/**
 * The pattern deck — sixty years of Life engineering as unit roster.
 * Coordinates are relative; rotate() spins them in 90° steps.
 *
 * clearance: travelers need this much empty margin around them at placement,
 * or the surrounding ash corrupts them before they ever move.
 * dir: base travel heading (sign only), rotated along with the cells.
 */

export interface Pattern {
  id: string
  name: string
  cost: number
  blurb: string
  cells: ReadonlyArray<readonly [number, number]>
  clearance: number
  dir?: readonly [number, number]
}

const P = (
  id: string,
  name: string,
  cost: number,
  blurb: string,
  cells: ReadonlyArray<readonly [number, number]>,
  clearance = 0,
  dir?: readonly [number, number],
): Pattern => ({ id, name, cost, blurb, cells, clearance, dir })

export const PATTERNS: readonly Pattern[] = [
  P('block', 'Block', 4, 'Still life. A brick in the wall.', [
    [0, 0], [1, 0], [0, 1], [1, 1],
  ]),
  P('blinker', 'Blinker', 4, 'Period-2 oscillator. Cheap chaff.', [
    [0, 0], [1, 0], [2, 0],
  ]),
  P('toad', 'Toad', 5, 'Period-2 oscillator. Noisier chaff.', [
    [1, 0], [2, 0], [3, 0], [0, 1], [1, 1], [2, 1],
  ]),
  P(
    'glider',
    'Glider',
    7,
    'The projectile. Travels diagonally, c/4. Needs open ground to launch.',
    [[1, 0], [2, 1], [0, 2], [1, 2], [2, 2]],
    1,
    [1, 1],
  ),
  P('eater', 'Eater', 8, 'Point defense. Consumes incoming gliders.', [
    [0, 0], [1, 0], [0, 1], [2, 1], [2, 2], [2, 3], [3, 3],
  ]),
  P(
    'lwss',
    'Lightweight Spaceship',
    12,
    'Heavy shot. Travels orthogonally, c/2. Needs open ground to launch.',
    [[1, 0], [4, 0], [0, 1], [0, 2], [4, 2], [0, 3], [1, 3], [2, 3], [3, 3]],
    1,
    [-1, 0],
  ),
  P(
    'rpentomino',
    'R-Pentomino',
    14,
    'The bomb. 1,100 generations of chaos. Damages everyone.',
    [[1, 0], [2, 0], [0, 1], [1, 1], [1, 2]],
    1,
  ),
]

/** Neutral debris shapes scattered through the midfield (not cards). */
export const WILD_SHAPES: ReadonlyArray<ReadonlyArray<readonly [number, number]>> = [
  [[0, 0], [1, 0], [0, 1], [1, 1]], // block
  [[1, 0], [2, 0], [0, 1], [3, 1], [1, 2], [2, 2]], // beehive
  [[0, 0], [1, 0], [2, 0]], // blinker
]

export const patternById = (id: string): Pattern => {
  const p = PATTERNS.find((p) => p.id === id)
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
