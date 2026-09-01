/**
 * Meta-progression state: ash currency, genome slots, owned + equipped genes.
 * Lives entirely in the web layer (localStorage) — the sim stays pure and
 * receives the equipped loadout as a plain argument.
 */

import { Duel, PLAYER, SLOT_COSTS, geneByKey } from '../sim'

const KEY = 'god-meta-v1'

export interface MetaState {
  ash: number
  slots: number
  owned: string[]
  equipped: string[]
}

export function loadMeta(): MetaState {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) {
      const m = JSON.parse(raw) as MetaState
      return {
        ash: m.ash | 0,
        slots: Math.min(m.slots | 0, SLOT_COSTS.length),
        owned: Array.isArray(m.owned) ? m.owned : [],
        equipped: Array.isArray(m.equipped) ? m.equipped.slice(0, m.slots | 0) : [],
      }
    }
  } catch {
    /* corrupted or unavailable: start fresh */
  }
  return { ash: 0, slots: 0, owned: [], equipped: [] }
}

function save(m: MetaState): MetaState {
  try {
    localStorage.setItem(KEY, JSON.stringify(m))
  } catch {
    /* private mode */
  }
  return m
}

/** Ash earned by a finished duel: time survived plus a victory bonus. */
export function ashFor(duel: Duel): number {
  const survival = Math.floor(duel.state.gen / 12)
  const win = duel.status === 'won' ? 25 : 0
  const holdings = Math.floor(duel.state.pops[PLAYER] / 25)
  return survival + win + holdings
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

export function buyGene(m: MetaState, key: string): MetaState {
  const gene = geneByKey(key)
  if (m.owned.includes(key) || m.ash < gene.ashCost) return m
  return save({ ...m, ash: m.ash - gene.ashCost, owned: [...m.owned, key] })
}

export function toggleEquip(m: MetaState, key: string): MetaState {
  if (!m.owned.includes(key)) return m
  const equipped = m.equipped.includes(key)
    ? m.equipped.filter((k) => k !== key)
    : m.equipped.length < m.slots
      ? [...m.equipped, key]
      : m.equipped
  return save({ ...m, equipped })
}
