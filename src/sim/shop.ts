/**
 * The between-round shop stock — a seeded, deterministic catalog draw. You
 * spend PLASM (harvested from radicals) to buy mutagens into your run build; a
 * pure function of (seed, round-cleared, reroll count, what you already own) so
 * a run replays byte-identically. Rarity odds shift toward the wild as the
 * rounds climb (commons early → epics/legendaries late) — the pure→warped
 * gradient, made economic.
 */

import { rngFrom } from './rng'
import { geneByKey, normalizeChoice, type GeneChoice } from './genes'
import { geneChoiceWarp, rarityOf, type Rarity } from './warp'

export interface ShopItem {
  key: string
  level: number
  name: string
  desc: string
  warp: number
  rarity: Rarity
  price: number
}

/** Genes sold by the shop (Thrifty excluded — Metabolism is its law-clean twin). */
const SHOP_GENES = ['metabolism', 'ranger', 'hardy', 'highlife', 'elder', 'vampire', 'martyr']

const PRICE: Record<Rarity, number> = { common: 6, uncommon: 12, rare: 22, epic: 36, legendary: 60 }

/** Rarity weights by the round just cleared (1 = shop before round 2). */
const WEIGHTS: Record<number, Record<Rarity, number>> = {
  1: { common: 55, uncommon: 30, rare: 12, epic: 3, legendary: 0 },
  2: { common: 30, uncommon: 30, rare: 25, epic: 12, legendary: 3 },
}

const ROMAN = ['', '', ' II', ' III']

/** Reroll cost (PLASM) escalates with rerolls this visit. */
export const shopRerollCost = (rerolls: number): number => 3 + rerolls * 3

export function rollShop(
  seed: string,
  roundCleared: number,
  rerolls: number,
  runLoadout: readonly GeneChoice[],
  size = 5,
): ShopItem[] {
  const rng = rngFrom(seed, `shop:${roundCleared}:${rerolls}`)
  const owned: Record<string, number> = {}
  for (const c of runLoadout) {
    const n = normalizeChoice(c)
    owned[n.key] = Math.max(owned[n.key] ?? 0, n.level)
  }
  // Candidate = the next un-maxed rung of each gene.
  const pool = SHOP_GENES.map((key) => ({ key, level: (owned[key] ?? 0) + 1 })).filter(
    (c) => c.level <= geneByKey(c.key).levels.length,
  )
  const weights = WEIGHTS[Math.min(2, Math.max(1, roundCleared))]
  const items: ShopItem[] = []
  while (items.length < size && pool.length) {
    const weighted = pool.map((c) => {
      const w = geneChoiceWarp({ key: c.key, level: c.level })
      const r = rarityOf(w)
      return { c, r, w, weight: weights[r] }
    })
    const total = weighted.reduce((a, x) => a + x.weight, 0)
    if (total <= 0) break
    let roll = rng() * total
    let chosen = weighted[weighted.length - 1]
    for (const x of weighted) {
      roll -= x.weight
      if (roll <= 0) {
        chosen = x
        break
      }
    }
    pool.splice(
      pool.findIndex((c) => c.key === chosen.c.key),
      1,
    )
    const gene = geneByKey(chosen.c.key)
    const g = gene.levels[chosen.c.level - 1]
    items.push({
      key: chosen.c.key,
      level: chosen.c.level,
      name: gene.name + ROMAN[chosen.c.level],
      desc: g.desc,
      warp: chosen.w,
      rarity: chosen.r,
      price: PRICE[chosen.r],
    })
  }
  return items
}
