<!--
DRAFT design blueprint, synthesized from a design conversation (2026-09).
North star set by the designer: "Game of Death is to Conway as Balatro is to Poker."
Locked decisions: pure-Conway round 1 that strays further each round; progression =
capped baseline + ascension; seeds = full-class characters; acquisition = between-round
shop (choose slots) + in-round radical chests (upgrade facets); board stays pure Conway,
wildness delivered as cell-type data tuples; "stray boldly, kept honest by fun + not-overpowered".
Status: proposal for review — numbers/names/rosters are starting points, not final.
-->

# THE GAME OF DEATH — v1 DESIGN BLUEPRINT

*"Game of Death is to Conway as Balatro is to Poker."* One board rule (B3/S23). One run that opens as pure Conway and ends gloriously warped. Everything below is reconciled from the four pillars into a single buildable spec; where pillars conflicted, the resolution is called out inline.

---

## 1. VISION

**Pitch.** The Game of Death is a roguelike deckbuilder played *on Conway's Game of Life*. You and a rival seed colonies onto a shared board that steps by the real B3/S23 rule. You don't move pieces — you spend harvested matter to place living patterns, flank the neutral "radicals" in the contested midfield to convert them, and survive a closing storm that scores territory. Between rounds you shop; within rounds you crack chests. Each purchase is a *data tuple* that bends the rule one notch further from Conway. The whole game is the arc from a clean glass slide to a saturating, fluorescing, reality-bending microscope image — and then it wipes and you do it again, honestly, from B3/S23.

**The pure→warped promise.** Round 1 of *every* run, at *every* progression tier, opens at **warp 0**: the board is literally, provably LIFE, and every placed cell is type 0. This is the Balatro on-ramp — you always relearn the honest base. From there, warp is a *computed scalar* (distance from B3/S23), it only ever climbs *within* a run, and it *always resets* at run end. The meta never leaks power into gen 0; it only widens *what can appear*. Straying is the reward, purity is the promise, and the reset is the law.

---

## 2. THE RUN (concrete play-by-play)

A run is a **3-round gauntlet** vs. an escalating rival. One round ≈ 808 generations (ringGrace 400 + shrink schedule). Currencies: **BIOMASS** (in-round placement fuel), **PLASM** (run-scoped harvest currency for shop + chests), **ASH** (permanent meta).

**Pre-run.** Pick a character (say **The Scavenger**, free). Its seed (`seedling`), its one passive (`incomeScale 0.045`), its pool bias (economy/capture), and its signature card (SKIMMER glider, `clearance:0`) fold into the standard `Duel` constructor. Warp cap for R1 is **0**, so the Scavenger's board is pure B3/S23. Slots: 2 RULE / 2 UNIT / 1 PASSIVE, all empty.

**Round 1 — Pure Conway.** The board steps as honest LIFE. You place gliders and blocks from BIOMASS, aiming for the 36 radical clusters (~155 cells) in the midfield (x ∈ [0.34w, 0.66w]). Every radical you flank and convert (via existing flank-defection) mints **PLASM**, not biomass — a conversion ledger, transforming matter that already existed. Harvest is front-loaded: the storm eats the midfield after ~gen 400, so you fight for the center early. You bank ~30 PLASM and fill the **chest meter** (chestEvery 10) ~3 times. Each chest, surfaced at a pause as pick-1-of-3 filtered to what you've slotted, offers a one-axis facet — but with nothing warped slotted yet, R1 chests are commons (radius +2, incomeScale +0.008). You outpopulate the rival, storm scores territory, **round won**.

**CashOut → Shop (visit 1 of 2).** 5 cards drawn from `rngFrom(seed,'shop:1')`, weighted {common 55, uncommon 30, rare 12, epic 3, legendary 0}. You have ~30 PLASM. You buy **Vampire I** (RARE, 22 PLASM: `{drain, drainEvery:3, surviveMask 1..6}`) into a UNIT slot and **Hardy I** (COMMON, 6: survive|={8}) into a RULE slot. Warp is now 4+1 = 5, but the R2 cap is **4**... so `build()` holds the higher-warp entry dormant until the cap admits it — you reslot to stay legal, or accept one is inactive until R3. (See §7.)

**Round 2 — First bend.** Cap 4. Your Vampire is live: every 3rd gen it converts an adjacent enemy. The faction rule is now S238 (Hardy active). The board *leans* — a faint autofluorescence haze appears, the WARP METER creeps off pure-green, the ambient hum detunes a partial. You feed the vampire against the rival's living front, harvest another ~35 PLASM, and a chest offers **Swift Fangs** (`drainEvery 3→2`). You take it — warp +1, monotonic climb. **Round won.**

**Shop (visit 2).** Weights shift {common 30, uncommon 30, rare 25, epic 12, legendary 3}. R3 cap will be **10**. You splurge on **Laser** (LEGENDARY, 60 PLASM: `{propel:[1,0], nose:[1,0], noseReach:3}` — a self-propelled eater-nose ship) and reroll once (4 PLASM) to find **Martyr** (UNCOMMON).

**Round 3 — Climax.** Cap 10; epics and legendaries activate. The Laser streaks a cold UV lane across the board destroying 3 enemy cells per tick then advancing; the vampire feeds every 2 gens; martyrs mine the chokepoints. The board glows — white-hot legendary cores, chromatic fringing, the warp meter full and lit through every fluorophore channel, resonance stingers on each laser cut. The storm closes, drone rising a semitone. You hold territory. **Run cleared.** ASH is paid out. `runFacets`, PLASM, and the whole drafted loadout are **wiped**. Next run opens, once again, at warp 0.

---

## 3. THE GRADIENT & RARITY

**Rarity is a computed scalar, not a vibe.** Define a pure function `warp(entry)` folded over the existing data tuple:

- each birth/survive digit added or removed vs B3/S23 = **+1**
- reach (radius) and economy (incomeScale) changes = **+0** (geometry/economy is not a rule bend — keeps Ranger/Scavenger legible)
- cell-type flags: `steadfast` +1, `unconvertible` +1, `surviveMask` override = digit-delta from S23, `drain` +2, `onDeathKill` +2, `blastRadius>1` +1/extra ring, and the three legendary flags **+3 each**.

`warp()` is bisectable, sweep-testable in the existing `genebalance` harness, and byte-identical on every machine. **The five tiers are warp bands:**

| Tier | Warp | Meaning | Example content |
|---|---|---|---|
| **COMMON** | 1 | one rule digit or reach step; still a named Life-like rule | **Hardy I** (S23→S238), **HighLife I** (B3→B36), **Ranger** (radius 12, warp 0) |
| **UNCOMMON** | 2 | two digits or one mild flag | **Stubborn Cell** (`steadfast`), **Deep Reserves** (incomeScale +0.008) |
| **RARE** | 3–4 | first real bend: timed conversion or death-trigger | **Martyr I** (`onDeathKill`), **Vampire I** (`drain, drainEvery:3`) |
| **EPIC** | 5–6 | stacked/accelerated bend | **Vampire II** (`drainEvery:2`), **Volatile Martyr** (`blastRadius:2, chainBlast`) |
| **LEGENDARY** | 7+ | reality-bender via a NEW tuple field | **Laser** (propel/nose eater-ship, w8), **Cascade Strain** (`onDrainInherit`, w8), **Rogue Replicator** (`birthMask` B1357/S1357, w9) |

**Three new legendary flags (Conway-honest, read by generic passes):**
1. **`propel:[dx,dy]` + `nose:[dx,dy]` + `noseReach:n`** — a self-propelled eater. A generic "traveler pass" destroys up to `noseReach` enemy cells at successive nose offsets, then translates the cell one step. *This is the unified "laser" — it supersedes the separately-named `eaterNose`/`noseKill` from the roster/economy pillars; one implementation.* Storm-suppressed by the existing `inSafe` guard.
2. **`onDrainInherit:boolean`** — in the vampire pass, a converted enemy inherits the drain type instead of becoming type 0 → a deterministic conversion chain feeding `chain.ts` toward MASSACRE+.
3. **`birthMask:number`** — a cell-type carries its own private birth mask (`surviveMask` already exists); `step()` reads `t.birthMask ?? faction.birth`, one extra `??` per branch → a pocket of alternate physics.

All three **transform or destroy, never mint**. Laws hold.

**The gradient is enforced by data, not hope.** Per-round **WARP CAP** `[0, 4, 10]` added to `RoundDef`. The cap = max summed warp of your *active* slots; `build()` holds over-cap tuples dormant, so R1 folds to exactly LIFE. Straying accelerates via three seeded dials: the cap rising 0→4→10, shop rarity odds shifting by round (§5), and in-round chests bumping one facet indefinitely (§5). Warp climbs monotonically within a run, then fully resets.

**Fluorescence signal.** Warp drives the microscope, derived deterministically: per-cell bloom/saturation scale with that type's warp; legendaries clip a white-hot core and light a novel emission channel (laser = cold UV/cyan streak, chain-proc = pulsing far-red, strain = 570nm orange). Board-global warp raises an autofluorescence haze + chromatic fringing; a diegetic **WARP METER** (spectral bar) fills green→through-the-fluorophores. Audio: pure round = clean incubator hum; each warp tier detunes a partial; the bed pitch-bends up a semitone per round.

---

## 4. CHARACTERS

Each character is a bundle of (seed + one-axis passive + seeded pool bias + one signature), folded into the existing `Duel` constructor with no new sim paths. **Sidegrades, not a ladder** — every one still opens R1 on a pure B3/S23 board (their bends only activate as the warp cap rises). Two free starters bend nothing on their own faction rule; the four unlocks each stray along exactly one axis.

| # | Name | Identity (one line) | Access | Diff |
|---|---|---|---|---|
| 1 | **The Vector** | Rush/aggro — tiny `seedling`, baked reach (radius 14), pure-Conway two-glider SALVO; paper-thin defensively. | **FREE** | 2 |
| 2 | **The Scavenger** | Capture/economy — `seedling`, `incomeScale 0.045` rate bump, SKIMMER glider (`clearance:0`) threads debris; weak in a direct brawl. | **FREE** | 1 |
| 3 | **The Bulwark** | Turtle/permanence — `pulsar` seed, `addSurvive:[8]`, KEYSTONE Elder anchor; no reach or burst, can't close. | ash 60 | 2 |
| 4 | **The Detonator** | Bomb/minefield — `soup` seed, cheap Martyr pool, MINEFIELD `MARTYR_GREAT` (blastRadius 2); sloppy placement self-immolates. | ash 70 | 3 |
| 5 | **The Hemophage** | Vampire/drain — `pentadecathlon` seed, `convertsSteadfast` faction flag, SWIFT Vampire; fragile, dies against a turtle with no living front. | ash 90 | 3 |
| 6 | **The Cataclyst** | Chaos/methuselah — `acorn` seed, `addBirth:[6]` (B36), PRISM directed ship (the laser), boosted legendary odds; least controllable, cannibalizes itself. | ash 150 | 5 |
| 7 | **Gosper** | *(breadth long-tail)* glider-gun mastery character. | ash 200 **+ clear A3** | — |

**Reveal cadence:** only the two free starters are visible at first; unlocks reveal as they're purchased (breadth-unlock). `poolBias` MUST draw from a seeded `rngFrom(seed,'shop')` stream, never `Math.random`.

---

## 5. ECONOMY

**Three currencies, strictly separated, never cross-converted:**
- **BIOMASS** — the *only* thing spent during a duel (income = `incomeBase + incomeScale·√pop`). Labeled "placement fuel."
- **PLASM** — run-scoped harvest currency, banked across the 3 rounds, wiped at run end. Buys shop items and drives chests only; never becomes biomass (that would mint matter). Labeled "harvest."
- **ASH** — permanent meta breadth. Labeled "research."

**Earning PLASM.** Reuse `Duel.trackChain()`'s existing radical-conversion counter verbatim. Two tuning constants: `plasmPerRadical:1`, `chestEvery:10`. Each gen: `plasm += radCapDelta; chestMeter += radCapDelta`; every 10 accumulated pushes a chest onto `chestQueue`. Both are deterministic gen-indexed tallies — no RNG on the earn side. Expected ~30 PLASM/round, ~3 chests/round, ~9–12 chests/run. A turtle who ignores the midfield earns almost nothing — deliberate pressure toward the contested center.

**The between-round SHOP** (opens at CashOut after R1 and R2 — two visits; R3 win goes to run-end). Slots reuse the genome loadout, split into three typed lanes for legibility:
- **RULE** slots (B/S digits, reach, income): base **2**
- **UNIT** slots (cell-type cards): base **2**
- **PASSIVE** slots (luck/income-rate/bomb dials): base **1**

**Slot reconciliation** (economy pillar said cap 5; progression said ash-cap 4 + A9 for the 5th — resolved here): **ash buys up to 4 slots** (`SLOT_COSTS [20,55,110,190]`); the **5th slot is gated behind Ascension A9**. A character/seed may *re-partition* its 4–5 slots toward its identity lane (+1 there, −1 elsewhere) but never exceed the cap by raw power. Every run opens at its partition with a pure board.

Per visit: draw 5 cards from `rngFrom(seed,'shop:${round}')`, weighted by rarity. **Buy** (pay PLASM, drop into open compatible slot) / **Swap** (over occupied) / **Sell** (half back, but selling a UNIT forfeits its invested chest facets — real opportunity cost). Reslotting owned items between compatible slots is **free**. **Reroll** = `4 + rerollUses·3` PLASM, reset each visit (perk grants free rerolls). **Skip** banks PLASM.

Round-indexed rarity weights enforce the north star:
- after R1: {common 55, uncommon 30, rare 12, epic 3, **legendary 0**}
- after R2: {common 30, uncommon 30, rare 25, epic 12, legendary 3}

Prices in PLASM: common **6**, uncommon **12**, rare **22**, epic **36**, legendary **60** (tuned so ~30 PLASM/round buys ~1 rare or 2–3 commons).

**In-round CHESTS** (cost nothing — the meter payoff). Each queued chest surfaces at the next PAUSE as pick-1-of-3 (respects the time-throttle; never interrupts a tick). Options draw from `rngFrom(seed,'chest:${chestIndex}')`, **filtered to facets of currently-slotted things** (always usable). Each is a one-axis delta applied to a per-run `runFacets` overlay — NOT to module constants — fed into an extended `build()`. Facets stack indefinitely within a run subject to Conway-sanity clamps, and reset next run:

| Facet | Delta | Clamp |
|---|---|---|
| Swift Fangs | `drainEvery −1` | floor 1 |
| Thick Wall | `surviveMask |=` next of [0,7,8,6] | 9 digits |
| Fat Payload | `blastRadius +1` | cap 4 footprint |
| Long Reach | `radius +2` | — |
| Rich Culture | `incomeScale +0.008` | — |
| Detonator | `bombEveryK −1` | floor 2 |
| Focused Optics | `noseReach +1` | — |

Chest *contents* key off `chestIndex` (deterministic counter), not wall-clock or pause count, so *when* you open never changes *what's inside*; the pick is a recorded action like `playCard`. Application order is a stable target-key sort → byte-identical replay.

**Wiring:** `plasm`/`chestMeter`/`chestQueue`/`runFacets` live on `Duel` (deterministic sim); shop draw/reroll/buy/sell live in the web/CashOut layer keyed by seed; `tuning` gains the constants + price tables.

---

## 6. PROGRESSION

**Core reframe:** today `meta.ts` sells permanent GENES equipped at run start — that *is* start-of-run rule creep and is **removed**. Those genes migrate to the in-run shop (§5); `loadoutOf(meta)` returns `[]` at run start (a test asserts R1 player rule == LIFE). The permanent ash layer sells only three things:

**(A) Capped baseline — 4 perks, none touch a mask or mint matter. Total = 975 ash, maxed in ~6–10 runs.**
| Perk | Axis | Levels / cost | Cap |
|---|---|---|---|
| **Shop Slots** | build capacity | `SLOT_COSTS [20,55,110,190]` | 4 (5th via A9) |
| **Chest Options** | selection width (1→2→3 shown) | [45,120] | +2 |
| **Reroll** | free shop rerolls/visit | [40,100] | +2 |
| **Income Rate** | `incomeScale +0.004/lvl` (rate, not grant) | [35,90,170] | +3 (0.03→0.042) |

At ~run 8 cumulative ash ≈ 1000 → a **"Baseline complete"** state shows. Ash now has *nothing left that raises baseline competence*. That is the plateau guarantee.

**(B) Ascension — 15 cumulative DELTA tuples summed into the `Duel` `overrides`; ZERO sim change.** Deltas only touch planner (`aiSamples`,`aiHorizon`), storm (`ringGrace`,`ringShrinkEvery`,`ringMinHalf`), rival seed/loadout for rounds 2–3, player economy, and clawed-back comforts. **No delta ever adds a rule gene to the player's round 1** — R1 stays pure at every tier. A1 unlocks on first `runClear`; each tier unlocks by clearing at the current tier. Each clear pays a one-time ash bounty (+50→+200). Key gates:
- **A3** → Gosper character purchasable · **A5** → EPIC draft pool · **A9** → 5th shop slot · **A10** → LEGENDARY draft pool · **A15** → "true clear" title.
- Mid-tiers *re-tighten the perks*: A6 startBiomass 24→18, A9/A14 radicals 36→28→20 (starves harvest), A12 incomeScale −0.006, A15 ringGrace→180. A maxed baseline feels earned again, never dominant.

**(C) Breadth — the real long tail, all ash-priced.** Characters (§4) and a `MetaState.unlocked[]` catalog: commons start unlocked; higher rarities cost ash AND need an ascension gate (epics→A5, legendaries→A10). Widens *what the in-run shop can offer* — never round-1 power.

**meta.ts mapping (minimal):** ADD `perks:{}`, `ascension:0`, `ascMax:0`, `unlocked:[]`; REPURPOSE `equipped` to per-run draft state (so `loadoutOf` = [] at run start); ADD `buyPerk`/`perkEffects`, `selectAscension`/`recordAscensionClear`/`ascOverrides`, `buyUnlock`/`isUnlocked`; v3→v4 migration defaults. `App.tsx` folds `ascOverrides(ascension) + perkEffects(m).incomeScaleBonus` into overrides at duel construction.

**Run 1→100 arc:** Runs 1–2 pure onramp (~40–70 ash/run). Runs 3–6 baseline ramp — slots, chests, income smooth out; first full clears. Runs 6–10 baseline CAP → "Baseline complete." Runs 10–30 **breadth era** — buy characters + catalog, climb A1–A6 for bounties and epic-pool/5th-slot gates. Runs 30–100 **mastery era** — A7–A15 with economy/storm re-tightened, full legendary pool, all characters; replay value = character × ascension × the build you draft that run.

---

## 7. HOW IT STAYS HONEST

The board is always literal Conway: the seven laws hold because every warped thing is a *data tuple read by a generic engine pass* (the traveler, drain, martyr, birth passes) — no bespoke per-item logic, no second language, and type-0 cells are untouched so the blinker/glider/eater tests stay green. **Transform-not-mint:** PLASM is a conversion ledger of matter already on the board, income is a √pop *rate* (never a flat grant), laser *destroys*, chain-proc *converts*, strain *births only from real live neighbors*. **One-axis:** every entry moves exactly one number. **Determinism:** every draw (shop, chest, pool bias, rival) comes from a named seeded `rngFrom` stream, all earn-side tallies are gen-indexed counters, application order is a stable sort, and the traveler pass uses a fixed board-scan order under the existing `inSafe` storm guard — so identical (seed, action-sequence) replays byte-identically (audited by the harness). **The board stays pure Conway** because warp is derived not authored, the per-round WARP CAP `[0,4,10]` holds over-cap tuples dormant in `build()`, the meta layer sells only breadth + non-rule perks (`loadoutOf` = [] at run start, guarded by a test), and the drafted loadout + all facets are wiped every run. Round 1 is *proven* LIFE, every run, forever — with a clock.

---

## 8. WHAT WE REUSE vs BUILD

**Reuse verbatim:** `step()` engine + drain/martyr passes as the pattern to mirror; `GENES`, `CELL_TYPES`, `SEEDS`, `PATTERNS`, `build()`/loadout fold, `poolFor()`; `Duel` constructor + `trackChain()` radical counter + `chain.ts`; `rngFrom` seeded streams; `render.ts` fluorophore palette; `audio.ts` bed; `meta.ts` ash/slots/seeds plumbing; the `genebalance` harness (already accepts arbitrary loadouts — extend to accept a `runFacets` overlay for stacked-facet sweeps).

**Surgical sim changes (the entire honest cost):**
1. `warp(entry)` pure function over existing tuples.
2. **Three legendary tuple fields** on `CellTypeDef`: `propel`+`nose`+`noseReach` (one new generic "traveler pass"), `onDrainInherit` (one line in the vampire pass), `birthMask` (one `??` in `step()`). *This unifies the laser — the pillars' `eaterNose`/`noseKill` are the same feature under this one implementation.*
3. Small flags: `chainBlast` (martyr→martyr), `convertsSteadfast` (Hemophage faction flag), `incomeScale` as a passive-tuple rate field. `blastRadius` if not already present.
4. `runFacets` overlay + WARP CAP applied inside the extended `build()`.
5. On `Duel`: `plasm`, `chestMeter`, `chestQueue`, `runFacets` (deterministic).
6. `tuning`: `plasmPerRadical`, `chestEvery`, price/weight tables; `rounds.ts`: `warpCap:[0,4,10]`.

**Web work:** CashOut shop UI (draw/buy/sell/swap/reroll/skip, seed-keyed); pause-time chest pick-1-of-3; the diegetic WARP METER; the meta screen surfacing perks/ascension/breadth + `nextUnlockGap` + "Baseline complete"; folding `ascOverrides`+`perkEffects` into overrides. `chain.ts` and (baseline) `rounds.ts` structure untouched.

Everything is a bisectable balance-sweep knob; nothing requires a second language.

---

## 9. LEAN v1

**The one thing v1 must prove: the Balatro→Conway loop is fun** — pure R1 → harvest → shop → warp → glowier R3, wiped and repeated with a reason to come back.

**Ship in v1:**
- Warp function + WARP CAP `[0,4,10]` enforcing pure R1.
- **3-round gauntlet**, 1 rival, 2 shop visits + chests.
- **2 free characters** (Vector, Scavenger) — no unlock gate needed to prove the loop.
- Catalog through **EPIC only, using existing cell types** (Hardy, HighLife, Ranger, Stubborn, Martyr, Vampire I/II, plus their chest facets). *No new sim flags required for the core loop.*
- PLASM + shop (typed 2/2/1 slots, buy/sell/reroll/skip) + in-round chests + `runFacets`.
- **Capped baseline perks (all 4)** + ash economy + "Baseline complete."
- Fluorescence: per-cell warp bloom + the board-global WARP METER (defer novel legendary emission channels).

**Defer to v1.1+:**
- The **three legendary flags** and their content (Laser/propel-nose, Cascade/onDrainInherit, Rogue Replicator/birthMask) — ship the laser as the first fast-follow legendary once the economy is proven with existing types.
- Characters 3–7 (Bulwark, Detonator, Hemophage, Cataclyst, Gosper) + `convertsSteadfast`.
- **Ascension** (ship A1–A6 first; the cadence works at any tier count) and the full LEGENDARY/EPIC ascension gates.
- Legendary/novel audio stingers and emission channels.

This slice needs **zero to one** new sim flags, exercises every currency and the full pure→warped arc, and de-risks the fun question before we spend on breadth.

---

## 10. OPEN QUESTIONS (each with a recommendation)

1. **Over-cap purchases in the shop — block or allow-dormant?** When you buy a warp-5 item under a warp-4 round cap, does the shop refuse it or let you own it dormant until R3?
 *Recommendation:* **Allow-dormant** (matches `build()` holding tuples inactive). It lets players pre-invest for R3 and preserves the "you strayed but the board hasn't caught up yet" tension. Show a dimmed "activates R3" tag.

2. **Rival warp — does the rival also climb the gradient, and on what schedule?** The pillars specify rival rule-genes only in rounds 2–3 but don't fix the rival's warp curve.
 *Recommendation:* Rival warp = a fixed fraction (~0.7×) of the round cap, drawn from a seeded rival loadout, so the rival visibly warps alongside you but slightly behind — you feel your own escalation as an edge. Tune via the harness to ~50% mirrored win-rate per band.

3. **PLASM carryover vs. spend-it-or-lose-it between visits.** Banking rewards skipping; but unlimited banking could trivialize the R2 visit.
 *Recommendation:* **Full carryover within a run** (it's wiped at run end anyway), which makes skip a real strategic lever. If R3 shopping feels too strong, add a small "spoilage" (−20% unbanked) rather than a hard cap.

4. **Chest timing UX — auto-pause on chest ready, or queue silently until the player pauses?** Auto-pause guarantees you see it; silent queue respects flow.
 *Recommendation:* **Silent queue with a pulsing meter indicator**; contents are `chestIndex`-keyed so timing never changes rewards. Add an optional "auto-pause on chest" toggle for new players.

5. **Sell-forfeits-facets — too punishing?** Selling a chest-invested UNIT loses all its facets, which may feel bad.
 *Recommendation:* **Keep it** as the opportunity cost that makes chest investment meaningful, but surface a clear confirm ("Sell Vampire — forfeits 3 facets?"). Revisit only if playtests show players never sell.

6. **Do the two free starters risk feeling identical since both are pure-board?** Vector (reach) and Scavenger (income) both step B3/S23.
 *Recommendation:* Lean hard on **opposite pool biases + signature cards** (SALVO aggro lanes vs. SKIMMER capture threading) and opposite seeds' pressure. If they still blur in playtest, give Vector a slightly smaller seed or Scavenger a distinct chest-facet bias to sharpen the identity split.


---

## 11. RESOLVED DECISIONS (designer sign-off, 2026-09)

1. **Over-cap shop buys** — allowed, held DORMANT until the round cap admits them; shown with an "activates R{n}" tag.
2. **Rival warp** — rival climbs the gradient at ~0.7x the round cap. Difficulty is PLAYER-CHOSEN before a run via a **Biosafety Level (BSL-1..4)** selector that scales rival warp fraction + planner + storm + economy and pays a proportional **ash multiplier**; the next BSL unlocks by clearing the current. This REPLACES silent auto-scaled ascension (agency + risk/reward, Balatro-stakes style). Baseline perks still plateau; BSL is the mastery/reward axis.
3. **PLASM** — full carryover within a run; spoilage only added later if R3 shopping is too strong.
4. **Chests** — silent queue; contents keyed by chestIndex (timing never changes rewards). HUD shows a **queued-chest count indicator**; clear feedback on open. Optional auto-pause-on-chest toggle for new players.
5. **Sell** — refunds half the BASE price; invested chest FACETS are forfeited (higher investment = larger sacrifice = the risk). Sell value does NOT scale with facet investment. One-number tunable if too harsh.
6. **Free starters** — The Vector (reach-rush) and The Scavenger (income-capture), sharpened by opposite pool biases + signature cards.
