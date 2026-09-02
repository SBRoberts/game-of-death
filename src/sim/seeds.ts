/**
 * Seeds — the starting formation of your colony, a progression axis of its
 * own. The default is the classic random soup; unlockable seeds are famous
 * Life patterns (oscillators, a generator, a methuselah). Challenge seeds are
 * deliberately fragile — clear a round from one and it pays a bounty.
 *
 * Coordinates are relative to the pattern's own origin; the Duel centers them
 * on the colony's start point. Everything here is data — pure and
 * deterministic, no RNG.
 */

export type SeedCategory = 'soup' | 'oscillator' | 'generator' | 'methuselah' | 'challenge'

export interface Seed {
  id: string
  name: string
  category: SeedCategory
  blurb: string
  /** Ash to unlock; 0 = owned from the start. */
  ashCost: number
  /** null = the procedural soup (the classic start). Else explicit cells. */
  cells: ReadonlyArray<readonly [number, number]> | null
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
  const bars = [
    [2, 3, 4],
    [8, 9, 10],
  ].flat()
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
    id: 'soup',
    name: 'Primordial Soup',
    category: 'soup',
    blurb: 'The classic start — a dense, chaotic disc. Populous and unpredictable.',
    ashCost: 0,
    cells: null,
  },
  {
    id: 'pulsar',
    name: 'Pulsar',
    category: 'oscillator',
    blurb: 'A period-3 beacon — large, symmetric, and utterly stable. It holds its ground.',
    ashCost: 45,
    cells: pulsar(),
  },
  {
    id: 'pentadecathlon',
    name: 'Pentadecathlon',
    category: 'oscillator',
    blurb: 'Period-15 — a long, slow pulse that keeps stirring births around it.',
    ashCost: 65,
    cells: fromAscii(`
..O....O..
OO.OOOO.OO
..O....O..
`),
  },
  {
    id: 'acorn',
    name: 'Acorn',
    category: 'methuselah',
    blurb: 'Seven cells that erupt for thousands of generations before they settle. A slow bomb you live inside.',
    ashCost: 60,
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
