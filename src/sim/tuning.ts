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
  // capturable matter (flank a radical and it defects to you).
  radicalsCount: 36,

  // Harvest economy: converting radical matter banks PLASM (the run-scoped
  // shop/chest currency) and fills the chest meter. Both are ledgers of matter
  // already on the board — never minted, never converted back to biomass.
  plasmPerRadical: 1, // PLASM banked per converted radical cell
  chestEvery: 10, // converted radical cells per in-run chest

  // Throttle stops, generations per second (index 0 = paused). 1× is slow
  // enough to think at; the top stop is for riding out settled positions.
  speeds: [0, 2, 5, 12, 30],
}

export type Tuning = typeof TUNING
