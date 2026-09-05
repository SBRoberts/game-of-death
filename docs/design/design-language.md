# The Game of Death — Design Language

> Synthesized from a 5-lens design panel (motion, cell-biology, art direction, systems/tokens, legibility). The animation system in src/web/spike/TurnSpike.tsx implements the core of this.

I have everything grounded in the real code. Here is the synthesized design language.

---

# THE GAME OF DEATH — Unified Design Language: "Living Culture on a Lab CRT"

Lead synthesis of the five lenses. Every claim below is anchored to the actual code: `step()` in `src/sim/engine.ts` (post-step `s.prev` = pre-tick board, `s.cells` = post-tick board — the exact diff endpoints), the reel `stepOnce` in `src/web/spike/TurnSpike.tsx:449-471`, the draw passes in `src/web/render.ts`, and the free-run loop in `src/web/App.tsx:673` (`SPEEDS = TUNING.speeds = [0,2,5,12,30]`).

**Ground-truth finding that reshapes the plan:** the engine does **not** emit per-cell event/cause data today. `combatDeaths` (engine.ts:154) is aggregate *and* misnamed — it increments on **every** in-safe death, natural or combat. So the render-side natural-vs-combat distinction has no authoritative source yet. The one required engine change (below) is real and load-bearing; everything attribution-related depends on it.

---

## 1. THEME

**The world (locked).** One specimen, two stacked optics. A living fluorescence culture — GFP-green YOU, mCherry-red RIVAL, faint DAPI-blue RADICALS on a near-black slide — observed through the phosphor of a vintage lab CRT (period-2 scanlines, faint aperture grille, dust, coverslip edge, round field, an etched reticle). The CRT is not decoration: **phosphor persistence is the diegetic license for the entire ~250ms animation layer** — a cell blooms or fades because excited phosphor decays, not because we blurred the slide. Cells behave like cells (mitosis, apoptosis, lysis, infection); the tube is why we get to see it happen in time instead of as a flicker.

**The four non-negotiable rules every surface obeys:**

1. **SURVIVORS HOLD, CHANGERS MOVE — and every generation ends on a crisp SETTLE frame.** Only born/died/converted cells animate; a survivor (`prev[i]===cells[i]>0`) never moves and never scales beyond ±5% breath. All *countable geometry* resolves by `0.65·D`; the last 35% of every transition is the true discrete state at full size, dead-still and countable. The countable disc is always `source-over` at integer cell coords with the 1px dark gutter (`r = CELL/2 − 0.5`, already in `drawPuncta`) **redrawn** — it never leaves its grid cell, never position-tweens, never exceeds the gutter (max scale 1.0). This single contract is what keeps the slide countable and defeats the "chlorinated pool" regression.

2. **Events change LUMINANCE and WHITENESS, never HUE. One transient colour only: HOT WHITE, ≤2 frames, that always cools into an *existing palette hue.*** The resolved colour *is* the attribution answer — birth cools to its **own** faction, a kill cools to the **aggressor's**, a flip cools to the **new owner's**, a merge warms to **emergent gold**. Additive `'lighter'` is for **transients only** (flashes, nuclei, rings, seam-gold); steady discs stay `source-over`. No surface may invent a colour; gold is reserved forever for green+red overlap = contested ground.

3. **The aggressor owns the strike, the ring, and the scorch; cause leads effect by ≥1 frame; both are read from the authoritative sim buffers, never a heuristic.** Every event is distinguishable by **motion + shape alone** (grow / shrink-inward-no-ring / pop+ring / directional-wipe+chevron), so the three colourblind schemes in `SCHEMES` only keep it pretty — they never carry meaning.

4. **The crisp planning layer draws LAST, unblurred, instant.** Foresight overlay, placement ghost, reach ring, graticule, momentum frame, HUD/chain text (render.ts:696-937) render after every flash and after the glass, in `source-over`, never additive-hazed, never tweened. Spectacle may never touch the promise layer, and reduced-motion degrades to instant truth with attribution preserved statically.

**Token set** — one source of truth (`src/web/tokens.ts`), emitting a JS `TOK` object for canvas + CSS vars at boot. Every event/ash/contested colour is a **pure function of the live faction triad**, so a `SCHEMES` swap (deuteranopia/tritanopia) recomputes them for free. `setPalette` in render.ts already has the `lift` helper — extend it, don't fork it.

```
COLOUR — faction triad (from SCHEMES[mode], RGB):
  you 66,245,155 (#42f59b GFP)   rival 255,83,64 (#ff5340 mCherry)   radical 127,150,255 (DAPI)
DERIVED (recomputed on scheme swap):
  flash-birth   = lift(faction,+90)         // birth nucleus ignition
  flash-lyse-ring = lift(aggressor,+40)      // combat kill ring — THE attribution colour
  flash-lyse-neutral = 255,240,214           // storm / no single aggressor
  flash-strike  = time-lerp #ffffff → hue    // any strike: white peak cooling to owner hue
  scar          = old-faction @ a 0.6→0      // retreating tenant on a convert
  contested-gold = 232,196,99 (#e8c463)      // EMERGENT additive overlap only; also ash/value
  senesce       = 12,16,26                    // natural-death fade target
  ash-natural   = faction @ 0.12 (COLORS.ash, exists) — own hue, 1 gen
  ash-combat    = aggressor @ 0.22, hollow dark core — held ~2 gens (the conqueror's stain)
  hot-white     = #ffffff  (the ONLY non-palette colour; ≤2 frames)
CHROME (95% neutral): bg #04060b · panel #0b0f16 · panel-hi #101724 · etch #070a11
  · glass rgba(6,9,14,0.86) · line #1b2331 · line-soft #121926
  · text #c3cfe0 · dim #8391a8 · label #5c6a80 · faint #45536b
SPECIALTY (rare "other fluorophores", read as nuclei): elder #eafcff · vampire #c46bff · martyr #ffd84a
STORM-AMBER #ff8a70 (entropy edge — deliberately ≠ rival red)

MOTION — chrome durations (ms): t1 90 · t2 130 · t3 200 · t4 260 · t5 320 · t6 420 · t7 600
  loops: t-loop 1600 · t-breathe 2600
  board clock: D = derived per generation (§3) — NEVER a raw t-value
EASINGS (shared bezier control points, CSS + JS):
  EASE-OUT    (0.16,1,0.3,1)   entrance/decel — birth alpha, wipe, ring, chrome-in
  EASE-SETTLE (0.2,1.2,0.4,1)  overshoot — bloom/nucleus pop ONLY (never a countable disc)
  EASE-IN     (0.5,0,0.9,0.3)  collapse — natural-death shrink
  EASE-SNAP   (0.3,0.85,0.35,1) convert commit, hit reactions
  EASE-LIN    linear — white→hue colour-temperature cooling
  EASE-BREATH easeInOutSine loop — survivor breath, warp haze

SPACE — sp: 2·4·6·8·12·16·22   radii: 4·6·8·10·12·pill(999)   strokes: hair 1 · mid 1.5 · focus 2
CELL-RELATIVE (CELL is runtime): r-disc = CELL/2−0.5 (countable, gutter-bound) ·
  r-core 0.34·CELL · r-nucleus 0.14·CELL · bloom-wide 0.9·CELL · bloom-hot 0.5·CELL · ring-max 1.6·CELL
```

---

## 2. THE FIVE LIFE-EVENT ANIMATIONS (exact canvas recipes)

**Shared clock.** A generation transition runs on normalized `p = tGen ∈ [0,1]` over duration `D` (§3). Each event owns a sub-window `[a,b]`; its local progress is `u = clamp((p − a − delay_i)/(b−a), 0, 1)`. `delay_i` is the spatial stagger (§3), capped so **geometry always finishes by `0.65·D`**. Additive overlays (rings, bloom) may run to `1.0`.

**Draw order (maps directly onto render.ts passes; crisp-last preserved):**
```
1 bg fill (COLORS.bg)                              [render.ts:613]
2 bloom buffer — seeded by interpolated alpha·scale [drawBloom, additive upscale]
3 multi-gen ash — natural(own hue) + combat(aggressor hollow) [replaces :619-624]
4 DYING cells (drawn UNDER the living, so growth overgrows corpses)
5 SURVIVORS  (source-over discs, gutter redrawn — the stable count frame)
6 BIRTHS     (source-over discs, gutter redrawn; overshoot lives in bloom/nucleus only)
7 CONVERT wipes (clip-rect B-over-A, source-over) + scar
8 TRANSIENTS, composite 'lighter': strike chords, nucleus ignitions, lyse rings, seam-gold
9 post-fx: grain, period-2 scanlines, aperture grille, vignette, coverslip/dust, round-field mask
10 CRISP OVERLAY, source-over, unblurred, INSTANT: foresight, ghost, reach, graticule,
   momentum frame, HUD/chain/banner text   [render.ts:696-937, unchanged in spirit]
```

### A. DIVIDE / BIRTH — "cytokinesis bud, in place"
- **Trigger:** `events[i]===BORN` (`prev[i]===0 && cells[i]>0`). `cause[i]` = parent faction (the dominant neighbour `d` at engine.ts:149).
- **Countable disc (slot 6, source-over):** radius `0.35·r-disc → r-disc`, alpha `0.4 → 1`, window `[0.20, 0.50]`, **EASE-OUT, NO overshoot, capped at 1.0** — bouncy discs collide and break counting. From frame 1 it counts as 1 (the 0.35 floor keeps it visible if a frame freezes mid-transition). Redraw the 1px gutter last so adjacent births never fuse. Colour = own faction throughout; **hue never changes on a birth.**
- **The pop lives in the additive layer only (slot 8, 'lighter'):** a nucleus dot `r-nucleus` in `flash-birth`, alpha `0→1→0` peaking at `u=0.4`, gone by `0.7`, riding **EASE-SETTLE** (overshoot ~1.06) — the visible "pop" that never touches the countable disc. The bloom seed for this cell scales with `alpha·scale` so the halo grows with it.
- **Mitosis direction (the signature, slot 8, 'lighter'):** a 1px cytoplasmic bridge, `mix(faction, white, 0.6)`, from the nearest same-faction parent centroid to this cell, alpha `0.7→0`, that **snaps at `u=0.8`**. This — not a moving disc — is what makes a growing colony read as *dividing tissue budding outward from where you played.* (Resolves motion-lens/biology "offset bud + dumbbell pinch" against legibility's in-place law: keep the directional *bridge*, drop the disc offset.)
- **LOD:** `CELL<8` → drop bridge + nucleus anim, keep scale+alpha only. **Reduced-motion:** disc at full alpha instantly.

### B. MERGE — emergent, not a primitive
- **No bespoke animation and no merge colour.** Two fronts meeting is just many attributed births filling a seam. Because slot-2 bloom is additive, a green front and a red front produce overlapping halos that **warm to `contested-gold` on their own** — that gold *is* confluence, and it means exactly what it means in the HUD (ash/value). Seam births inherit the nearer parent (via the bridge in A), so buds visibly point **inward** from both sides and the seam knits shut.
- **Friendly merge stays own-hue** — gold must **never** fire when your own front joins up, or "I linked up" misreads as "a fight." Only a genuinely contested seam (a cell whose 8-neighbourhood held **both** factions last gen) gets a 1px animated gold shimmer stroke (`contested-gold`, `lineDashOffset` drift, alpha `0.4→0`, ~t3) plus, along it, the normal convert/combat beats of C/D/E.

### C. DIE — NATURAL (apoptosis) — "quiet, so combat reads loud"
- **Trigger:** `events[i]===DIED_NATURAL` — the death branch where the survive-mask zeroed `out` (engine.ts:141-145), i.e. under/overpopulation. **Deliberately undramatic — the *absence* of a ring is the greyscale-safe differentiator from a kill.**
- **Recipe (slot 4, under the living, source-over):** radius `r-disc → 0.15·r-disc`, alpha `1 → 0`, window `[0.05, 0.45]`, **EASE-IN** (accelerating collapse = "starved"), shrinking toward its own centre with ~30% desaturation toward `senesce`. **No ring, no flash, no blebs** (dropped biology's apoptotic blebs — cost + clutter without payoff). Leaves the existing own-hue `ash-natural` remnant (extends render.ts:619-624), fading over the next gen.
- **Reduced-motion:** straight to ash.

### D. DIE — COMBAT (lysis) — "pop → burst, painted by the killer" · **THE signature beat**
- **Trigger:** `events[i]===DIED_COMBAT` — the casualty branch (engine.ts:138, enemy−friendly ≥ casualtyMargin) **and** martyr-blast victims (engine.ts:206-212). `cause[i]` = **aggressor faction** (the dominant enemy for a casualty; `cells[i]` of the martyr/vampire for specials).
- **Cause-before-effect, staged:**
  1. **Strike chord (slot 8, 'lighter'), `[0.00, 0.12]`:** a 1px line in the **aggressor's** hue darting from the aggressor's side into the cell — fires **≥1 frame before** the cell reacts.
  2. **Flinch + white flash:** disc pops to `1.25·r-disc` for one beat with a 1-frame `hot-white` core (the fluorophore rupturing), `[0.12, 0.15]`, EASE-SNAP.
  3. **Lysis (slot 4 disc + slot 8 ring):** disc collapses `1.25 → 0`, alpha `→0`, `[0.15, 0.45]`; simultaneously **one expanding ring** grows `0.4·CELL → ring-max(1.6·CELL)`, lineWidth `1.5→0.3`, alpha `0.8→0`, over `[0.15, 0.95]`, **EASE-OUT**, in **`flash-lyse-ring` = lift(aggressor,+40)**. Keep biology's swell→burst *shape*; **overrule** its "victim's-contents" ring colour — **the ring is the aggressor's**, always. A chain of ten kills paints ten green rings blooming outward from where YOU played = "I killed them all."
- **Remnant:** `ash-combat` (aggressor hue @0.22, hollow dark core), held ~2 gens — a battlefield glows where a starvation field goes dark, even on a frozen frame.
- **Budget:** ring skipped when `CELL<8` or ring-count this frame `>140` or `flourish<0.4` (disc scale+alpha still play — the death is never dropped). **Reduced-motion:** 1-frame white → instant `ash-combat`, no ring.

### E. ATTACK / CONVERT — "directional infection wipe" (never crossfade)
- **Trigger:** `events[i]===CONVERTED` — flank defection (engine.ts:135) or vampire drain (engine.ts:181). `cause[i]` = **new owner B** (the aggressor).
- **Recipe:** 1-frame `flash-strike` (white peak) over the cell, `[0.08, 0.15]`, 'lighter'. Then **B's fill sweeps across via a `clip`-rect wipe from the aggressor's side**, `[0.15, 0.45]`, EASE-OUT — replacing A. **Never a crossfade** (a muddy A/B blend hides who's winning and erases attribution). At the trailing edge the retreating `scar` (old-A @ 0.6→0) is briefly visible, so you read A→B, not just B. The cell **does not move or resize** — position and count preserved. Triple-redundant attribution: wipe **direction** points back to B's mass, fill is **B's** colour, and a 2-frame chevron glyph at the incoming edge points to the aggressor for CVD viewers. Special-cell nucleus recolours to B on settle.
- **Fast path** (converts many, or `CELL<6`): skip clip; crossfade... **no** — keep the hard rule: snap fill A→B at `u=0.5` with the white flash bridging the pop (a hard switch reads; a blend does not). **Reduced-motion:** instant swap + one spark.

---

## 3. MOTION RULES (legible & attributable at scale)

**The single generation clock — fold interpolation INTO the reel's existing gap; add zero latency.**
- **Resolve reel** (`TurnSpike stepOnce`, :449-471): today it `d.tick()`s then waits `52 + decel + freeze` ms. Convert that wait into the interpolation window: after `tick()`, drive a RAF loop advancing `tGen = (now − genStart)/D` where **`D = clamp(52 + decel + freeze, 110, 340)`ms** (the ritardando at :468 and hit-stop `freeze` at :456 *become* the ceremony budget). Steady churn ≈110-130ms/gen (quick, countable); the decelerating landing and chain hit-stops bloom to ≈250-320ms/gen (full anticipation → overshoot → settle) exactly where the eye has time and the drama earned it. At `tGen≥1`, commit and schedule the next `stepOnce`. Honours the brief's ~250ms as the hero/landing duration without dragging 16 gens to 4s+.
- **Free-run** (`App.tsx:673`, `gps = SPEEDS[speedRef.current]`): `D = clamp(tickInterval·0.72, 0, 340)`. When `gps ≥ ~8` (12× and 30×), **FLOW mode: `D = 0`** — crisp discrete state + additive bloom breathe + CRT persistence trails, **no per-cell tweens.** Full choreography is a ≤5-gps feature; fast-forward is for skipping and gets trails, not mitosis. This also protects 60fps — you never run thousands of tweens at 30×.

**Staging (cause before effect, overlapping tracks, one union-diff pass):**
```
strike chord     [0.00, 0.12]         convert wipe    [0.15, 0.45]
combat flinch    [0.12, 0.15]         birth disc      [0.20, 0.50]
natural collapse [0.05, 0.45]         birth pop/bridge[0.20, 0.70] (additive)
combat collapse  [0.15, 0.45]         lyse ring       [0.15, 0.95] (additive)
                         SETTLE — true discrete state — [0.65, 1.00]
```
Strike precedes kill precedes regrowth; the causal order *is* the attribution.

**Stagger by distance from YOUR action.** `delay_i = clamp(cheb(i, causalCentroid)·0.02, 0, 0.15)·D`, where `causalCentroid` = placement centroid on the player's step, else the kill centroid (`killSumX/killSumY / killN`, already in engine.ts:96-98). The cascade emanates as a wave from your move and spreads simultaneous changes across time so hundreds never flash at once. Cap keeps `geometry-end + delay ≤ 0.65·D` (the settle frame is inviolable). **Never random jitter** — all offsets are spatial or index-hashed, so it stays deterministic and replayable.

**Concurrency cap — decimate ceremony, never cells.** Every changed cell always reaches its exact final state. Rank changers by proximity to `causalCentroid`; when `changerCount > CAP (~110)`, over-budget/distant cells **snap to final instantly** (correct, un-animated) and `flourish = clamp(CAP/changerCount, 0.2, 1)` scales overshoot amplitude, ring radius, and stagger spread. Hard ceiling ~140 rings/frame. Attribution-relevant events (near your move) always animate.

**Zero per-frame allocation.** One union-diff pass per **commit** (not per frame) fills reused typed arrays keyed to `W*H`: `eventKind:Uint8Array`, `cause:Uint8Array`, `delay:Float32Array`, `seed:Float32Array`. The same interpolated `alpha·scale` seeds `drawBloom` (render.ts:346, already reuses `bloomCanvas`/`bloomImage`) so halos stay in sync.

**Reduced-motion** (`matchMedia('(prefers-reduced-motion: reduce)')`, already checked App.tsx:420/448/651): `D = 0` → today's instant discrete steps, **no** scale/ring/strobe/shake. Attribution survives statically — hold the `ash-combat` (aggressor-hued) / `ash-natural` (own-hue) stain for 1 gen plus a non-flashing faction-tinted outline on cells changed this gen. The reel still steps and may *slow* its cadence; it must **never strobe faster.** Foresight overlay unchanged.

---

## 4. BUILD ORDER

Build in this sequence; each step is independently verifiable and each unblocks the next.

1. **Engine: the one authoritative change** (`src/sim/types.ts` + `engine.ts`). Add `events: Uint8Array` and `cause: Uint8Array` to `SimState`, allocated once in `createState`/`cloneState` (zero per-frame garbage, stays pure/deterministic). Fill them in the existing branches of `step()`: BORN at :149 (`cause` = dominant `d`); DIED_NATURAL where the survive-mask zeroes `out` (:141-145); DIED_COMBAT in the casualty branch (:138, `cause` = dominant enemy) **and** the martyr pass (:206-212, `cause = cells[i]`); CONVERTED at :135 and the vampire pass (:181, `cause = cells[i]`). **This fixes the real gap** — `combatDeaths` (:154) currently counts natural deaths too. Keep `npm test` green (blinker/glider/eater) and re-audit the determinism hash (memory: expect `d8ba6440`).

2. **Transition precompute + render signature.** On each commit, run the single union-diff pass (`prev` vs `cells`) into the reused `eventKind/cause/delay/seed` buffers. Add a `tGen ∈ [0,1]` field to `FxState` (render.ts:174) so `render()` interpolates without new params churn.

3. **Generation clock.** Refactor `stepOnce` (TurnSpike:449-471) from a setTimeout hop to a RAF loop advancing `tGen` over `D = clamp(52+decel+freeze, 110, 340)`; commit at `tGen≥1`. Add FLOW mode + `D`-scaling to the App free-run loop (:673) and the reduced-motion `D=0` branch. No behaviour change yet — just the clock.

4. **Per-event art**, in draw-order slots 4-8 (§2), reading the buffers. Build **die-combat first** (see signature), then convert-wipe, birth, natural-death; merge falls out for free from birth + additive bloom.

5. **Theme polish.** Unify `src/web/tokens.ts` (collapse the triplicated palette: CSS `:root`, `COLORS`, `SCHEMES`; generate CSS vars from it at boot; derive every flash from the live triad via the existing `lift`). Add the synthesis chrome — period-2 scanlines + faint aperture grille + coverslip/dust + round-field mask into post-fx slot 9, over the crisp cells. Add survivor breath (EASE-BREATH) and CVD chevrons.

**THE ONE SIGNATURE DETAIL TO NAIL FIRST: the aggressor-hued strike → ring on a combat death (event D), cause exactly one frame before effect, sourced from the `cause` buffer.** Pick this one because it sits at the intersection of every lens and de-risks the two hardest things at once: it *forces the authoritative `cause` buffer into existence* (step 1, the linchpin the whole redesign depends on), and it makes the hard-constraint — attribution — literally visible. Prototype it on a single hardcoded kill: a 1px green chord darts in, one frame later the victim pops and dissolves under a green ring in `lift(you,+40)`, leaving a green hollow scorch. Tune the one-frame lead and the aggressor-colour rule until a chain of ten kills unmistakably reads as *"my green did all of this."* Get that beat right and the birth cytokinesis-bridge (event A, the close-second signature, highest-frequency, sells "living tissue") slots in against a proven clock. Nail these two and the slide stops being a grid that flickers and becomes a culture that fights.