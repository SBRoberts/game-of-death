/**
 * Meta-progression state: ash currency, genome slots, owned + equipped genes.
 * Lives entirely in the web layer (localStorage) — the sim stays pure and
 * receives the equipped loadout as a plain argument.
 */

import { Duel, SEEDS, SLOT_COSTS, geneByKey, maxLevel, seedById, type GeneChoice } from '../sim'

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
}

/**
 * Itemized ash payout — one source of truth for the earn logic AND the
 * cash-out screen, so the reward you watch count up is the reward you get.
 */
export function ashBreakdown(duel: Duel, runClear: boolean): { rows: AshRow[]; total: number } {
  const s = duel.summary
  const rows: AshRow[] = [
    { label: 'endurance', detail: `${s.gens} generations`, value: Math.floor(s.gens / 20) },
    {
      label: 'destruction',
      detail: `${s.rivalDestroyed.toLocaleString()} rival cells died`,
      value: Math.floor(s.rivalDestroyed / 2000),
    },
  ]
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
export function ashFor(duel: Duel, runClear = false): number {
  return ashBreakdown(duel, runClear).total
}

export function earnAsh(m: MetaState, amount: number): MetaState {
  return save({ ...m, ash: m.ash + amount })
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
