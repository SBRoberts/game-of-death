/**
 * The genome. Genes are ladders of one-axis data tuples — each LEVEL changes
 * exactly one number along the gene's axis, so upgrades stay bisectable and
 * the balance sweep can test every rung:
 *   rule genes — mutate your faction's B/S digits or one economy number
 *   card genes — add (and upgrade) a special uni-cell in your draw pool
 * Slots cap how many you equip; the loadout IS your build.
 */

import { MARTYR_GREAT, VAMPIRE_SWIFT, VAMPIRE_ELDEST } from './celltypes'

export interface GeneLevel {
  ashCost: number
  desc: string
  /** Digits added to the owning faction's survive mask (absolute per level). */
  addSurvive?: number[]
  /** Digits added to the owning faction's birth mask (absolute per level). */
  addBirth?: number[]
  /** Placement radius override for the owning faction. */
  radius?: number
  /** Flat bonus to the owning faction's starting biomass. (Legacy — mints
   *  matter, so it's excluded from the in-run draft; use addIncomeScale.) */
  startBonus?: number
  /** Added to the owning faction's income scale — a RATE on √population you
   *  actually grew, not a flat grant, so it transforms rather than mints. */
  addIncomeScale?: number
  /** Special pattern id added to the owning faction's draw pool. */
  card?: string
  /** Card overrides at this level: biomass cost and/or cell-type variant. */
  cardCost?: number
  cardType?: number
}

export interface Gene {
  key: string
  name: string
  kind: 'rule' | 'card'
  levels: GeneLevel[]
}

/** A loadout entry; bare strings mean level 1. */
export type GeneChoice = string | { key: string; level: number }

export const normalizeChoice = (c: GeneChoice): { key: string; level: number } =>
  typeof c === 'string' ? { key: c, level: 1 } : c

export const GENES: readonly Gene[] = [
  {
    key: 'hardy',
    name: 'Hardy',
    kind: 'rule',
    levels: [
      { ashCost: 30, desc: 'Core strength — your cells survive fully surrounded (8 neighbors).', addSurvive: [8] },
      { ashCost: 85, desc: 'Your cells survive dense crowds (7–8 neighbors).', addSurvive: [7, 8] },
      { ashCost: 160, desc: 'Your cells thrive in the crush (6–8 neighbors).', addSurvive: [6, 7, 8] },
    ],
  },
  {
    key: 'highlife',
    name: 'HighLife',
    kind: 'rule',
    levels: [
      { ashCost: 40, desc: 'Replicator blood — your births also trigger on 6 neighbors.', addBirth: [6] },
      { ashCost: 90, desc: 'Births trigger on 6 or 8 neighbors.', addBirth: [6, 8] },
      { ashCost: 170, desc: 'Births trigger on any of 6, 7, 8.', addBirth: [6, 7, 8] },
    ],
  },
  {
    key: 'ranger',
    name: 'Ranger',
    kind: 'rule',
    levels: [
      { ashCost: 30, desc: 'Seed reach 12 cells from your colony.', radius: 12 },
      { ashCost: 40, desc: 'Seed reach 14 cells.', radius: 14 },
      { ashCost: 55, desc: 'Seed reach 18 cells — strike deep.', radius: 18 },
    ],
  },
  {
    key: 'thrifty',
    name: 'Thrifty',
    kind: 'rule',
    levels: [
      { ashCost: 35, desc: 'Deep reserves — begin each round with +12 biomass.', startBonus: 12 },
      { ashCost: 45, desc: 'Begin each round with +24 biomass.', startBonus: 24 },
      { ashCost: 60, desc: 'Begin each round with +40 biomass.', startBonus: 40 },
    ],
  },
  {
    key: 'metabolism',
    name: 'Metabolism',
    kind: 'rule',
    levels: [
      { ashCost: 30, desc: 'Richer culture — income scales faster with your population.', addIncomeScale: 0.012 },
      { ashCost: 45, desc: 'Income scales faster still.', addIncomeScale: 0.024 },
      { ashCost: 60, desc: 'A thriving culture — income scales fastest.', addIncomeScale: 0.04 },
    ],
  },
  {
    key: 'elder',
    name: 'Elder',
    kind: 'card',
    levels: [
      { ashCost: 60, desc: 'Unlock the Elder: a single immortal anchor cell (⬢28).', card: 'elder' },
      { ashCost: 75, desc: 'Elders root cheaper (⬢23).', card: 'elder', cardCost: 23 },
      { ashCost: 110, desc: 'Elders root cheap enough to garden with (⬢18).', card: 'elder', cardCost: 18 },
    ],
  },
  {
    key: 'vampire',
    name: 'Vampire',
    kind: 'card',
    levels: [
      { ashCost: 75, desc: 'Unlock the Vampire: infects a rival cell every 3rd generation.', card: 'vampire' },
      {
        ashCost: 80,
        desc: 'Vampire II feeds every other generation.',
        card: 'vampire',
        cardType: VAMPIRE_SWIFT,
      },
      {
        ashCost: 130,
        desc: 'Vampire III feeds every generation.',
        card: 'vampire',
        cardType: VAMPIRE_ELDEST,
      },
    ],
  },
  {
    key: 'martyr',
    name: 'Martyr',
    kind: 'card',
    levels: [
      { ashCost: 45, desc: 'Unlock the Martyr: detonates on death (⬢10).', card: 'martyr' },
      { ashCost: 40, desc: 'Martyrs seed cheaper (⬢7) — lay minefields.', card: 'martyr', cardCost: 7 },
      {
        ashCost: 70,
        desc: 'Martyr III detonates in a 5×5 blast.',
        card: 'martyr',
        cardCost: 7,
        cardType: MARTYR_GREAT,
      },
    ],
  },
]

export const geneByKey = (key: string): Gene => {
  const g = GENES.find((g) => g.key === key)
  if (!g) throw new Error(`unknown gene: ${key}`)
  return g
}

export const maxLevel = (key: string): number => geneByKey(key).levels.length

/** Ash price of the next genome slot; index = slots already owned (cap 5).
 *  The first slot is cheap so a couple of runs already buy your first gene —
 *  the meta hooks early rather than gating the fun behind a long grind. */
export const SLOT_COSTS = [25, 70, 110, 160, 220]
