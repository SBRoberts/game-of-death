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
  ROUNDS,
  geneByKey,
  geneChoiceWarp,
  normalizeChoice,
  rngFrom,
  TUNING,
  type GeneChoice,
  type Rng,
} from '../sim'
import { plannerAt, playTurnRound } from './turnloop'

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
    { aiSamples: round.aiSamples, rivalActs: round.rivalActs, bleachFromTurn: round.bleachFromTurn, bleachPerTurn: round.bleachPerTurn },
    [],
    round.rivalLoadout,
    'soup',
    round.rivalSeed,
  )
  d.warpCap = round.warpCap
  d.runLoadout = [...build]
  d.rebuildPlayer()
  // The player's depth is fixed; the round's aiSamples is the RIVAL's, or the
  // boss would hand the player its own brain and cancel its difficulty out.
  playTurnRound(d, plannerAt(TUNING.aiSamples), plannerAt(round.aiSamples), seed, {
    rivalActs: round.rivalActs,
    order: 'rivalFirst',
  })
  return d.status === 'won'
}

/** Play a full gauntlet under a policy; returns cleared[] per round. */
function playGauntlet(seed: string, policy: Policy, focusKey: string): boolean[] {
  const build: GeneChoice[] = []
  const rng = rngFrom(seed, 'draft')
  const cleared = ROUNDS.map(() => false)
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
const last = ROUNDS.length - 1
console.log('policy'.padEnd(10), ...ROUNDS.map((_, r) => (r === last ? `R${r + 1}(clear)` : `R${r + 1}`).padStart(r === last ? 11 : 6)))
for (const policy of policies) {
  const tally = ROUNDS.map(() => 0)
  for (let i = 0; i < n; i++) {
    const c = playGauntlet(`draft-${i}`, policy, focusKey)
    for (let r = 0; r < ROUNDS.length; r++) if (c[r]) tally[r]++
  }
  const pct = (x: number) => `${Math.round((x / n) * 100)}%`
  const flag = (x: number) => {
    const p = (x / n) * 100
    return p > FLAG_HIGH ? ' ⚠HIGH' : p < FLAG_LOW ? ' ·low' : ''
  }
  console.log(
    (policy === 'focused' ? `focus:${focusKey.slice(0, 4)}` : policy).padEnd(10),
    ...tally.map((t, r) => (r === last ? (pct(t) + flag(t)).padStart(11) : pct(t).padStart(6))),
  )
}
console.log(
  '\nHealthy: pure clears rarely, average lands in the 35–65 band, rare/focus may exceed (it resets each run).',
)
