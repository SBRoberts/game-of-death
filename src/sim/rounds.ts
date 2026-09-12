/**
 * The gauntlet: an escalating series of rounds. Escalation is data —
 * the rival's faction loadout, sharper planner settings, how many placements
 * it telegraphs per turn, the player's warp cap, and a per-round BLEACH
 * schedule (which turn the field starts dying inward, and how fast) so each
 * round pressures the board differently. The last round is a boss.
 */

import type { GeneChoice } from './genes'

export interface RoundDef {
  label: string
  rivalLoadout: GeneChoice[]
  /** The rival's starting seed — scales with the round so a small player
   *  seed is a fair fight early and unlocking bigger seeds matters later. */
  rivalSeed: string
  aiSamples: number
  /** Placements the rival attempts at the start of each of your deploy phases
   *  (telegraphed — your projection sees them before you commit). */
  rivalActs: number
  /** Max ACTIVE warp the player's build may run this round (the pure→warped
   *  gradient). Round 1 caps at 0 → provably pure Conway; higher rounds admit
   *  rarer, wilder tuples. Over-cap drafted picks stay dormant. */
  warpCap: number
  /** BLEACH: the turn (1-based) whose incubation first eats the edges, and the
   *  cells of inset added per turn from then on. Varied per round so some
   *  rounds force the centre early and others stay open. 0 = never. */
  bleachFromTurn: number
  bleachPerTurn: number
  /** The finale — a distinctive boss specimen. */
  boss?: boolean
}

export const ROUNDS: readonly RoundDef[] = [
  // 1 — open field, learn the game. The edges only start to go in the last two turns.
  { label: 'the neighbor', rivalLoadout: [], rivalSeed: 'seedling', aiSamples: 6, rivalActs: 1, warpCap: 0, bleachFromTurn: 7, bleachPerTurn: 1 },
  // 2 — a real opponent; a mild late bleach nibbles the flanks.
  { label: 'the veteran', rivalLoadout: ['martyr'], rivalSeed: 'soup', aiSamples: 8, rivalActs: 1, warpCap: 3, bleachFromTurn: 6, bleachPerTurn: 1 },
  // 3 — a fast-breeding swarm and a fast, early bleach: hold the centre.
  { label: 'the swarm', rivalLoadout: ['highlife'], rivalSeed: 'soup', aiSamples: 9, rivalActs: 1, warpCap: 5, bleachFromTurn: 3, bleachPerTurn: 2 },
  // 4 — immortal, draining blood, two placements a turn; a moderate mid-round bleach.
  { label: 'elder blood', rivalLoadout: ['elder', { key: 'vampire', level: 2 }], rivalSeed: 'soup', aiSamples: 12, rivalActs: 2, warpCap: 7, bleachFromTurn: 5, bleachPerTurn: 2 },
  // 5 — a relentless, hardy bloom that drains, under an early slow bleach.
  { label: 'the bloom', rivalLoadout: ['highlife', { key: 'vampire', level: 2 }, 'hardy'], rivalSeed: 'soup', aiSamples: 11, rivalActs: 2, warpCap: 9, bleachFromTurn: 3, bleachPerTurn: 1 },
  // 6 — THE PROGENITOR: every specimen you have faced, at once. Immortal
  //     (elder), hardy, draining (vampire III), mined (martyr) AND fast-breeding
  //     (highlife) — the bloom's population engine was what actually made round
  //     5 brutal, so the finale carries it too. Plans deepest and deploys FOUR
  //     patterns a turn. A heavy early bleach made it EASIER than round 5 (it
  //     eats the boss's larger mass first), so the clock here is late and light
  //     and the pressure comes from the specimen itself.
  { label: 'the progenitor', rivalLoadout: ['elder', { key: 'vampire', level: 3 }, 'martyr', 'hardy', 'highlife'], rivalSeed: 'soup', aiSamples: 16, rivalActs: 4, warpCap: 12, bleachFromTurn: 6, bleachPerTurn: 1, boss: true },
]
