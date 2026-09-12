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
  /** Cell-type id per cell (see celltypes.ts); 0 = normal Conway cell. */
  types: Uint8Array
  /** Previous generation's types (scratch buffer after each step). */
  prevTypes: Uint8Array
  /** Population per faction index. */
  pops: number[]
  /** Entropy-storm inset from every board edge; cells outside the safe rect die. */
  ringInset: number
  /** Cumulative deaths per faction (all causes, bleach included). */
  deaths: Int32Array
  /**
   * Cumulative COMBAT deaths per faction — cells lysed by an enemy (the
   * casualty rule or a martyr blast) ONLY. Natural under/overpopulation deaths
   * and bleached cells are excluded, so the Chain scorer can never mistake a
   * soup churning on its own, or the closing field, for a player's cascade.
   */
  combatDeaths: Int32Array
  /** Natural (under/overpopulation) deaths per faction — the culture's own churn. */
  naturalDeaths: Int32Array
  /**
   * Per-cell event from the LAST step (see EV_* in engine.ts), row-major.
   * The authoritative attribution source: the renderer reads it rather than
   * guessing from a prev/cells diff, which cannot tell a lysis from a starvation.
   */
  events: Uint8Array
  /**
   * Per-cell CAUSE of that event: the aggressor's faction for a lysis or a
   * conversion, the parent faction for a birth, 0 when nobody is responsible.
   */
  cause: Uint8Array
  /** Cumulative conversions, indexed [from * factions.length + to]. */
  converts: Int32Array
  /** Combat-death centroid accumulators for THIS step (reset each step). */
  killN: number
  killSumX: number
  killSumY: number
  /** Martyr detonations THIS step: cell index + enemies killed (cleared each step). */
  blasts: Array<{ i: number; kills: number }>
}
