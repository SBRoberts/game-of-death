---
name: verify
description: Drive The Game of Death end-to-end in a headless browser and capture evidence. Use after any change to sim rules, the duel loop, or the web UI.
---

# Verifying The Game of Death

The surface is the browser: one canvas board + React HUD/hand. Tests and
typecheck are CI's job — verification means watching a duel run.

## Launch

```bash
npm run dev &          # serves http://localhost:5173
curl -s -o /dev/null -w "%{http_code}" http://localhost:5173/   # expect 200
```

## Drive (headless, no extension needed)

`puppeteer-core` against system Chrome works:
`executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'`,
`headless: 'new'`. A known-good driver script pattern lives in git history —
see the flow below.

Key selectors / inputs:

- Load `http://localhost:5173/?seed=<fixed>` for reproducible runs; press
  `Space` immediately to pause for stable inspection.
- The UI has TWO MOUNTS switched by window aspect ratio: float (~16:10 —
  full-bleed board, six `.island` glass panels) and dock (`.rail` beside a
  `.board-col` with `.label-strip`/`.footer-strip`). Aspect < 1.0 renders
  the `.portrait` rotate prompt. Resize the viewport to pick a mount.
- Key selectors: `.biomass-inline .val` / `.rail-panel .readout .val`
  (wallet), `.storm-track` (two-ended hairline), `.round-pips`,
  `.tickers .kills`, `.throttle-well .detent` (radiogroup), `.card`
  (`.selected` shows blurb + R hint), `.plate` (ash ledger with
  `.plate-row`s and welded `.plate-actions`), `.genome-surface` (strand:
  `.rule-readout .rule`, `.socket-row`, `.slip`), `.coach-step`
  (3 anchored steps until first release of time), `.overlay` (null while
  running). Reach ring + graticule are canvas-drawn while a card is armed.
- Populations have no numeric readout — the momentum frame is the gauge.
- Cards: `.hand .card` (click to select). Board: click the `<canvas>` at
  fractional coordinates via its bounding box — the player colony sits around
  (0.22w, 0.5h), rival (0.78w, 0.5h).
- Throttle buttons: `button.speed` (last one = 8×). Keys: Space pause,
  `r` rotate, `n` new run.

## The canonical flow

1. Load fixed seed, pause → screenshot (both colonies seeded, HUD populated).
2. Select card, hover near player colony → ghost renders green.
3. Click → biomass drops by card cost, flash renders, hand slot refills.
4. Probe: click far from colony → red ghost, biomass unchanged.
5. Probe: gen counter frozen while paused (compare 1s apart).
6. Throttle 8×, poll `.overlay` up to ~40s → duel reaches a verdict
   (extinction or storm-closure territory).
7. `n` → fresh seed, gen resets.
8. Zero console errors expected (`page.on('console'/'pageerror')`).

## Recording game-feel

`page.screencast({ path: 'clip.webm' })` works with puppeteer-core + system
Chrome — start it after load, stop before close, keep clips ~30s. Move the
mouse with `{ steps: N }` so hovers read naturally on video. SFX are WebAudio
and inaudible headless; verify audio wiring by checking zero console errors on
select/place/invalid/storm/win paths.

## Title screen

The app opens on a **title screen** (`.title-screen`) that spells "THE GAME OF
DEATH" in live cells, with `START` and `HOW TO PLAY` buttons. Drive scripts
must click `.title-btn.primary` (START) to reach the game, which lands
**paused** (throttle at ⏸) so the first action is planning. `.howto` is the
rules modal.

## Debug hooks

Load with `&debug=1` to enable force-end keys: `v` wins the current duel,
`x` loses it. This is how you drive the gauntlet interstitials (round
cleared → next round → run complete) without playing to victory headless.
Seed meta state pre-load via `evaluateOnNewDocument` writing `god-meta-v1`
to localStorage (e.g. `{"ash":300,"slots":0,"owned":[],"equipped":[]}`).

## Gotchas

- The claude-in-chrome extension may be disconnected; puppeteer-core is the
  reliable fallback.
- An unpiloted player loses to the rival AI — that is correct behavior, not
  a bug.
- After sim-rule changes also run `npm run harness` and sanity-check the
  self-play winrate (~50% ± noise for mirrored policies) and the determinism
  audit line.


## Reachability audit (run after ANY layout or overlay change)

`reachability-audit.mjs` in this folder drives every surface (title, how-to,
duel, genome, settings, chest, cash-out, shop) at seven viewport sizes and
reports anything a player could not get to. It has already caught two hard
blockers: the cash-out's continue button sitting below the fold on a landscape
phone with nothing scrolling (a finished round could not be left), and the
title's action row overflowing a portrait phone (the game could not be started).

```bash
mkdir -p /tmp/god-driver && cd /tmp/god-driver && npm init -y && npm i puppeteer-core
npm run dev &        # from the repo
mkdir -p /tmp/god-shots
OUT=/tmp/god-shots node .claude/skills/verify/reachability-audit.mjs
```

It classifies findings so the report is actionable rather than noisy:

- **UNREACHABLE** — an interactive control outside the viewport with no
  scrollable ancestor. Always a bug.
- **CLIPPED** — content cut off with nothing scrolling. Only reported when the
  hidden content is interactive or text-bearing; oversized decorative layers
  under `overflow: hidden` (grain, vignette, scanlines) are doing their job.
- **needs-scroll** — below the fold but scrollable to. Fine, reported as a count.
- **TINY** — a target under 24px. 24px is the pointer floor, 44px for touch.

**Want: `HARD FAILURES: 0`.** Screenshots of any failing combination land in
`$OUT`. Add a size to `SIZES` or a surface to `open` when either grows.
