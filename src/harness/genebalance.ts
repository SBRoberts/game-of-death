/**
 * Gene balance sweep — the balance law realized. For every gene, run
 * planner-with-gene vs planner-vanilla over seeded duels and flag anything
 * outside the fair band. Because genes are data and duels are deterministic,
 * this is the whole balance QA department.
 *
 *   npm run balance          # 16 duels per gene
 *   npm run balance -- 32
 */

import { Duel, GENES, PLAYER, RIVAL, rngFrom, smartAct, type GeneChoice } from '../sim'

const nDuels = Number(process.argv[2] ?? 12)
const FLAG_HIGH = 65
const FLAG_LOW = 35

function runDuel(seed: string, loadout: GeneChoice[]): Duel {
  const d = new Duel(seed, {}, loadout, [])
  d.autoRival = false
  const pr = rngFrom(seed, 'policy-player')
  const rr = rngFrom(seed, 'policy-rival')
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
  return d
}

console.log(`gene balance sweep: ${nDuels} duels per gene LEVEL, planner mirror\n`)

// Paired design: every loadout (and the baseline) replays the SAME seed set,
// so a gene's delta is attributable to the gene, not to seed-family luck.
let baselineWins = 0
for (let i = 0; i < nDuels; i++) {
  if (runDuel(`balance-${i}`, []).status === 'won') baselineWins++
}
const baseline = (baselineWins / nDuels) * 100
console.log(`${'(vanilla)'.padEnd(12)} ${baseline.toFixed(0).padStart(3)}% baseline\n`)

const flagged: string[] = []
for (const gene of GENES) {
  for (let level = 1; level <= gene.levels.length; level++) {
    let wins = 0
    const t0 = performance.now()
    for (let i = 0; i < nDuels; i++) {
      if (runDuel(`balance-${i}`, [{ key: gene.key, level }]).status === 'won') wins++
    }
    const rate = (wins / nDuels) * 100
    const delta = rate - baseline
    const rung = `${gene.key}@${level}`
    const mark = rate >= FLAG_HIGH ? ' ⚠ STRONG' : rate <= FLAG_LOW ? ' ⚠ WEAK' : ''
    if (mark) flagged.push(rung)
    const dt = ((performance.now() - t0) / 1000).toFixed(0)
    console.log(
      `${rung.padEnd(14)} ${rate.toFixed(0).padStart(3)}% ` +
        `(${delta >= 0 ? '+' : ''}${delta.toFixed(0)} vs vanilla, ${dt}s)${mark}`,
    )
  }
}

console.log(
  flagged.length
    ? `\nflagged for tuning: ${flagged.join(', ')}`
    : `\nno gene outside the ${FLAG_LOW}–${FLAG_HIGH}% band.`,
)
