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
import { rotateDir, type Pattern } from './patterns'
import { pickInt, type Rng } from './rng'

/**
 * One evaluation for placements, shared by the planner AI and the UI's
 * placement hint — so the grade you read is the grade the rival plays by.
 *
 * It scores the NET TERRITORY SWING a placement causes, because that is what
 * actually decides a round: cells that SETTLE into a stable nucleus are the
 * prize, mere churn is discounted heavily, a rival cell removed is worth about
 * as much as a cell gained, and your own losses count fully against you.
 *
 * The weights are measured, not guessed: an earlier version priced disruption
 * at 3× a gain and counted raw churn as growth, which let a deeper search win
 * the fight and lose the count — the skill gradient flattened out past a
 * shallow search. Under these weights a deeper planner reliably beats a
 * shallower one (src/harness/turnbalance.ts), which is the game's core claim.
 */
export function impactScore(
  cells: Uint8Array,
  impact: Impact,
  target: number,
  cost: number,
): number {
  void cells // ownership of a disrupted future comes from the projection, not the live board
  let score = -cost * 0.35
  // Whose future was disrupted: destroyedOwner[k] is who WOULD have held the
  // cell, which is the honest question — the live board may not hold it yet.
  impact.destroyed.forEach((_, k) => {
    score += impact.destroyedOwner[k] === target ? 1.0 : 0.2
  })
  // A settled nucleus is the thing worth buying; the rest is churn that burns out.
  score += impact.lasting.length * 1.3
  score += Math.max(0, impact.gained.length - impact.lasting.length) * 0.15
  // Own cells this placement smothers cost exactly what they are worth. A
  // deliberate sacrifice (martyr, vampire) still wins on the enemy cells it takes.
  score -= impact.ownLost.length * 1.0
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

/** What a policy placed, so a driver can telegraph it on the slide. */
export interface Placed {
  patternId: string
  cells: Array<[number, number]>
}

export function aiAct(duel: Duel, faction: number, rng: Rng, target: number): Placed | null {
  const affordable = duel.poolFor(faction).filter((p) => p.cost <= duel.biomass[faction])
  if (affordable.length === 0) return null
  const pattern = affordable[pickInt(rng, affordable.length)]
  const { own, cx, cy } = scan(duel, faction, target)
  if (own.length === 0) return null
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
    if (duel.tryPlace(faction, pattern.id, ox, oy, rot)) {
      return { patternId: pattern.id, cells: duel.patternCells(pattern, ox, oy, rot) }
    }
  }
  return null
}

export interface Plan {
  pattern: Pattern
  ox: number
  oy: number
  rot: number
  score: number
}

/**
 * The planner's evaluation without the commit: sample candidate placements
 * from `candidates` (default: the faction's whole affordable pool), Foresight-
 * score each, and return the best — or null when nothing beats doing nothing.
 * smartAct() commits it via tryPlace; a driver that wants the placement on the
 * player's record (forecast + attribution) can commit the plan via playCard.
 */
export function planBest(
  duel: Duel,
  faction: number,
  rng: Rng,
  target: number,
  samples: number,
  horizon: number,
  candidates: readonly Pattern[] = duel.poolFor(faction),
): Plan | null {
  const affordable = candidates.filter((p) => p.cost <= duel.biomass[faction])
  if (affordable.length === 0) return null
  const { own, cx, cy } = scan(duel, faction, target)
  if (own.length === 0) return null
  const s = duel.state
  const w = s.cfg.width

  let best: Plan | null = null
  for (let k = 0; k < samples; k++) {
    const pattern = affordable[pickInt(rng, affordable.length)]
    const anchor = own[pickInt(rng, own.length)]
    const ax = anchor % w
    const ay = Math.floor(anchor / w)
    const dx = Math.sign(cx - ax)
    const dy = Math.sign(cy - ay)
    // Sample the faction's actual legal reach, so reach genes matter.
    const reach = Math.max(4, (duel.radii[faction] ?? 10) - 2)
    const ox = ax + dx * (2 + pickInt(rng, reach)) + pickInt(rng, 7) - 3
    const oy = ay + dy * (2 + pickInt(rng, reach)) + pickInt(rng, 7) - 3
    const rot = pattern.dir ? aimRot(pattern.dir, cx - ox, cy - oy) : pickInt(rng, 4)
    const cells = duel.patternCells(pattern, ox, oy, rot)
    if (!duel.canPlace(faction, cells, pattern.clearance)) continue

    const impact = projectImpact(
      s,
      faction,
      cells,
      horizon,
      (g) => duel.insetAt(g),
      pattern.cellType ?? 0,
    )
    const score = impactScore(s.cells, impact, target, pattern.cost)
    if (!best || score > best.score) best = { pattern, ox, oy, rot, score }
  }
  return best && best.score > 0 ? best : null
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
): Placed | null {
  const best = planBest(duel, faction, rng, target, samples, horizon)
  if (!best) return null
  if (!duel.tryPlace(faction, best.pattern.id, best.ox, best.oy, best.rot)) return null
  return { patternId: best.pattern.id, cells: duel.patternCells(best.pattern, best.ox, best.oy, best.rot) }
}
