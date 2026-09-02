/**
 * The pattern deck — sixty years of Life engineering as unit roster.
 * Coordinates are relative; rotate() spins them in 90° steps.
 *
 * clearance: travelers need this much empty margin around them at placement,
 * or the surrounding ash corrupts them before they ever move.
 * dir: base travel heading (sign only), rotated along with the cells.
 */

/** Tactical role — drives the card chip color and how tips are phrased. */
export type Role = 'hold' | 'grow' | 'strike' | 'guard' | 'bomb'

export interface Pattern {
  id: string
  name: string
  cost: number
  role: Role
  /** Tactical guidance: where this wants to live and what it's for. */
  tip: string
  cells: ReadonlyArray<readonly [number, number]>
  clearance: number
  dir?: readonly [number, number]
  /** Non-standard cell type (celltypes.ts) the cells are placed as. */
  cellType?: number
}

export const PATTERNS: readonly Pattern[] = [
  {
    id: 'block',
    name: 'Block',
    cost: 4,
    role: 'hold',
    tip: 'Best beside allies — stable mass that holds the line and pads your territory count.',
    cells: [[0, 0], [1, 0], [0, 1], [1, 1]],
    clearance: 0,
  },
  {
    id: 'blinker',
    name: 'Blinker',
    cost: 4,
    role: 'grow',
    tip: 'Cheap numbers near your colony; churns into fresh births where you dominate.',
    cells: [[0, 0], [1, 0], [2, 0]],
    clearance: 0,
  },
  {
    id: 'toad',
    name: 'Toad',
    cost: 5,
    role: 'grow',
    tip: 'Noisy chaff for your frontier — stirs the soup and feeds your recruitment.',
    cells: [[1, 0], [2, 0], [3, 0], [0, 1], [1, 1], [2, 1]],
    clearance: 0,
  },
  {
    id: 'glider',
    name: 'Glider',
    cost: 7,
    role: 'strike',
    tip: 'Launch from open ground at the rival — or claim radicals from afar. Aim with R.',
    cells: [[1, 0], [2, 1], [0, 2], [1, 2], [2, 2]],
    clearance: 1,
    dir: [1, 1],
  },
  {
    id: 'eater',
    name: 'Eater',
    cost: 8,
    role: 'guard',
    tip: 'Plant at your border facing enemy fire — it eats incoming gliders and survives.',
    cells: [[0, 0], [1, 0], [0, 1], [2, 1], [2, 2], [2, 3], [3, 3]],
    clearance: 0,
  },
  {
    id: 'lwss',
    name: 'Lightweight Spaceship',
    cost: 12,
    role: 'strike',
    tip: 'Heavy shot down an open lane. Smashes fronts and forts — aim with R.',
    cells: [[1, 0], [4, 0], [0, 1], [0, 2], [4, 2], [0, 3], [1, 3], [2, 3], [3, 3]],
    clearance: 1,
    dir: [-1, 0],
  },
  {
    id: 'rpentomino',
    name: 'R-Pentomino',
    cost: 14,
    role: 'bomb',
    tip: 'Drop far from home — behind enemy lines or into the radicals. It erupts for a thousand generations.',
    cells: [[1, 0], [2, 0], [0, 1], [1, 1], [1, 2]],
    clearance: 1,
  },
]

/**
 * Special uni-cells — single cells whose power is in the cell itself, not the
 * shape. Not in the base deck: a card-gene must be equipped to draw them.
 */
export const SPECIAL_PATTERNS: readonly Pattern[] = [
  {
    id: 'elder',
    name: 'Elder',
    cost: 28,
    role: 'hold',
    tip: 'A single immortal cell. Ignores every death rule but the storm — the anchor your colony builds on.',
    cells: [[0, 0]],
    clearance: 0,
    cellType: 1,
  },
  {
    id: 'vampire',
    name: 'Vampire',
    cost: 24,
    role: 'strike',
    tip: 'Costs a fortune, feeds forever: converts an adjacent enemy every third generation and never defects. Starves alone.',
    cells: [[0, 0]],
    clearance: 0,
    cellType: 2,
  },
  {
    id: 'martyr',
    name: 'Martyr',
    cost: 10,
    role: 'guard',
    tip: 'Lives like a normal cell, dies like a bomb — every adjacent enemy dies with it. Seed it where they must tread.',
    cells: [[0, 0]],
    clearance: 0,
    cellType: 3,
  },
]

/** Neutral debris shapes scattered through the midfield (not cards). */
export const RADICAL_SHAPES: ReadonlyArray<ReadonlyArray<readonly [number, number]>> = [
  [[0, 0], [1, 0], [0, 1], [1, 1]], // block
  [[1, 0], [2, 0], [0, 1], [3, 1], [1, 2], [2, 2]], // beehive
  [[0, 0], [1, 0], [2, 0]], // blinker
]

export const patternById = (id: string): Pattern => {
  const p = PATTERNS.find((p) => p.id === id) ?? SPECIAL_PATTERNS.find((p) => p.id === id)
  if (!p) throw new Error(`unknown pattern: ${id}`)
  return p
}

/** Rotate pattern cells by rot × 90° clockwise, normalized to origin. */
export function rotate(
  cells: ReadonlyArray<readonly [number, number]>,
  rot: number,
): Array<[number, number]> {
  let out: Array<[number, number]> = cells.map(([x, y]) => [x, y])
  for (let r = 0; r < ((rot % 4) + 4) % 4; r++) {
    out = out.map(([x, y]) => [-y, x])
  }
  const minX = Math.min(...out.map(([x]) => x))
  const minY = Math.min(...out.map(([, y]) => y))
  return out.map(([x, y]) => [x - minX, y - minY])
}

/** Rotate a travel heading with the same transform as rotate() (no normalize). */
export function rotateDir(
  dir: readonly [number, number],
  rot: number,
): [number, number] {
  let [x, y] = dir
  for (let r = 0; r < ((rot % 4) + 4) % 4; r++) {
    ;[x, y] = [-y, x]
  }
  return [x, y]
}

/** Translate rotated cells to an absolute board anchor. */
export const placeAt = (
  cells: ReadonlyArray<readonly [number, number]>,
  ox: number,
  oy: number,
): Array<[number, number]> => cells.map(([x, y]) => [x + ox, y + oy])
