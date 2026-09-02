/**
 * The gauntlet: three rounds, escalating rival. Escalation is data —
 * a loadout for the rival's faction plus sharper planner settings.
 */

import type { GeneChoice } from './genes'

export interface RoundDef {
  label: string
  rivalLoadout: GeneChoice[]
  aiSamples: number
  aiActEvery: number
}

export const ROUNDS: readonly RoundDef[] = [
  { label: 'the neighbor', rivalLoadout: [], aiSamples: 6, aiActEvery: 20 },
  { label: 'the veteran', rivalLoadout: ['martyr'], aiSamples: 8, aiActEvery: 16 },
  {
    label: 'elder blood',
    rivalLoadout: ['elder', { key: 'vampire', level: 2 }],
    aiSamples: 10,
    aiActEvery: 13,
  },
]
