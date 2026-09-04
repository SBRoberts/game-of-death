/**
 * Seeds — the starting cluster your colony grows from, in the Conway sense.
 * You begin with a small seed and unlock bigger, better, and harder ones: a
 * denser founding soup, stable oscillators, a glider generator, chaotic
 * methuselahs, and fragile challenge seeds that pay a bounty when cleared.
 *
 * A seed is either a procedural soup (a random disc of a given radius/density)
 * or a fixed formation (explicit cells). Everything here is data — pure and
 * deterministic, no RNG of its own; the Duel supplies the seeded stream.
 */

export type SeedCategory = 'soup' | 'oscillator' | 'generator' | 'methuselah' | 'challenge'

export interface Seed {
  id: string
  name: string
  category: SeedCategory
  blurb: string
  /** Ash to unlock; 0 = owned from the start. */
  ashCost: number
  /** A random disc (radius in cells, density 0..1) — a "soup" seed. */
  soup?: { radius: number; density: number }
  /** A fixed formation, relative to its own origin. */
  cells?: ReadonlyArray<readonly [number, number]>
  /** Present on challenge seeds: what it asks and what winning pays. */
  challenge?: { desc: string; rewardAsh: number }
}

/** Parse an ASCII block ('O'/'X'/'#' = live) into relative coordinates. */
function fromAscii(art: string): Array<[number, number]> {
  const rows = art.split('\n').filter((r) => r.trim().length > 0)
  const cells: Array<[number, number]> = []
  rows.forEach((row, y) => {
    ;[...row].forEach((ch, x) => {
      if (ch === 'O' || ch === 'X' || ch === '#') cells.push([x, y])
    })
  })
  return cells
}

/** The pulsar (period-3): four symmetric tri-bar arms on a 13×13 field. */
function pulsar(): Array<[number, number]> {
  const cells: Array<[number, number]> = []
  const bars = [2, 3, 4, 8, 9, 10]
  for (const r of [0, 5, 7, 12]) for (const c of bars) cells.push([c, r])
  for (const c of [0, 5, 7, 12]) for (const r of bars) cells.push([c, r])
  return cells
}

// Gosper glider gun — canonical 36-cell coordinates (fires a glider / 30 gens).
const GOSPER: Array<[number, number]> = [
  [0, 4], [0, 5], [1, 4], [1, 5],
  [10, 4], [10, 5], [10, 6], [11, 3], [11, 7], [12, 2], [12, 8], [13, 2], [13, 8],
  [14, 5], [15, 3], [15, 7], [16, 4], [16, 5], [16, 6], [17, 5],
  [20, 2], [20, 3], [20, 4], [21, 2], [21, 3], [21, 4], [22, 1], [22, 5],
  [24, 0], [24, 1], [24, 5], [24, 6], [34, 2], [34, 3], [35, 2], [35, 3],
]

export const SEEDS: readonly Seed[] = [
  {
    id: 'seedling',
    name: 'Seedling',
    category: 'soup',
    blurb: 'Your first seed — a small cluster of cells. Everything grows from here.',
    ashCost: 0,
    soup: { radius: 4, density: 0.5 },
  },
  {
    id: 'pulsar',
    name: 'Pulsar',
    category: 'oscillator',
    blurb: 'A period-3 beacon — symmetric and utterly stable. Trades raw numbers for permanence.',
    ashCost: 50,
    cells: pulsar(),
  },
  {
    id: 'pentadecathlon',
    name: 'Pentadecathlon',
    category: 'oscillator',
    blurb: 'Period-15 — a long, slow pulse that keeps stirring fresh births around it.',
    ashCost: 70,
    cells: fromAscii(`
..O....O..
OO.OOOO.OO
..O....O..
`),
  },
  {
    id: 'soup',
    name: 'Primordial Soup',
    category: 'soup',
    blurb: 'The dense classic — a broad, chaotic founding mass. Bigger and messier than the Seedling.',
    ashCost: 90,
    // No explicit params: this is the tuning-default soup, so a no-arg duel
    // (harness/tests) stays byte-identical and honors any tuning overrides.
  },
  {
    id: 'acorn',
    name: 'Acorn',
    category: 'methuselah',
    blurb: 'Seven cells that erupt for thousands of generations before they settle. Explosive, hard to steer.',
    ashCost: 70,
    cells: fromAscii(`
.O.....
...O...
OO..OOO
`),
  },
  {
    id: 'glidergun',
    name: 'Gosper Gun',
    category: 'generator',
    blurb: 'Fires a glider every 30 generations — an endless army from a fixed emplacement. The prize seed.',
    ashCost: 200,
    cells: GOSPER,
  },
  {
    id: 'founders',
    name: 'Founders',
    category: 'oscillator',
    blurb: 'A designed base — spaced still-lifes and blinkers that hold their shape and gently pulse. Legible from gen 0; nothing boils.',
    ashCost: 0,
    // Validated horizon-0 by `npm run classify`: components are ≥6 cells apart so
    // no oscillator phase reaches a neighbour — the whole set is stable (p2).
    cells: [
      [0, 0], [1, 0], [0, 1], [1, 1], // block
      [10, 0], [11, 0], [9, 1], [12, 1], [10, 2], [11, 2], // beehive
      [0, 9], [1, 9], [2, 9], // blinker
      [9, 10], [10, 10], [9, 11], [10, 11], // block
      [18, 4], [19, 4], [20, 4], // blinker
      [19, 11], [20, 11], [18, 12], [21, 12], [19, 13], [20, 13], // beehive
    ],
  },
  {
    id: 'diehard',
    name: 'Diehard',
    category: 'challenge',
    blurb: 'In pure Life it vanishes after 130 generations. Start from almost nothing — and win anyway.',
    ashCost: 0,
    cells: fromAscii(`
......O.
OO......
.O...OOO
`),
    challenge: {
      desc: 'Clear a round seeded from the Diehard.',
      rewardAsh: 120,
    },
  },
]

export const seedById = (id: string): Seed => {
  const s = SEEDS.find((s) => s.id === id)
  if (!s) throw new Error(`unknown seed: ${id}`)
  return s
}
