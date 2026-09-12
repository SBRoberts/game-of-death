# THE GAME OF DEATH

A deterministic tactical duel played on Conway's Game of Life. You don't move
pieces. You choose an intervention, watch the automaton execute it, and find
out whether the future you predicted is the one you got.

**Play:** `npm install && npm run dev` → http://localhost:5173

![A duel in progress: GFP-green colony vs mCherry-red rival across a DAPI-blue debris field](docs/screenshot-battle.png)

## The pitch

Conway's Life has an obvious problem as a game: the simulation is fascinating
and the player has almost no agency. The answer here is to let you *inject
causality* rather than issue orders. You pick a formation, place it, and the
rules tell you what kind of future you just created.

That only works if you can see the future before you buy it, so the whole game
is built around one guarantee:

> **What the ghost shows you is what happens.** The placement preview projects
> exactly one incubation window, the rival commits its move *before* you commit
> yours, and nothing is injected mid-window. The projection is not an estimate —
> it is the literal next state of the slide.

That guarantee is measured, not asserted. `npm run harness` grades every
forecast against the settled board and the last placement of every fully
resolved turn comes back **100%** on both settling cells and struck rival cells.

## The turn

One round is **8 turns**, each of them the same four beats:

1. **DEPLOY** — time is held. The rival's move for this turn is already on the
   slide, flashed in its own colour, so you plan against what it actually did.
   Pick a card (`Q`/`W`/`E`), aim, and read the ghost: how many cells settle,
   how many rival cells it disrupts, what it costs you.
2. **INCUBATE** (`space`) — 16 generations resolve, animated. This is the
   reward, not a loading bar: your plan becoming a fact.
3. **SETTLE** — a scorecard grades the turn. Growth, lysis, assimilation, any
   cascades, and the honest comparison: *forecast 7 settle → held 7/7 · exact*.
4. **Re-plan.** The board is different now.

The round ends when a colony is extinct, or on territory at the eighth settle.
A dead-even board breaks on lysis, never on a house rule.

## The rules underneath

Two colonies of B3/S23 life share one board with the **Free Radicals** between
them — an unaligned third faction holding the midfield. They are cover,
obstacles, and recruits at once, and the arena is sized so they sit inside your
reach from turn one. Three faction interactions sit on top of Conway:

- **Recruitment** — a newborn cell joins the strictly dominant neighbouring
  faction (ties abort the birth).
- **Flanking** — a live cell whose enemy neighbours outnumber its friends by 2+
  defects on the spot. This is also how you assimilate the Free Radicals.
- **Lysis** — outnumbered by just one, the cell dies instead. Fronts bleed and
  churn rather than feeding the winner.

You seed patterns within 10 cells of your living colony, paid for in biomass:
blocks, blinkers, toads, gliders, eaters, spaceships, the R-Pentomino. They are
not reskinned weapons — they are real Life constructions, and each one creates a
different *kind* of future. Travelers need open ground to launch.

**BLEACH** is the tactical clock. From a round-specific turn onward, the field
dies inward a little at the start of every incubation, so the viable ecosystem
shrinks turn by turn and the centre becomes unavoidable. It is previewed on the
slide during deploy — dashed, with the doomed band stained — so it is something
you plan against rather than something that happens to you.

Runs are fully deterministic per seed (`?seed=...`). Same seed, same actions,
same universe, every time.

## Attribution: who actually did that

A cell that starves in its own soup and a cell an enemy crowded to death look
**identical** in a before/after diff. So the engine does not leave it to a diff:
`step()` writes a per-cell event and cause in the same branch that decides each
cell's fate. That buffer is the single authority for the Chain, the settle
report, and the kill rings on the slide.

This was load-bearing. The scorer previously counted every in-field death as
combat, which meant a rival soup churning on its own registered as your cascade:
a measured round produced **3,483** "combat" deaths against **8** real ones, and
the game cheerfully told you that you had engineered eleven cascades and a
×150 CATACLYSM when the two colonies had never once touched. Attribution is not
a nicety here; without it the game's central claim is a lie.

Crowding counts, and that matters: a rival cell that dies of overpopulation
*because your cells are the ones crowding it* is your doing — that is how an
attack in Life actually works. A cell starving alone credits nobody, and a cell
the bleach ate credits nobody.

## The Chain

When one intervention starts a run of generations that nets a stream of rival
losses, that's a chain, and sustained chains escalate through named tiers —
SKIRMISH, ROUT, MASSACRE, CATACLYSM, EXTINCTION EVENT. Every banked cascade
records how long it ran and which placement caused it, and the slide draws the
link: the source placement stays ringed and named while the turn resolves, with
a hairline running from it to the cascade it set off.

The tiers are set against the measured distribution of honest cascades, so they
mean something: SKIRMISH names about half of what banks, ROUT is a good turn,
MASSACRE a great one, and the top two need a genuinely engineered collapse —
realistically, a warped late-round build.

## The run

A run is **6 rounds** against an escalating rival, and every run opens at
**warp 0**: round one is provably pure B3/S23, no exceptions, at every
progression tier. Power is earned inside the run and wiped at the end of it.

- **PLASM** is harvested by assimilating radicals — a ledger of matter already
  on the board, never minted. It buys the between-round shop.
- **Plasmid chests** drop as you harvest: pick 1 of 3 mutagens, stacking into
  your run build.
- A per-round **warp cap** holds over-cap picks dormant until a later round
  admits them, so straying is gradual and round one is always clean.
- **ASH** is the only thing that persists, and it buys breadth and difficulty
  (Biosafety Level 1–4), never round-one power.

Finished runs are read out as an experiment, not just a payout — cascades
engineered, longest cascade, cultures assimilated, how much of what the ghost
promised you actually held, which pattern caused the most, and the run code.

## Daily Culture

Because the game is deterministic, one seed per day is the same universe for
everyone. **DAILY CULTURE** on the title screen opens it, and your best result
for that date is kept. Can you solve this universe better than I did?

## The proof

`npm run harness` states the game's three claims as numbers. Current results at
n=60 per matchup:

```
player   vs rival     player wins
random   vs random     47%     ← structural baseline
weak     vs random     75%
planner  vs random     83%
strong   vs random     90%
planner  vs planner    47%     ← mirror, want ~50
strong   vs planner    68%

skill gradient vs random: 47% → 75% → 83% → 90%  (monotone)

forecast honesty, fully-resolved turns:
  last placement of each turn   settle held 100%   rival struck 100%
```

**The skill gradient is the core claim.** A progressively better planner
reliably beats a weaker one, and depth keeps paying: the deep planner beats the
game's own planner 68% of the time. That number was 48% — a coin flip — until
the placement score was rebuilt around *net territory swing* rather than raw
disruption. The old score paid 3× for disrupting a rival's future and counted
churn as growth, so a deeper search won the fight and lost the count. Cells that
**settle** are the prize; the rest burns out. The player's hint grade and the
rival's policy read the same function, so the grade you're shown is the standard
you're being played by.

Other harnesses:

| Command | What it answers |
| --- | --- |
| `npm run harness` | skill gradient, forecast honesty, determinism |
| `npm run arena` | is the board sized for the turn model? contact, harvest, real lysis |
| `npm run gauntlet` | the round curve and the boss, at the un-drafted difficulty floor |
| `npm run draftbalance` | does an average drafted build land in the fair band? |
| `npm run balance` | per-gene paired sweep across every level |

`npm run gauntlet` reports the round curve against an **un-drafted** player —
a deliberate difficulty floor, since real players draft. It currently declines
85% → 62% → 58% → 33% → 23% → 22%, so the boss is the peak. Getting that read
honestly required separating the two sides' planning depth: a round's
`aiSamples` is the *rival's* setting, and a harness policy that reads it from
the shared tuning hands the player the boss's brain in the boss round, which
silently cancels out exactly the difficulty being measured.

`npm run arena` exists because geometry is a balance parameter. An arena sized
for the retired 800-generation real-time round left the two colonies growing in
separate jars: across every seed the fronts never met, not one radical was ever
harvested, and the entire chest-and-shop economy was dead on arrival. The sweep
is how the current 84×52 field was chosen — contact lands around turn 3 on every
seed and the harvest opens on turn 1.

## Design laws

1. **One currency, one physics.** All power flows through biomass; abilities
   transform matter, never mint it.
2. **Genes are data, not code.** Every upgrade is a rule tuple. Never bespoke logic.
3. **One axis per gene**, so broken builds are bisectable.
4. **Every forever has a clock.** The bleach is the global guarantee.
5. **Determinism with seeds.** Every run is a replayable bug report.
6. **The ghost never lies.** The projection horizon equals the resolve window,
   and the harness fails the build if a promise goes undelivered.
7. **Attribution is earned, never assumed.** If the engine can't say who caused
   a death, nobody gets credit for it.

## Architecture

```
src/sim/      Pure, deterministic, dependency-free TypeScript.
              No DOM, no Date, no Math.random. Nothing here may import outward.
src/web/      Vite + React chrome. The board is ONE canvas, never React.
src/harness/  Headless proofs; all of them drive the real turn loop
              (src/harness/turnloop.ts), so a harness result is a game result.
```

**This is the long-term stack: TypeScript end-to-end.** The sim sits behind a
narrow boundary designed as a future Rust/WASM seam, and the decision is to keep
the door open rather than walk through it. Revisit only if boards grow past
~500×500, per-cell rule fields land, or sweep confidence needs another order of
magnitude. `engine.ts` is ~290 stable lines with ground-truth tests and exact
determinism hashes to verify any reimplementation against.

**Mobile & offline:** the game is a PWA — every asset is local and precached, so
it is playable offline and installable to a phone's home screen.

## Where it goes next

The near-term bet, in order:

1. **Make the eight-turn duel unbelievably good.** Prediction, intervention,
   cascade and consequence are the whole experience; the meta wraps it.
2. **Cards as futures, not tiers.** Each pattern should be correct in some
   situation and wrong in others. Twelve phenomenal patterns, not eighty.
3. **Mutations weirder, not bigger.** A gene should change how you think, not
   your percentages.
4. **Answer the human question.** The planner ladder proves the mechanics reward
   planning. It does not prove *people* learn. Ten players, ten runs each, one
   question: "what did you learn?" Good answers name a mechanism.

## Commands

| Command | What |
| --- | --- |
| `npm run dev` | Dev server |
| `npm test` | Sim ground-truth + turn-model tests (vitest) |
| `npm run harness` | Skill gradient, forecast honesty, determinism audit |
| `npm run arena` | Arena geometry sweep |
| `npm run gauntlet` | Round curve / boss tuning |
| `npm run balance` | Gene balance sweep |
| `npm run draftbalance` | Drafted-build sweep |
| `npm run typecheck` | Strict TS across sim/web/harness |
| `npm run build` | Static production build |
