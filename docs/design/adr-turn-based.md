# Decision: the turn-based duel is the canonical gameplay

**Status:** LOCKED (2026-09-05). Graduated to production (2026-09-12).
Supersedes the real-time-with-pause duel.

The turn loop prototyped in the spike is THE gameplay model for the duel. The
real-time throttle loop is retired: `App.tsx` drives turns, the spike component
and the old real-time `selfplay` harness are deleted, and `TUNING.speeds` is gone.

## The locked mechanics

- **Turn loop:** DEPLOY (paused — the rival's move for this turn is already on
  the slide; place cards from a hand of 3 within your reach, each graded live by
  the forward projection ghost) → **INCUBATE** (exactly `turnGens` generations,
  fully animated) → **SETTLE** (a scorecard attributes what the turn did and
  grades the forecast) → repeat for `turnsPerRound` turns.
- **Win:** extinct the rival, or more territory at the last settle. A dead-even
  board breaks on lysis — never a house rule.
- **Budget** accrues per generation resolved, discretized to turn boundaries.
- **Legibility contract:** the resolve window equals the projection horizon.

## Decisions made during graduation (2026-09-12)

These were open or wrong in the spike; they are settled now.

1. **The rival telegraphs.** It deploys at the start of YOUR deploy phase, and
   never inside an incubation. This is what makes the ghost honest: with nothing
   injected mid-window, the projection is the literal next state, not an
   estimate. Verified continuously — `npm run harness` fails the build if the
   last placement of a fully resolved turn does not deliver exactly what it
   promised. Rounds set `rivalActs`; difficulty adds to it.

2. **The storm became BLEACH, a turn clock.** The old schedule started at
   generation 400 — more than three times a whole round — so it never fired and
   the round had no clock at all. Bleach is now indexed by turn
   (`bleachFromTurn`, `bleachPerTurn`), compresses the field at the start of an
   incubation, and is previewed on the slide during deploy. The clock is
   something you plan against, not something that happens to you.

3. **Attribution moved into the engine.** `step()` now writes per-cell `events`
   and `cause` in the same branch that decides each cell's fate. A prev/cells
   diff cannot distinguish a starvation from a lysis, so every consumer — the
   Chain, the settle report, the kill rings — reads the engine buffer instead.
   `combatDeaths` previously counted every in-field death: a measured round had
   3,483 "combat" deaths against 8 real ones, and the game credited the player
   with cascades in rounds where the colonies never touched. **A cell crowded to
   death by an enemy's cells counts as that enemy's doing** — that is how an
   attack in Life works — while a cell starving alone, or eaten by the bleach,
   credits nobody.

4. **The arena is a balance parameter.** It was sized for 800-generation rounds
   and never resized for 128. Swept in `src/harness/arena.ts`, which found the
   old geometry produced zero contact and zero harvest on every seed — the
   chest-and-shop economy was dead on arrival. Now 84×52 with colonies at 0.26w:
   contact around turn 3 on every seed, harvest opening turn 1. Smaller cells
   count for more and render bigger, which serves the legibility contract too.
   Re-run the sweep after touching the grid or the turn structure.

5. **The placement score is net territory swing.** `impactScore` paid 3× for
   disrupting a rival's future and counted raw churn as growth, so a deeper
   search won the fight and lost the count: the deep planner beat the standard
   planner only 48% of the time — the skill gradient flattened. Scoring settled
   cells as the prize and pricing a removed rival cell like a gained one took
   that to 73% and made the ladder monotone. The player's hint grade and the
   rival's policy share the function, so the grade shown is the standard played by.

6. **Chain tiers are set against measured honest cascades**, an order of
   magnitude below the old thresholds, which had been calibrated against the
   natural-churn inflation. Chains arm for the turn you placed in, so every
   banked cascade has a source placement to name.

7. **All harnesses drive the real turn loop** (`src/harness/turnloop.ts`). A
   harness that replays a retired cadence measures a game nobody plays.

## Preserved

The deterministic `Duel`/engine, faction combat, The Chain; and the meta —
chests/PLASM, between-round shop, per-round warp cap, ASH, BSL difficulty,
seeds/Culture Lab. Round 1 is still provably pure B3/S23 at every tier.

## Consequences

- `npm run harness` is now the turn-model proof and asserts three things:
  a monotone skill gradient, forecast honesty, and determinism.
- Balance numbers from before this date describe a game that no longer exists.
- The determinism hash changed with the driver cadence and the arena. The sim
  stays pure and deterministic; the hash is re-derived, not defended.
