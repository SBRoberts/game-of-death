/**
 * Headless self-play: both factions run the scripted AI policy across N
 * seeded duels. This is the seed of the balance harness — when genes exist,
 * this is where gene-vs-gene winrates get flagged.
 *
 *   npm run harness            # 40 duels
 *   npm run harness -- 200     # more duels
 */

import { Duel, PLAYER, RIVAL, aiAct, rngFrom, stateHash } from '../sim'

const playerPolicy = (d: Duel, rng: ReturnType<typeof rngFrom>): void => {
  if (d.state.gen % d.t.aiActEvery === 0) aiAct(d, PLAYER, rng, RIVAL)
}

const nDuels = Number(process.argv[2] ?? 40)

// Determinism audit first: an identical seed must replay identically.
{
  const runHash = (seed: string): number => {
    const d = new Duel(seed)
    const rng = rngFrom(seed, 'player-policy')
    while (d.status === 'running' && d.state.gen < 6000) {
      d.tick()
      playerPolicy(d, rng)
    }
    return stateHash(d.state)
  }
  const [h1, h2] = [runHash('audit'), runHash('audit')]
  if (h1 !== h2) {
    console.error(`DETERMINISM VIOLATION: ${h1} !== ${h2}`)
    process.exit(1)
  }
  console.log(`determinism audit: ok (hash ${h1.toString(16)})`)
}

let wins = 0
let losses = 0
let totalGens = 0
let storms = 0
const t0 = performance.now()

for (let i = 0; i < nDuels; i++) {
  const seed = `selfplay-${i}`
  const d = new Duel(seed)
  const rng = rngFrom(seed, 'player-policy')
  while (d.status === 'running' && d.state.gen < 6000) {
    d.tick()
    playerPolicy(d, rng)
  }
  if (d.status === 'won') wins++
  else losses++
  if (d.outcome.includes('storm')) storms++
  totalGens += d.state.gen
}

const dt = (performance.now() - t0) / 1000
console.log(`\nself-play: ${nDuels} duels, both sides scripted`)
console.log(`  player-side winrate: ${((wins / nDuels) * 100).toFixed(1)}%  (${wins}W / ${losses}L)`)
console.log(`  decided by storm closure: ${storms}/${nDuels}`)
console.log(`  mean duel length: ${Math.round(totalGens / nDuels)} generations`)
console.log(`  throughput: ${Math.round(totalGens / dt).toLocaleString()} generations/sec`)
console.log(
  `\nnote: with mirrored policies, winrate far from 50% means the map or rules favor a side.`,
)
