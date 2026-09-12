/**
 * The automaton itself. step() is pure state → state with zero randomness:
 * classic B/S rules per faction, plus faction interactions —
 *   Recruitment: a birth joins the strictly dominant neighboring faction.
 *   Flanking:    a live cell outnumbered by ≥ flankingMargin defects.
 *   Casualty:    outnumbered below that margin, it dies instead.
 * — and per-cell type overrides (Elder/Vampire/Martyr, see celltypes.ts).
 * Ties resolve to "nothing happens" so no faction gets a hidden edge.
 *
 * Every step also writes per-cell EVENT and CAUSE buffers. They are the single
 * authoritative answer to "what happened here, and who did it" — a starvation
 * and a lysis look identical in a prev/cells diff, so attribution (the Chain,
 * the settle report, the aggressor-hued kill rings) must read these, never the
 * diff. Filled in the same branches that decide each cell's fate: no second pass.
 */

/** Per-cell events written by step() into `s.events`. */
export const EV_NONE = 0
export const EV_BORN = 1
export const EV_DIED_NATURAL = 2 // starved or smothered with no enemy in contact — its own churn
export const EV_DIED_COMBAT = 3 // died in contact with an enemy: lysis, a martyr blast, or
// crowding — an overpopulation death is that enemy's doing when its cells are the ones crowding.
export const EV_CONVERTED = 4 // defected to an enemy: flanking, or a vampire's drain
export const EV_BLEACHED = 5 // eaten by the closing field — nobody's doing but the clock

import { CELL_TYPES } from './celltypes'
import type { SimConfig, SimState } from './types'

const NEIGHBORS: ReadonlyArray<readonly [number, number]> = [
  [-1, -1], [0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0],
]

export function createState(cfg: SimConfig): SimState {
  const n = cfg.width * cfg.height
  const nf = cfg.factions.length
  return {
    cfg,
    gen: 0,
    cells: new Uint8Array(n),
    prev: new Uint8Array(n),
    types: new Uint8Array(n),
    prevTypes: new Uint8Array(n),
    events: new Uint8Array(n),
    cause: new Uint8Array(n),
    pops: cfg.factions.map(() => 0),
    ringInset: 0,
    deaths: new Int32Array(nf),
    combatDeaths: new Int32Array(nf),
    naturalDeaths: new Int32Array(nf),
    converts: new Int32Array(nf * nf),
    killN: 0,
    killSumX: 0,
    killSumY: 0,
    blasts: [],
  }
}

export function cloneState(s: SimState): SimState {
  return {
    cfg: s.cfg,
    gen: s.gen,
    cells: s.cells.slice(),
    prev: s.prev.slice(),
    types: s.types.slice(),
    prevTypes: s.prevTypes.slice(),
    events: s.events.slice(),
    cause: s.cause.slice(),
    pops: s.pops.slice(),
    ringInset: s.ringInset,
    deaths: s.deaths.slice(),
    combatDeaths: s.combatDeaths.slice(),
    naturalDeaths: s.naturalDeaths.slice(),
    converts: s.converts.slice(),
    killN: s.killN,
    killSumX: s.killSumX,
    killSumY: s.killSumY,
    blasts: [...s.blasts],
  }
}

export function setCells(
  s: SimState,
  faction: number,
  coords: ReadonlyArray<readonly [number, number]>,
  cellType = 0,
): void {
  const { width, height } = s.cfg
  for (const [x, y] of coords) {
    if (x < 0 || x >= width || y < 0 || y >= height) continue
    const i = y * width + x
    const old = s.cells[i]
    if (old > 0) s.pops[old]--
    s.cells[i] = faction
    s.types[i] = faction > 0 ? cellType : 0
    if (faction > 0) s.pops[faction]++
  }
}

export function step(s: SimState): void {
  const { width: w, height: h, factions, flankingMargin, casualtyMargin } = s.cfg
  const cells = s.cells
  const types = s.types
  const next = s.prev // reuse the old buffers; after the swap they hold gen-1
  const nextTypes = s.prevTypes
  const nf = factions.length
  const counts = new Int32Array(nf)
  const inset = s.ringInset
  const x0 = inset
  const x1 = w - inset
  const y0 = inset
  const y1 = h - inset
  const inSafe = (x: number, y: number): boolean => x >= x0 && x < x1 && y >= y0 && y < y1
  const deaths = s.deaths
  const combatDeaths = s.combatDeaths
  const naturalDeaths = s.naturalDeaths
  const converts = s.converts
  const events = s.events
  const cause = s.cause
  events.fill(EV_NONE)
  cause.fill(0)
  s.blasts.length = 0
  s.killN = 0
  s.killSumX = 0
  s.killSumY = 0

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x
      if (!inSafe(x, y)) {
        if (cells[i] > 0) {
          deaths[cells[i]]++
          events[i] = EV_BLEACHED // the clock's doing — never anyone's cascade
        }
        next[i] = 0 // the bleach suppresses every ability, even the Elder's
        nextTypes[i] = 0
        continue
      }

      counts.fill(0)
      let total = 0
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy
        if (yy < 0 || yy >= h) continue
        const base = yy * w
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue
          const xx = x + dx
          if (xx < 0 || xx >= w) continue
          const f = cells[base + xx]
          if (f > 0) {
            counts[f]++
            total++
          }
        }
      }

      const cur = cells[i]
      let out = 0
      let outType = 0
      let lysedBy = 0 // the aggressor, when this cell dies contested
      if (cur > 0) {
        const t = CELL_TYPES[types[i]]
        const friendly = counts[cur]
        const enemy = total - friendly
        if (!t.steadfast && enemy - friendly >= flankingMargin) {
          out = dominant(counts, nf, cur) || cur // defect to the dominant enemy
          outType = out === cur ? types[i] : 0
        } else if (!t.steadfast && enemy - friendly >= casualtyMargin) {
          out = 0 // contested and outnumbered: a casualty, not a convert
          lysedBy = dominant(counts, nf, cur)
        } else {
          const surviveMask = t.surviveMask ?? factions[cur].rule.survive
          if ((surviveMask >> total) & 1) {
            out = cur
            outType = types[i]
          } else if (enemy > 0) {
            // It died to the rule — starved or smothered — but an enemy was in
            // contact, so the enemy's cells are part of the neighbourhood that
            // killed it. THIS is how a Life attack actually works: you don't
            // stab a cell, you crowd it. Crediting it is what lets a glider
            // dropped into a fort read as a cascade instead of as ambient churn,
            // while a cell starving alone in its own soup still credits nobody.
            lysedBy = dominant(counts, nf, cur)
          }
        }
      } else if (total > 0) {
        const d = dominant(counts, nf, 0)
        if (d > 0 && (factions[d].rule.birth >> total) & 1) out = d // born normal
      }
      if (cur > 0) {
        if (out === 0) {
          deaths[cur]++
          if (lysedBy > 0) {
            // Lysed by an enemy front. ONLY this counts as combat — a cell that
            // simply starved or smothered is the culture's own churn, and
            // crediting it to a player would make every soup look like a cascade.
            combatDeaths[cur]++
            events[i] = EV_DIED_COMBAT
            cause[i] = lysedBy
            s.killN++
            s.killSumX += x
            s.killSumY += y
          } else {
            naturalDeaths[cur]++
            events[i] = EV_DIED_NATURAL
          }
        } else if (out !== cur) {
          converts[cur * nf + out]++
          events[i] = EV_CONVERTED
          cause[i] = out
        }
      } else if (out > 0) {
        events[i] = EV_BORN
        cause[i] = out
      }
      next[i] = out
      nextTypes[i] = outType
    }
  }

  // Vampire pass: each surviving vampire converts one adjacent enemy in the
  // next state. Neighbor scan order rotates with the generation so the feeding
  // direction varies — deterministically.
  for (let i = 0; i < cells.length; i++) {
    const drainType = CELL_TYPES[types[i]]
    if (!drainType.drain || cells[i] === 0 || next[i] !== cells[i]) continue
    if (s.gen % (drainType.drainEvery ?? 1) !== 0) continue
    const x = i % w
    const y = Math.floor(i / w)
    const start = s.gen % 8
    for (let k = 0; k < 8; k++) {
      const [dx, dy] = NEIGHBORS[(start + k) % 8]
      const xx = x + dx
      const yy = y + dy
      if (xx < 0 || xx >= w || yy < 0 || yy >= h || !inSafe(xx, yy)) continue
      const j = yy * w + xx
      if (next[j] > 0 && next[j] !== cells[i] && !CELL_TYPES[nextTypes[j]].unconvertible) {
        converts[next[j] * nf + cells[i]]++
        next[j] = cells[i]
        nextTypes[j] = 0
        events[j] = EV_CONVERTED
        cause[j] = cells[i]
        break
      }
    }
  }

  // Martyr pass: a martyr that died to the rules (not the storm) takes every
  // adjacent enemy with it. Blasts do not chain into other martyrs' deaths.
  for (let i = 0; i < cells.length; i++) {
    if (!CELL_TYPES[types[i]].onDeathKill || cells[i] === 0 || next[i] !== 0) continue
    const x = i % w
    const y = Math.floor(i / w)
    if (!inSafe(x, y)) continue
    const radius = CELL_TYPES[types[i]].blastRadius ?? 1
    let kills = 0
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        if (dx === 0 && dy === 0) continue
        const xx = x + dx
        const yy = y + dy
        if (xx < 0 || xx >= w || yy < 0 || yy >= h) continue
        const j = yy * w + xx
        if (next[j] > 0 && next[j] !== cells[i]) {
          deaths[next[j]]++
          combatDeaths[next[j]]++ // a detonation is unambiguously the martyr's doing
          events[j] = EV_DIED_COMBAT
          cause[j] = cells[i]
          s.killN++
          s.killSumX += xx
          s.killSumY += yy
          next[j] = 0
          nextTypes[j] = 0
          kills++
        }
      }
    }
    s.blasts.push({ i, kills })
  }

  // Specials edit the grid post-pass, so recount populations wholesale.
  const pops = s.pops
  pops.fill(0)
  for (let i = 0; i < next.length; i++) if (next[i] > 0) pops[next[i]]++

  s.prev = s.cells
  s.cells = next
  s.prevTypes = s.types
  s.types = nextTypes
  s.gen++
}

/** Strictly dominant faction among counts (excluding `except`); 0 on tie. */
function dominant(counts: Int32Array, nf: number, except: number): number {
  let best = 0
  let bestCount = 0
  let tied = false
  for (let f = 1; f < nf; f++) {
    if (f === except) continue
    const c = counts[f]
    if (c > bestCount) {
      best = f
      bestCount = c
      tied = false
    } else if (c === bestCount && c > 0) {
      tied = true
    }
  }
  return tied ? 0 : best
}

/** FNV-1a over the board + gen — for determinism checks and replay audits. */
export function stateHash(s: SimState): number {
  let h = 0x811c9dc5
  const cells = s.cells
  const types = s.types
  for (let i = 0; i < cells.length; i++) {
    h ^= cells[i] ^ (types[i] << 4)
    h = Math.imul(h, 0x01000193)
  }
  h ^= s.gen
  return Math.imul(h, 0x01000193) >>> 0
}
