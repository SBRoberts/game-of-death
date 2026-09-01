/**
 * Scripted seeder, not intelligence: spend biomass on a random affordable
 * pattern, anchored at a random own cell, nudged toward the enemy centroid.
 * Exists so the duel has a pulse and the harness can self-play.
 */

import type { Duel } from './duel'
import { PATTERNS } from './patterns'
import { pickInt, type Rng } from './rng'

export function aiAct(duel: Duel, faction: number, rng: Rng): void {
  const affordable = PATTERNS.filter((p) => p.cost <= duel.biomass[faction])
  if (affordable.length === 0) return
  const pattern = affordable[pickInt(rng, affordable.length)]

  const s = duel.state
  const { width: w } = s.cfg
  const own: number[] = []
  let ex = 0
  let ey = 0
  let en = 0
  for (let i = 0; i < s.cells.length; i++) {
    const f = s.cells[i]
    if (f === faction) own.push(i)
    else if (f > 0) {
      ex += i % w
      ey += Math.floor(i / w)
      en++
    }
  }
  if (own.length === 0) return
  const cx = en > 0 ? ex / en : w / 2
  const cy = en > 0 ? ey / en : s.cfg.height / 2

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
