/**
 * Every gameplay constant lives here — one file to read, one file to balance.
 * Design law: genes and tuning are data, never bespoke logic.
 */

export const TUNING = {
  // The arena is sized for the TURN model, not the retired real-time round:
  // small enough that the fronts MEET (contact lands around turn 3 on every
  // seed) and the midfield sits inside your placement reach from turn 1.
  // Swept in src/harness/arena.ts — re-run it if you touch these.
  width: 84,
  height: 52,

  // Turn structure (docs/design/adr-turn-based.md). A round is turnsPerRound
  // turns of DEPLOY (place cards, time held) → INCUBATE (exactly turnGens
  // generations, animated) → SETTLE (a report grades what the turn did).
  turnsPerRound: 8,
  turnGens: 16,

  // Foresight: the placement ghost projects exactly one INCUBATE window, so
  // what the ghost promises is what the settle report grades (WYSIWYG). The
  // rival deploys BEFORE your deploy phase and nothing is injected mid-window,
  // so the projection is the literal future of the slide — not an estimate.
  foresightGens: 16,

  // Economy: income accrues per generation resolved (the population→income
  // flywheel, discretized to turn boundaries).
  startBiomass: 24,
  incomeBase: 0.12,
  incomeScale: 0.03, // + incomeScale * sqrt(population) per generation

  // Placement: patterns may only be seeded near your living colony.
  placementRadius: 10, // Chebyshev distance from any friendly cell
  handSize: 3,

  // Faction physics.
  flankingMargin: 2, // enemy − friendly ≥ 2 → the cell defects
  casualtyMargin: 1, // enemy − friendly ≥ 1 → the cell dies contested

  // BLEACH — the tactical clock. From bleachFromTurn on, the field dies inward
  // by bleachPerTurn cells at the start of every incubation, so the viable
  // ecosystem shrinks turn by turn and the centre becomes unavoidable. 0 =
  // never; rounds set their own schedule in rounds.ts.
  bleachFromTurn: 0,
  bleachPerTurn: 1,
  ringMinHalf: 6, // the bleach stops when the safe rect is this close to centre

  // Round structure.
  warmupGens: 30, // no win/loss checks before this
  genLimit: 20000, // hard safety stop → territory scoring

  // Rival AI: the planner — Foresight-scored placements, the same tool you
  // have. It deploys rivalActs placements at the start of each of your deploy
  // phases, telegraphed on the slide, so your projection accounts for them.
  rivalSmart: true,
  rivalActs: 1,
  aiSamples: 6, // candidate placements the planner scores per act
  aiHorizon: 16, // Foresight generations per candidate score

  // Colony seeding. colonyX is the fraction of the width each colony's centre
  // sits at (the rival mirrors it). The arena is sized so the fronts MEET
  // inside a round: a round is turnsPerRound × turnGens generations, and a
  // Life front creeps ~0.2 cells/gen, so a gap much wider than that is two
  // cultures growing in separate jars. Swept in src/harness/arena.ts.
  colonyX: 0.26,
  seedBlobRadius: 7,
  seedDensity: 0.45,

  // Neutral debris scattered through the midfield: obstacles, cover, and
  // capturable matter (flank a radical and it defects to you). The band is a
  // fraction-of-width span; it must overlap your reach early or the harvest
  // economy (PLASM → chests → shop) never opens.
  radicalsCount: 60,
  radicalFrom: 0.3,
  radicalSpan: 0.4,

  // Harvest economy: converting radical matter banks PLASM (the run-scoped
  // shop/chest currency) and fills the chest meter. Both are ledgers of matter
  // already on the board — never minted, never converted back to biomass.
  plasmPerRadical: 3, // PLASM banked per converted radical cell
  chestEvery: 3, // converted radical cells per in-run chest (≈3 chests a round)
}

export type Tuning = typeof TUNING
