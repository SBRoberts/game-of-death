/**
 * Foresight: the causal impact of a hypothetical placement. Runs two cloned
 * futures — with and without the placed cells — and diffs them N generations
 * out. Cells the placement wins are "gained"; enemy/radical cells it disrupts
 * are "destroyed". This is what makes an option legible before you pay for it.
 */

import { cloneState, setCells, step } from './engine'
import type { SimState } from './types'

export interface Impact {
  /** Cell indices that become `faction` only because of the placement. */
  gained: number[]
  /** Cell indices where another faction's future is disrupted by it. */
  destroyed: number[]
  /** For each `destroyed` entry, the faction that would have held it. */
  destroyedOwner: number[]
  /**
   * The subset of gained cells that have SETTLED — still yours two further
   * generations on, so still lifes and period-2 oscillators both qualify.
   * This is the "will it form a stable nucleus?" answer.
   */
  lasting: number[]
  /** Your OWN cells this placement costs — alive in the do-nothing future,
   *  dead with the placement (self-overpopulation). The honest downside. */
  ownLost: number[]
}

export function projectImpact(
  s: SimState,
  faction: number,
  cells: ReadonlyArray<readonly [number, number]>,
  gens: number,
  insetAt?: (gen: number) => number,
  cellType = 0,
): Impact {
  const base = cloneState(s)
  const alt = cloneState(s)
  setCells(alt, faction, cells, cellType)
  for (let k = 0; k < gens; k++) {
    if (insetAt) {
      const inset = insetAt(base.gen + 1)
      base.ringInset = inset
      alt.ringInset = inset
    }
    step(base)
    step(alt)
  }
  const gained: number[] = []
  const destroyed: number[] = []
  const destroyedOwner: number[] = []
  const ownLost: number[] = []
  for (let i = 0; i < base.cells.length; i++) {
    const a = base.cells[i]
    const b = alt.cells[i]
    if (b === faction && a !== faction) gained.push(i)
    else if (a === faction && b !== faction) ownLost.push(i) // your cell, killed by your own move
    else if (a !== 0 && a !== faction && b !== a) {
      destroyed.push(i)
      destroyedOwner.push(a)
    }
  }

  // Stability probe: two more generations of the alt future. Gained cells
  // still owned afterward have settled into a nucleus rather than churn.
  for (let k = 0; k < 2; k++) {
    if (insetAt) alt.ringInset = insetAt(alt.gen + 1)
    step(alt)
  }
  const lasting = gained.filter((i) => alt.cells[i] === faction)

  return { gained, destroyed, destroyedOwner, lasting, ownLost }
}
