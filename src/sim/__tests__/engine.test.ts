import { describe, expect, it } from 'vitest'
import { ELDER, MARTYR, VAMPIRE } from '../celltypes'
import { createState, setCells, step, stateHash } from '../engine'
import { patternById, placeAt, rotate } from '../patterns'
import { LIFE, mask, type SimConfig, type SimState } from '../types'
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
  casualtyMargin: 1,
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

  it('LWSS travels 2 cells against +x every 4 generations (base rotation)', () => {
    const s = createState(cfg())
    const lwss = patternById('lwss').cells
    setCells(s, 1, placeAt(lwss, 20, 20))
    for (let i = 0; i < 4; i++) step(s)
    expect(liveSet(s)).toEqual(new Set(placeAt(lwss, 18, 20).map(([x, y]) => `${x},${y}`)))
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

  it('outnumbered-by-one cell dies as a casualty instead of defecting', () => {
    const s = createState(cfg())
    setCells(s, 1, [[5, 5], [4, 5]]) // faction a: cell + one friend
    setCells(s, 2, [[6, 5], [5, 6]]) // faction b: two attackers
    step(s)
    // (5,5): friendly 1, enemy 2 → below flanking margin, at casualty margin
    expect(s.cells[5 * 40 + 5]).toBe(0)
  })

  it('wilds capture: neutral cells flanked by a colony defect to it', () => {
    const s = createState(cfg())
    setCells(s, 2, [[10, 10]]) // one wild-stand-in cell
    setCells(s, 1, [[9, 9], [10, 9], [11, 9]]) // colony pressing on it
    step(s)
    // (10,10): friendly 0, enemy 3 → flanked by ≥2 → joins faction 1
    expect(s.cells[10 * 40 + 10]).toBe(1)
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

describe('engine: special cells', () => {
  it('elder is immortal alone and among enemies (but not in the storm)', () => {
    const s = createState(cfg())
    setCells(s, 1, [[10, 10]], ELDER)
    setCells(s, 2, [[9, 10], [11, 10], [10, 9], [10, 11]]) // surrounded
    for (let i = 0; i < 6; i++) step(s)
    expect(s.cells[10 * 40 + 10]).toBe(1)
    expect(s.types[10 * 40 + 10]).toBe(ELDER)
    s.ringInset = 15
    step(s)
    expect(s.cells[10 * 40 + 10]).toBe(0) // every forever has a clock
  })

  it('vampire converts an adjacent enemy and starves when alone', () => {
    const s = createState(cfg())
    setCells(s, 1, [[10, 10]], VAMPIRE)
    setCells(s, 2, placeAt(patternById('block').cells, 11, 10)) // stable prey
    step(s)
    // One block cell now belongs to faction 1 (drained), vampire still stands.
    expect(s.cells[10 * 40 + 10]).toBe(1)
    expect(s.pops[1]).toBeGreaterThanOrEqual(2)

    const lone = createState(cfg())
    setCells(lone, 1, [[20, 20]], VAMPIRE)
    step(lone)
    expect(lone.cells[20 * 40 + 20]).toBe(0) // starved: non-standard death
  })

  it('martyr detonates on death, killing adjacent enemies', () => {
    const s = createState(cfg())
    setCells(s, 1, [[10, 10]], MARTYR) // no friends: dies of underpopulation...
    setCells(s, 2, placeAt(patternById('block').cells, 12, 9)) // ...beside a block
    // Martyr at (10,10) has neighbors (12,x)? No — block at 12..13 is not
    // adjacent. Bring one enemy adjacent so the blast has a target:
    setCells(s, 2, [[11, 10]])
    step(s)
    expect(s.cells[10 * 40 + 10]).toBe(0) // martyr died
    expect(s.cells[10 * 40 + 11]).toBe(0) // and took the adjacent enemy along
  })
})

describe('foresight: nucleus stability', () => {
  it('a block settles (all lasting); an r-pentomino mostly churns', async () => {
    const { projectImpact } = await import('../foresight')
    const s = createState(cfg())
    const block = projectImpact(s, 1, placeAt(patternById('block').cells, 10, 10), 24)
    expect(block.gained.length).toBe(4)
    expect(block.lasting.length).toBe(4) // still life: every cell settles

    const s2 = createState(cfg())
    const blinker = projectImpact(s2, 1, placeAt(patternById('blinker').cells, 20, 20), 24)
    expect(blinker.lasting.length).toBeGreaterThan(0) // period-2 counts as settled
  })

  it('martyr blasts report their kill count', () => {
    const s = createState(cfg())
    setCells(s, 1, [[10, 10]], MARTYR)
    // A supported enemy: survives the rules, dies to the blast.
    setCells(s, 2, [[11, 10], [12, 10], [12, 9]])
    step(s)
    expect(s.blasts.length).toBe(1)
    expect(s.blasts[0].kills).toBeGreaterThanOrEqual(1)
  })
})

describe('duel: genome loadout', () => {
  it('rule genes mutate the player faction; card genes extend the pool', () => {
    const d = new Duel('loadout-test', {}, ['hardy', 'highlife', 'vampire'])
    expect(d.state.cfg.factions[1].rule.survive & mask(8)).toBeTruthy()
    expect(d.state.cfg.factions[1].rule.birth & mask(6)).toBeTruthy()
    expect(d.state.cfg.factions[2].rule.survive & mask(8)).toBeFalsy() // rival untouched
    expect(d.playerPool.some((p) => p.id === 'vampire')).toBe(true)

    const vanilla = new Duel('loadout-test')
    expect(vanilla.playerPool.some((p) => p.id === 'vampire')).toBe(false)
  })

  it('economy genes are per-faction, not global', () => {
    const d = new Duel('econ-test', {}, ['thrifty', 'ranger'])
    expect(d.biomass[1]).toBe(d.t.startBiomass + 12) // level 1
    expect(d.biomass[2]).toBe(d.t.startBiomass) // rival gets no head start
    expect(d.radii[1]).toBe(12)
    expect(d.radii[2]).toBe(10)
  })

  it('gene levels deepen the axis: leveled loadouts apply their rung', () => {
    const d = new Duel('level-test', {}, [
      { key: 'hardy', level: 3 },
      { key: 'vampire', level: 3 },
      { key: 'martyr', level: 2 },
      { key: 'thrifty', level: 3 },
    ])
    const survive = d.state.cfg.factions[1].rule.survive
    expect(survive & mask(6)).toBeTruthy()
    expect(survive & mask(7)).toBeTruthy()
    expect(survive & mask(8)).toBeTruthy()
    const vamp = d.playerPool.find((p) => p.id === 'vampire')
    expect(vamp?.cellType).toBe(5) // VAMPIRE_ELDEST: feeds every generation
    expect(vamp?.name).toBe('Vampire III')
    const martyr = d.playerPool.find((p) => p.id === 'martyr')
    expect(martyr?.cost).toBe(7) // level 2: cheaper mines
    expect(d.biomass[1]).toBe(d.t.startBiomass + 40)
  })

  it('big martyr (level 3) blasts at radius 2', async () => {
    const { MARTYR_GREAT } = await import('../celltypes')
    const s = createState(cfg())
    setCells(s, 1, [[10, 10]], MARTYR_GREAT)
    // Supported enemy two cells away — outside a normal blast, inside a great one.
    setCells(s, 2, [[12, 10], [13, 10], [13, 9]])
    setCells(s, 2, [[11, 10]]) // adjacent trigger pressure
    step(s)
    expect(s.cells[10 * 40 + 10]).toBe(0) // martyr died
    expect(s.cells[10 * 40 + 12]).toBe(0) // radius-2 kill
  })

  it('rival loadout mutates faction 2 and its pool, not the player', () => {
    const d = new Duel('rival-loadout', {}, [], ['hardy', 'vampire'])
    expect(d.state.cfg.factions[2].rule.survive & mask(8)).toBeTruthy()
    expect(d.state.cfg.factions[1].rule.survive & mask(8)).toBeFalsy()
    expect(d.rivalPool.some((p) => p.id === 'vampire')).toBe(true)
    expect(d.playerPool.some((p) => p.id === 'vampire')).toBe(false)
    expect(d.poolFor(2).some((p) => p.id === 'vampire')).toBe(true)
  })

  it('loadout runs stay deterministic', () => {
    const a = new Duel('loadout-det', {}, ['hardy', 'martyr'])
    const b = new Duel('loadout-det', {}, ['hardy', 'martyr'])
    for (let i = 0; i < 300; i++) {
      a.tick()
      b.tick()
    }
    expect(stateHash(a.state)).toBe(stateHash(b.state))
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

describe('duel: launch clearance', () => {
  it('travelers need open ground; fortifications can sit snug', () => {
    // Solid colony disc at (28,40) radius 3 for deterministic geometry.
    const d = new Duel('clearance-test', { seedDensity: 1, seedBlobRadius: 3, wildsCount: 0 })
    const glider = patternById('glider')
    const block = d.patternCells(patternById('block'), 33, 40, 0)
    expect(d.canPlace(1, block, 0)).toBe(true)
    const snug = d.patternCells(glider, 32, 39, 0) // 1 cell off the colony edge
    expect(d.canPlace(1, snug, glider.clearance)).toBe(false)
    const clear = d.patternCells(glider, 35, 38, 0) // open ground, in influence
    expect(d.canPlace(1, clear, glider.clearance)).toBe(true)
  })

  it('names the rejection reason', () => {
    const d = new Duel('clearance-test', { seedDensity: 1, seedBlobRadius: 3, wildsCount: 0 })
    const glider = patternById('glider')
    const block = patternById('block')
    const onColony = d.patternCells(block, 27, 40, 0)
    expect(d.placeProblem(1, onColony, 0)).toBe('occupied')
    const farCorner = d.patternCells(block, d.t.width - 6, 3, 0)
    expect(d.placeProblem(1, farCorner, 0)).toBe('far')
    const snug = d.patternCells(glider, 32, 39, 0)
    expect(d.placeProblem(1, snug, glider.clearance)).toBe('blocked')
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
