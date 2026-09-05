# Decision: the turn-based duel ("spike 1") is the canonical gameplay

**Status:** LOCKED (2026-09-05). Supersedes the real-time-with-pause duel.

The prototype at `src/web/spike/TurnSpike.tsx` (`/?spike=1`) is adopted as THE gameplay
model for the duel. The real-time throttle loop in `App.tsx` is retired as the duel driver.

## The locked mechanics

- **Turn loop:** DEPLOY (paused — place cards from a hand of 3 within your reach, each
  placement graded live by the forward **projection** ghost: `+N settle · N cleared`) →
  **INCUBATE** (one fixed ~16-generation resolve, fully animated) → **SETTLE** (a scorecard
  attributes what your move did) → repeat for **8 turns**.
- **No STEADY/HOT greed dial** — a single INCUBATE. Difficulty-for-reward lives at the
  meta/run level (BSL stakes), never as a per-turn self-handicap.
- **Budget** accrues per turn from resolved generations (the population→income flywheel,
  discretized to turn boundaries).
- **Win:** extinct the rival, or more territory at turn 8 (ties broken on kills).
- **Legibility contract:** the resolve window equals the projection horizon (WYSIWYG); cells
  are crisp/countable; "survivors hold, changers move"; life events (divide/merge/die/attack)
  animate with cause-before-effect attribution. Aesthetic: "living culture on a lab CRT"
  (see design-language.md).

## Preserved (the meta wraps the new duel unchanged)

The deterministic `Duel`/engine, faction combat, The Chain; and the meta — chests/PLASM,
between-round shop, per-round warp cap, ASH, BSL difficulty, seeds/Culture Lab.

## Graduation plan (spike → production)

1. Promote the turn driver: replace `App.tsx`'s real-time loop with deploy→incubate→settle.
2. Port the animated confocal renderer + projection + life-event layer into `render.ts`.
3. Re-anchor the meta to turns (chests between turns, shop/warp per round — mostly as-is).
4. Re-derive the determinism audit hash (driver cadence changes; sim stays pure/deterministic)
   and recompute `draftbalance` winrates for the turn model.
5. Copy/HUD to the turn model; storm→BLEACH per the HANDOFF brief.
