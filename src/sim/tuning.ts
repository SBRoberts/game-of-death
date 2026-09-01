/**
 * Every gameplay constant lives here — one file to read, one file to balance.
 * Design law: genes and tuning are data, never bespoke logic.
 */

export const TUNING = {
  width: 128,
  height: 80,

  // Economy: income accrues per generation, so running the throttle hot is
  // literally how you get rich (and how you get killed).
  startBiomass: 24,
  incomeBase: 0.12,
  incomeScale: 0.03, // + incomeScale * sqrt(population) per generation

  // Placement: patterns may only be seeded near your living colony.
  placementRadius: 10, // Chebyshev distance from any friendly cell
  handSize: 3,

  // Faction physics.
  flankingMargin: 2, // enemy − friendly ≥ 2 → the cell defects
  casualtyMargin: 1, // enemy − friendly ≥ 1 → the cell dies contested

  // Foresight: the placement ghost previews this many generations of impact.
  foresightGens: 24,

  // Entropy storm: after a grace period, the board edges begin to die inward.
  ringGrace: 400, // generations before the storm starts
  ringShrinkEvery: 12, // generations per 1-cell inset
  ringMinHalf: 6, // storm stops when the safe rect is this many cells from center

  // Round structure.
  warmupGens: 30, // no win/loss checks before this
  genLimit: 20000, // hard safety stop → territory scoring

  // Rival AI.
  aiActEvery: 20, // generations between rival placement attempts
  rivalSmart: true, // rival uses the Foresight planner instead of random seeding
  aiSamples: 6, // candidate placements the planner scores per act
  aiHorizon: 16, // Foresight generations per candidate score

  // Colony seeding.
  seedBlobRadius: 7,
  seedDensity: 0.45,

  // Neutral debris scattered through the midfield: obstacles, cover, and
  // capturable matter (flank a wild cell and it defects to you).
  wildsCount: 36,

  // Throttle stops, generations per second (index 0 = paused).
  speeds: [0, 4, 8, 16, 32],
}

export type Tuning = typeof TUNING
