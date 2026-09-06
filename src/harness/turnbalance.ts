/**
 * Turn-based balance harness (`npm run turnbalance`).
 *
 * The duel is now turn-based (docs/design/adr-turn-based.md): a round is
 * TURNS_PER_ROUND turns of deploy (each side places) → incubate (INCUBATE_GENS
 * generations), ending by extinction or territory at the last turn. This replays
 * that exact loop with self-play policies to re-derive winrates for the turn
 * model — planning must still beat random decisively; mirrors must sit near 50%.
 *
 * The sim engine is untouched, so per-seed determinism is unchanged; this only
 * changes the DRIVER (the cadence of acts and ticks), matching App.tsx.
 */

import { Duel, PLAYER, RIVAL, aiAct, smartAct, rngFrom, stateHash, type Rng } from '../sim'

const TURNS_PER_ROUND = 8
const INCUBATE_GENS = 16
const PLACEMENTS_PER_TURN = 2 // each side attempts a couple of placements per deploy

const nDuels = Number(process.argv[2] ?? 16)
type PolicyName = 'planner' | 'random'
const policies: Record<PolicyName, (d: Duel, rng: Rng, faction: number, target: number) => void> = {
  random: (d, rng, faction, target) => aiAct(d, faction, rng, target),
  planner: (d, rng, faction, target) => smartAct(d, faction, rng, target, d.t.aiSamples, d.t.aiHorizon),
}

function deploy(d: Duel, policy: PolicyName, rng: Rng, faction: number, target: number) {
  for (let k = 0; k < PLACEMENTS_PER_TURN; k++) policies[policy](d, rng, faction, target)
}

function runTurnDuel(seed: string, playerPolicy: PolicyName, rivalPolicy: PolicyName): Duel {
  const d = new Duel(seed)
  d.autoRival = false // both sides driven explicitly for a fair matchup
  const pr = rngFrom(seed, 'policy-player')
  const rr = rngFrom(seed, 'policy-rival')
  for (let turn = 1; turn <= TURNS_PER_ROUND && d.status === 'running'; turn++) {
    // DEPLOY — alternate act order per turn to kill first-mover bias.
    if (turn % 2 === 0) {
      deploy(d, playerPolicy, pr, PLAYER, RIVAL)
      deploy(d, rivalPolicy, rr, RIVAL, PLAYER)
    } else {
      deploy(d, rivalPolicy, rr, RIVAL, PLAYER)
      deploy(d, playerPolicy, pr, PLAYER, RIVAL)
    }
    // INCUBATE — a fixed window of generations.
    const targetGen = d.state.gen + INCUBATE_GENS
    while (d.status === 'running' && d.state.gen < targetGen) d.tick()
  }
  if (d.status === 'running') {
    const [p, r] = [d.state.pops[PLAYER], d.state.pops[RIVAL]]
    d.forceEnd(p > r ? 'won' : 'lost') // territory at the last turn (house wins ties)
  }
  return d
}

// Determinism audit for the turn driver — identical seed replays identically.
{
  const h1 = stateHash(runTurnDuel('audit', 'planner', 'random').state)
  const h2 = stateHash(runTurnDuel('audit', 'planner', 'random').state)
  if (h1 !== h2) { console.error(`DETERMINISM VIOLATION: ${h1} !== ${h2}`); process.exit(1) }
  console.log(`turn-model determinism: ok (hash ${h1.toString(16)})\n`)
}

const matchups: Array<[PolicyName, PolicyName]> = [
  ['planner', 'random'],
  ['random', 'random'],
  ['planner', 'planner'],
]
let plannerWin = 0
for (const [p, r] of matchups) {
  let wins = 0, gens = 0
  const t0 = performance.now()
  for (let i = 0; i < nDuels; i++) {
    const d = runTurnDuel(`turn-${p}-${r}-${i}`, p, r)
    if (d.status === 'won') wins++
    gens += d.state.gen
  }
  const pct = Math.round((100 * wins) / nDuels)
  if (p === 'planner' && r === 'random') plannerWin = pct
  const dt = ((performance.now() - t0) / 1000).toFixed(1)
  console.log(`${p.padEnd(8)} vs ${r.padEnd(8)}  ${String(pct).padStart(3)}% player wins  (${wins}/${nDuels}, mean ${Math.round(gens / nDuels)} gens, ${dt}s)`)
}
console.log(`\nturn-model proof: planner beats random by ${plannerWin - 50 >= 0 ? '+' : ''}${plannerWin - 50} pts vs a coin flip (want strongly positive; mirrors near 50%).`)
