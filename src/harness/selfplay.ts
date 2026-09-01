/**
 * The proof harness. Pits policies against each other across seeded duels:
 *
 *   planner  — samples placements, Foresight-scores them, plays the best
 *   random   — same placement machinery, zero evaluation
 *
 * If the mechanics reward planning, planner must beat random decisively while
 * the mirror matches stay near 50%. This is the core-mechanics claim of the
 * game, stated as a number.
 *
 *   npm run harness            # 16 duels per matchup
 *   npm run harness -- 40      # more
 */

import { Duel, PLAYER, RIVAL, aiAct, smartAct, rngFrom, stateHash, type Rng } from '../sim'

const nDuels = Number(process.argv[2] ?? 16)

type PolicyName = 'planner' | 'random'
const policies: Record<PolicyName, (d: Duel, rng: Rng, faction: number, target: number) => void> =
  {
    random: (d, rng, faction, target) => aiAct(d, faction, rng, target),
    planner: (d, rng, faction, target) =>
      smartAct(d, faction, rng, target, d.t.aiSamples, d.t.aiHorizon),
  }

function runDuel(seed: string, playerPolicy: PolicyName, rivalPolicy: PolicyName): Duel {
  const d = new Duel(seed)
  d.autoRival = false // both sides driven explicitly for a fair matchup
  const pr = rngFrom(seed, 'policy-player')
  const rr = rngFrom(seed, 'policy-rival')
  while (d.status === 'running' && d.state.gen < 6000) {
    d.tick()
    if (d.state.gen % d.t.aiActEvery === 0) {
      // Alternate act order per act-generation to kill first-mover bias.
      if ((d.state.gen / d.t.aiActEvery) % 2 === 0) {
        policies[playerPolicy](d, pr, PLAYER, RIVAL)
        policies[rivalPolicy](d, rr, RIVAL, PLAYER)
      } else {
        policies[rivalPolicy](d, rr, RIVAL, PLAYER)
        policies[playerPolicy](d, pr, PLAYER, RIVAL)
      }
    }
  }
  return d
}

// Determinism audit first: an identical seed must replay identically,
// including through the planner's Foresight scoring.
{
  const h1 = stateHash(runDuel('audit', 'planner', 'random').state)
  const h2 = stateHash(runDuel('audit', 'planner', 'random').state)
  if (h1 !== h2) {
    console.error(`DETERMINISM VIOLATION: ${h1} !== ${h2}`)
    process.exit(1)
  }
  console.log(`determinism audit: ok (hash ${h1.toString(16)})\n`)
}

const matchups: Array<[PolicyName, PolicyName]> = [
  ['planner', 'random'],
  ['random', 'random'],
  ['planner', 'planner'],
]

const results: Record<string, number> = {}
for (const [p, r] of matchups) {
  let wins = 0
  let gens = 0
  const t0 = performance.now()
  for (let i = 0; i < nDuels; i++) {
    const d = runDuel(`match-${p}-${r}-${i}`, p, r)
    if (d.status === 'won') wins++
    gens += d.state.gen
  }
  const dt = ((performance.now() - t0) / 1000).toFixed(1)
  const rate = (wins / nDuels) * 100
  results[`${p} vs ${r}`] = rate
  console.log(
    `${p.padEnd(7)} vs ${r.padEnd(7)}  ${rate.toFixed(0).padStart(3)}% player wins  ` +
      `(${wins}/${nDuels}, mean ${Math.round(gens / nDuels)} gens, ${dt}s)`,
  )
}

const edge = results['planner vs random'] - results['random vs random']
console.log(
  `\ncore-mechanics proof: planning is worth ${edge >= 0 ? '+' : ''}${edge.toFixed(0)} points ` +
    `of winrate over random play (want strongly positive; mirrors near 50%).`,
)
