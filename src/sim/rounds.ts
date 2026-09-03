/**
 * The gauntlet: three rounds, escalating rival. Escalation is data —
 * a loadout for the rival's faction plus sharper planner settings.
 */

import type { GeneChoice } from './genes'

export interface RoundDef {
  label: string
  rivalLoadout: GeneChoice[]
  /** The rival's starting seed — scales with the round so a small player
   *  seed is a fair fight in round 1 and unlocking bigger seeds matters later. */
  rivalSeed: string
  aiSamples: number
  aiActEvery: number
  /** Max ACTIVE warp the player's build may run this round (the pure→warped
   *  gradient). Round 1 caps at 0 → the board is provably pure Conway; higher
   *  rounds admit rarer, wilder tuples. Over-cap drafted picks stay dormant. */
  warpCap: number
}

export const ROUNDS: readonly RoundDef[] = [
  { label: 'the neighbor', rivalLoadout: [], rivalSeed: 'seedling', aiSamples: 6, aiActEvery: 20, warpCap: 0 },
  { label: 'the veteran', rivalLoadout: ['martyr'], rivalSeed: 'soup', aiSamples: 8, aiActEvery: 16, warpCap: 4 },
  {
    label: 'elder blood',
    rivalLoadout: ['elder', { key: 'vampire', level: 2 }],
    rivalSeed: 'soup',
    aiSamples: 10,
    aiActEvery: 13,
    warpCap: 10,
  },
]
