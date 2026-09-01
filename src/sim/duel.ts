/**
 * A single round: two colonies, one shrinking board, biomass economy,
 * a hand of pattern cards, win/loss resolution. Deterministic given
 * (seed, sequence of playCard calls with their generation timing).
 */

import { createState, setCells, step } from './engine'
import { PATTERNS, patternById, placeAt, rotate, type Pattern } from './patterns'
import { rngFrom, pickInt, type Rng } from './rng'
import { TUNING, type Tuning } from './tuning'
import { LIFE, type SimState } from './types'
import { aiAct } from './ai'

export const PLAYER = 1
export const RIVAL = 2

export type DuelStatus = 'running' | 'won' | 'lost'

export class Duel {
  readonly seed: string
  readonly t: Tuning
  readonly state: SimState
  /** Biomass per faction index (0 unused). */
  biomass: number[]
  hand: string[]
  status: DuelStatus = 'running'
  outcome = ''
  /** When true, the rival plays itself inside tick(); harness can disable. */
  autoRival = true

  private drawRng: Rng
  private rivalRng: Rng

  constructor(seed: string, overrides: Partial<Tuning> = {}) {
    this.seed = seed
    this.t = { ...TUNING, ...overrides }
    this.state = createState({
      width: this.t.width,
      height: this.t.height,
      factions: [
        { name: 'dead', rule: LIFE },
        { name: 'you', rule: LIFE },
        { name: 'rival', rule: LIFE },
      ],
      flankingMargin: this.t.flankingMargin,
    })
    this.biomass = [0, this.t.startBiomass, this.t.startBiomass]
    this.drawRng = rngFrom(seed, 'draw')
    this.rivalRng = rngFrom(seed, 'rival')

    const soupRng = rngFrom(seed, 'soup')
    this.seedColony(PLAYER, Math.floor(this.t.width * 0.22), Math.floor(this.t.height / 2), soupRng)
    this.seedColony(RIVAL, Math.floor(this.t.width * 0.78), Math.floor(this.t.height / 2), soupRng)

    this.hand = Array.from({ length: this.t.handSize }, () => this.draw())
  }

  private seedColony(faction: number, cx: number, cy: number, rng: Rng): void {
    const r = this.t.seedBlobRadius
    const coords: Array<[number, number]> = []
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (dx * dx + dy * dy > r * r) continue
        if (rng() < this.t.seedDensity) coords.push([cx + dx, cy + dy])
      }
    }
    setCells(this.state, faction, coords)
  }

  private draw(): string {
    return PATTERNS[pickInt(this.drawRng, PATTERNS.length)].id
  }

  get maxInset(): number {
    return Math.floor(Math.min(this.t.width, this.t.height) / 2) - this.t.ringMinHalf
  }

  /** Inset the storm will have at a given generation. */
  insetAt(gen: number): number {
    if (gen <= this.t.ringGrace) return 0
    return Math.min(this.maxInset, Math.floor((gen - this.t.ringGrace) / this.t.ringShrinkEvery))
  }

  income(faction: number): number {
    return this.t.incomeBase + this.t.incomeScale * Math.sqrt(this.state.pops[faction])
  }

  tick(): void {
    if (this.status !== 'running') return
    const s = this.state

    s.ringInset = this.insetAt(s.gen + 1)
    step(s)
    this.biomass[PLAYER] += this.income(PLAYER)
    this.biomass[RIVAL] += this.income(RIVAL)

    if (this.autoRival && s.gen % this.t.aiActEvery === 0) {
      aiAct(this, RIVAL, this.rivalRng)
    }

    if (s.gen > this.t.warmupGens) {
      if (s.pops[PLAYER] === 0) return this.finish('lost', 'Your colony is extinct.')
      if (s.pops[RIVAL] === 0) return this.finish('won', 'The rival colony is extinct.')
    }
    if (s.ringInset >= this.maxInset || s.gen >= this.t.genLimit) {
      const [p, r] = [s.pops[PLAYER], s.pops[RIVAL]]
      if (p > r) this.finish('won', `The storm closed. Territory: ${p} vs ${r}.`)
      else this.finish('lost', `The storm closed. Territory: ${p} vs ${r}. The house wins ties.`)
    }
  }

  private finish(status: DuelStatus, outcome: string): void {
    this.status = status
    this.outcome = outcome
  }

  /** Absolute cells for a pattern at anchor/rotation — shared by ghost + place. */
  patternCells(pattern: Pattern, ox: number, oy: number, rot: number): Array<[number, number]> {
    return placeAt(rotate(pattern.cells, rot), ox, oy)
  }

  canPlace(faction: number, cells: ReadonlyArray<readonly [number, number]>): boolean {
    const s = this.state
    const { width: w, height: h } = s.cfg
    const inset = s.ringInset
    let nearColony = false
    for (const [x, y] of cells) {
      if (x < inset || x >= w - inset || y < inset || y >= h - inset) return false
      if (s.cells[y * w + x] !== 0) return false // no overwriting live cells
      if (!nearColony && this.withinInfluence(faction, x, y)) nearColony = true
    }
    return nearColony
  }

  private withinInfluence(faction: number, x: number, y: number): boolean {
    const s = this.state
    const { width: w, height: h } = s.cfg
    const r = this.t.placementRadius
    for (let yy = Math.max(0, y - r); yy <= Math.min(h - 1, y + r); yy++) {
      const base = yy * w
      for (let xx = Math.max(0, x - r); xx <= Math.min(w - 1, x + r); xx++) {
        if (s.cells[base + xx] === faction) return true
      }
    }
    return false
  }

  /** Internal placement, shared by player and AI. */
  tryPlace(faction: number, patternId: string, ox: number, oy: number, rot: number): boolean {
    if (this.status !== 'running') return false
    const pattern = patternById(patternId)
    if (this.biomass[faction] < pattern.cost) return false
    const cells = this.patternCells(pattern, ox, oy, rot)
    if (!this.canPlace(faction, cells)) return false
    setCells(this.state, faction, cells)
    this.biomass[faction] -= pattern.cost
    return true
  }

  /** Player plays a card from the hand; the slot refills from the deck. */
  playCard(handIdx: number, ox: number, oy: number, rot: number): Array<[number, number]> | null {
    const id = this.hand[handIdx]
    if (!id) return null
    const pattern = patternById(id)
    const cells = this.patternCells(pattern, ox, oy, rot)
    if (!this.tryPlace(PLAYER, id, ox, oy, rot)) return null
    this.hand[handIdx] = this.draw()
    return cells
  }
}
