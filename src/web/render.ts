/**
 * Canvas renderer. The board is never React — one canvas, redrawn per frame.
 * The sim's prev-generation buffer gives us free one-gen "ash" trails.
 */

import { PLAYER, RIVAL, WILDS, type Duel } from '../sim'
import type { Impact } from '../sim'

export const CELL = 8

export const COLORS = {
  bg: '#0a0d12',
  player: '#3ce8c8',
  rival: '#ff5570',
  wilds: '#7c889c',
  ash: ['', 'rgba(60,232,200,0.13)', 'rgba(255,85,112,0.13)', 'rgba(140,155,180,0.10)'],
  storm: 'rgba(255,70,70,0.09)',
  stormEdge: 'rgba(255,90,90,0.35)',
  ghostOk: 'rgba(120,255,190,0.85)',
  ghostBad: 'rgba(255,120,120,0.85)',
  foresightGain: 'rgba(60,232,200,0.30)',
  foresightHit: 'rgba(255,85,112,0.45)',
  arrow: 'rgba(230,240,255,0.55)',
  flash: 'rgba(255,255,255,',
} as const

const FACTION_FILL: Record<number, string> = {
  [PLAYER]: COLORS.player,
  [RIVAL]: COLORS.rival,
  [WILDS]: COLORS.wilds,
}

export interface Ghost {
  cells: Array<[number, number]>
  valid: boolean
  /** Travel heading in board units, already rotated; drawn as an arrow. */
  dir?: [number, number]
}

export interface Flash {
  cells: Array<[number, number]>
  ttl: number
}

export interface Pulse {
  x: number
  y: number
  ttl: number
  max: number
}

export interface FxState {
  pulses: Pulse[]
  hoverCell: { x: number; y: number } | null
  now: number
  /** 0..1 red vignette when the storm first bites. */
  stormFlash: number
}

// Cheap bloom: live cells rendered 1px each into an offscreen buffer, then
// upscaled with smoothing under the crisp pass — a soft phosphor halo.
let bloomCanvas: HTMLCanvasElement | null = null
let bloomImage: ImageData | null = null
const BLOOM_RGB: Record<number, [number, number, number]> = {
  [PLAYER]: [60, 232, 200],
  [RIVAL]: [255, 85, 112],
  [WILDS]: [124, 136, 156],
}

function drawBloom(ctx: CanvasRenderingContext2D, cells: Uint8Array, w: number, h: number): void {
  if (!bloomCanvas || bloomCanvas.width !== w || bloomCanvas.height !== h) {
    bloomCanvas = document.createElement('canvas')
    bloomCanvas.width = w
    bloomCanvas.height = h
    bloomImage = null
  }
  const bctx = bloomCanvas.getContext('2d')
  if (!bctx) return
  bloomImage ??= bctx.createImageData(w, h)
  const px = bloomImage.data
  px.fill(0)
  for (let i = 0; i < cells.length; i++) {
    const f = cells[i]
    if (f > 0) {
      const rgb = BLOOM_RGB[f] ?? BLOOM_RGB[WILDS]
      const o = i * 4
      px[o] = rgb[0]
      px[o + 1] = rgb[1]
      px[o + 2] = rgb[2]
      px[o + 3] = 255
    }
  }
  bctx.putImageData(bloomImage, 0, 0)
  ctx.save()
  ctx.imageSmoothingEnabled = true
  ctx.globalAlpha = 0.42
  ctx.drawImage(bloomCanvas, 0, 0, w * CELL, h * CELL)
  ctx.restore()
}

export function render(
  ctx: CanvasRenderingContext2D,
  duel: Duel,
  ghost: Ghost | null,
  impact: Impact | null,
  flashes: Flash[],
  fx: FxState,
): void {
  const s = duel.state
  const { width: w, height: h } = s.cfg

  ctx.fillStyle = COLORS.bg
  ctx.fillRect(0, 0, w * CELL, h * CELL)

  drawBloom(ctx, s.cells, w, h)

  // Ash: alive last generation, dead now — tinted by who died there.
  for (let i = 0; i < s.cells.length; i++) {
    if (s.cells[i] === 0 && s.prev[i] > 0) {
      ctx.fillStyle = COLORS.ash[s.prev[i]] ?? COLORS.ash[3]
      ctx.fillRect((i % w) * CELL, Math.floor(i / w) * CELL, CELL - 1, CELL - 1)
    }
  }

  // Live cells.
  for (let i = 0; i < s.cells.length; i++) {
    const f = s.cells[i]
    if (f > 0) {
      ctx.fillStyle = FACTION_FILL[f] ?? COLORS.wilds
      ctx.fillRect((i % w) * CELL, Math.floor(i / w) * CELL, CELL - 1, CELL - 1)
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
    // Breathing storm boundary.
    const pulse = 0.26 + 0.16 * Math.sin(fx.now / 260)
    ctx.strokeStyle = `rgba(255,90,90,${pulse.toFixed(3)})`
    ctx.lineWidth = 1
    ctx.strokeRect(
      inset * CELL + 0.5,
      inset * CELL + 0.5,
      (w - 2 * inset) * CELL - 1,
      (h - 2 * inset) * CELL - 1,
    )
  }

  // Red vignette flash when the storm first bites.
  if (fx.stormFlash > 0.01) {
    ctx.fillStyle = `rgba(255,60,60,${(fx.stormFlash * 0.22).toFixed(3)})`
    ctx.fillRect(0, 0, w * CELL, h * CELL)
  }

  // Foresight: the causal diff of the hovered placement, N generations out.
  if (impact) {
    ctx.fillStyle = COLORS.foresightGain
    for (const i of impact.gained) {
      ctx.fillRect((i % w) * CELL + 1, Math.floor(i / w) * CELL + 1, CELL - 3, CELL - 3)
    }
    ctx.fillStyle = COLORS.foresightHit
    for (const i of impact.destroyed) {
      const x = (i % w) * CELL
      const y = Math.floor(i / w) * CELL
      ctx.fillRect(x + 2, y + 2, CELL - 5, CELL - 5)
    }
  }

  // Placement ghost + travel heading.
  if (ghost) {
    ctx.fillStyle = ghost.valid ? COLORS.ghostOk : COLORS.ghostBad
    ctx.globalAlpha = 0.6
    for (const [x, y] of ghost.cells) {
      if (x >= 0 && x < w && y >= 0 && y < h) {
        ctx.fillRect(x * CELL, y * CELL, CELL - 1, CELL - 1)
      }
    }
    ctx.globalAlpha = 1
    if (ghost.dir && ghost.valid) {
      const cx = (ghost.cells.reduce((a, [x]) => a + x, 0) / ghost.cells.length + 0.5) * CELL
      const cy = (ghost.cells.reduce((a, [, y]) => a + y, 0) / ghost.cells.length + 0.5) * CELL
      const len = 4.5 * CELL
      const mag = Math.hypot(ghost.dir[0], ghost.dir[1]) || 1
      const dx = (ghost.dir[0] / mag) * len
      const dy = (ghost.dir[1] / mag) * len
      ctx.strokeStyle = COLORS.arrow
      ctx.fillStyle = COLORS.arrow
      ctx.lineWidth = 1.5
      ctx.beginPath()
      ctx.moveTo(cx, cy)
      ctx.lineTo(cx + dx, cy + dy)
      ctx.stroke()
      const a = Math.atan2(dy, dx)
      ctx.beginPath()
      ctx.moveTo(cx + dx, cy + dy)
      ctx.lineTo(cx + dx - 7 * Math.cos(a - 0.45), cy + dy - 7 * Math.sin(a - 0.45))
      ctx.lineTo(cx + dx - 7 * Math.cos(a + 0.45), cy + dy - 7 * Math.sin(a + 0.45))
      ctx.closePath()
      ctx.fill()
    }
  }

  // Placement flashes, decaying.
  for (const flash of flashes) {
    ctx.fillStyle = `${COLORS.flash}${(flash.ttl / 12) * 0.9})`
    for (const [x, y] of flash.cells) {
      ctx.fillRect(x * CELL, y * CELL, CELL - 1, CELL - 1)
    }
  }

  // Placement pulses: an expanding ring from the seed site.
  for (const p of fx.pulses) {
    const t = 1 - p.ttl / p.max
    ctx.strokeStyle = `rgba(60,232,200,${(0.55 * (1 - t)).toFixed(3)})`
    ctx.lineWidth = 1.5
    ctx.beginPath()
    ctx.arc(p.x * CELL, p.y * CELL, CELL * (0.8 + t * 3.4), 0, Math.PI * 2)
    ctx.stroke()
  }

  // Hover crosshair cell when nothing is selected — the board answers touch.
  if (fx.hoverCell && !ghost) {
    const { x, y } = fx.hoverCell
    if (x >= 0 && x < w && y >= 0 && y < h) {
      ctx.strokeStyle = 'rgba(230,240,255,0.28)'
      ctx.lineWidth = 1
      ctx.strokeRect(x * CELL + 0.5, y * CELL + 0.5, CELL - 2, CELL - 2)
    }
  }
}
