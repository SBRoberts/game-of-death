/**
 * Gauntlet balance harness (`npm run gauntlet`).
 *
 * Plays the REAL 6-round sequence (each round's rival loadout/seed, planner
 * settings, warp cap, and BLEACH schedule) with a planner-vs-planner turn loop,
 * and reports per-round player winrate + how the bleach bit. This is the tuning
 * dashboard for the round curve and the boss.
 *
 * The player here is UN-DRAFTED (pure B3/S23) — a conservative difficulty FLOOR.
 * Real players draft warpier genes each round, so a moderate/low floor winrate in
 * late rounds is expected; a near-0 floor (esp. the boss) means "too hard even
 * before you account for the player being weaker than they'll really be."
 */

import { Duel, PLAYER, RIVAL, smartAct, rngFrom, ROUNDS } from '../sim'

const TURNS_PER_ROUND = 8
const INCUBATE_GENS = 16
const PLACEMENTS_PER_TURN = 2
const nDuels = Number(process.argv[2] ?? 24)

function runRound(roundIdx: number, seed: string): { won: boolean; you: number; rival: number; maxInset: number } {
  const r = ROUNDS[roundIdx]
  const d = new Duel(
    `${seed}-r${roundIdx + 1}`,
    { aiSamples: r.aiSamples, aiActEvery: r.aiActEvery, ringGrace: r.bleachGrace, ringShrinkEvery: r.bleachEvery }, // BSL-1 neutral

    [], // player un-drafted (pure) — the difficulty floor
    r.rivalLoadout,
    'soup',
    r.rivalSeed,
  )
  d.warpCap = r.warpCap
  d.rebuildPlayer()
  d.autoRival = false
  const pr = rngFrom(seed, 'gaunt-p')
  const rr = rngFrom(seed, 'gaunt-r')
  let maxInset = 0
  for (let turn = 1; turn <= TURNS_PER_ROUND && d.status === 'running'; turn++) {
    // deploy — both sides place a couple, alternating order
    const first = turn % 2 === 0
    for (let k = 0; k < PLACEMENTS_PER_TURN; k++) {
      if (first) { smartAct(d, PLAYER, pr, RIVAL, d.t.aiSamples, d.t.aiHorizon); smartAct(d, RIVAL, rr, PLAYER, r.aiSamples, d.t.aiHorizon) }
      else { smartAct(d, RIVAL, rr, PLAYER, r.aiSamples, d.t.aiHorizon); smartAct(d, PLAYER, pr, RIVAL, d.t.aiSamples, d.t.aiHorizon) }
    }
    const target = d.state.gen + INCUBATE_GENS
    while (d.status === 'running' && d.state.gen < target) { d.tick(); if (d.state.ringInset > maxInset) maxInset = d.state.ringInset }
  }
  const you = d.state.pops[PLAYER], rival = d.state.pops[RIVAL]
  if (d.status === 'running') {
    const win = you !== rival ? you > rival : d.state.combatDeaths[RIVAL] > d.state.combatDeaths[PLAYER]
    d.forceEnd(win ? 'won' : 'lost')
  }
  return { won: d.status === 'won', you, rival, maxInset }
}

console.log(`\nGAUNTLET — un-drafted planner player, ${nDuels} seeds/round (difficulty floor)\n`)
console.log('rd  round            warp  rival                              floor-win   avg you/rival   bleach')
for (let i = 0; i < ROUNDS.length; i++) {
  const r = ROUNDS[i]
  let wins = 0, sy = 0, sr = 0, sInset = 0
  for (let n = 0; n < nDuels; n++) {
    const res = runRound(i, `g${n}`)
    if (res.won) wins++
    sy += res.you; sr += res.rival; sInset += res.maxInset
  }
  const pct = Math.round((100 * wins) / nDuels)
  const rival = `${r.rivalSeed} ${JSON.stringify(r.rivalLoadout).replace(/[[\]"]/g, '') || '—'}`
  const inset = (sInset / nDuels).toFixed(1)
  console.log(
    `${String(i + 1).padEnd(3)} ${(r.label + (r.boss ? ' (BOSS)' : '')).padEnd(17)} ${String(r.warpCap).padStart(2)}   ${rival.slice(0, 34).padEnd(34)} ${String(pct).padStart(3)}%      ${Math.round(sy / nDuels)}/${Math.round(sr / nDuels)}`.padEnd(96) + `   inset ${inset}`,
  )
}
console.log('\nReading: floor-win is a pure (un-drafted) player. A steady DECLINE across rounds is the intended')
console.log('ramp; a cliff to ~0% (esp. the boss) = too hard even before drafting. inset = avg storm bite.')
