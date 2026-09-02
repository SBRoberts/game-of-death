/**
 * A single round: two colonies, one shrinking board, biomass economy,
 * a hand of pattern cards, win/loss resolution. Deterministic given
 * (seed, sequence of playCard calls with their generation timing).
 */

import { createState, setCells, step } from './engine'
import { PATTERNS, RADICAL_SHAPES, patternById, placeAt, rotate, type Pattern } from './patterns'
import { geneByKey, normalizeChoice, type GeneChoice } from './genes'
import { rngFrom, pickInt, type Rng } from './rng'
import { TUNING, type Tuning } from './tuning'
import { LIFE, mask, type Rule, type SimState } from './types'
import { aiAct, smartAct } from './ai'

export const PLAYER = 1
export const RIVAL = 2
export const RADICALS = 3

export type DuelStatus = 'running' | 'won' | 'lost'

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
  /** The player's draw pool: base deck plus unlocked special cards. */
  readonly playerPool: readonly Pattern[]
  /** The rival's pool — grows with its own loadout in later rounds. */
  readonly rivalPool: readonly Pattern[]
  /** Per-faction placement radius (genes may extend the owner's only). */
  readonly radii: number[]
  /** Per-faction income scale (genes may boost the owner's only). */
  readonly incomeScales: number[]

  private drawRng: Rng
  private rivalRng: Rng

  constructor(
    seed: string,
    overrides: Partial<Tuning> = {},
    loadout: readonly GeneChoice[] = [],
    rivalLoadout: readonly GeneChoice[] = [],
  ) {
    this.seed = seed
    this.loadout = loadout

    // A faction's genes build its rule, pool, and economy — all owned by that
    // faction alone. Each gene applies at its chosen level; card genes may
    // override the card's cost or upgrade its cell-type variant.
    const t = { ...TUNING, ...overrides }
    this.t = t
    const ROMAN = ['', '', ' II', ' III']
    const build = (choices: readonly GeneChoice[]) => {
      const rule: Rule = { birth: LIFE.birth, survive: LIFE.survive }
      const pool: Pattern[] = [...PATTERNS]
      let radius = t.placementRadius
      let incomeScale = t.incomeScale
      let startBonus = 0
      for (const choice of choices.map(normalizeChoice)) {
        const gene = geneByKey(choice.key)
        const level = Math.min(Math.max(choice.level, 1), gene.levels.length)
        const g = gene.levels[level - 1]
        if (g.addSurvive) rule.survive |= mask(...g.addSurvive)
        if (g.addBirth) rule.birth |= mask(...g.addBirth)
        if (g.radius !== undefined) radius = g.radius
        if (g.startBonus) startBonus += g.startBonus
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
      return { rule, pool, radius, incomeScale, startBonus }
    }
    const player = build(loadout)
    const rival = build(rivalLoadout)
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
    this.biomass = [
      0,
      this.t.startBiomass + player.startBonus,
      this.t.startBiomass + rival.startBonus,
      0,
    ]
    this.drawRng = rngFrom(seed, 'draw')
    this.rivalRng = rngFrom(seed, 'rival')

    const soupRng = rngFrom(seed, 'soup')
    this.seedColony(PLAYER, Math.floor(this.t.width * 0.22), Math.floor(this.t.height / 2), soupRng)
    this.seedColony(RIVAL, Math.floor(this.t.width * 0.78), Math.floor(this.t.height / 2), soupRng)
    this.seedRadicals(rngFrom(seed, 'radicals'))

    this.hand = Array.from({ length: this.t.handSize }, () => this.draw())
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

  private seedColony(faction: number, cx: number, cy: number, rng: Rng): void {
    const r = this.t.seedBlobRadius
    const coords: Array<[number, number]> = []
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (dx * dx + dy * dy > r * r) continue
        if (rng() < this.t.seedDensity) coords.push([cx + dx, cy + dy])
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
    }
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
    this.status = status
    this.outcome = outcome
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
    return cells
  }
}
