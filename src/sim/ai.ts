/**
 * Two rival policies:
 *   aiAct    — scripted seeder: random affordable pattern, nudged at the enemy.
 *   smartAct — the planner: samples candidate placements, scores each with a
 *              Foresight projection (the same tool the player has), plays the
 *              best. The harness pits planner against random to *prove* that
 *              better planning wins under these mechanics.
 */

import type { Duel } from './duel'
import { projectImpact, type Impact } from './foresight'
import { PATTERNS, rotateDir, type Pattern } from './patterns'
import { pickInt, type Rng } from './rng'

/**
 * One evaluation for placements, shared by the planner AI and the UI's
 * placement hint: disrupting the target's future counts most, growth counts
 * some, and the biomass cost is a tax. Positive means worth playing.
 */
export function impactScore(
  cells: Uint8Array,
  impact: Impact,
  target: number,
  cost: number,
): number {
  let score = -cost * 0.4
  for (const i of impact.destroyed) score += cells[i] === target ? 3 : 0.5
  score += impact.gained.length * 0.4
  return score
}

interface Scan {
  own: number[]
  cx: number
  cy: number
}

function scan(duel: Duel, faction: number, target: number): Scan {
  const s = duel.state
  const { width: w, height } = s.cfg
  const own: number[] = []
  let ex = 0
  let ey = 0
  let en = 0
  for (let i = 0; i < s.cells.length; i++) {
    const f = s.cells[i]
    if (f === faction) own.push(i)
    else if (f === target) {
      ex += i % w
      ey += Math.floor(i / w)
      en++
    }
  }
  return {
    own,
    cx: en > 0 ? ex / en : w / 2,
    cy: en > 0 ? ey / en : height / 2,
  }
}

/** Rotation that points a traveler's heading most directly at (tx, ty). */
function aimRot(dir: readonly [number, number], tx: number, ty: number): number {
  let best = 0
  let bestDot = -Infinity
  for (let r = 0; r < 4; r++) {
    const [dx, dy] = rotateDir(dir, r)
    const dot = dx * tx + dy * ty
    if (dot > bestDot) {
      bestDot = dot
      best = r
    }
  }
  return best
}

export function aiAct(duel: Duel, faction: number, rng: Rng, target: number): void {
  const affordable = PATTERNS.filter((p) => p.cost <= duel.biomass[faction])
  if (affordable.length === 0) return
  const pattern = affordable[pickInt(rng, affordable.length)]
  const { own, cx, cy } = scan(duel, faction, target)
  if (own.length === 0) return
  const w = duel.state.cfg.width

  for (let attempt = 0; attempt < 12; attempt++) {
    const anchor = own[pickInt(rng, own.length)]
    const ax = anchor % w
    const ay = Math.floor(anchor / w)
    const dx = Math.sign(cx - ax)
    const dy = Math.sign(cy - ay)
    const ox = ax + dx * 3 + pickInt(rng, 9) - 4
    const oy = ay + dy * 3 + pickInt(rng, 9) - 4
    const rot = pickInt(rng, 4)
    if (duel.tryPlace(faction, pattern.id, ox, oy, rot)) return
  }
}

/**
 * Sample candidate placements, Foresight-score each, play the best one.
 * Scoring favors disrupting the target's future over land-grabbing, and a
 * candidate must beat a do-nothing baseline of 0 or the biomass is saved.
 */
export function smartAct(
  duel: Duel,
  faction: number,
  rng: Rng,
  target: number,
  samples: number,
  horizon: number,
): void {
  const affordable = PATTERNS.filter((p) => p.cost <= duel.biomass[faction])
  if (affordable.length === 0) return
  const { own, cx, cy } = scan(duel, faction, target)
  if (own.length === 0) return
  const s = duel.state
  const w = s.cfg.width

  let best: { pattern: Pattern; ox: number; oy: number; rot: number; score: number } | null = null
  for (let k = 0; k < samples; k++) {
    const pattern = affordable[pickInt(rng, affordable.length)]
    const anchor = own[pickInt(rng, own.length)]
    const ax = anchor % w
    const ay = Math.floor(anchor / w)
    const dx = Math.sign(cx - ax)
    const dy = Math.sign(cy - ay)
    const ox = ax + dx * (2 + pickInt(rng, 6)) + pickInt(rng, 7) - 3
    const oy = ay + dy * (2 + pickInt(rng, 6)) + pickInt(rng, 7) - 3
    const rot = pattern.dir ? aimRot(pattern.dir, cx - ox, cy - oy) : pickInt(rng, 4)
    const cells = duel.patternCells(pattern, ox, oy, rot)
    if (!duel.canPlace(faction, cells, pattern.clearance)) continue

    const impact = projectImpact(s, faction, cells, horizon, (g) => duel.insetAt(g))
    const score = impactScore(s.cells, impact, target, pattern.cost)
    if (!best || score > best.score) best = { pattern, ox, oy, rot, score }
  }
  if (best && best.score > 0) {
    duel.tryPlace(faction, best.pattern.id, best.ox, best.oy, best.rot)
  }
}
