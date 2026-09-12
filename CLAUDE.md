# The Game of Death — working rules

Roguelike duel on Conway's Game of Life. See README.md for design + roadmap.

Stack decision (settled): TypeScript end-to-end, long-term. Do not introduce
Rust/WASM (or any second language) unless a trigger in README's architecture
section actually fires; the sim boundary keeps that port mechanical later.
Balance philosophy: top gene rungs may exceed the fair band by design —
price them in ash (jackpot tier), don't flatten them.

## Hard constraints

- `src/sim/` stays **pure and deterministic**: no DOM, no `Date.now()`, no
  `Math.random()`, no imports from `src/web/`. It is the future Rust/WASM
  boundary. Randomness only via `rng.ts` seeded streams.
- The board renders through `src/web/render.ts` on one canvas. Never render
  cells as React elements.
- All gameplay constants live in `src/sim/tuning.ts`. Genes/upgrades must be
  data (rule tuples), never special-cased logic — one axis per gene.
- **Attribution is the engine's job.** `step()` writes per-cell `events`/`cause`
  in the branch that decides each cell's fate. Never re-derive "what happened
  here and who did it" from a prev/cells diff — a diff cannot tell a starvation
  from a lysis, and guessing it once had the game crediting players with
  cascades in rounds where the colonies never touched.
- **The ghost never lies.** The projection horizon equals the incubation window
  and the rival deploys before your deploy phase, so the preview is the literal
  next state. Anything that injects cells mid-incubation breaks this and the
  harness will fail.
- Any engine change must keep `npm test` green (blinker/glider/eater are the
  automaton's ground truth) and the harness determinism audit passing.

## Commands

- `npm run dev` / `npm test` / `npm run typecheck`
- `npm run harness` — the turn-model proof. Run after any balance-affecting
  change. It asserts three things and FAILS the build on the last: a monotone
  skill gradient (random < weak < planner < strong, mirrors ~50%), forecast
  honesty (the last placement of a fully resolved turn must deliver exactly what
  the ghost promised), and determinism.
- `npm run arena` — geometry sweep. The board size is a balance parameter, not
  scenery: run it after touching width/height/colonyX/radical* or the turn
  structure, and check that contact still lands early and the harvest opens.
- `npm run gauntlet` / `npm run draftbalance` / `npm run balance` — round curve,
  drafted builds, per-gene sweep.
