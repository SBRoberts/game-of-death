/**
 * The gauntlet: an escalating series of rounds. Escalation is data —
 * the rival's faction loadout, sharper planner settings, the player's warp cap,
 * and a per-round BLEACH schedule (when/how fast the field dies inward) so each
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
  aiActEvery: number
  /** Max ACTIVE warp the player's build may run this round (the pure→warped
   *  gradient). Round 1 caps at 0 → provably pure Conway; higher rounds admit
   *  rarer, wilder tuples. Over-cap drafted picks stay dormant. */
  warpCap: number
  /** BLEACH schedule: the generation the field starts dying inward, and how
   *  many generations per 1-cell inset. Varied per round so some rounds bleach
   *  early/fast (hold the centre) and others stay open. A round is 8 turns ×
   *  16 gens = 128 gens, so a grace above ~130 never bleaches. */
  bleachGrace: number
  bleachEvery: number
  /** The finale — a distinctive boss specimen. */
  boss?: boolean
}

export const ROUNDS: readonly RoundDef[] = [
  // 1 — open field, learn the game. No bleach.
  { label: 'the neighbor', rivalLoadout: [], rivalSeed: 'seedling', aiSamples: 6, aiActEvery: 20, warpCap: 0, bleachGrace: 999, bleachEvery: 14 },
  // 2 — a real opponent; a mild late bleach nibbles the edges.
  { label: 'the veteran', rivalLoadout: ['martyr'], rivalSeed: 'soup', aiSamples: 8, aiActEvery: 16, warpCap: 3, bleachGrace: 96, bleachEvery: 12 },
  // 3 — a fast-breeding swarm and a fast, tight bleach: hold the centre.
  { label: 'the swarm', rivalLoadout: ['highlife'], rivalSeed: 'soup', aiSamples: 9, aiActEvery: 14, warpCap: 5, bleachGrace: 40, bleachEvery: 8 },
  // 4 — immortal, draining blood; a moderate mid-round bleach.
  { label: 'elder blood', rivalLoadout: ['elder', { key: 'vampire', level: 2 }], rivalSeed: 'soup', aiSamples: 10, aiActEvery: 13, warpCap: 7, bleachGrace: 64, bleachEvery: 12 },
  // 5 — an explosive bloom under an early, slow, creeping bleach.
  { label: 'the bloom', rivalLoadout: ['highlife', 'martyr'], rivalSeed: 'acorn', aiSamples: 11, aiActEvery: 12, warpCap: 9, bleachGrace: 32, bleachEvery: 14 },
  // 6 — THE PROGENITOR: an endless glider gun, immortal, draining, mined.
  { label: 'the progenitor', rivalLoadout: ['elder', { key: 'vampire', level: 3 }, 'martyr'], rivalSeed: 'glidergun', aiSamples: 12, aiActEvery: 10, warpCap: 12, bleachGrace: 48, bleachEvery: 10, boss: true },
]
