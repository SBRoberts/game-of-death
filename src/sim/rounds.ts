/**
 * The gauntlet: three rounds, escalating rival. Escalation is data —
 * a loadout for the rival's faction plus sharper planner settings.
 */

export interface RoundDef {
  label: string
  rivalLoadout: string[]
  aiSamples: number
  aiActEvery: number
}

export const ROUNDS: readonly RoundDef[] = [
  { label: 'the neighbor', rivalLoadout: [], aiSamples: 6, aiActEvery: 20 },
  { label: 'the veteran', rivalLoadout: ['martyr'], aiSamples: 8, aiActEvery: 16 },
  { label: 'elder blood', rivalLoadout: ['elder', 'vampire'], aiSamples: 10, aiActEvery: 13 },
]
