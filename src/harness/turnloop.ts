/**
 * The turn driver every harness shares — the exact loop App.tsx plays:
 *
 *   rival deploys (telegraphed) → player deploys → INCUBATE turnGens gens → SETTLE
 *
 * for turnsPerRound turns, ending by extinction or on territory at the last
 * settle. The sim engine is untouched; this only fixes the cadence of acts and
 * ticks, so per-seed determinism is the sim's.
 */

import { Duel, PLAYER, RIVAL, aiAct, planBest, smartAct, rngFrom, type Rng } from '../sim'

export type Policy = (d: Duel, rng: Rng, faction: number, target: number) => void

/** A planner at an EXPLICIT depth. Use this whenever the two sides must not
 *  share a depth: `d.t.aiSamples` is the RIVAL's setting (rounds raise it for
 *  the boss), so a policy that reads it hands the player the boss's brain too
 *  and any difficulty measured that way silently cancels out. */
export const plannerAt = (samples: number): Policy => (d, rng, f, t) =>
  void smartAct(d, f, rng, t, samples, d.t.aiHorizon)

/** The skill ladder: random → weak planner → the game's planner → a deep planner. */
export const POLICIES = {
  random: (d, rng, f, t) => void aiAct(d, f, rng, t),
  weak: (d, rng, f, t) => void smartAct(d, f, rng, t, 2, d.t.aiHorizon),
  planner: (d, rng, f, t) => void smartAct(d, f, rng, t, d.t.aiSamples, d.t.aiHorizon),
  strong: (d, rng, f, t) => void smartAct(d, f, rng, t, 16, d.t.aiHorizon),
} satisfies Record<string, Policy>
export type PolicyName = keyof typeof POLICIES

/** A planner that commits through the HAND via playCard, so every placement is
 *  on the duel's record with its forecast — what the honesty audit grades. */
export function plannerViaHand(samples: number): Policy {
  return (d, rng, faction, target) => {
    const hand = d.hand.map((id) => d.patternFor(faction, id))
    const plan = planBest(d, faction, rng, target, samples, d.t.aiHorizon, hand)
    if (!plan) return
    const idx = d.hand.indexOf(plan.pattern.id)
    if (idx >= 0) d.playCard(idx, plan.ox, plan.oy, plan.rot)
  }
}

export interface TurnLoopOpts {
  /** Placement attempts per side per turn (default 2). */
  placementsPerTurn?: number
  /** Rival attempts per turn; defaults to placementsPerTurn (a fair mirror).
   *  Pass the round's rivalActs for the real game's cadence. */
  rivalActs?: number
  /** 'alternate' kills first-mover bias for winrate proofs; 'rivalFirst' is the
   *  real game order (the rival telegraphs, you respond) — use for honesty audits. */
  order?: 'alternate' | 'rivalFirst'
}

export function playTurnRound(d: Duel, player: Policy, rival: Policy, seed: string, opts: TurnLoopOpts = {}): Duel {
  const per = opts.placementsPerTurn ?? 2
  const rivalActs = opts.rivalActs ?? per
  const order = opts.order ?? 'alternate'
  d.autoRival = false
  const pr = rngFrom(seed, 'policy-player')
  const rr = rngFrom(seed, 'policy-rival')
  for (let turn = 1; turn <= d.t.turnsPerRound && d.status === 'running'; turn++) {
    const rivalFirst = order === 'rivalFirst' || turn % 2 === 1
    const deployRival = () => {
      for (let k = 0; k < rivalActs; k++) rival(d, rr, RIVAL, PLAYER)
    }
    const deployPlayer = () => {
      for (let k = 0; k < per; k++) player(d, pr, PLAYER, RIVAL)
    }
    if (rivalFirst) {
      deployRival()
      deployPlayer()
    } else {
      deployPlayer()
      deployRival()
    }
    d.beginIncubate()
    const target = d.state.gen + d.t.turnGens
    while (d.status === 'running' && d.state.gen < target) d.tick()
    d.settle()
  }
  return d
}
