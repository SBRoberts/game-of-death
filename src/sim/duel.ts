/**
 * A single round: two colonies, one shrinking board, biomass economy,
 * a hand of pattern cards, win/loss resolution. Deterministic given
 * (seed, sequence of playCard calls with their generation timing).
 */

import { createState, setCells, step } from './engine'
import { PATTERNS, RADICAL_SHAPES, patternById, placeAt, rotate, type Pattern } from './patterns'
import { geneByKey, normalizeChoice, type GeneChoice } from './genes'
import { geneChoiceWarp, rarityOf, type Rarity } from './warp'
import { seedById } from './seeds'
import {
  CHAIN_ARM_GENS,
  CHAIN_BREAK_GENS,
  CHAIN_FLOOR,
  CHAIN_SPIKE_CAP,
  chainTier,
  type BankedChain,
  type Combo,
} from './chain'
import { rngFrom, pickInt, type Rng } from './rng'
import { TUNING, type Tuning } from './tuning'
import { LIFE, mask, type Rule, type SimState } from './types'
import { aiAct, smartAct } from './ai'

export const PLAYER = 1
export const RIVAL = 2
export const RADICALS = 3

export type DuelStatus = 'running' | 'won' | 'lost'

/** A faction's built loadout: its Conway rule, draw pool, reach, economy. */
export interface FoldResult {
  rule: Rule
  pool: Pattern[]
  radius: number
  incomeScale: number
  startBonus: number
  /** Summed warp of the choices that ended up ACTIVE (within the cap). */
  activeWarp: number
}

const ROMAN = ['', '', ' II', ' III']

/** One offered upgrade in a chest draft. */
export interface ChestOption {
  key: string
  level: number
  name: string
  desc: string
  warp: number
  rarity: Rarity
  /** True if it fits under this round's warp cap right now; else it activates
   *  a later round when the cap rises (shown with an "activates later" tag). */
  activeNow: boolean
}

/** Genes offered by in-run chests. Thrifty is excluded — it mints biomass;
 *  Metabolism (an income rate) is its law-clean replacement. */
export const DRAFT_GENES = ['metabolism', 'ranger', 'hardy', 'highlife', 'elder', 'vampire', 'martyr']

/**
 * Fold a set of gene choices into a faction's rule/pool/economy. Pure and
 * order-deterministic. `warpCap` gates the pure→warped gradient: a choice is
 * applied only if it keeps the running active-warp within the cap, otherwise it
 * is held DORMANT (skipped) — so a round-1 cap of 0 folds to exactly LIFE.
 */
export function foldLoadout(
  t: Tuning,
  choices: readonly GeneChoice[],
  warpCap = Infinity,
): FoldResult {
  const rule: Rule = { birth: LIFE.birth, survive: LIFE.survive }
  const pool: Pattern[] = [...PATTERNS]
  let radius = t.placementRadius
  let incomeScale = t.incomeScale
  let startBonus = 0
  let activeWarp = 0
  for (const raw of choices) {
    const choice = normalizeChoice(raw)
    const w = geneChoiceWarp(choice)
    if (activeWarp + w > warpCap) continue // over the cap → dormant this round
    activeWarp += w
    const gene = geneByKey(choice.key)
    const level = Math.min(Math.max(choice.level, 1), gene.levels.length)
    const g = gene.levels[level - 1]
    if (g.addSurvive) rule.survive |= mask(...g.addSurvive)
    if (g.addBirth) rule.birth |= mask(...g.addBirth)
    if (g.radius !== undefined) radius = g.radius
    if (g.startBonus) startBonus += g.startBonus
    if (g.addIncomeScale) incomeScale += g.addIncomeScale
    if (g.card) {
      const base = patternById(g.card)
      pool.push({
        ...base,
        name: base.name + ROMAN[level],
        cost: g.cardCost ?? base.cost,
        cellType: g.cardType ?? base.cellType,
        tip: level > 1 ? g.desc : base.tip,
      })
    }
  }
  return { rule, pool, radius, incomeScale, startBonus, activeWarp }
}

export class Duel {
  readonly seed: string
  readonly t: Tuning
  readonly state: SimState
  /** Biomass per faction index (0 unused). */
  biomass: number[]
  hand: string[]
  status: DuelStatus = 'running'
  outcome = ''
  /** When true, the rival plays itself inside tick(); harness can disable. */
  autoRival = true
  /** Equipped gene choices (key or key+level), applied at construction. */
  readonly loadout: readonly GeneChoice[]
  /** The player's draw pool: base deck plus unlocked special cards. Mutable so
   *  in-run shop/chest drafting can re-derive it (see rebuildPlayer). */
  playerPool: readonly Pattern[]
  /** The rival's pool — grows with its own loadout in later rounds. */
  readonly rivalPool: readonly Pattern[]
  /** Per-faction placement radius (genes may extend the owner's only). */
  readonly radii: number[]
  /** Per-faction income scale (genes may boost the owner's only). */
  readonly incomeScales: number[]

  // ── in-run drafting (shop + chests) ─────────────────────────────────────
  /** Choices drafted DURING the run, layered on top of the base loadout. */
  runLoadout: GeneChoice[] = []
  /** Max active warp admitted this round; over-cap drafted tuples stay dormant
   *  (round 1's cap of 0 keeps the board pure Conway). Infinity = no gate. */
  warpCap = Infinity
  /** Run-scoped harvest currency, banked from converting radicals (never minted,
   *  never becomes biomass). Feeds the shop + chest economy; wiped each run. */
  plasm = 0
  /** Chests earned but not yet opened (the HUD shows this count). */
  pendingChests = 0
  /** How many chests have been opened this round — seeds the next offer. */
  chestIndex = 0
  private chestMeter = 0

  // ── The Chain: emergent-cascade scoring (see chain.ts) ──────────────────
  /** Live combo the web meter/callout reads each frame. */
  combo: Combo = { active: false, len: 0, total: 0, tier: -1, cx: 0, cy: 0 }
  /** Chains banked this duel; the web watches this array's length for callouts. */
  readonly bankedCombos: BankedChain[] = []
  peakChain = 0
  private comboArmedUntil = -1
  private comboLow = 0
  private prevCd: number[] = []
  private prevRivalCap = 0
  private prevRadCap = 0
  /** Rolling baseline of net enemy losses; a chain scores the spike ABOVE it,
   *  so steady two-front grind (net ≈ baseline) can't inflate a chain — only a
   *  burst does. This is what keeps tiers meaningful and legible. */
  private chainBaseline = 0

  /** Reroll cost escalates with uses since your last placement. */
  private rerollUses = 0

  private drawRng: Rng
  private rivalRng: Rng

  /** The player's and rival's chosen starting formations (see seeds.ts). */
  readonly colonySeed: string
  readonly rivalSeed: string

  constructor(
    seed: string,
    overrides: Partial<Tuning> = {},
    loadout: readonly GeneChoice[] = [],
    rivalLoadout: readonly GeneChoice[] = [],
    colonySeed = 'soup',
    rivalSeed = 'soup',
  ) {
    this.seed = seed
    this.loadout = loadout
    this.colonySeed = colonySeed
    this.rivalSeed = rivalSeed

    // A faction's genes build its rule, pool, and economy — all owned by that
    // faction alone (see foldLoadout). Each gene applies at its chosen level;
    // card genes may override the card's cost or upgrade its cell-type variant.
    const t = { ...TUNING, ...overrides }
    this.t = t
    const player = foldLoadout(t, loadout)
    const rival = foldLoadout(t, rivalLoadout)
    this.playerPool = player.pool
    this.rivalPool = rival.pool
    this.radii = [0, player.radius, rival.radius, t.placementRadius]
    this.incomeScales = [0, player.incomeScale, rival.incomeScale, 0]
    const playerRule = player.rule

    this.state = createState({
      width: this.t.width,
      height: this.t.height,
      factions: [
        { name: 'dead', rule: LIFE },
        { name: 'you', rule: playerRule },
        { name: 'rival', rule: rival.rule },
        { name: 'free radicals', rule: LIFE },
      ],
      flankingMargin: this.t.flankingMargin,
      casualtyMargin: this.t.casualtyMargin,
    })
    this.prevCd = new Array(this.state.cfg.factions.length).fill(0)
    this.biomass = [
      0,
      this.t.startBiomass + player.startBonus,
      this.t.startBiomass + rival.startBonus,
      0,
    ]
    this.drawRng = rngFrom(seed, 'draw')
    this.rivalRng = rngFrom(seed, 'rival')

    const soupRng = rngFrom(seed, 'soup')
    this.seedColony(PLAYER, Math.floor(this.t.width * 0.22), Math.floor(this.t.height / 2), soupRng, colonySeed)
    this.seedColony(RIVAL, Math.floor(this.t.width * 0.78), Math.floor(this.t.height / 2), soupRng, rivalSeed)
    this.seedRadicals(rngFrom(seed, 'radicals'))

    this.hand = Array.from({ length: this.t.handSize }, () => this.draw())
  }

  /**
   * Re-derive the player's rule / pool / reach / economy from the base loadout
   * plus the run-drafted loadout, honoring the current warp cap, and write the
   * new Conway rule into the live faction so the next tick evolves under it.
   * Called after a shop purchase or a chest pick. Never re-grants startBonus
   * (that would retroactively mint biomass), keeping law #1 intact.
   */
  rebuildPlayer(): void {
    const p = foldLoadout(this.t, [...this.loadout, ...this.runLoadout], this.warpCap)
    this.playerPool = p.pool
    this.radii[PLAYER] = p.radius
    this.incomeScales[PLAYER] = p.incomeScale
    const rule = this.state.cfg.factions[PLAYER].rule
    rule.survive = p.rule.survive
    rule.birth = p.rule.birth
  }

  /** Summed active warp of the player's current build (drives rarity + glow). */
  get playerWarp(): number {
    return foldLoadout(this.t, [...this.loadout, ...this.runLoadout], this.warpCap).activeWarp
  }

  /** The current level of a drafted gene (0 = not yet owned this run). */
  private runLevel(key: string): number {
    let lvl = 0
    for (const c of this.runLoadout) {
      const n = normalizeChoice(c)
      if (n.key === key) lvl = Math.max(lvl, n.level)
    }
    return lvl
  }

  /**
   * The pick-1-of-3 offered by the chest at the given index. Deterministic
   * (seeded by seed+round+index), and dependent only on the drafted build so
   * far — so a run replays byte-identically. Each option is the NEXT rung of a
   * draftable gene; at least one is active under the current cap so every chest
   * has immediate value, the rest activate as later rounds raise the cap.
   */
  chestOptions(index: number, count = 3): ChestOption[] {
    const rng = rngFrom(this.seed, `chest:${index}`)
    const nowWarp = this.playerWarp
    const toOption = (key: string, level: number): ChestOption => {
      const gene = geneByKey(key)
      const g = gene.levels[level - 1]
      const w = geneChoiceWarp({ key, level })
      return {
        key,
        level,
        name: gene.name + ROMAN[level],
        desc: g.desc,
        warp: w,
        rarity: rarityOf(w),
        activeNow: nowWarp + w <= this.warpCap,
      }
    }
    // Candidates = the next un-maxed rung of every draftable gene.
    const cands = DRAFT_GENES.map((key) => ({ key, level: this.runLevel(key) + 1 }))
      .filter((c) => c.level <= geneByKey(c.key).levels.length)
      .map((c) => toOption(c.key, c.level))
    // Deterministic Fisher-Yates shuffle.
    for (let i = cands.length - 1; i > 0; i--) {
      const j = pickInt(rng, i + 1)
      ;[cands[i], cands[j]] = [cands[j], cands[i]]
    }
    // Lead with an active-now option (immediate value), then fill to 3 distinct.
    const active = cands.filter((c) => c.activeNow)
    const picks: ChestOption[] = active.length ? [active[0]] : []
    for (const c of cands) {
      if (picks.length >= count) break
      if (!picks.some((p) => p.key === c.key)) picks.push(c)
    }
    return picks
  }

  /**
   * Apply a chosen chest option: level the gene in the run build (in place, so
   * it persists across rounds), spend the chest, advance the offer stream, and
   * re-derive the player under the current cap. The pick is a recorded action,
   * like playCard — so (seed, actions) replays exactly.
   */
  applyChestPick(choice: GeneChoice): void {
    const c = normalizeChoice(choice)
    const i = this.runLoadout.findIndex((x) => normalizeChoice(x).key === c.key)
    if (i >= 0) this.runLoadout[i] = c
    else this.runLoadout.push(c)
    this.pendingChests = Math.max(0, this.pendingChests - 1)
    this.chestIndex++
    this.rebuildPlayer()
  }

  /** Neutral debris field in the midfield: cover, obstacles, capturable matter. */
  private seedRadicals(rng: Rng): void {
    const { width: w, height: h } = this.state.cfg
    for (let i = 0; i < this.t.radicalsCount; i++) {
      const shape = RADICAL_SHAPES[pickInt(rng, RADICAL_SHAPES.length)]
      const cells = placeAt(
        rotate(shape, pickInt(rng, 4)),
        Math.floor(w * 0.34 + rng() * w * 0.32),
        4 + pickInt(rng, h - 12),
      )
      // Require an empty 1-cell margin so debris seeds don't touch and bloom.
      const clear = cells.every(([x, y]) => {
        if (x < 2 || x >= w - 2 || y < 2 || y >= h - 2) return false
        for (let yy = y - 1; yy <= y + 1; yy++) {
          for (let xx = x - 1; xx <= x + 1; xx++) {
            if (this.state.cells[yy * w + xx] !== 0) return false
          }
        }
        return true
      })
      if (clear) setCells(this.state, RADICALS, cells)
    }
  }

  private seedColony(faction: number, cx: number, cy: number, rng: Rng, seedId = 'soup'): void {
    const seed = seedById(seedId)
    if (seed.cells) {
      // Stamp the chosen formation centered on the colony origin.
      const pattern = seed.cells
      const w = Math.max(...pattern.map(([x]) => x)) + 1
      const h = Math.max(...pattern.map(([, y]) => y)) + 1
      const ox = cx - Math.floor(w / 2)
      const oy = cy - Math.floor(h / 2)
      setCells(
        this.state,
        faction,
        pattern.map(([x, y]) => [ox + x, oy + y] as const),
      )
      return
    }
    // A soup seed: a random disc. Default params match the tuning so a no-arg
    // duel is byte-identical to before (harness/proofs unaffected).
    const r = seed.soup?.radius ?? this.t.seedBlobRadius
    const density = seed.soup?.density ?? this.t.seedDensity
    const coords: Array<[number, number]> = []
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (dx * dx + dy * dy > r * r) continue
        if (rng() < density) coords.push([cx + dx, cy + dy])
      }
    }
    setCells(this.state, faction, coords)
  }

  private draw(): string {
    return this.playerPool[pickInt(this.drawRng, this.playerPool.length)].id
  }

  /** Draw pool a faction's policy may buy from. */
  poolFor(faction: number): readonly Pattern[] {
    if (faction === PLAYER) return this.playerPool
    if (faction === RIVAL) return this.rivalPool
    return PATTERNS
  }

  /** Resolve a pattern id to THIS faction's (possibly leveled) variant. */
  patternFor(faction: number, id: string): Pattern {
    return this.poolFor(faction).find((p) => p.id === id) ?? patternById(id)
  }

  /** Test/dev hook: end the duel now (wired to a key only in ?debug mode). */
  forceEnd(status: 'won' | 'lost'): void {
    if (this.status === 'running') this.finish(status, 'debug')
  }

  /** What happened this duel — feeds the cash-out and the HUD tickers. */
  get summary() {
    const nf = this.state.cfg.factions.length
    return {
      gens: this.state.gen,
      rivalDestroyed: this.state.deaths[RIVAL],
      playerLost: this.state.deaths[PLAYER],
      radicalsClaimed: this.state.converts[RADICALS * nf + PLAYER],
      rivalConverted: this.state.converts[RIVAL * nf + PLAYER],
      peakChain: this.peakChain,
      bankedCombos: this.bankedCombos,
    }
  }

  // ── reroll & dig the hand (a second biomass sink) ────────────────────────
  /** Biomass cost of the next reroll; rises with uses since the last placement. */
  rerollCost(whole: boolean): number {
    return (whole ? 6 : 2) + this.rerollUses * (whole ? 4 : 2)
  }

  /** Redraw one hand slot for biomass. Returns true on success. */
  rerollCard(handIdx: number): boolean {
    if (this.status !== 'running' || handIdx < 0 || handIdx >= this.hand.length) return false
    const cost = this.rerollCost(false)
    if (this.biomass[PLAYER] < cost) return false
    this.biomass[PLAYER] -= cost
    this.hand[handIdx] = this.draw()
    this.rerollUses++
    return true
  }

  /** Redraw the whole hand for biomass. Returns true on success. */
  rerollHand(): boolean {
    if (this.status !== 'running') return false
    const cost = this.rerollCost(true)
    if (this.biomass[PLAYER] < cost) return false
    this.biomass[PLAYER] -= cost
    this.hand = this.hand.map(() => this.draw())
    this.rerollUses++
    return true
  }

  get maxInset(): number {
    return Math.floor(Math.min(this.t.width, this.t.height) / 2) - this.t.ringMinHalf
  }

  /** Inset the storm will have at a given generation. */
  insetAt(gen: number): number {
    if (gen <= this.t.ringGrace) return 0
    return Math.min(this.maxInset, Math.floor((gen - this.t.ringGrace) / this.t.ringShrinkEvery))
  }

  income(faction: number): number {
    return this.t.incomeBase + this.incomeScales[faction] * Math.sqrt(this.state.pops[faction])
  }

  tick(): void {
    if (this.status !== 'running') return
    const s = this.state

    s.ringInset = this.insetAt(s.gen + 1)
    step(s)
    this.trackChain()
    this.biomass[PLAYER] += this.income(PLAYER)
    this.biomass[RIVAL] += this.income(RIVAL)

    if (this.autoRival && s.gen % this.t.aiActEvery === 0) {
      if (this.t.rivalSmart) {
        smartAct(this, RIVAL, this.rivalRng, PLAYER, this.t.aiSamples, this.t.aiHorizon)
      } else {
        aiAct(this, RIVAL, this.rivalRng, PLAYER)
      }
    }

    if (s.gen > this.t.warmupGens) {
      if (s.pops[PLAYER] === 0) return this.finish('lost', 'Your colony is extinct.')
      if (s.pops[RIVAL] === 0) return this.finish('won', 'The rival colony is extinct.')
    }
    if (s.ringInset >= this.maxInset || s.gen >= this.t.genLimit) {
      const [p, r] = [s.pops[PLAYER], s.pops[RIVAL]]
      if (p > r) this.finish('won', `The storm closed. Territory: ${p} vs ${r}.`)
      else this.finish('lost', `The storm closed. Territory: ${p} vs ${r}. The house wins ties.`)
    }
  }

  private finish(status: DuelStatus, outcome: string): void {
    // Bank any chain still building when the duel ends.
    this.bankChain()
    this.status = status
    this.outcome = outcome
  }

  /**
   * Score this generation's net enemy losses into a chain. Combat deaths only
   * (storm-excluded upstream), armed only for a window after a player action
   * and never while the storm is closing — so a chain is legibly the player's
   * doing, not the ring's culling or ambient two-front grind.
   */
  private trackChain(): void {
    const s = this.state
    const nf = s.cfg.factions.length
    const cd = s.combatDeaths
    const cv = s.converts
    const rivalCap = cv[RIVAL * nf + PLAYER]
    const radCap = cv[RADICALS * nf + PLAYER]
    const perGen =
      cd[RIVAL] - this.prevCd[RIVAL] +
      (rivalCap - this.prevRivalCap) +
      (radCap - this.prevRadCap) -
      (cd[PLAYER] - this.prevCd[PLAYER])
    // Harvest: converting radicals banks PLASM and fills the chest meter. It's
    // a ledger of matter already on the board (never minted), gen-indexed and
    // deterministic — no RNG on the earn side.
    const harvest = radCap - this.prevRadCap
    if (harvest > 0) {
      this.plasm += harvest * this.t.plasmPerRadical
      this.chestMeter += harvest
      while (this.chestMeter >= this.t.chestEvery) {
        this.chestMeter -= this.t.chestEvery
        this.pendingChests++
      }
    }
    this.prevCd[RIVAL] = cd[RIVAL]
    this.prevCd[PLAYER] = cd[PLAYER]
    this.prevRivalCap = rivalCap
    this.prevRadCap = radCap

    // Score the spike above the rolling baseline (capped per gen), then let the
    // baseline chase perGen fast — so a burst scores big while a sustained grind
    // stops scoring within a few gens. Keeps chains rare and legible.
    const spike = Math.min(CHAIN_SPIKE_CAP, perGen - this.chainBaseline)
    this.chainBaseline += (perGen - this.chainBaseline) * 0.22

    const armed = s.gen <= this.comboArmedUntil && s.ringInset === 0
    const combo = this.combo
    if (armed && spike >= CHAIN_FLOOR) {
      if (!combo.active) {
        combo.active = true
        combo.len = 0
        combo.total = 0
      }
      combo.len++
      combo.total += spike
      combo.tier = chainTier(combo.total)
      if (s.killN > 0) {
        combo.cx = s.killSumX / s.killN
        combo.cy = s.killSumY / s.killN
      }
      this.comboLow = 0
    } else if (combo.active) {
      this.comboLow++
      if (this.comboLow >= CHAIN_BREAK_GENS || !armed) this.bankChain()
    }
  }

  private bankChain(): void {
    const combo = this.combo
    if (!combo.active) return
    const tier = chainTier(combo.total)
    if (tier >= 0) {
      this.bankedCombos.push({ tier, total: combo.total, gen: this.state.gen, cx: combo.cx, cy: combo.cy })
      if (combo.total > this.peakChain) this.peakChain = combo.total
    }
    combo.active = false
    combo.total = 0
    combo.len = 0
    combo.tier = -1
    this.comboLow = 0
  }

  /** Absolute cells for a pattern at anchor/rotation — shared by ghost + place. */
  patternCells(pattern: Pattern, ox: number, oy: number, rot: number): Array<[number, number]> {
    return placeAt(rotate(pattern.cells, rot), ox, oy)
  }

  /** Why a placement is illegal — 'ok' means it isn't. */
  placeProblem(
    faction: number,
    cells: ReadonlyArray<readonly [number, number]>,
    clearance = 0,
  ): 'ok' | 'storm' | 'occupied' | 'far' | 'blocked' {
    const s = this.state
    const { width: w, height: h } = s.cfg
    const inset = s.ringInset
    let nearColony = false
    for (const [x, y] of cells) {
      if (x < inset || x >= w - inset || y < inset || y >= h - inset) return 'storm'
      if (s.cells[y * w + x] !== 0) return 'occupied' // no overwriting live cells
      if (!nearColony && this.withinInfluence(faction, x, y)) nearColony = true
    }
    if (!nearColony) return 'far'
    if (clearance > 0) {
      // Travelers need open ground, or the surrounding ash corrupts them.
      const own = new Set(cells.map(([x, y]) => y * w + x))
      for (const [x, y] of cells) {
        for (let yy = Math.max(0, y - clearance); yy <= Math.min(h - 1, y + clearance); yy++) {
          for (let xx = Math.max(0, x - clearance); xx <= Math.min(w - 1, x + clearance); xx++) {
            const i = yy * w + xx
            if (s.cells[i] !== 0 && !own.has(i)) return 'blocked'
          }
        }
      }
    }
    return 'ok'
  }

  canPlace(
    faction: number,
    cells: ReadonlyArray<readonly [number, number]>,
    clearance = 0,
  ): boolean {
    return this.placeProblem(faction, cells, clearance) === 'ok'
  }

  /** Ghost info for the UI: cells, legality, and the reason when illegal. */
  ghostFor(
    faction: number,
    patternId: string,
    ox: number,
    oy: number,
    rot: number,
  ): {
    pattern: Pattern
    cells: Array<[number, number]>
    valid: boolean
    problem: 'ok' | 'storm' | 'occupied' | 'far' | 'blocked' | 'poor'
  } {
    const pattern = this.patternFor(faction, patternId)
    const cells = this.patternCells(pattern, ox, oy, rot)
    let problem = this.placeProblem(faction, cells, pattern.clearance) as
      | 'ok'
      | 'storm'
      | 'occupied'
      | 'far'
      | 'blocked'
      | 'poor'
    if (problem === 'ok' && this.biomass[faction] < pattern.cost) problem = 'poor'
    return { pattern, cells, valid: this.status === 'running' && problem === 'ok', problem }
  }

  private withinInfluence(faction: number, x: number, y: number): boolean {
    const s = this.state
    const { width: w, height: h } = s.cfg
    const r = this.radii[faction] ?? this.t.placementRadius
    for (let yy = Math.max(0, y - r); yy <= Math.min(h - 1, y + r); yy++) {
      const base = yy * w
      for (let xx = Math.max(0, x - r); xx <= Math.min(w - 1, x + r); xx++) {
        if (s.cells[base + xx] === faction) return true
      }
    }
    return false
  }

  /** Internal placement, shared by player and AI. */
  tryPlace(faction: number, patternId: string, ox: number, oy: number, rot: number): boolean {
    if (this.status !== 'running') return false
    const pattern = this.patternFor(faction, patternId)
    if (this.biomass[faction] < pattern.cost) return false
    const cells = this.patternCells(pattern, ox, oy, rot)
    if (!this.canPlace(faction, cells, pattern.clearance)) return false
    setCells(this.state, faction, cells, pattern.cellType ?? 0)
    this.biomass[faction] -= pattern.cost
    return true
  }

  /** Player plays a card from the hand; the slot refills from the deck. */
  playCard(handIdx: number, ox: number, oy: number, rot: number): Array<[number, number]> | null {
    const id = this.hand[handIdx]
    if (!id) return null
    const pattern = this.patternFor(PLAYER, id)
    const cells = this.patternCells(pattern, ox, oy, rot)
    if (!this.tryPlace(PLAYER, id, ox, oy, rot)) return null
    this.hand[handIdx] = this.draw()
    // Arm the chain scorer: cascades over the next window are the player's doing.
    this.comboArmedUntil = this.state.gen + CHAIN_ARM_GENS
    this.rerollUses = 0 // a placement resets the reroll price
    return cells
  }
}
