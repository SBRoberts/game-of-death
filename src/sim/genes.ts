/**
 * The genome. Genes are one-axis data tuples (design law: data, not code):
 *   rule genes — mutate your faction's B/S digits or one tuning number
 *   card genes — add a special uni-cell to your draw pool
 * Slots cap how many you equip; the loadout IS your build.
 */

import type { Tuning } from './tuning'

export interface Gene {
  key: string
  name: string
  kind: 'rule' | 'card'
  ashCost: number
  desc: string
  /** Digits added to the player faction's survive mask. */
  addSurvive?: number[]
  /** Digits added to the player faction's birth mask. */
  addBirth?: number[]
  /** One tuning number, replaced outright. */
  tuning?: Partial<Tuning>
  /** Special pattern id added to the player draw pool. */
  card?: string
}

export const GENES: readonly Gene[] = [
  {
    key: 'hardy',
    name: 'Hardy',
    kind: 'rule',
    ashCost: 30,
    desc: 'Overcrowding tolerance — your cells also survive with 4 neighbors.',
    addSurvive: [4],
  },
  {
    key: 'highlife',
    name: 'HighLife',
    kind: 'rule',
    ashCost: 40,
    desc: 'Replicator blood — your births also trigger on 6 neighbors.',
    addBirth: [6],
  },
  {
    key: 'ranger',
    name: 'Ranger',
    kind: 'rule',
    ashCost: 30,
    desc: 'Longer seed reach — place patterns up to 14 cells from your colony.',
    tuning: { placementRadius: 14 },
  },
  {
    key: 'thrifty',
    name: 'Thrifty',
    kind: 'rule',
    ashCost: 35,
    desc: 'Richer metabolism — population income up 50%.',
    tuning: { incomeScale: 0.045 },
  },
  {
    key: 'elder',
    name: 'Elder',
    kind: 'card',
    ashCost: 60,
    desc: 'Unlock the Elder card: a single immortal anchor cell.',
    card: 'elder',
  },
  {
    key: 'vampire',
    name: 'Vampire',
    kind: 'card',
    ashCost: 75,
    desc: 'Unlock the Vampire card: converts an adjacent enemy every generation.',
    card: 'vampire',
  },
  {
    key: 'martyr',
    name: 'Martyr',
    kind: 'card',
    ashCost: 45,
    desc: 'Unlock the Martyr card: detonates on death, killing adjacent enemies.',
    card: 'martyr',
  },
]

export const geneByKey = (key: string): Gene => {
  const g = GENES.find((g) => g.key === key)
  if (!g) throw new Error(`unknown gene: ${key}`)
  return g
}

/** Ash price of the next genome slot; index = slots already owned (cap 5). */
export const SLOT_COSTS = [40, 70, 110, 160, 220]
