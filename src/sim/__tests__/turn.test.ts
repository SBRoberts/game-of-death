import { describe, expect, it } from 'vitest'
import { Duel, PLAYER, RIVAL, TUNING } from '../index'
import { stateHash } from '../engine'

const T = TUNING.turnGens
/** A spot just off the player's colony — derived, so an arena re-sizing can't
 *  silently turn these tests into "placement was rejected" no-ops. */
const NEAR: readonly [number, number] = [
  Math.round(TUNING.width * TUNING.colonyX) + 6,
  Math.floor(TUNING.height / 2),
]

/** Drive one full turn the way the web driver does. */
function playTurn(d: Duel): void {
  d.beginIncubate()
  for (let i = 0; i < T; i++) d.tick()
  d.settle()
}

describe('turn model: the bleach is a turn clock', () => {
  it('is 0 before bleachFromTurn, steps per turn at the turn boundary, and caps', () => {
    const d = new Duel('bleach', { bleachFromTurn: 3, bleachPerTurn: 2 })
    expect(d.turnOf(0)).toBe(1)
    expect(d.turnOf(T)).toBe(1) // the last gen of turn 1
    expect(d.turnOf(T + 1)).toBe(2)
    expect(d.insetAt(0)).toBe(0)
    expect(d.insetAt(2 * T)).toBe(0) // turn 2 still open
    expect(d.insetAt(2 * T + 1)).toBe(2) // turn 3's first step eats the edge
    expect(d.insetAt(3 * T)).toBe(2)
    expect(d.insetAt(3 * T + 1)).toBe(4)
    expect(d.insetAt(10_000)).toBe(d.maxInset)
    expect(d.nextBleach()).toEqual({ turn: 3, inset: 2 })
    expect(d.roundMaxInset).toBe(Math.min(d.maxInset, (TUNING.turnsPerRound - 3 + 1) * 2))
  })

  it('a schedule of 0 never bleaches and the projection sees the same clock', () => {
    const open = new Duel('open', { bleachFromTurn: 0 })
    expect(open.insetAt(10_000)).toBe(0)
    expect(open.nextBleach()).toBeNull()
    const d = new Duel('bleach-live', { bleachFromTurn: 2, bleachPerTurn: 3 })
    d.autoRival = false
    playTurn(d)
    expect(d.state.ringInset).toBe(0)
    d.beginIncubate()
    d.tick()
    expect(d.state.ringInset).toBe(3) // the first step of turn 2
  })
})

describe('turn model: the settle report', () => {
  it('grades what the incubation did and files one report per turn', () => {
    const d = new Duel('settle-seed')
    d.autoRival = false
    expect(d.turn).toBe(1)
    const placed = d.playCard(0, NEAR[0], NEAR[1], 0)
    expect(placed).not.toBeNull()
    const rec = d.placements[0]
    expect(rec.turn).toBe(1)
    expect(rec.forecast.settle).toBe(rec.forecastCells.length)
    expect(rec.forecast.rival).toBe(rec.forecastHits.length)
    d.beginIncubate()
    const pop0 = d.state.pops[PLAYER]
    const rival0 = d.state.pops[RIVAL]
    for (let i = 0; i < T; i++) d.tick()
    const r = d.settle()
    expect(r.turn).toBe(1)
    expect(r.gens).toBe(T)
    expect(r.you).toBe(d.state.pops[PLAYER] - pop0)
    expect(r.rival).toBe(d.state.pops[RIVAL] - rival0)
    expect(r.placements).toEqual([rec])
    expect(r.forecast).toEqual(rec.forecast)
    expect(r.held).toBeLessThanOrEqual(r.forecastCells)
    expect(d.turn).toBe(2)
    expect(d.turnReports).toHaveLength(1)
    // A turn with no placement has no forecast to grade.
    playTurn(d)
    expect(d.turnReports[1].forecast).toBeNull()
    expect(d.turnReports[1].placements).toEqual([])
  })

  it('WYSIWYG: with the rival deployed first, the ghost is the literal future', () => {
    // Nothing is injected during incubation, so the projection made at commit
    // time IS the settled board: every settling cell held, every struck cell gone.
    let graded = 0
    for (const seed of ['wysiwyg-a', 'wysiwyg-b', 'wysiwyg-c', 'wysiwyg-d']) {
      const d = new Duel(seed)
      d.autoRival = false
      for (let turn = 0; turn < 4 && d.status === 'running'; turn++) {
        d.rivalDeploy()
        // Try a few spots until one is legal; the last placement sees the final board.
        for (const [ox, oy] of [NEAR, [NEAR[0] - 4, NEAR[1] - 6], [NEAR[0] + 2, NEAR[1] + 6], [NEAR[0] - 6, NEAR[1] + 4]] as const) {
          if (d.playCard(0, ox, oy, 0)) break
        }
        playTurn(d)
        const rep = d.turnReports[d.turnReports.length - 1]
        const last = rep.placements[rep.placements.length - 1]
        if (!last) continue
        expect(last.held).toBe(last.forecastCells.length)
        expect(last.struck).toBe(last.forecastHits.length)
        graded++
      }
    }
    expect(graded).toBeGreaterThan(4)
  })

  it('the last settle ends the round on territory (tie → lysis), never the house', () => {
    const d = new Duel('last-turn')
    d.autoRival = false
    for (let t = 0; t < TUNING.turnsPerRound && d.status === 'running'; t++) playTurn(d)
    expect(d.status).not.toBe('running')
    expect(d.outcome).toMatch(/Territory: \d+ vs \d+/)
    expect(d.turnReports.length).toBeLessThanOrEqual(TUNING.turnsPerRound)
    expect(d.turn).toBe(TUNING.turnsPerRound)
  })

  it('settle banks a live cascade so chains never straddle turns', () => {
    const d = new Duel('bank-at-settle')
    d.autoRival = false
    d.playCard(0, NEAR[0], NEAR[1], 0)
    playTurn(d)
    expect(d.combo.active).toBe(false)
  })
})

describe('turn model: the telegraphed rival', () => {
  it('rivalDeploy places up to rivalActs patterns, spends rival biomass, and is deterministic', () => {
    const a = new Duel('telegraph', { rivalActs: 2 })
    const b = new Duel('telegraph', { rivalActs: 2 })
    a.autoRival = false
    b.autoRival = false
    const bio = a.biomass[RIVAL]
    const pa = a.rivalDeploy()
    const pb = b.rivalDeploy()
    expect(pa.length).toBeLessThanOrEqual(2)
    expect(pa).toEqual(pb)
    if (pa.length) expect(a.biomass[RIVAL]).toBeLessThan(bio)
    expect(stateHash(a.state)).toBe(stateHash(b.state))
    // Nothing placed once the duel is over.
    a.forceEnd('lost')
    expect(a.rivalDeploy()).toEqual([])
  })

  it('self-driving duels act at turn boundaries only', () => {
    const d = new Duel('auto-cadence')
    const bio0 = d.biomass[RIVAL]
    d.tick() // gen 0 → the rival deploys before the first step
    const afterFirst = d.biomass[RIVAL]
    for (let i = 1; i < T; i++) d.tick() // no more acts inside the window
    // Only income moved the wallet during the window (monotone up).
    expect(d.biomass[RIVAL]).toBeGreaterThanOrEqual(afterFirst)
    expect(bio0).toBeGreaterThan(0)
  })
})

describe('turn model: attribution', () => {
  it('every banked cascade is attributed to a placement and the pattern stats add up', () => {
    let banked = 0
    for (let n = 0; n < 16 && banked === 0; n++) {
      const d = new Duel(`attrib-${n}`)
      d.autoRival = false
      for (let t = 0; t < TUNING.turnsPerRound && d.status === 'running'; t++) {
        d.rivalDeploy()
        for (const [ox, oy] of [[NEAR[0] + 4, NEAR[1]], [NEAR[0] + 6, NEAR[1] - 6], [NEAR[0] + 2, NEAR[1] + 6], [NEAR[0] + 8, NEAR[1] + 4], NEAR] as const) {
          if (d.playCard(0, ox, oy, 1)) break
        }
        playTurn(d)
      }
      if (d.bankedCombos.length === 0) continue
      banked = d.bankedCombos.length
      for (const bc of d.bankedCombos) {
        expect(bc.src).not.toBeNull()
        expect(bc.len).toBeGreaterThan(0)
      }
      const credited = d.placements.reduce((a, p) => a + p.chain, 0)
      const total = d.bankedCombos.reduce((a, c) => a + c.total, 0)
      expect(credited).toBeCloseTo(total, 6)
      const stats = d.patternStats
      expect(stats.reduce((a, s) => a + s.plays, 0)).toBe(d.placements.length)
      expect(stats.reduce((a, s) => a + s.cascades, 0)).toBe(d.bankedCombos.length)
      expect(d.summary.cascades).toBe(d.bankedCombos.length)
      expect(d.summary.longestChain).toBeGreaterThan(0)
    }
    expect(banked).toBeGreaterThan(0)
  })
})
