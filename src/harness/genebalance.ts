/**
 * Gene balance sweep — the balance law realized, now parallel. Every gene
 * LEVEL replays the same paired seed set in a planner mirror; rungs fan out
 * across CPU cores as child processes, so a full 22-rung audit takes minutes.
 *
 *   npm run balance          # 12 duels per rung
 *   npm run balance -- 32    # tighter confidence
 *
 * Deterministic: identical seeds per rung regardless of parallelism.
 */

import { spawn } from 'node:child_process'
import { availableParallelism } from 'node:os'
import { fileURLToPath } from 'node:url'
import { Duel, GENES, type GeneChoice } from '../sim'
import { POLICIES, playTurnRound } from './turnloop'

const FLAG_HIGH = 65
const FLAG_LOW = 35

function runDuel(seed: string, loadout: GeneChoice[]): Duel {
  const d = new Duel(seed, {}, loadout, [])
  return playTurnRound(d, POLICIES.planner, POLICIES.planner, seed)
}

// ── child mode: compute one rung, print JSON ───────────────────────────────
if (process.env.GOD_RUNG !== undefined) {
  const rung = process.env.GOD_RUNG // '' = vanilla baseline, else 'key@level'
  const n = Number(process.env.GOD_N ?? 12)
  const loadout: GeneChoice[] = rung
    ? [{ key: rung.split('@')[0], level: Number(rung.split('@')[1]) }]
    : []
  let wins = 0
  for (let i = 0; i < n; i++) {
    if (runDuel(`balance-${i}`, loadout).status === 'won') wins++
  }
  console.log(JSON.stringify({ rung, wins, n }))
  process.exit(0)
}

// ── parent mode: fan rungs across cores, collect, report ───────────────────
const nDuels = Number(process.argv[2] ?? 12)
const rungs: string[] = ['']
for (const gene of GENES) {
  for (let level = 1; level <= gene.levels.length; level++) rungs.push(`${gene.key}@${level}`)
}

const self = fileURLToPath(import.meta.url)
const workers = Math.max(1, availableParallelism() - 2)
console.log(
  `gene balance sweep: ${nDuels} duels × ${rungs.length} rungs across ${workers} workers\n`,
)

const results = new Map<string, { wins: number; n: number }>()
const t0 = performance.now()

async function runRung(rung: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn('npx', ['tsx', self], {
      env: { ...process.env, GOD_RUNG: rung, GOD_N: String(nDuels) },
      stdio: ['ignore', 'pipe', 'inherit'],
    })
    let out = ''
    child.stdout.on('data', (d) => (out += d))
    child.on('close', (code) => {
      if (code !== 0) return reject(new Error(`rung ${rung || 'baseline'} exited ${code}`))
      const parsed = JSON.parse(out.trim().split('\n').pop() ?? '{}')
      results.set(rung, { wins: parsed.wins, n: parsed.n })
      resolve()
    })
  })
}

const queue = [...rungs]
await Promise.all(
  Array.from({ length: workers }, async () => {
    while (queue.length > 0) {
      const rung = queue.shift()
      if (rung === undefined) break
      await runRung(rung)
    }
  }),
)

const baseline = results.get('')
const basePct = baseline ? (baseline.wins / baseline.n) * 100 : 0
console.log(`${'(vanilla)'.padEnd(14)} ${basePct.toFixed(0).padStart(3)}% baseline\n`)

const flagged: string[] = []
for (const rung of rungs.slice(1)) {
  const r = results.get(rung)
  if (!r) continue
  const rate = (r.wins / r.n) * 100
  const delta = rate - basePct
  const mark = rate >= FLAG_HIGH ? ' ⚠ STRONG' : rate <= FLAG_LOW ? ' ⚠ WEAK' : ''
  if (mark) flagged.push(rung)
  console.log(
    `${rung.padEnd(14)} ${rate.toFixed(0).padStart(3)}% ` +
      `(${delta >= 0 ? '+' : ''}${delta.toFixed(0)} vs vanilla)${mark}`,
  )
}

const secs = ((performance.now() - t0) / 1000).toFixed(0)
console.log(
  flagged.length
    ? `\nflagged: ${flagged.join(', ')}  (${secs}s total)`
    : `\nno rung outside the ${FLAG_LOW}–${FLAG_HIGH}% band. (${secs}s total)`,
)
