/**
 * Draft-sequence balance sweep — the redesign's guardrail. Instead of a single
 * turn-1 gene, this replays the full 3-round gauntlet with a player that DRAFTS
 * a run-scoped build (chests + shop) between rounds, under each round's warp
 * cap, against the escalating rival. It answers the one question the reset-each-
 * run economy must satisfy: an AVERAGE build clears in the fair band (a lucky
 * rare-heavy build may exceed — that's a great run, not a bought forever-win —
 * and a no-draft "pure Conway" run is hard but possible).
 *
 *   npm run draftbalance         # 24 gauntlets per policy
 *   npm run draftbalance -- 60   # tighter confidence
 */

import {
  Duel,
  DRAFT_GENES,
  PLAYER,
  RIVAL,
  ROUNDS,
  geneByKey,
  geneChoiceWarp,
  normalizeChoice,
  rngFrom,
  smartAct,
  type GeneChoice,
  type Rng,
} from '../sim'

const FLAG_HIGH = 65
const FLAG_LOW = 35
const PICKS_PER_ROUND = 4 // ~chests + a shop buy or two

type Policy = 'pure' | 'average' | 'rare' | 'focused'

/** The current level of a key in a build (0 = not owned). */
const lvlOf = (build: GeneChoice[], key: string): number =>
  build.reduce((m, c) => (normalizeChoice(c).key === key ? Math.max(m, normalizeChoice(c).level) : m), 0)

/** Merge a pick into the build in place (level up, one entry per key). */
function add(build: GeneChoice[], key: string, level: number): void {
  const i = build.findIndex((c) => normalizeChoice(c).key === key)
  if (i >= 0) build[i] = { key, level }
  else build.push({ key, level })
}

/** Draft `n` picks into the build under a policy (seeded, deterministic). */
function draft(policy: Policy, build: GeneChoice[], n: number, rng: Rng, focusKey: string): void {
  if (policy === 'pure') return
  for (let k = 0; k < n; k++) {
    // candidate = next un-maxed rung of each draftable gene
    const cands = DRAFT_GENES.map((key) => ({ key, level: lvlOf(build, key) + 1 })).filter(
      (c) => c.level <= geneByKey(c.key).levels.length,
    )
    if (!cands.length) break
    let choice
    if (policy === 'rare') {
      // prefer the warpiest available rung (the jackpot chase)
      choice = cands.reduce((a, b) => (geneChoiceWarp(b) > geneChoiceWarp(a) ? b : a))
    } else if (policy === 'focused') {
      choice = cands.find((c) => c.key === focusKey) ?? cands[Math.floor(rng() * cands.length)]
    } else {
      choice = cands[Math.floor(rng() * cands.length)] // average: uniform
    }
    add(build, choice.key, choice.level)
  }
}

/** Play one round with a mirror planner; true if the player wins. */
function playRound(
  seed: string,
  build: GeneChoice[],
  round: (typeof ROUNDS)[number],
): boolean {
  const d = new Duel(
    seed,
    { aiSamples: round.aiSamples, aiActEvery: round.aiActEvery },
    [],
    round.rivalLoadout,
    'soup',
    round.rivalSeed,
  )
  d.warpCap = round.warpCap
  d.runLoadout = [...build]
  d.rebuildPlayer()
  d.autoRival = false
  const pr = rngFrom(seed, 'pp')
  const rr = rngFrom(seed, 'pr')
  while (d.status === 'running' && d.state.gen < 6000) {
    d.tick()
    if (d.state.gen % d.t.aiActEvery === 0) {
      if ((d.state.gen / d.t.aiActEvery) % 2 === 0) {
        smartAct(d, PLAYER, pr, RIVAL, d.t.aiSamples, d.t.aiHorizon)
        smartAct(d, RIVAL, rr, PLAYER, d.t.aiSamples, d.t.aiHorizon)
      } else {
        smartAct(d, RIVAL, rr, PLAYER, d.t.aiSamples, d.t.aiHorizon)
        smartAct(d, PLAYER, pr, RIVAL, d.t.aiSamples, d.t.aiHorizon)
      }
    }
  }
  return d.status === 'won'
}

/** Play a full gauntlet under a policy; returns [clearedRound1, r2, r3]. */
function playGauntlet(seed: string, policy: Policy, focusKey: string): boolean[] {
  const build: GeneChoice[] = []
  const rng = rngFrom(seed, 'draft')
  const cleared = [false, false, false]
  for (let r = 0; r < ROUNDS.length; r++) {
    draft(policy, build, PICKS_PER_ROUND, rng, focusKey) // draft before the round
    if (!playRound(`${seed}-r${r + 1}`, build, ROUNDS[r])) break
    cleared[r] = true
  }
  return cleared
}

const n = Number(process.argv[2] ?? 24)
const policies: Policy[] = ['pure', 'average', 'rare', 'focused']
const focusKey = 'vampire' // the "focused build" archetype

console.log(`draft-sequence balance: ${n} gauntlets × ${policies.length} policies\n`)
console.log('policy'.padEnd(10), 'R1'.padStart(6), 'R2'.padStart(6), 'R3(clear)'.padStart(11))
for (const policy of policies) {
  const tally = [0, 0, 0]
  for (let i = 0; i < n; i++) {
    const c = playGauntlet(`draft-${i}`, policy, focusKey)
    for (let r = 0; r < 3; r++) if (c[r]) tally[r]++
  }
  const pct = (x: number) => `${Math.round((x / n) * 100)}%`
  const flag = (x: number) => {
    const p = (x / n) * 100
    return p > FLAG_HIGH ? ' ⚠HIGH' : p < FLAG_LOW ? ' ·low' : ''
  }
  console.log(
    (policy === 'focused' ? `focus:${focusKey.slice(0, 4)}` : policy).padEnd(10),
    pct(tally[0]).padStart(6),
    pct(tally[1]).padStart(6),
    (pct(tally[2]) + flag(tally[2])).padStart(11),
  )
}
console.log(
  '\nHealthy: pure clears rarely, average lands in the 35–65 band, rare/focus may exceed (it resets each run).',
)
