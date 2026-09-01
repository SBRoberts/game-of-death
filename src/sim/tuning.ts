/**
 * Every gameplay constant lives here — one file to read, one file to balance.
 * Design law: genes and tuning are data, never bespoke logic.
 */

export const TUNING = {
  width: 128,
  height: 80,

  // Economy: income accrues per generation, so running the throttle hot is
  // literally how you get rich (and how you get killed).
  startBiomass: 20,
  incomeBase: 0.25,
  incomeScale: 0.05, // + incomeScale * sqrt(population) per generation

  // Placement: patterns may only be seeded near your living colony.
  placementRadius: 8, // Chebyshev distance from any friendly cell
  handSize: 3,

  // Faction physics.
  flankingMargin: 2, // enemy − friendly ≥ 2 → the cell defects

  // Entropy storm: after a grace period, the board edges begin to die inward.
  ringGrace: 400, // generations before the storm starts
  ringShrinkEvery: 12, // generations per 1-cell inset
  ringMinHalf: 6, // storm stops when the safe rect is this many cells from center

  // Round structure.
  warmupGens: 30, // no win/loss checks before this
  genLimit: 20000, // hard safety stop → territory scoring

  // Rival AI.
  aiActEvery: 25, // generations between rival placement attempts

  // Colony seeding.
  seedBlobRadius: 9,
  seedDensity: 0.38,

  // Throttle stops, generations per second (index 0 = paused).
  speeds: [0, 4, 8, 16, 32],
} as const

export type Tuning = typeof TUNING
