/**
 * Non-standard cells: a second per-cell layer beside faction. Type 0 is a
 * normal Conway cell; the rest override pieces of the death/conversion rules.
 * Per the design laws these are data tuples, not bespoke logic — the engine
 * reads the flags, nothing else.
 */

import { mask } from './types'

export interface CellTypeDef {
  key: string
  name: string
  /** Overrides the faction's survival mask (Elder: survives anything). */
  surviveMask?: number
  /** Immune to flanking defection and casualty deaths. */
  steadfast?: boolean
  /** Cannot be converted by flanking or by a Vampire's drain. */
  unconvertible?: boolean
  /** Converts one adjacent enemy cell (deterministic scan). */
  drain?: boolean
  /** Drain fires only when gen % drainEvery === 0 (default: every gen). */
  drainEvery?: number
  /** On a rules-death (not the storm), kills every adjacent enemy cell. */
  onDeathKill?: boolean
  /** Chebyshev radius of the death blast (default 1 = the 8 neighbors). */
  blastRadius?: number
}

export const NORMAL = 0
export const ELDER = 1
export const VAMPIRE = 2
export const MARTYR = 3
export const VAMPIRE_SWIFT = 4
export const VAMPIRE_ELDEST = 5
export const MARTYR_GREAT = 6

export const CELL_TYPES: readonly CellTypeDef[] = [
  { key: 'normal', name: 'Cell' },
  {
    key: 'elder',
    name: 'Elder',
    surviveMask: mask(0, 1, 2, 3, 4, 5, 6, 7, 8),
    steadfast: true,
    unconvertible: true,
  },
  {
    key: 'vampire',
    name: 'Vampire',
    // Starves alone (0 neighbors) and smothers in a crowd (7-8): a
    // non-standard death condition — it must live among the living.
    surviveMask: mask(1, 2, 3, 4, 5, 6),
    steadfast: true,
    unconvertible: true,
    drain: true,
    drainEvery: 3,
  },
  {
    key: 'martyr',
    name: 'Martyr',
    onDeathKill: true,
  },
  {
    key: 'vampire-swift',
    name: 'Vampire II',
    surviveMask: mask(1, 2, 3, 4, 5, 6),
    steadfast: true,
    unconvertible: true,
    drain: true,
    drainEvery: 2,
  },
  {
    key: 'vampire-eldest',
    name: 'Vampire III',
    surviveMask: mask(1, 2, 3, 4, 5, 6),
    steadfast: true,
    unconvertible: true,
    drain: true,
    drainEvery: 1,
  },
  {
    key: 'martyr-great',
    name: 'Martyr III',
    onDeathKill: true,
    blastRadius: 2,
  },
]
