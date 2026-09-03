import { describe, expect, it } from 'vitest'
import { cellTypeWarp, geneChoiceWarp, rarityOf } from '../warp'
import { CELL_TYPES, VAMPIRE, VAMPIRE_SWIFT, VAMPIRE_ELDEST, MARTYR, MARTYR_GREAT, ELDER } from '../celltypes'
import { foldLoadout, Duel, PLAYER } from '../duel'
import { TUNING } from '../tuning'
import { LIFE } from '../types'

describe('warp: distance from Conway', () => {
  it('scores rule-digit genes one warp per digit', () => {
    expect(geneChoiceWarp('hardy')).toBe(1) // addSurvive [8]
    expect(geneChoiceWarp({ key: 'hardy', level: 3 })).toBe(3) // [6,7,8]
    expect(geneChoiceWarp('highlife')).toBe(1) // addBirth [6]
    expect(geneChoiceWarp({ key: 'highlife', level: 2 })).toBe(2) // [6,8]
  })

  it('scores reach and economy as zero (geometry is not a rule bend)', () => {
    expect(geneChoiceWarp('ranger')).toBe(0)
    expect(geneChoiceWarp('thrifty')).toBe(0)
  })

  it('scores cell-type signatures with an accelerator notch', () => {
    expect(cellTypeWarp(CELL_TYPES[VAMPIRE])).toBe(3) // drain, drainEvery 3 -> 3+0
    expect(cellTypeWarp(CELL_TYPES[VAMPIRE_SWIFT])).toBe(4) // drainEvery 2 -> 3+1
    expect(cellTypeWarp(CELL_TYPES[VAMPIRE_ELDEST])).toBe(5) // drainEvery 1 -> 3+2
    expect(cellTypeWarp(CELL_TYPES[MARTYR])).toBe(3) // onDeathKill, r1
    expect(cellTypeWarp(CELL_TYPES[MARTYR_GREAT])).toBe(4) // blastRadius 2
    expect(cellTypeWarp(CELL_TYPES[ELDER])).toBe(3) // standalone survive anchor
    expect(cellTypeWarp(CELL_TYPES[0])).toBe(0) // normal
  })

  it('places entries in sensible rarity bands', () => {
    expect(rarityOf(geneChoiceWarp('hardy'))).toBe('common')
    expect(rarityOf(geneChoiceWarp('vampire'))).toBe('rare')
    expect(rarityOf(geneChoiceWarp({ key: 'vampire', level: 3 }))).toBe('epic')
    expect(rarityOf(7)).toBe('legendary')
  })
})

describe('foldLoadout: the warp cap gates the gradient', () => {
  it('a cap of 0 folds to exactly pure Conway (B3/S23)', () => {
    const f = foldLoadout(TUNING, ['hardy', 'highlife', { key: 'vampire', level: 2 }], 0)
    expect(f.rule.survive).toBe(LIFE.survive)
    expect(f.rule.birth).toBe(LIFE.birth)
    expect(f.activeWarp).toBe(0)
    expect(f.pool.length).toBe(foldLoadout(TUNING, [], 0).pool.length) // no cards admitted
  })

  it('an uncapped fold applies every choice (unchanged legacy behaviour)', () => {
    const f = foldLoadout(TUNING, ['hardy'])
    expect(f.rule.survive & (1 << 8)).toBeTruthy()
    expect(f.activeWarp).toBe(1)
  })

  it('admits choices greedily up to the cap, holding the rest dormant', () => {
    // hardy(1) + highlife(1) fit under cap 2; the vampire(4) does not.
    const f = foldLoadout(TUNING, ['hardy', 'highlife', 'vampire'], 2)
    expect(f.activeWarp).toBe(2)
    expect(f.rule.survive & (1 << 8)).toBeTruthy()
    expect(f.rule.birth & (1 << 6)).toBeTruthy()
    expect(f.pool.some((p) => p.name.startsWith('Vampire'))).toBe(false)
  })
})

describe('Duel.rebuildPlayer: in-run re-derivation', () => {
  it('round 1 (cap 0) opens on a pure Conway board even with a loadout', () => {
    const d = new Duel('warp-seed', {}, ['hardy', 'highlife'])
    d.warpCap = 0
    d.rebuildPlayer()
    const rule = d.state.cfg.factions[PLAYER].rule
    expect(rule.survive).toBe(LIFE.survive)
    expect(rule.birth).toBe(LIFE.birth)
    expect(d.playerWarp).toBe(0)
  })

  it('drafting mid-run mutates the live faction rule under a raised cap', () => {
    const d = new Duel('warp-seed', {}, [])
    d.warpCap = 10
    d.runLoadout.push('hardy')
    d.rebuildPlayer()
    const rule = d.state.cfg.factions[PLAYER].rule
    expect(rule.survive & (1 << 8)).toBeTruthy()
    expect(d.playerWarp).toBe(1)
  })
})

describe('Duel harvest counters', () => {
  it('start at zero and never go negative while ticking', () => {
    const d = new Duel('harvest-seed', {}, [])
    expect(d.plasm).toBe(0)
    expect(d.pendingChests).toBe(0)
    for (let i = 0; i < 300 && d.status === 'running'; i++) d.tick()
    expect(d.plasm).toBeGreaterThanOrEqual(0)
    expect(Number.isInteger(d.pendingChests)).toBe(true)
    expect(d.pendingChests).toBeGreaterThanOrEqual(0)
  })
})
