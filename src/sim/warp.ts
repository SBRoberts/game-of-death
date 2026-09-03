/**
 * WARP — a pure scalar measuring how far a catalog entry strays from Conway
 * (B3/S23). Rarity IS warp, the per-round warp cap gates the pure→warped
 * gradient (round 1 caps at 0 → the board is provably LIFE), and the balance
 * sweep and the fluorescence renderer both read the same number. Derived, not
 * authored, so it stays bisectable; weights are designed so signature abilities
 * dominate and their supporting flags stay cheap.
 */

import { CELL_TYPES, type CellTypeDef } from './celltypes'
import { geneByKey, normalizeChoice, type GeneChoice } from './genes'
import { patternById } from './patterns'

/** How far a special cell-type strays from a normal Conway cell. */
export function cellTypeWarp(t: CellTypeDef | undefined): number {
  if (!t) return 0
  let w = 0
  // Signature abilities dominate; accelerating them adds a notch.
  if (t.drain) w += 3 + Math.max(0, 3 - (t.drainEvery ?? 1)) // drainEvery 3→3, 2→4, 1→5
  if (t.onDeathKill) w += 3 + Math.max(0, (t.blastRadius ?? 1) - 1) // r1→3, r2→4
  // A standalone survival override with no active ability (Elder) is a rare anchor.
  if (t.surviveMask !== undefined && !t.drain) w += 3
  // Lone defensive flags (a plain steadfast/unconvertible cell) read as uncommon.
  if (!t.drain && !t.onDeathKill && t.surviveMask === undefined) {
    if (t.steadfast) w += 2
    if (t.unconvertible) w += 2
  }
  return w
}

/** Warp of a gene choice at its chosen level (the unit of the catalog). */
export function geneChoiceWarp(choice: GeneChoice): number {
  const c = normalizeChoice(choice)
  const gene = geneByKey(c.key)
  const level = Math.min(Math.max(c.level, 1), gene.levels.length)
  const g = gene.levels[level - 1]
  // Rule-digit bends cost one warp each; reach/economy are geometry, not a bend.
  let w = (g.addSurvive?.length ?? 0) + (g.addBirth?.length ?? 0)
  if (g.card) {
    const typeIndex = g.cardType ?? patternById(g.card).cellType ?? 0
    w += cellTypeWarp(CELL_TYPES[typeIndex])
  }
  return w
}

/** Rarity tiers are warp bands (distance from Conway made literal). */
export type Rarity = 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary'

export function rarityOf(warp: number): Rarity {
  if (warp <= 1) return 'common'
  if (warp <= 2) return 'uncommon'
  if (warp <= 4) return 'rare'
  if (warp <= 6) return 'epic'
  return 'legendary'
}
