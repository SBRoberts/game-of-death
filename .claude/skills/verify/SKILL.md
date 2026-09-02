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
- HUD text: `.hud-stats .stat` (gen), `.stat.biomass`, `.stat.you`,
  `.stat.rival`, `.stat.storm`, `.overlay` (null while running), `.help .seed`.
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
