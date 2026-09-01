/**
 * Canvas renderer. The board is never React — one canvas, redrawn per frame.
 * The sim's prev-generation buffer gives us free one-gen "ash" trails.
 */

import { PLAYER, type Duel } from '../sim'

export const CELL = 8

export const COLORS = {
  bg: '#0a0d12',
  gridline: 'rgba(120,140,170,0.05)',
  player: '#3ce8c8',
  rival: '#ff5570',
  ash: 'rgba(140,155,180,0.13)',
  storm: 'rgba(255,70,70,0.09)',
  stormEdge: 'rgba(255,90,90,0.35)',
  ghostOk: 'rgba(120,255,190,0.85)',
  ghostBad: 'rgba(255,120,120,0.85)',
  flash: 'rgba(255,255,255,',
} as const

export interface Ghost {
  cells: Array<[number, number]>
  valid: boolean
}

export interface Flash {
  cells: Array<[number, number]>
  ttl: number
}

export function render(
  ctx: CanvasRenderingContext2D,
  duel: Duel,
  ghost: Ghost | null,
  flashes: Flash[],
): void {
  const s = duel.state
  const { width: w, height: h } = s.cfg

  ctx.fillStyle = COLORS.bg
  ctx.fillRect(0, 0, w * CELL, h * CELL)

  // Ash: alive last generation, dead now.
  ctx.fillStyle = COLORS.ash
  for (let i = 0; i < s.cells.length; i++) {
    if (s.cells[i] === 0 && s.prev[i] > 0) {
      ctx.fillRect((i % w) * CELL, Math.floor(i / w) * CELL, CELL - 1, CELL - 1)
    }
  }

  // Live cells.
  for (let f = 1; f <= 2; f++) {
    ctx.fillStyle = f === PLAYER ? COLORS.player : COLORS.rival
    for (let i = 0; i < s.cells.length; i++) {
      if (s.cells[i] === f) {
        ctx.fillRect((i % w) * CELL, Math.floor(i / w) * CELL, CELL - 1, CELL - 1)
      }
    }
  }

  // Entropy storm: shade the dead zone, stroke the safe rect.
  const inset = s.ringInset
  if (inset > 0) {
    ctx.fillStyle = COLORS.storm
    ctx.fillRect(0, 0, w * CELL, inset * CELL)
    ctx.fillRect(0, (h - inset) * CELL, w * CELL, inset * CELL)
    ctx.fillRect(0, inset * CELL, inset * CELL, (h - 2 * inset) * CELL)
    ctx.fillRect((w - inset) * CELL, inset * CELL, inset * CELL, (h - 2 * inset) * CELL)
    ctx.strokeStyle = COLORS.stormEdge
    ctx.lineWidth = 1
    ctx.strokeRect(
      inset * CELL + 0.5,
      inset * CELL + 0.5,
      (w - 2 * inset) * CELL - 1,
      (h - 2 * inset) * CELL - 1,
    )
  }

  // Placement ghost.
  if (ghost) {
    ctx.fillStyle = ghost.valid ? COLORS.ghostOk : COLORS.ghostBad
    ctx.globalAlpha = 0.6
    for (const [x, y] of ghost.cells) {
      if (x >= 0 && x < w && y >= 0 && y < h) {
        ctx.fillRect(x * CELL, y * CELL, CELL - 1, CELL - 1)
      }
    }
    ctx.globalAlpha = 1
  }

  // Placement flashes, decaying.
  for (const flash of flashes) {
    ctx.fillStyle = `${COLORS.flash}${(flash.ttl / 12) * 0.9})`
    for (const [x, y] of flash.cells) {
      ctx.fillRect(x * CELL, y * CELL, CELL - 1, CELL - 1)
    }
  }
}
