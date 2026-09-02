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
- Any engine change must keep `npm test` green (blinker/glider/eater are the
  automaton's ground truth) and the harness determinism audit passing.

## Commands

- `npm run dev` / `npm test` / `npm run typecheck`
- `npm run harness` — headless self-play; run after balance-affecting changes
  and sanity-check the reported winrate (~50% for mirrored policies).
