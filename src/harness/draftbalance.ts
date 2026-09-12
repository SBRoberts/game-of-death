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

// Bands apply to the CONDITIONAL per-round winrate — P(clear round N | reached
// it) — not to the cumulative clear. Over a 6-round gauntlet a healthy 80%
// per round compounds to a ~26% full clear, so judging the final column against
// a per-round band would flag a perfectly good curve as broken.
const FLAG_HIGH = 75
const FLAG_LOW = 40
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
const head = ROUNDS.map((_, r) => `R${r + 1}`.padStart(8)).join('')
console.log('policy'.padEnd(10) + head + '   clear')
for (const policy of policies) {
  const reached = ROUNDS.map(() => 0)
  const tally = ROUNDS.map(() => 0)
  for (let i = 0; i < n; i++) {
    const c = playGauntlet(`draft-${i}`, policy, focusKey)
    for (let r = 0; r < ROUNDS.length; r++) {
      // You only attempt a round if you cleared the one before it.
      if (r === 0 || c[r - 1]) reached[r]++
      if (c[r]) tally[r]++
    }
  }
  // Conditional: of the runs that GOT here, how many got through?
  const cond = tally.map((t, r) => (reached[r] ? (100 * t) / reached[r] : NaN))
  // Show the denominator: few runs reach the late rounds, so a bare "100%" off
  // three samples is noise that someone will otherwise tune against.
  const cells = cond.map((p, r) => {
    if (Number.isNaN(p) || reached[r] === 0) return '       —'
    const flag = reached[r] < 8 ? '?' : p > FLAG_HIGH ? '^' : p < FLAG_LOW ? 'v' : ' '
    return `${Math.round(p)}%${flag}/${reached[r]}`.padStart(8)
  })
  const clear = Math.round((100 * tally[last]) / n)
  console.log(
    (policy === 'focused' ? `focus:${focusKey.slice(0, 4)}` : policy).padEnd(10) +
      cells.join('') +
      `${String(clear).padStart(7)}%`,
  )
}
console.log(
  `\nPer-round cells are CONDITIONAL: pct/n where n = runs that reached it.` +
    `\n^ above ${FLAG_HIGH}%, v below ${FLAG_LOW}%, ? = fewer than 8 runs reached it (noise, do not tune on it).` +
    `\n"clear" is the cumulative full-gauntlet rate — ${ROUNDS.length} rounds compound, so ~25% there is a` +
    `\nhealthy average build, not a broken one. Want: pure struggles, average sits in the band.`,
)
