/**
 * The automaton itself. step() is pure state → state with zero randomness:
 * classic B/S rules per faction, plus two faction interactions —
 *   Recruitment: a birth joins the strictly dominant neighboring faction.
 *   Flanking:    a live cell outnumbered by ≥ flankingMargin defects.
 * Ties resolve to "nothing happens" so no faction gets a hidden edge.
 */

import type { SimConfig, SimState } from './types'

export function createState(cfg: SimConfig): SimState {
  const n = cfg.width * cfg.height
  return {
    cfg,
    gen: 0,
    cells: new Uint8Array(n),
    prev: new Uint8Array(n),
    pops: cfg.factions.map(() => 0),
    ringInset: 0,
  }
}

export function setCells(s: SimState, faction: number, coords: ReadonlyArray<readonly [number, number]>): void {
  const { width, height } = s.cfg
  for (const [x, y] of coords) {
    if (x < 0 || x >= width || y < 0 || y >= height) continue
    const i = y * width + x
    const old = s.cells[i]
    if (old === faction) continue
    if (old > 0) s.pops[old]--
    s.cells[i] = faction
    if (faction > 0) s.pops[faction]++
  }
}

export function cloneState(s: SimState): SimState {
  return {
    cfg: s.cfg,
    gen: s.gen,
    cells: s.cells.slice(),
    prev: s.prev.slice(),
    pops: s.pops.slice(),
    ringInset: s.ringInset,
  }
}

export function step(s: SimState): void {
  const { width: w, height: h, factions, flankingMargin, casualtyMargin } = s.cfg
  const cells = s.cells
  const next = s.prev // reuse the old buffer; after the swap it holds gen-1
  const nf = factions.length
  const counts = new Int32Array(nf)
  const pops = s.pops
  pops.fill(0)
  const inset = s.ringInset
  const x0 = inset
  const x1 = w - inset
  const y0 = inset
  const y1 = h - inset

  for (let y = 0; y < h; y++) {
    const rowInside = y >= y0 && y < y1
    for (let x = 0; x < w; x++) {
      const i = y * w + x
      if (!rowInside || x < x0 || x >= x1) {
        next[i] = 0 // the storm
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
      if (cur > 0) {
        const friendly = counts[cur]
        const enemy = total - friendly
        if (enemy - friendly >= flankingMargin) {
          out = dominant(counts, nf, cur) || cur // defect to the dominant enemy
        } else if (enemy - friendly >= casualtyMargin) {
          out = 0 // contested and outnumbered: a casualty, not a convert
        } else {
          out = (factions[cur].rule.survive >> total) & 1 ? cur : 0
        }
      } else if (total > 0) {
        const d = dominant(counts, nf, 0)
        if (d > 0 && (factions[d].rule.birth >> total) & 1) out = d
      }
      next[i] = out
      if (out > 0) pops[out]++
    }
  }

  s.prev = s.cells
  s.cells = next
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
  for (let i = 0; i < cells.length; i++) {
    h ^= cells[i]
    h = Math.imul(h, 0x01000193)
  }
  h ^= s.gen
  return Math.imul(h, 0x01000193) >>> 0
}
