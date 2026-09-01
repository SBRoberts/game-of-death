/**
 * Core sim types. Everything in src/sim is pure, deterministic, and
 * dependency-free — no DOM, no Date, no Math.random. This module is the
 * future Rust/WASM boundary; keep it that way.
 */

/** Birth/survival rule as bitmasks over total live-neighbor counts 0..8. */
export interface Rule {
  birth: number
  survive: number
}

/** Build a neighbor-count bitmask: mask(2, 3) → survives on 2 or 3. */
export const mask = (...ns: number[]): number => ns.reduce((m, n) => m | (1 << n), 0)

/** Classic Conway B3/S23. */
export const LIFE: Rule = { birth: mask(3), survive: mask(2, 3) }

export interface Faction {
  name: string
  rule: Rule
}

export interface SimConfig {
  width: number
  height: number
  /** Index 0 is a placeholder for "dead"; real factions start at 1. */
  factions: Faction[]
  /** A live cell defects when enemy − friendly neighbors ≥ this margin. */
  flankingMargin: number
  /**
   * Below the flanking margin, a live cell still dies as a casualty when
   * enemy − friendly ≥ this. Overwhelming force assimilates; skirmishes bleed.
   */
  casualtyMargin: number
}

export interface SimState {
  cfg: SimConfig
  gen: number
  /** Faction id per cell (0 = dead), row-major width×height. */
  cells: Uint8Array
  /** Previous generation's cells (valid after each step; used for ash trails). */
  prev: Uint8Array
  /** Population per faction index. */
  pops: number[]
  /** Entropy-storm inset from every board edge; cells outside the safe rect die. */
  ringInset: number
}
