/**
 * Foresight: the causal impact of a hypothetical placement. Runs two cloned
 * futures — with and without the placed cells — and diffs them N generations
 * out. Cells the placement wins are "gained"; enemy/wild cells it disrupts
 * are "destroyed". This is what makes an option legible before you pay for it.
 */

import { cloneState, setCells, step } from './engine'
import type { SimState } from './types'

export interface Impact {
  /** Cell indices that become `faction` only because of the placement. */
  gained: number[]
  /** Cell indices where another faction's future is disrupted by it. */
  destroyed: number[]
}

export function projectImpact(
  s: SimState,
  faction: number,
  cells: ReadonlyArray<readonly [number, number]>,
  gens: number,
  insetAt?: (gen: number) => number,
): Impact {
  const base = cloneState(s)
  const alt = cloneState(s)
  setCells(alt, faction, cells)
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
  for (let i = 0; i < base.cells.length; i++) {
    const a = base.cells[i]
    const b = alt.cells[i]
    if (b === faction && a !== faction) gained.push(i)
    else if (a !== 0 && a !== faction && b !== a) destroyed.push(i)
  }
  return { gained, destroyed }
}
