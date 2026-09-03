/**
 * Meta-progression state: ash currency, genome slots, owned + equipped genes.
 * Lives entirely in the web layer (localStorage) — the sim stays pure and
 * receives the equipped loadout as a plain argument.
 */

import {
  CHAIN_TIERS,
  Duel,
  GENES,
  SEEDS,
  SLOT_COSTS,
  chainAshValue,
  geneByKey,
  maxLevel,
  seedById,
  type GeneChoice,
} from '../sim'

const KEY = 'god-meta-v1'

/** Seeds owned from the start: the soup, and the free challenge. */
const STARTER_SEEDS = SEEDS.filter((s) => s.ashCost === 0).map((s) => s.id)

export interface MetaState {
  ash: number
  slots: number
  /** Gene key → owned level (absent = not owned). */
  levels: Record<string, number>
  equipped: string[]
  /** Owned starting seeds and the one selected for the next run. */
  seedsOwned: string[]
  seedSel: string
  /** Completed challenge-seed ids (bounty already paid). */
  challenges: string[]
  /** Biggest cascade ever pulled off (peak chain ×N) — the flex stat. */
  best: number
  /** Furthest round ever reached (1-based) — the progress stat. */
  bestRound: number
  /** Capped baseline perks: perk key → owned level (a short competence ramp
   *  that plateaus; ash beyond the cap buys only breadth + difficulty). */
  perks: Record<string, number>
  /** Chosen Biosafety Level for the next run (1–4), and the highest unlocked. */
  bsl: number
  bslMax: number
}

export function loadMeta(): MetaState {
  const fresh = (): MetaState => ({
    ash: 0,
    slots: 0,
    levels: {},
    equipped: [],
    seedsOwned: [...STARTER_SEEDS],
    seedSel: 'seedling',
    challenges: [],
    best: 0,
    bestRound: 0,
    perks: {},
    bsl: 1,
    bslMax: 1,
  })
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) {
      const m = JSON.parse(raw) as Partial<MetaState> & { owned?: string[] }
      // v1 migration: an `owned` array becomes level-1 entries.
      const levels: Record<string, number> = { ...(m.levels ?? {}) }
      if (Array.isArray(m.owned)) for (const k of m.owned) levels[k] ??= 1
      // v2→v3 migration: seeds/challenges default to the starter set; keep
      // only ids that still exist in the catalog.
      const valid = new Set(SEEDS.map((s) => s.id))
      const seedsOwned = Array.from(
        new Set([...STARTER_SEEDS, ...(m.seedsOwned ?? []).filter((id) => valid.has(id))]),
      )
      const seedSel = seedsOwned.includes(m.seedSel ?? '') ? m.seedSel! : 'seedling'
      return {
        ash: m.ash! | 0,
        slots: Math.min(m.slots! | 0, SLOT_COSTS.length),
        levels,
        equipped: Array.isArray(m.equipped)
          ? m.equipped.filter((k) => levels[k]).slice(0, m.slots! | 0)
          : [],
        seedsOwned,
        seedSel,
        challenges: Array.isArray(m.challenges) ? m.challenges : [],
        best: m.best! | 0,
        bestRound: m.bestRound! | 0,
        perks: (m.perks as Record<string, number>) ?? {},
        bsl: Math.max(1, Math.min(4, m.bsl! | 0 || 1)),
        bslMax: Math.max(1, Math.min(4, m.bslMax! | 0 || 1)),
      }
    }
  } catch {
    /* corrupted or unavailable: start fresh */
  }
  return fresh()
}

/** The equipped loadout with levels, ready to hand to a Duel. */
export function loadoutOf(m: MetaState): GeneChoice[] {
  return m.equipped.map((key) => ({ key, level: m.levels[key] ?? 1 }))
}

function save(m: MetaState): MetaState {
  try {
    localStorage.setItem(KEY, JSON.stringify(m))
  } catch {
    /* private mode */
  }
  return m
}

export interface AshRow {
  label: string
  detail: string
  value: number
  /** Chain tier index (0-4) for cascade rows, so the ledger can color them. */
  tier?: number
}

/**
 * Itemized ash payout — one source of truth for the earn logic AND the
 * cash-out screen, so the reward you watch count up is the reward you get.
 *
 * Raw attrition ('destruction') is the floor; the banked cascades are the
 * highlight reel — each named chain pays a convex tier bonus on top, so the
 * skill of *engineering* a wipe out-earns grinding one cell at a time.
 */
export function ashBreakdown(
  duel: Duel,
  runClear: boolean,
  opts: { newFrontier?: boolean } = {},
): { rows: AshRow[]; total: number } {
  const s = duel.summary
  const rows: AshRow[] = [
    // Loss-floor: every specimen you run pays something, so a death is never a
    // dry hole — you always walk away with progress.
    { label: 'specimen logged', detail: 'the record grows', value: 3 },
    { label: 'endurance', detail: `${s.gens} generations`, value: Math.floor(s.gens / 20) },
    {
      label: 'destruction',
      detail: `${s.rivalDestroyed.toLocaleString()} rival cells died`,
      value: Math.floor(s.rivalDestroyed / 2000),
    },
  ]
  // New frontier: reaching a round you've never reached pays a milestone bounty,
  // win or lose — so pushing deeper is rewarded even on the run that kills you.
  if (opts.newFrontier)
    rows.push({ label: 'new frontier', detail: 'deepest yet', value: 30 })
  // Cascade rows: one per tier reached, richest tier first (the reel's peak).
  const byTier = new Map<number, number>()
  for (const bc of s.bankedCombos) byTier.set(bc.tier, (byTier.get(bc.tier) ?? 0) + 1)
  for (let t = CHAIN_TIERS.length - 1; t >= 0; t--) {
    const n = byTier.get(t)
    if (!n) continue
    rows.push({
      label: CHAIN_TIERS[t].name.toLowerCase(),
      detail: n > 1 ? `${n} cascades` : 'a cascade',
      value: chainAshValue(t) * n,
      tier: t,
    })
  }
  if (s.radicalsClaimed > 0)
    rows.push({
      label: 'capture',
      detail: `${s.radicalsClaimed} radicals claimed`,
      value: Math.floor(s.radicalsClaimed / 2),
    })
  if (s.rivalConverted > 0)
    rows.push({
      label: 'conversion',
      detail: `${s.rivalConverted} enemies turned`,
      value: Math.floor(s.rivalConverted / 5),
    })
  if (duel.status === 'won') rows.push({ label: 'victory', detail: 'round cleared', value: 25 })
  if (runClear) rows.push({ label: 'the universe yields', detail: 'full gauntlet', value: 40 })
  const total = rows.reduce((a, r) => a + r.value, 0)
  return { rows: rows.filter((r) => r.value > 0), total }
}

/** Ash earned by a finished duel (see ashBreakdown for the itemization). */
export function ashFor(duel: Duel, runClear = false, opts: { newFrontier?: boolean } = {}): number {
  return ashBreakdown(duel, runClear, opts).total
}

export function earnAsh(m: MetaState, amount: number): MetaState {
  return save({ ...m, ash: m.ash + amount })
}

/**
 * Fold a finished run's records into the meta. Returns the new state and which
 * records fell, so the cash-out can announce NEW BEST / NEW FRONTIER.
 */
export function recordRun(
  m: MetaState,
  peakChain: number,
  roundReached: number,
): { meta: MetaState; newBest: boolean; newFrontier: boolean } {
  const newBest = peakChain > m.best
  const newFrontier = roundReached > m.bestRound
  if (!newBest && !newFrontier) return { meta: m, newBest: false, newFrontier: false }
  return {
    meta: save({
      ...m,
      best: Math.max(m.best, peakChain),
      bestRound: Math.max(m.bestRound, roundReached),
    }),
    newBest,
    newFrontier,
  }
}

/**
 * The smallest ash gap to the next thing you could buy (slot, gene level, or
 * seed). Null when everything reachable is already affordable or maxed — the
 * cash-out uses it for the "N to next unlock" carrot.
 */
export function nextUnlockGap(m: MetaState): { gap: number; label: string } | null {
  const options: { cost: number; label: string }[] = []
  const slot = nextSlotCost(m)
  if (slot !== null) options.push({ cost: slot, label: 'a genome slot' })
  for (const g of GENES) {
    const c = upgradeCost(m, g.key)
    if (c !== null) options.push({ cost: c, label: (m.levels[g.key] ?? 0) > 0 ? `${g.name} +1` : g.name })
  }
  for (const s of SEEDS) {
    if (!m.seedsOwned.includes(s.id) && s.ashCost > 0)
      options.push({ cost: s.ashCost, label: s.name })
  }
  const unaffordable = options.filter((o) => o.cost > m.ash).sort((a, b) => a.cost - b.cost)
  if (unaffordable.length === 0) return null
  const next = unaffordable[0]
  return { gap: next.cost - m.ash, label: next.label }
}

export function nextSlotCost(m: MetaState): number | null {
  return m.slots < SLOT_COSTS.length ? SLOT_COSTS[m.slots] : null
}

export function buySlot(m: MetaState): MetaState {
  const cost = nextSlotCost(m)
  if (cost === null || m.ash < cost) return m
  return save({ ...m, ash: m.ash - cost, slots: m.slots + 1 })
}

/** Ash cost of the NEXT level of a gene (null when maxed). */
export function upgradeCost(m: MetaState, key: string): number | null {
  const level = m.levels[key] ?? 0
  if (level >= maxLevel(key)) return null
  return geneByKey(key).levels[level].ashCost
}

/** Buy level 1, or the next level if already owned. */
export function buyGene(m: MetaState, key: string): MetaState {
  const cost = upgradeCost(m, key)
  if (cost === null || m.ash < cost) return m
  return save({
    ...m,
    ash: m.ash - cost,
    levels: { ...m.levels, [key]: (m.levels[key] ?? 0) + 1 },
  })
}

export function toggleEquip(m: MetaState, key: string): MetaState {
  if (!m.levels[key]) return m
  const equipped = m.equipped.includes(key)
    ? m.equipped.filter((k) => k !== key)
    : m.equipped.length < m.slots
      ? [...m.equipped, key]
      : m.equipped
  return save({ ...m, equipped })
}

// ── seeds ───────────────────────────────────────────────────────────────────

/** Buy an unlockable seed (owned seeds are a no-op). */
export function buySeed(m: MetaState, id: string): MetaState {
  if (m.seedsOwned.includes(id)) return m
  const cost = seedById(id).ashCost
  if (m.ash < cost) return m
  return save({ ...m, ash: m.ash - cost, seedsOwned: [...m.seedsOwned, id] })
}

/** Choose the seed for the next run (owned only). */
export function selectSeed(m: MetaState, id: string): MetaState {
  if (!m.seedsOwned.includes(id)) return m
  return save({ ...m, seedSel: id })
}

/**
 * Pay a challenge-seed bounty the first time its condition is met. Returns the
 * updated state and the bounty granted (0 if none), so the caller can announce.
 */
export function claimChallenge(m: MetaState, seedId: string): { meta: MetaState; bounty: number } {
  const seed = seedById(seedId)
  if (!seed.challenge || m.challenges.includes(seedId)) return { meta: m, bounty: 0 }
  const bounty = seed.challenge.rewardAsh
  return {
    meta: save({ ...m, ash: m.ash + bounty, challenges: [...m.challenges, seedId] }),
    bounty,
  }
}

// ── capped baseline perks (a short competence ramp that plateaus) ────────────
export interface PerkDef {
  key: string
  name: string
  desc: string
  costs: number[] // ash per level; length = cap
}

export const PERKS: readonly PerkDef[] = [
  { key: 'reserve', name: 'Reserve Culture', desc: 'Begin each run with banked PLASM for the first shop.', costs: [40, 90, 150] },
  { key: 'sight', name: 'Wide Assay', desc: 'Plasmid chests reveal a fourth option.', costs: [120] },
  { key: 'rerolls', name: 'Free Reagents', desc: 'Begin each shop visit with free rerolls.', costs: [55, 130] },
  { key: 'vitality', name: 'Vitality', desc: 'A small permanent lift to your income rate.', costs: [45, 110, 200] },
]

// Cumulative effect value at each level.
const PERK_VALUE: Record<string, number[]> = {
  reserve: [8, 16, 24],
  sight: [1],
  rerolls: [1, 2],
  vitality: [0.004, 0.008, 0.012],
}

export const perkDef = (key: string): PerkDef => PERKS.find((p) => p.key === key)!
export const perkLevel = (m: MetaState, key: string): number => m.perks[key] ?? 0
export const perkCap = (key: string): number => perkDef(key).costs.length
export function perkCost(m: MetaState, key: string): number | null {
  const lvl = perkLevel(m, key)
  return lvl < perkCap(key) ? perkDef(key).costs[lvl] : null
}
export function buyPerk(m: MetaState, key: string): MetaState {
  const cost = perkCost(m, key)
  if (cost === null || m.ash < cost) return m
  return save({ ...m, ash: m.ash - cost, perks: { ...m.perks, [key]: perkLevel(m, key) + 1 } })
}
/** True once every perk is maxed — the plateau; ash now buys only breadth + BSL. */
export const perksMaxed = (m: MetaState): boolean => PERKS.every((p) => perkLevel(m, p.key) >= p.costs.length)

const perkVal = (m: MetaState, key: string): number => {
  const lvl = perkLevel(m, key)
  return lvl > 0 ? PERK_VALUE[key][lvl - 1] : 0
}
export interface PerkEffects {
  startPlasm: number
  chestOptions: number
  freeRerolls: number
  incomeBonus: number
}
export function perkEffects(m: MetaState): PerkEffects {
  return {
    startPlasm: perkVal(m, 'reserve'),
    chestOptions: 3 + perkVal(m, 'sight'),
    freeRerolls: perkVal(m, 'rerolls'),
    incomeBonus: perkVal(m, 'vitality'),
  }
}

// ── BSL: the pre-run difficulty selector (harder = more ash) ─────────────────
export interface BslDef {
  level: number
  label: string
  blurb: string
  ashMult: number
  aiSamplesAdd: number
  aiActEveryMul: number
  ringGraceMul: number
}
export const BSL: readonly BslDef[] = [
  { level: 1, label: 'BSL-1 · Contained', blurb: 'A calm specimen. Standard threat.', ashMult: 1.0, aiSamplesAdd: 0, aiActEveryMul: 1, ringGraceMul: 1 },
  { level: 2, label: 'BSL-2 · Hazardous', blurb: 'Sharper rival, sooner storm. +40% ash.', ashMult: 1.4, aiSamplesAdd: 3, aiActEveryMul: 0.85, ringGraceMul: 0.85 },
  { level: 3, label: 'BSL-3 · Virulent', blurb: 'Ruthless rival, fast storm. +90% ash.', ashMult: 1.9, aiSamplesAdd: 5, aiActEveryMul: 0.72, ringGraceMul: 0.72 },
  { level: 4, label: 'BSL-4 · Lethal', blurb: 'The specimen fights to kill. +150% ash.', ashMult: 2.5, aiSamplesAdd: 8, aiActEveryMul: 0.6, ringGraceMul: 0.6 },
]
export const bslDef = (n: number): BslDef => BSL[Math.max(0, Math.min(3, n - 1))]
export function selectBsl(m: MetaState, n: number): MetaState {
  if (n < 1 || n > m.bslMax) return m
  return save({ ...m, bsl: n })
}
/** On a full run clear, unlock the next BSL if you cleared at your ceiling. */
export function recordBslClear(m: MetaState): { meta: MetaState; unlocked: number } {
  if (m.bsl === m.bslMax && m.bslMax < 4) {
    return { meta: save({ ...m, bslMax: m.bslMax + 1 }), unlocked: m.bslMax + 1 }
  }
  return { meta: m, unlocked: 0 }
}
