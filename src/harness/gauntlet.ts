/**
 * Gauntlet balance harness (`npm run gauntlet`).
 *
 * Plays the REAL round sequence (each round's rival loadout/seed, planner
 * settings, telegraphed deploys per turn, warp cap, and BLEACH schedule) with
 * the game's turn loop, and reports per-round player winrate + how far the
 * bleach closed. This is the tuning dashboard for the round curve and the boss.
 *
 * The player here is UN-DRAFTED (pure B3/S23) — a conservative difficulty FLOOR.
 * Real players draft warpier genes each round, so a moderate/low floor winrate in
 * late rounds is expected; a near-0 floor (esp. the boss) means "too hard even
 * before you account for the player being weaker than they'll really be."
 */

import { Duel, PLAYER, RIVAL, ROUNDS, TUNING } from '../sim'
import { plannerAt, playTurnRound } from './turnloop'

const nDuels = Number(process.argv[2] ?? 24)
/** The player's planning depth is held FIXED across the gauntlet. A round's
 *  aiSamples is the RIVAL's depth; letting the player policy read it from the
 *  shared tuning gave the player the boss's brain in the boss round, which is
 *  why the finale kept measuring easier than round 5. */
const PLAYER_DEPTH = TUNING.aiSamples

function runRound(roundIdx: number, seed: string): { won: boolean; you: number; rival: number; inset: number } {
  const r = ROUNDS[roundIdx]
  const d = new Duel(
    `${seed}-r${roundIdx + 1}`,
    { aiSamples: r.aiSamples, rivalActs: r.rivalActs, bleachFromTurn: r.bleachFromTurn, bleachPerTurn: r.bleachPerTurn }, // BSL-1 neutral
    [], // player un-drafted (pure) — the difficulty floor
    r.rivalLoadout,
    'soup',
    r.rivalSeed,
  )
  d.warpCap = r.warpCap
  d.rebuildPlayer()
  // The real game's order and cadence: the rival telegraphs rivalActs and plans
  // at the round's depth; you answer with two placements at a fixed depth.
  playTurnRound(d, plannerAt(PLAYER_DEPTH), plannerAt(r.aiSamples), seed, {
    rivalActs: r.rivalActs,
    order: 'rivalFirst',
  })
  return { won: d.status === 'won', you: d.state.pops[PLAYER], rival: d.state.pops[RIVAL], inset: d.state.ringInset }
}

console.log(`\nGAUNTLET — un-drafted planner player, ${nDuels} seeds/round (difficulty floor)\n`)
console.log('rd  round            warp  rival                              floor-win   avg you/rival   bleach')
for (let i = 0; i < ROUNDS.length; i++) {
  const r = ROUNDS[i]
  let wins = 0
  let sy = 0
  let sr = 0
  let sInset = 0
  for (let n = 0; n < nDuels; n++) {
    const res = runRound(i, `g${n}`)
    if (res.won) wins++
    sy += res.you
    sr += res.rival
    sInset += res.inset
  }
  const pct = Math.round((100 * wins) / nDuels)
  const rival = `${r.rivalSeed} ${JSON.stringify(r.rivalLoadout).replace(/[[\]"]/g, '') || '—'}`
  const inset = (sInset / nDuels).toFixed(1)
  console.log(
    `${String(i + 1).padEnd(3)} ${(r.label + (r.boss ? ' (BOSS)' : '')).padEnd(17)} ${String(r.warpCap).padStart(2)}   ${rival.slice(0, 34).padEnd(34)} ${String(pct).padStart(3)}%      ${Math.round(sy / nDuels)}/${Math.round(sr / nDuels)}`.padEnd(96) +
      `   T${r.bleachFromTurn || '—'} +${r.bleachPerTurn}/turn → inset ${inset}`,
  )
}
console.log('\nReading: floor-win is a pure (un-drafted) player. A steady DECLINE across rounds is the intended')
console.log('ramp; a cliff to ~0% (esp. the boss) = too hard even before drafting. inset = where the bleach ended.')
