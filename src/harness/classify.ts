/**
 * Pattern stabilization classifier — the legibility diagnostic.
 *
 * A pattern is a "unit" if it settles into known debris (still-lifes /
 * oscillators / clean spaceships) within the turn's resolution window; anything
 * that keeps generating fresh chaos far past that window is a "methuselah" and
 * belongs in the rare / high-warp tool tier, not the default deck.
 *
 * This runs every card and seed the game ships through a pure, isolated Life
 * sim and reports its stabilization HORIZON — the generation past which it stops
 * producing new chaos. Run: `npm run classify`.
 *
 * Design law honored: this reads game content but steps its own faithful copy of
 * B3/S23 so it can also classify patterns under WARPED rules (the warp=chaos
 * thesis), which the shipped engine can't do in isolation.
 */

import { PATTERNS, SPECIAL_PATTERNS, SEEDS, type Seed } from '../sim'

// ── A rule as neighbour-count sets. Pure Life = B3/S23. ────────────────────────
interface Rule {
  birth: number[]
  survive: number[]
  name: string
}
const LIFE: Rule = { birth: [3], survive: [2, 3], name: 'B3/S23 (pure)' }
const HIGHLIFE: Rule = { birth: [3, 6], survive: [2, 3], name: 'B36/S23 (HighLife)' }
const WILD: Rule = { birth: [3, 6, 8], survive: [2, 3, 8], name: 'B368/S238 (heavy warp)' }

type Cells = ReadonlyArray<readonly [number, number]>
const key = (x: number, y: number) => `${x},${y}`

/** One Life step under an arbitrary rule, on an unbounded plane (Set of "x,y"). */
function stepLife(live: Set<string>, birth: boolean[], survive: boolean[]): Set<string> {
  const counts = new Map<string, number>()
  for (const c of live) {
    const [x, y] = c.split(',').map(Number)
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue
        const k = key(x + dx, y + dy)
        counts.set(k, (counts.get(k) ?? 0) + 1)
      }
  }
  const next = new Set<string>()
  for (const [k, n] of counts) {
    if (live.has(k) ? survive[n] : birth[n]) next.add(k)
  }
  return next
}

interface Verdict {
  tag: 'still-life' | 'oscillator' | 'spaceship' | 'settles' | 'unbounded' | 'chaotic' | 'dies'
  horizon: number // gens until it stops making new chaos (cap = ">cap")
  period: number
  startPop: number
  peakPop: number
  finalPop: number
  capped: boolean
}

function bbox(live: Set<string>): [number, number, number, number] {
  let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity
  for (const c of live) {
    const [x, y] = c.split(',').map(Number)
    if (x < minx) minx = x
    if (y < miny) miny = y
    if (x > maxx) maxx = x
    if (y > maxy) maxy = y
  }
  return [minx, miny, maxx, maxy]
}
const normKey = (live: Set<string>, minx: number, miny: number) =>
  [...live].map((c) => { const [x, y] = c.split(',').map(Number); return `${x - minx},${y - miny}` }).sort().join(';')

function classify(cells: Cells, rule: Rule, cap = 2048): Verdict {
  const birth: boolean[] = Array(9).fill(false)
  const survive: boolean[] = Array(9).fill(false)
  rule.birth.forEach((n) => (birth[n] = true))
  rule.survive.forEach((n) => (survive[n] = true))

  let live = new Set(cells.map(([x, y]) => key(x, y)))
  const startPop = live.size
  const seen = new Map<string, { gen: number; minx: number; miny: number }>()
  const pops: number[] = []
  const areas: number[] = []

  for (let g = 0; g <= cap; g++) {
    if (live.size === 0)
      return { tag: 'dies', horizon: g, period: 0, startPop, peakPop: Math.max(startPop, ...pops, 0), finalPop: 0, capped: false }
    const [minx, miny, maxx, maxy] = bbox(live)
    pops.push(live.size)
    areas.push((maxx - minx + 1) * (maxy - miny + 1))

    const nk = normKey(live, minx, miny)
    const prev = seen.get(nk)
    if (prev) {
      const period = g - prev.gen
      const translating = prev.minx !== minx || prev.miny !== miny
      const tag: Verdict['tag'] = translating ? 'spaceship' : period === 1 ? 'still-life' : 'oscillator'
      return { tag, horizon: prev.gen, period, startPop, peakPop: Math.max(...pops), finalPop: live.size, capped: false }
    }
    seen.set(nk, { gen: g, minx, miny })
    live = stepLife(live, birth, survive)
  }

  // No clean periodicity within cap → analyse the population/area tail.
  const peakPop = Math.max(...pops)
  const growing = areas[areas.length - 1] > areas[(areas.length >> 1)] * 1.3
  const win = Math.min(600, pops.length >> 1)
  let period = 0
  for (let P = 1; P <= 48 && !period; P++) {
    let ok = true
    for (let i = pops.length - win; i < pops.length; i++) if (pops[i] !== pops[i - P]) { ok = false; break }
    if (ok) period = P
  }
  if (period && !growing) {
    // settled methuselah: horizon = one past the last non-periodic population.
    let lastBad = 0
    for (let i = period; i < pops.length; i++) if (pops[i] !== pops[i - period]) lastBad = i
    return { tag: 'settles', horizon: lastBad + 1, period, startPop, peakPop, finalPop: pops[pops.length - 1], capped: false }
  }
  if (growing)
    return { tag: 'unbounded', horizon: cap, period, startPop, peakPop, finalPop: pops[pops.length - 1], capped: true }
  return { tag: 'chaotic', horizon: cap, period: 0, startPop, peakPop, finalPop: pops[pops.length - 1], capped: true }
}

// ── seeded soup generation (self-contained LCG; representative not byte-exact) ──
function soup(radius: number, density: number, seed: number): Array<[number, number]> {
  let s = (seed * 2654435761) >>> 0
  const rnd = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff)
  const cells: Array<[number, number]> = []
  for (let y = -radius; y <= radius; y++)
    for (let x = -radius; x <= radius; x++)
      if (x * x + y * y <= radius * radius && rnd() < density) cells.push([x, y])
  return cells
}

const WINDOW = 24 // the turn / ghost resolution window
const verdictLine = (name: string, v: Verdict) => {
  const h = v.capped ? `>${v.horizon}` : `${v.horizon}`
  const unit = !v.capped && v.horizon <= WINDOW && v.tag !== 'unbounded'
  const flag = unit ? 'UNIT ' : v.tag === 'dies' ? 'dies ' : 'METHUSELAH'
  const per = v.period ? ` p${v.period}` : ''
  return `  ${name.padEnd(20)} ${v.tag.padEnd(11)}${per.padEnd(5)} horizon ${h.padStart(6)}  pop ${String(v.startPop).padStart(3)}→peak ${String(v.peakPop).padStart(4)}→${String(v.finalPop).padStart(4)}   ${flag}`
}

function seedCells(seed: Seed, rngSeed = 7): Cells | null {
  if (seed.cells) return seed.cells
  if (seed.soup) return soup(seed.soup.radius, seed.soup.density, rngSeed)
  // Primordial Soup uses the tuning default (r7, d0.45).
  return soup(7, 0.45, rngSeed)
}

console.log(`\n╔══ PATTERN STABILIZATION CLASSIFIER ══╗`)
console.log(`Resolution window = ${WINDOW} gens. UNIT = settles ≤ window; METHUSELAH = keeps making chaos past it.\n`)

console.log(`── CARDS (isolated, pure ${LIFE.name}) ──`)
for (const p of PATTERNS) console.log(verdictLine(p.name, classify(p.cells, LIFE)))
console.log(`\n── SPECIAL CELLS (single cells; behaviour is cell-type, not shape) ──`)
for (const p of SPECIAL_PATTERNS) console.log(verdictLine(p.name, classify(p.cells, LIFE)))

console.log(`\n── SEEDS (isolated, pure ${LIFE.name}) ──`)
for (const s of SEEDS) {
  const cells = seedCells(s)
  if (cells) console.log(verdictLine(`${s.name} (${s.category})`, classify(cells, LIFE)))
}

console.log(`\n── COLLISIONS (the real late-game mechanism: clean objects meeting) ──`)
const shift = (cells: Cells, dx: number, dy: number): Cells => cells.map(([x, y]) => [x + dx, y + dy])
const glider = PATTERNS.find((p) => p.id === 'glider')!.cells
const block = PATTERNS.find((p) => p.id === 'block')!.cells
const blinker = PATTERNS.find((p) => p.id === 'blinker')!.cells
const pulsarCells = SEEDS.find((s) => s.id === 'pulsar')!.cells!
const collisions: Array<[string, Cells]> = [
  // two colony fronts meeting: two seedling soups a few cells apart
  ['two soup fronts', [...soup(4, 0.5, 7), ...shift(soup(4, 0.5, 11), 9, 0)]],
  ['glider → block', [...block, ...shift(glider, -6, -6)]],
  ['glider → pulsar', [...pulsarCells, ...shift(glider, -6, -6)]],
  ['block + blinker touching', [...block, ...shift(blinker, 2, 0)]],
]
for (const [name, cells] of collisions) console.log(verdictLine(name, classify(cells, LIFE)))

console.log(`\n── WARP = CHAOS (a genuinely-stable unit, straying from Conway) ──`)
const penta = SEEDS.find((s) => s.id === 'pentadecathlon')!.cells!
for (const rule of [LIFE, HIGHLIFE, WILD]) console.log(verdictLine(`Pentadecathlon · ${rule.name}`, classify(penta, rule)))
console.log('  (a soup is chaotic under any rule; a stable unit shows the rule’s own effect)')

console.log(`\n── CANDIDATE: a designed "Founders" starting formation (spaced still-lifes + oscillators) ──`)
const beehive = (dx: number, dy: number): Cells => shift([[1, 0], [2, 0], [0, 1], [3, 1], [1, 2], [2, 2]], dx, dy)
// Components spaced ≥6 cells apart so no oscillator phase reaches a neighbour —
// the classifier is the check that this holds.
const FOUNDERS: Cells = [
  ...shift(block, 0, 0),
  ...beehive(9, 0),
  ...shift(blinker, 0, 9),
  ...shift(block, 9, 10),
  ...shift(blinker, 18, 4),
  ...beehive(18, 11),
]
console.log(verdictLine('Founders formation', classify(FOUNDERS, LIFE)))
console.log('  vs the current defaults:')
console.log(verdictLine('Seedling (current)', classify(soup(4, 0.5, 7), LIFE)))
console.log(verdictLine('Primordial Soup (current)', classify(soup(7, 0.45, 7), LIFE)))

console.log(`\n╚══════════════════════════════════════╝\n`)
