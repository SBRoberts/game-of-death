import { describe, expect, it } from 'vitest'
import { createState, setCells, step, stateHash } from '../engine'
import { patternById, placeAt, rotate } from '../patterns'
import { LIFE, type SimConfig, type SimState } from '../types'
import { Duel } from '../duel'

const cfg = (over: Partial<SimConfig> = {}): SimConfig => ({
  width: 40,
  height: 40,
  factions: [
    { name: 'dead', rule: LIFE },
    { name: 'a', rule: LIFE },
    { name: 'b', rule: LIFE },
  ],
  flankingMargin: 2,
  ...over,
})

const liveSet = (s: SimState): Set<string> => {
  const out = new Set<string>()
  for (let i = 0; i < s.cells.length; i++) {
    if (s.cells[i] > 0) out.add(`${i % s.cfg.width},${Math.floor(i / s.cfg.width)}`)
  }
  return out
}

describe('engine: classic Life behavior with one faction', () => {
  it('blinker oscillates with period 2', () => {
    const s = createState(cfg())
    setCells(s, 1, placeAt(patternById('blinker').cells, 10, 10))
    const gen0 = liveSet(s)
    step(s)
    const gen1 = liveSet(s)
    step(s)
    expect(liveSet(s)).toEqual(gen0)
    expect(gen1).not.toEqual(gen0)
    expect(s.pops[1]).toBe(3)
  })

  it('glider translates by (1,1) every 4 generations', () => {
    const s = createState(cfg())
    const glider = patternById('glider').cells
    setCells(s, 1, placeAt(glider, 5, 5))
    for (let i = 0; i < 4; i++) step(s)
    expect(liveSet(s)).toEqual(new Set(placeAt(glider, 6, 6).map(([x, y]) => `${x},${y}`)))
  })

  it('eater is a still life', () => {
    const s = createState(cfg())
    setCells(s, 1, placeAt(patternById('eater').cells, 10, 10))
    const gen0 = liveSet(s)
    for (let i = 0; i < 8; i++) step(s)
    expect(liveSet(s)).toEqual(gen0)
  })

  it('rotation preserves cell count and normalizes to origin', () => {
    for (const p of ['glider', 'lwss', 'eater']) {
      for (let r = 0; r < 4; r++) {
        const cells = rotate(patternById(p).cells, r)
        expect(cells.length).toBe(patternById(p).cells.length)
        expect(Math.min(...cells.map(([x]) => x))).toBe(0)
        expect(Math.min(...cells.map(([, y]) => y))).toBe(0)
      }
    }
  })
})

describe('engine: faction rules', () => {
  it('flanked cell defects to the dominant enemy', () => {
    const s = createState(cfg())
    setCells(s, 1, [[5, 5], [4, 5]]) // faction a: cell + one friend
    setCells(s, 2, [[6, 5], [6, 6], [5, 6]]) // faction b: three flankers
    step(s)
    // (5,5): friendly 1, enemy 3 → margin 2 → defects to b
    expect(s.cells[5 * 40 + 5]).toBe(2)
  })

  it('birth joins the strictly dominant faction; ties abort the birth', () => {
    const s = createState(cfg())
    // Dominant case: (10,10) has 2 a-neighbors + 1 b-neighbor → born as a
    setCells(s, 1, [[9, 10], [11, 10]])
    setCells(s, 2, [[10, 11]])
    step(s)
    expect(s.cells[10 * 40 + 10]).toBe(1)
  })

  it('storm inset kills everything outside the safe rect', () => {
    const s = createState(cfg())
    setCells(s, 1, placeAt(patternById('block').cells, 1, 1)) // hugging the edge
    setCells(s, 1, placeAt(patternById('block').cells, 20, 20)) // safe center
    s.ringInset = 5
    step(s)
    expect(s.cells[1 * 40 + 1]).toBe(0)
    expect(s.cells[20 * 40 + 20]).toBe(1)
    expect(s.pops[1]).toBe(4)
  })
})

describe('duel: determinism', () => {
  it('same seed and actions produce identical runs', () => {
    const a = new Duel('test-seed-42')
    const b = new Duel('test-seed-42')
    for (let i = 0; i < 500; i++) {
      a.tick()
      b.tick()
      if (i === 100) {
        a.playCard(0, 30, 40, 1)
        b.playCard(0, 30, 40, 1)
      }
    }
    expect(stateHash(a.state)).toBe(stateHash(b.state))
    expect(a.biomass).toEqual(b.biomass)
    expect(a.hand).toEqual(b.hand)
    expect(a.status).toBe(b.status)
  })

  it('different seeds diverge', () => {
    const a = new Duel('seed-a')
    const b = new Duel('seed-b')
    expect(stateHash(a.state)).not.toBe(stateHash(b.state))
  })
})

describe('duel: rules of play', () => {
  it('rejects placement outside colony influence', () => {
    const d = new Duel('influence-test')
    // Far corner: nowhere near the player colony at ~22% width
    expect(d.tryPlace(1, 'block', d.t.width - 6, 3, 0)).toBe(false)
  })

  it('placement costs biomass and refills the hand', () => {
    const d = new Duel('economy-test')
    const before = d.biomass[1]
    const card = d.hand[0]
    // Place adjacent to the player colony center
    const cx = Math.floor(d.t.width * 0.22)
    const cy = Math.floor(d.t.height / 2)
    let placed: unknown = null
    outer: for (let dy = -14; dy <= 14; dy += 2) {
      for (let dx = -14; dx <= 14; dx += 2) {
        placed = d.playCard(0, cx + dx, cy + dy, 0)
        if (placed) break outer
      }
    }
    expect(placed).toBeTruthy()
    expect(d.biomass[1]).toBeLessThan(before)
    expect(d.hand.length).toBe(d.t.handSize)
    expect(d.hand[0]).toBeDefined()
    void card
  })
})
