/**
 * Canvas renderer — fluorescence microscopy treatment. Factions are
 * fluorophores on a dark slide: GFP-green player, mCherry-red rival, faint
 * DAPI-blue wilds. Cells are round glowing puncta with a cheap two-pass
 * bloom; grain and a vignette sell the glass. The board is never React.
 */

import { ELDER, MARTYR, PLAYER, RIVAL, VAMPIRE, WILDS, type Duel } from '../sim'
import type { Impact } from '../sim'

export const CELL = 8

export const COLORS = {
  bg: '#04060b',
  player: '#42f59b', // GFP
  rival: '#ff5340', // mCherry
  wilds: '#5f7dff', // DAPI
  vampire: '#c46bff', // far-red
  elder: '#eafcff',
  martyr: '#ffd84a', // YFP
  ash: ['', 'rgba(66,245,155,0.12)', 'rgba(255,83,64,0.12)', 'rgba(95,125,255,0.09)'],
  storm: 'rgba(255,70,70,0.09)',
  ghostOk: 'rgba(140,255,190,0.85)',
  ghostBad: 'rgba(255,120,120,0.85)',
  foresightGain: 'rgba(66,245,155,0.30)',
  foresightHit: 'rgba(255,83,64,0.45)',
  arrow: 'rgba(235,245,255,0.55)',
  flash: 'rgba(255,255,255,',
} as const

const FACTION_FILL: Record<number, string> = {
  [PLAYER]: COLORS.player,
  [RIVAL]: COLORS.rival,
  [WILDS]: COLORS.wilds,
}

const BLOOM_RGB: Record<number, [number, number, number]> = {
  [PLAYER]: [66, 245, 155],
  [RIVAL]: [255, 83, 64],
  [WILDS]: [95, 125, 255],
}

export interface Ghost {
  cells: Array<[number, number]>
  valid: boolean
  dir?: [number, number]
  /** Show a 3×3 detonation zone around each cell (martyr). */
  blastZone?: boolean
}

export interface FloatText {
  x: number
  y: number
  text: string
  color: string
  ttl: number
  max: number
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
  maxR: number
  color: string
}

export interface Spark {
  x: number
  y: number
  ttl: number
  color: string
}

export interface FxState {
  pulses: Pulse[]
  sparks: Spark[]
  floats: FloatText[]
  hoverCell: { x: number; y: number } | null
  now: number
  stormFlash: number
}

// ── cached layers ──────────────────────────────────────────────────────────
let bloomCanvas: HTMLCanvasElement | null = null
let bloomImage: ImageData | null = null
let grain: CanvasPattern | null = null
let vignette: CanvasGradient | null = null
let vignetteKey = ''

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
  // Two upscale passes: a wide dim halo and a tighter hot one.
  ctx.globalAlpha = 0.22
  ctx.drawImage(bloomCanvas, -CELL, -CELL, (w + 2) * CELL, (h + 2) * CELL)
  ctx.globalAlpha = 0.4
  ctx.drawImage(bloomCanvas, 0, 0, w * CELL, h * CELL)
  ctx.restore()
}

function grainPattern(ctx: CanvasRenderingContext2D): CanvasPattern | null {
  if (grain) return grain
  const g = document.createElement('canvas')
  g.width = 96
  g.height = 96
  const gctx = g.getContext('2d')
  if (!gctx) return null
  const img = gctx.createImageData(96, 96)
  for (let i = 0; i < img.data.length; i += 4) {
    const v = 150 + Math.floor(Math.random() * 105)
    img.data[i] = v
    img.data[i + 1] = v
    img.data[i + 2] = v
    img.data[i + 3] = Math.random() < 0.5 ? 10 : 0
  }
  gctx.putImageData(img, 0, 0)
  grain = ctx.createPattern(g, 'repeat')
  return grain
}

/** One filled path of circles per faction — puncta, not pixels. */
function drawPuncta(
  ctx: CanvasRenderingContext2D,
  s: { cells: Uint8Array; types: Uint8Array },
  w: number,
  faction: number,
  color: string,
  alpha: number,
): void {
  ctx.fillStyle = color
  ctx.globalAlpha = alpha
  ctx.beginPath()
  const r = CELL / 2 - 0.5
  for (let i = 0; i < s.cells.length; i++) {
    if (s.cells[i] !== faction) continue
    const cx = (i % w) * CELL + CELL / 2
    const cy = Math.floor(i / w) * CELL + CELL / 2
    ctx.moveTo(cx + r, cy)
    ctx.arc(cx, cy, r, 0, Math.PI * 2)
  }
  ctx.fill()
  ctx.globalAlpha = 1
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
  const W = w * CELL
  const H = h * CELL

  ctx.fillStyle = COLORS.bg
  ctx.fillRect(0, 0, W, H)

  drawBloom(ctx, s.cells, w, h)

  // Photobleached remnants: alive last generation, dead now.
  for (let i = 0; i < s.cells.length; i++) {
    if (s.cells[i] === 0 && s.prev[i] > 0) {
      ctx.fillStyle = COLORS.ash[s.prev[i]] ?? COLORS.ash[3]
      ctx.fillRect((i % w) * CELL + 1, Math.floor(i / w) * CELL + 1, CELL - 2, CELL - 2)
    }
  }

  drawPuncta(ctx, s, w, WILDS, COLORS.wilds, 0.8)
  drawPuncta(ctx, s, w, RIVAL, COLORS.rival, 1)
  drawPuncta(ctx, s, w, PLAYER, COLORS.player, 1)

  // Special-cell nuclei — and the martyr's visible tripwire.
  for (let i = 0; i < s.types.length; i++) {
    const t = s.types[i]
    if (t === 0 || s.cells[i] === 0) continue
    const cx = (i % w) * CELL + CELL / 2
    const cy = Math.floor(i / w) * CELL + CELL / 2
    if (t === MARTYR) {
      const breathe = 0.14 + 0.08 * Math.sin(fx.now / 320 + i)
      ctx.strokeStyle = COLORS.martyr
      ctx.globalAlpha = breathe
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.arc(cx, cy, CELL * 1.45, 0, Math.PI * 2)
      ctx.stroke()
      ctx.globalAlpha = 1
    }
    if (t === VAMPIRE) {
      ctx.fillStyle = COLORS.vampire
      ctx.beginPath()
      ctx.arc(cx, cy, CELL / 2 + 0.5, 0, Math.PI * 2)
      ctx.fill()
      ctx.fillStyle = '#1a0b2e'
      ctx.beginPath()
      ctx.arc(cx, cy, CELL / 5, 0, Math.PI * 2)
      ctx.fill()
    } else {
      ctx.fillStyle = t === ELDER ? COLORS.elder : COLORS.martyr
      ctx.beginPath()
      ctx.arc(cx, cy, CELL / 4, 0, Math.PI * 2)
      ctx.fill()
    }
  }

  // Conversion sparks: a cell changing hands flares white-hot for a beat.
  for (const sp of fx.sparks) {
    ctx.globalAlpha = (sp.ttl / 8) * 0.85
    ctx.fillStyle = '#ffffff'
    ctx.beginPath()
    ctx.arc(sp.x * CELL + CELL / 2, sp.y * CELL + CELL / 2, CELL * 0.62, 0, Math.PI * 2)
    ctx.fill()
    ctx.globalAlpha = 1
  }

  // Entropy storm.
  const inset = s.ringInset
  if (inset > 0) {
    ctx.fillStyle = COLORS.storm
    ctx.fillRect(0, 0, W, inset * CELL)
    ctx.fillRect(0, H - inset * CELL, W, inset * CELL)
    ctx.fillRect(0, inset * CELL, inset * CELL, H - 2 * inset * CELL)
    ctx.fillRect(W - inset * CELL, inset * CELL, inset * CELL, H - 2 * inset * CELL)
    const pulse = 0.26 + 0.16 * Math.sin(fx.now / 260)
    ctx.strokeStyle = `rgba(255,90,90,${pulse.toFixed(3)})`
    ctx.lineWidth = 1
    ctx.strokeRect(
      inset * CELL + 0.5,
      inset * CELL + 0.5,
      W - 2 * inset * CELL - 1,
      H - 2 * inset * CELL - 1,
    )
  }
  if (fx.stormFlash > 0.01) {
    ctx.fillStyle = `rgba(255,60,60,${(fx.stormFlash * 0.22).toFixed(3)})`
    ctx.fillRect(0, 0, W, H)
  }

  // Foresight overlay: churn is faint; cells that SETTLE read solid — the
  // nucleus you're actually buying.
  if (impact) {
    const lasting = new Set(impact.lasting)
    ctx.fillStyle = COLORS.foresightGain
    for (const i of impact.gained) {
      if (lasting.has(i)) continue
      ctx.fillRect((i % w) * CELL + 1, Math.floor(i / w) * CELL + 1, CELL - 3, CELL - 3)
    }
    ctx.fillStyle = 'rgba(66,245,155,0.62)'
    for (const i of impact.lasting) {
      const x = (i % w) * CELL
      const y = Math.floor(i / w) * CELL
      ctx.fillRect(x + 1, y + 1, CELL - 3, CELL - 3)
      ctx.strokeStyle = 'rgba(200,255,225,0.7)'
      ctx.lineWidth = 1
      ctx.strokeRect(x + 0.5, y + 0.5, CELL - 2, CELL - 2)
    }
    ctx.fillStyle = COLORS.foresightHit
    for (const i of impact.destroyed) {
      ctx.fillRect((i % w) * CELL + 2, Math.floor(i / w) * CELL + 2, CELL - 5, CELL - 5)
    }
  }

  // Placement ghost + heading.
  if (ghost) {
    // Martyr detonation zone: the threat, visible before you commit.
    if (ghost.blastZone && ghost.valid) {
      ctx.strokeStyle = COLORS.martyr
      ctx.globalAlpha = 0.55
      ctx.setLineDash([3, 3])
      ctx.lineWidth = 1
      for (const [x, y] of ghost.cells) {
        ctx.strokeRect((x - 1) * CELL + 0.5, (y - 1) * CELL + 0.5, 3 * CELL - 1, 3 * CELL - 1)
      }
      ctx.setLineDash([])
      ctx.globalAlpha = 1
    }
    ctx.fillStyle = ghost.valid ? COLORS.ghostOk : COLORS.ghostBad
    ctx.globalAlpha = 0.6
    for (const [x, y] of ghost.cells) {
      if (x >= 0 && x < w && y >= 0 && y < h) {
        ctx.beginPath()
        ctx.arc(x * CELL + CELL / 2, y * CELL + CELL / 2, CELL / 2 - 0.5, 0, Math.PI * 2)
        ctx.fill()
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

  // Placement flashes.
  for (const flash of flashes) {
    ctx.fillStyle = `${COLORS.flash}${(flash.ttl / 12) * 0.9})`
    for (const [x, y] of flash.cells) {
      ctx.fillRect(x * CELL, y * CELL, CELL - 1, CELL - 1)
    }
  }

  // Expanding rings: placements and detonations.
  for (const p of fx.pulses) {
    const t = 1 - p.ttl / p.max
    ctx.strokeStyle = p.color
    ctx.globalAlpha = 0.7 * (1 - t)
    ctx.lineWidth = 1.5
    ctx.beginPath()
    ctx.arc(p.x * CELL, p.y * CELL, CELL * 0.8 + t * p.maxR, 0, Math.PI * 2)
    ctx.stroke()
    ctx.globalAlpha = 1
  }

  // Hover crosshair.
  if (fx.hoverCell && !ghost) {
    const { x, y } = fx.hoverCell
    if (x >= 0 && x < w && y >= 0 && y < h) {
      ctx.strokeStyle = 'rgba(230,240,255,0.28)'
      ctx.lineWidth = 1
      ctx.strokeRect(x * CELL + 0.5, y * CELL + 0.5, CELL - 2, CELL - 2)
    }
  }

  // The glass: grain, then vignette.
  const gp = grainPattern(ctx)
  if (gp) {
    ctx.fillStyle = gp
    ctx.fillRect(0, 0, W, H)
  }
  const vKey = `${W}x${H}`
  if (!vignette || vignetteKey !== vKey) {
    vignette = ctx.createRadialGradient(W / 2, H / 2, H * 0.42, W / 2, H / 2, H * 0.95)
    vignette.addColorStop(0, 'rgba(2,4,10,0)')
    vignette.addColorStop(1, 'rgba(2,4,10,0.5)')
    vignetteKey = vKey
  }
  ctx.fillStyle = vignette
  ctx.fillRect(0, 0, W, H)

  // Floating kill counts — drawn above the glass so they always read.
  for (const f of fx.floats) {
    const t = 1 - f.ttl / f.max
    ctx.globalAlpha = Math.min(1, f.ttl / (f.max * 0.4))
    ctx.fillStyle = f.color
    ctx.font = 'bold 11px ui-monospace, Menlo, monospace'
    ctx.textAlign = 'center'
    ctx.fillText(f.text, f.x * CELL, f.y * CELL - t * 14)
    ctx.globalAlpha = 1
  }
}
