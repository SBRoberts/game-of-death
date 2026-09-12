/**
 * The proof harness (`npm run harness`), for the turn-based duel that is the
 * canonical game (docs/design/adr-turn-based.md).
 *
 * Three claims, stated as numbers:
 *   1. SKILL GRADIENT — a better planner reliably beats a worse one: random <
 *      weak planner < the game's planner < a deep planner, and mirrors sit
 *      near 50%. If planning didn't matter, the ladder would be flat.
 *   2. HONESTY — the projection ghost is the literal future: with the rival
 *      deployed first and nothing injected mid-incubation, every cell the ghost
 *      showed settling is held at settle and every rival cell it showed struck
 *      is gone. Measured, not assumed (WYSIWYG is the legibility contract).
 *   3. DETERMINISM — identical seed + actions replay byte-identically.
 *
 *   npm run harness            # 16 duels per matchup
 *   npm run harness -- 40      # more
 */

import { Duel, PLAYER, stateHash } from '../sim'
import { POLICIES, playTurnRound, plannerViaHand, type PolicyName } from './turnloop'

const nDuels = Number(process.argv[2] ?? 16)

function run(seed: string, player: PolicyName, rival: PolicyName): Duel {
  return playTurnRound(new Duel(seed), POLICIES[player], POLICIES[rival], seed)
}

// ── 3. determinism ─────────────────────────────────────────────────────────
{
  const h1 = stateHash(run('audit', 'planner', 'random').state)
  const h2 = stateHash(run('audit', 'planner', 'random').state)
  if (h1 !== h2) {
    console.error(`DETERMINISM VIOLATION: ${h1} !== ${h2}`)
    process.exit(1)
  }
  console.log(`turn-model determinism: ok (hash ${h1.toString(16)})\n`)
}

// ── 1. the skill gradient ──────────────────────────────────────────────────
const matchups: Array<[PolicyName, PolicyName]> = [
  ['random', 'random'],
  ['weak', 'random'],
  ['planner', 'random'],
  ['strong', 'random'],
  ['planner', 'planner'],
  ['strong', 'weak'],
  ['strong', 'planner'],
]
const rate: Record<string, number> = {}
console.log('player   vs rival     player wins   mean gens')
for (const [p, r] of matchups) {
  let wins = 0
  let gens = 0
  const t0 = performance.now()
  for (let i = 0; i < nDuels; i++) {
    const d = run(`turn-${p}-${r}-${i}`, p, r)
    if (d.status === 'won') wins++
    gens += d.state.gen
  }
  const pct = Math.round((100 * wins) / nDuels)
  rate[`${p}/${r}`] = pct
  const dt = ((performance.now() - t0) / 1000).toFixed(1)
  console.log(`${p.padEnd(8)} vs ${r.padEnd(8)}  ${String(pct).padStart(3)}%  (${wins}/${nDuels})   ${String(Math.round(gens / nDuels)).padStart(4)}   ${dt}s`)
}
const ladder = [rate['random/random'], rate['weak/random'], rate['planner/random'], rate['strong/random']]
const monotone = ladder.every((v, i) => i === 0 || v >= ladder[i - 1])
console.log(
  `\nskill gradient vs random: random ${ladder[0]}% → weak ${ladder[1]}% → planner ${ladder[2]}% → strong ${ladder[3]}%` +
    `  ${monotone ? '(monotone ✓)' : '(NOT monotone ⚠)'}`,
)
console.log(`planning edge: planner beats random by +${rate['planner/random'] - rate['random/random']} pts over the structural baseline; mirror ${rate['planner/planner']}% (want ~50).`)

// ── 2. forecast honesty ────────────────────────────────────────────────────
{
  let held = 0
  let heldOf = 0
  let struck = 0
  let struckOf = 0
  let lastHeld = 0
  let lastHeldOf = 0
  let lastStruck = 0
  let lastStruckOf = 0
  let placements = 0
  for (let i = 0; i < nDuels; i++) {
    const seed = `honest-${i}`
    const d = playTurnRound(new Duel(seed), plannerViaHand(6), POLICIES.planner, seed, { order: 'rivalFirst' })
    for (const rep of d.turnReports) {
      // A turn cut short by extinction never ran the window the ghost projected,
      // so its forecast was never due. Grading it would be scoring a promise
      // against a world that ended first.
      if (rep.gens < d.t.turnGens) continue
      held += rep.held
      heldOf += rep.forecastCells
      struck += rep.struck
      struckOf += rep.forecastHits
      placements += rep.placements.length
      // The LAST placement of a turn sees the final board: its forecast must be exact.
      const last = rep.placements[rep.placements.length - 1]
      if (last) {
        lastHeld += last.held
        lastHeldOf += last.forecastCells.length
        lastStruck += last.struck
        lastStruckOf += last.forecastHits.length
      }
    }
  }
  const pct = (a: number, b: number) => (b > 0 ? `${((100 * a) / b).toFixed(1)}%` : 'n/a')
  const p = PLAYER // (documenting which side is graded)
  void p
  console.log(`\nforecast honesty over ${placements} player placements in fully-resolved turns (rival telegraphs first):`)
  console.log(`  all placements   settle held ${pct(held, heldOf)} (${held}/${heldOf})   rival struck ${pct(struck, struckOf)} (${struck}/${struckOf})`)
  console.log(`  last of each turn settle held ${pct(lastHeld, lastHeldOf)} (${lastHeld}/${lastHeldOf})   rival struck ${pct(lastStruck, lastStruckOf)} (${lastStruck}/${lastStruckOf})   ← must be 100%`)
  if (lastHeld !== lastHeldOf || lastStruck !== lastStruckOf) {
    console.error('WYSIWYG VIOLATION: the ghost promised something the settle did not deliver.')
    process.exit(1)
  }
}
