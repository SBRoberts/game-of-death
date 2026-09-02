/**
 * Canvas renderer — fluorescence microscopy treatment. Factions are
 * fluorophores on a dark slide: GFP-green player, mCherry-red rival, faint
 * DAPI-blue free radicals. Cells are round glowing puncta with a cheap two-pass
 * bloom; grain and a vignette sell the glass. The board is never React.
 */

import { ELDER, MARTYR, PLAYER, RIVAL, VAMPIRE, RADICALS, type Duel } from '../sim'
import type { Impact } from '../sim'

// Cell size is runtime state so the board can fill its container (HANDOFF §3).
// ESM live bindings keep every importer current; call setCell() only on
// layout changes, never per frame. Integer only — fractional cells fray puncta.
export let CELL = 8
export function setCell(n: number): void {
  CELL = n
}

export const COLORS = {
  bg: '#04060b',
  player: '#42f59b', // GFP
  rival: '#ff5340', // mCherry
  radicals: '#5f7dff', // DAPI
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
}

const FACTION_FILL: Record<number, string> = {
  [PLAYER]: COLORS.player,
  [RIVAL]: COLORS.rival,
  [RADICALS]: COLORS.radicals,
}

const BLOOM_RGB: Record<number, [number, number, number]> = {
  [PLAYER]: [66, 245, 155],
  [RIVAL]: [255, 83, 64],
  [RADICALS]: [95, 125, 255],
}

// ── faction palettes ───────────────────────────────────────────────────────
// Two real fluorophore pairs. 'gfp' is the default look; 'cfp' swaps the
// deuteranopia-hostile green/red pair for CFP-cyan vs YFP-amber (an actual
// FRET pair) and shifts the radicals to lavender so cyan/blue never collide.
export type PaletteMode = 'gfp' | 'cfp'
const PALETTES: Record<PaletteMode, { you: number[]; rival: number[]; radicals: number[] }> = {
  gfp: { you: [66, 245, 155], rival: [255, 83, 64], radicals: [95, 125, 255] },
  cfp: { you: [80, 205, 255], rival: [255, 178, 46], radicals: [158, 145, 224] },
}

export function setPalette(mode: PaletteMode): void {
  const p = PALETTES[mode]
  const rgb = (c: number[]) => `rgb(${c[0]},${c[1]},${c[2]})`
  const rgba = (c: number[], a: number) => `rgba(${c[0]},${c[1]},${c[2]},${a})`
  const lift = (c: number[]) => c.map((v) => Math.min(255, v + 70))
  COLORS.player = rgb(p.you)
  COLORS.rival = rgb(p.rival)
  COLORS.radicals = rgb(p.radicals)
  COLORS.ash[1] = rgba(p.you, 0.12)
  COLORS.ash[2] = rgba(p.rival, 0.12)
  COLORS.ash[3] = rgba(p.radicals, 0.09)
  COLORS.ghostOk = rgba(lift(p.you), 0.85)
  COLORS.ghostBad = rgba(lift(p.rival), 0.85)
  COLORS.foresightGain = rgba(p.you, 0.3)
  COLORS.foresightHit = rgba(p.rival, 0.45)
  FACTION_FILL[PLAYER] = COLORS.player
  FACTION_FILL[RIVAL] = COLORS.rival
  FACTION_FILL[RADICALS] = COLORS.radicals
  BLOOM_RGB[PLAYER] = p.you as [number, number, number]
  BLOOM_RGB[RIVAL] = p.rival as [number, number, number]
  BLOOM_RGB[RADICALS] = p.radicals as [number, number, number]
  GRADE_COLORS.good = rgb(p.you)
  GRADE_COLORS.great = rgb(lift(p.you))
  const root = document.documentElement.style
  root.setProperty('--you', COLORS.player)
  root.setProperty('--rival', COLORS.rival)
  root.setProperty('--dapi', COLORS.radicals)
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
  /** Placement evaluation, drawn beside the ghost where the eyes already are. */
  hint: { text: string; grade: 'poor' | 'fair' | 'good' | 'great' | null } | null
  /** Placement reach radius while a card is armed — draws the reach ring. */
  reach: number | null
}

// ── the reach ring (HANDOFF §4.2) ──────────────────────────────────────────
// The legal placement region, drawn as a boundary on the slide. Chebyshev
// dilation is separable: a horizontal distance sweep then a vertical one.
let reachMask: Uint8Array | null = null
let reachTmp: Uint8Array | null = null
let reachKey = ''

function computeReachMask(s: { cells: Uint8Array; gen: number; cfg: { width: number; height: number } }, radius: number, pop: number): Uint8Array {
  const w = s.cfg.width
  const h = s.cfg.height
  const n = w * h
  const key = `${s.gen}:${radius}:${pop}`
  if (reachMask && reachMask.length === n && reachKey === key) return reachMask
  reachKey = key
  if (!reachMask || reachMask.length !== n) {
    reachMask = new Uint8Array(n)
    reachTmp = new Uint8Array(n)
  }
  const tmp = reachTmp!
  const mask = reachMask
  const FAR = 1 << 20
  for (let y = 0; y < h; y++) {
    const base = y * w
    let run = FAR
    for (let x = 0; x < w; x++) {
      run = s.cells[base + x] === PLAYER ? 0 : run + 1
      tmp[base + x] = run <= radius ? 1 : 0
    }
    run = FAR
    for (let x = w - 1; x >= 0; x--) {
      run = s.cells[base + x] === PLAYER ? 0 : run + 1
      if (run <= radius) tmp[base + x] = 1
    }
  }
  for (let x = 0; x < w; x++) {
    let run = FAR
    for (let y = 0; y < h; y++) {
      run = tmp[y * w + x] === 1 ? 0 : run + 1
      mask[y * w + x] = run <= radius ? 1 : 0
    }
    run = FAR
    for (let y = h - 1; y >= 0; y--) {
      run = tmp[y * w + x] === 1 ? 0 : run + 1
      if (run <= radius) mask[y * w + x] = 1
    }
  }
  return mask
}

function drawReachRing(
  ctx: CanvasRenderingContext2D,
  s: { cells: Uint8Array; gen: number; cfg: { width: number; height: number }; pops: number[] },
  radius: number,
): void {
  const w = s.cfg.width
  const h = s.cfg.height
  const mask = computeReachMask(s, radius, s.pops[PLAYER])
  ctx.strokeStyle = COLORS.player
  ctx.globalAlpha = 0.28
  ctx.lineWidth = 1
  ctx.beginPath()
  let labelX = -1
  let labelY = 0
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (mask[y * w + x] !== 1) continue
      if (x > labelX) {
        labelX = x
        labelY = y
      }
      const px = x * CELL
      const py = y * CELL
      if (x === 0 || mask[y * w + x - 1] === 0) {
        ctx.moveTo(px + 0.5, py)
        ctx.lineTo(px + 0.5, py + CELL)
      }
      if (x === w - 1 || mask[y * w + x + 1] === 0) {
        ctx.moveTo(px + CELL - 0.5, py)
        ctx.lineTo(px + CELL - 0.5, py + CELL)
      }
      if (y === 0 || mask[(y - 1) * w + x] === 0) {
        ctx.moveTo(px, py + 0.5)
        ctx.lineTo(px + CELL, py + 0.5)
      }
      if (y === h - 1 || mask[(y + 1) * w + x] === 0) {
        ctx.moveTo(px, py + CELL - 0.5)
        ctx.lineTo(px + CELL, py + CELL - 0.5)
      }
    }
  }
  ctx.stroke()
  if (labelX >= 0) {
    ctx.globalAlpha = 0.5
    ctx.font = '600 9.5px ui-monospace, Menlo, monospace'
    ctx.textAlign = 'left'
    ctx.fillStyle = COLORS.player
    const tx = Math.min(labelX * CELL + CELL + 6, w * CELL - 70)
    ctx.fillText(`REACH ${radius}`, tx, labelY * CELL + 3)
  }
  ctx.globalAlpha = 1
}

// ── the graticule (HANDOFF §4.3) ───────────────────────────────────────────
// An eyepiece reticle ticked into the board's inner edge. Skipped when cells
// are too small for the ticks to stay distinct.
function graticule(ctx: CanvasRenderingContext2D, cellsWide: number, cellsHigh: number): void {
  if (CELL < 6) return
  const W = cellsWide * CELL
  const H = cellsHigh * CELL
  const off = 7
  ctx.strokeStyle = 'rgba(195,207,224,0.20)'
  ctx.lineWidth = 1
  ctx.beginPath()
  for (let x = 8; x < cellsWide; x += 8) {
    const len = x % 32 === 0 ? 7 : 3.5
    const px = Math.round(x * CELL) + 0.5
    ctx.moveTo(px, off)
    ctx.lineTo(px, off + len)
    ctx.moveTo(px, H - off)
    ctx.lineTo(px, H - off - len)
  }
  for (let y = 8; y < cellsHigh; y += 8) {
    const len = y % 32 === 0 ? 7 : 3.5
    const py = Math.round(y * CELL) + 0.5
    ctx.moveTo(off, py)
    ctx.lineTo(off + len, py)
    ctx.moveTo(W - off, py)
    ctx.lineTo(W - off - len, py)
  }
  ctx.stroke()
}

const GRADE_STEPS = { poor: 1, fair: 2, good: 3, great: 4 } as const
const GRADE_COLORS: Record<'poor' | 'fair' | 'good' | 'great', string> = {
  poor: '#98a2b5',
  fair: '#d7e3ff',
  good: '#42f59b',
  great: '#c6ff5e',
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
      const rgb = BLOOM_RGB[f] ?? BLOOM_RGB[RADICALS]
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

// ── the momentum frame ─────────────────────────────────────────────────────
// The board's border IS the territory gauge: your green grows outward from
// the center of the left edge, the rival's red from the center of the right,
// and the Free Radicals hold shimmering seams where the fronts would meet.
// The arcs flow around rounded corners, fade like fluorescence toward their
// tips, and carry a glowing frontline node that flares while you're gaining.
// At round end the frame finishes the story: all green, or all red.
let shownYou = 0.33
let shownRival = 0.33
let heatYou = 0
let heatRival = 0

interface FrameSeg {
  len: number
  at: (d: number) => [number, number]
}
let frameSegs: FrameSeg[] | null = null
let frameP = 0
let frameKey = ''

function buildFramePath(W: number, H: number): void {
  const c = 2.5 // stroke centerline inset
  const R = 12 // corner radius
  const vh = H / 2 - c - R // half vertical straight
  const hs = W - 2 * (c + R) // horizontal straight
  const vs = H - 2 * (c + R) // full vertical straight
  const q = (Math.PI * R) / 2
  const arc = (cx: number, cy: number, a0: number): FrameSeg => ({
    len: q,
    at: (d) => {
      const a = a0 + (d / q) * (Math.PI / 2)
      return [cx + R * Math.cos(a), cy + R * Math.sin(a)]
    },
  })
  // Clockwise from the left edge's center, heading up.
  frameSegs = [
    { len: vh, at: (d) => [c, H / 2 - d] },
    arc(c + R, c + R, Math.PI), // top-left
    { len: hs, at: (d) => [c + R + d, c] },
    arc(W - c - R, c + R, -Math.PI / 2), // top-right
    { len: vs, at: (d) => [W - c, c + R + d] },
    arc(W - c - R, H - c - R, 0), // bottom-right
    { len: hs, at: (d) => [W - c - R - d, H - c] },
    arc(c + R, H - c - R, Math.PI / 2), // bottom-left
    { len: vh, at: (d) => [c, H - c - R - d] },
  ]
  frameP = frameSegs.reduce((a, s) => a + s.len, 0)
}

function framePointAt(t: number): [number, number] {
  const segs = frameSegs
  if (!segs) return [0, 0]
  t = ((t % frameP) + frameP) % frameP
  for (const s of segs) {
    if (t <= s.len) return s.at(t)
    t -= s.len
  }
  return segs[segs.length - 1].at(segs[segs.length - 1].len)
}

/** One faction arc: chunked strokes with intensity falling off toward tips. */
function drawFactionArc(
  ctx: CanvasRenderingContext2D,
  center: number,
  half: number,
  color: string,
  heat: number,
): void {
  if (half < 2) return
  const chunks = Math.max(6, Math.min(28, Math.floor(half / 12)))
  for (let side = -1; side <= 1; side += 2) {
    for (let k = 0; k < chunks; k++) {
      const u0 = k / chunks
      const u1 = (k + 1) / chunks
      const fade = 1 - 0.55 * Math.pow((u0 + u1) / 2, 1.7)
      const t0 = center + side * half * u0
      const t1 = center + side * half * u1
      // glow pass then crisp pass
      ctx.strokeStyle = color
      ctx.lineCap = 'round'
      ctx.globalAlpha = 0.12 * fade
      ctx.lineWidth = 7.5
      strokePiece(ctx, t0, t1)
      ctx.globalAlpha = 0.95 * fade
      ctx.lineWidth = 3.2 - 1.1 * ((u0 + u1) / 2)
      strokePiece(ctx, t0, t1)
    }
  }
  ctx.globalAlpha = 1
  // Frontline nodes at both tips: brighter and larger while gaining ground.
  for (const side of [-1, 1]) {
    const [x, y] = framePointAt(center + side * half)
    const r = 2.4 + Math.min(2.2, heat)
    const g = ctx.createRadialGradient(x, y, 0.5, x, y, r * 3)
    g.addColorStop(0, color)
    g.addColorStop(1, 'rgba(0,0,0,0)')
    ctx.globalAlpha = 0.35 + Math.min(0.45, heat * 0.5)
    ctx.fillStyle = g
    ctx.beginPath()
    ctx.arc(x, y, r * 3, 0, Math.PI * 2)
    ctx.fill()
    ctx.globalAlpha = 1
    ctx.fillStyle = '#eafcff'
    ctx.beginPath()
    ctx.arc(x, y, r * 0.55, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = color
    ctx.beginPath()
    ctx.arc(x, y, r * 0.95, 0, Math.PI * 2)
    ctx.globalAlpha = 0.7
    ctx.fill()
    ctx.globalAlpha = 1
  }
}

function strokePiece(ctx: CanvasRenderingContext2D, t0: number, t1: number): void {
  const lo = Math.min(t0, t1)
  const hi = Math.max(t0, t1)
  ctx.beginPath()
  ctx.moveTo(...framePointAt(lo))
  const steps = Math.max(1, Math.ceil((hi - lo) / 6))
  for (let i = 1; i <= steps; i++) {
    ctx.lineTo(...framePointAt(lo + ((hi - lo) * i) / steps))
  }
  ctx.stroke()
}

function drawMomentumFrame(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  you: number,
  radicals: number,
  rival: number,
  now: number,
  status: 'running' | 'won' | 'lost',
): void {
  const key = `${W}x${H}`
  if (!frameSegs || frameKey !== key) {
    buildFramePath(W, H)
    frameKey = key
  }
  const total = you + radicals + rival
  // At round end the frame completes the story; mid-run it tracks territory.
  const targetYou = status === 'won' ? 1 : status === 'lost' ? 0 : total > 0 ? you / total : 0.33
  const targetRival =
    status === 'lost' ? 1 : status === 'won' ? 0 : total > 0 ? rival / total : 0.33
  const ease = status === 'running' ? 0.06 : 0.1
  heatYou = Math.max(0, heatYou * 0.94 + (targetYou - shownYou) * 26)
  heatRival = Math.max(0, heatRival * 0.94 + (targetRival - shownRival) * 26)
  shownYou += (targetYou - shownYou) * ease
  shownRival += (targetRival - shownRival) * ease

  const P = frameP
  const gh = (shownYou * P) / 2
  const rh = (shownRival * P) / 2
  const RC = P / 2 // right edge's center, by symmetry of the path

  // The Free Radical seams: unstable, drifting, DAPI-tinted.
  ctx.save()
  ctx.setLineDash([4, 6])
  ctx.lineDashOffset = -(now / 90)
  ctx.strokeStyle = COLORS.radicals
  ctx.lineWidth = 2
  ctx.globalAlpha = 0.7
  if (RC - rh - gh > 3) strokePiece(ctx, gh + 2, RC - rh - 2)
  if (P - gh - (RC + rh) > 3) strokePiece(ctx, RC + rh + 2, P - gh - 2)
  ctx.restore()

  drawFactionArc(ctx, 0, gh, COLORS.player, heatYou)
  drawFactionArc(ctx, RC, rh, COLORS.rival, heatRival)
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

  drawPuncta(ctx, s, w, RADICALS, COLORS.radicals, 0.8)
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
    ctx.fillStyle = COLORS.player
    ctx.globalAlpha = 0.62
    for (const i of impact.lasting) {
      ctx.fillRect((i % w) * CELL + 1, Math.floor(i / w) * CELL + 1, CELL - 3, CELL - 3)
    }
    ctx.globalAlpha = 1
    ctx.strokeStyle = 'rgba(235,245,255,0.7)'
    ctx.lineWidth = 1
    for (const i of impact.lasting) {
      ctx.strokeRect((i % w) * CELL + 0.5, Math.floor(i / w) * CELL + 0.5, CELL - 2, CELL - 2)
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

  // Reach ring: the legal ground, lit while a card is armed.
  if (fx.reach !== null && duel.status === 'running') {
    drawReachRing(ctx, s, fx.reach)
  }

  // The frame gauge draws over the glass so it always reads.
  drawMomentumFrame(ctx, W, H, s.pops[PLAYER], s.pops[RADICALS], s.pops[RIVAL], fx.now, duel.status)

  // The eyepiece graticule, ticked just inside the frame.
  graticule(ctx, w, h)

  // Cursor-side placement evaluation: the verdict lives where you're aiming.
  // Sized for reading, not squinting: 14px type, generous padding, an opaque
  // panel, and a grade row with fat pips.
  if (fx.hint && ghost) {
    const gx = Math.max(...ghost.cells.map(([x]) => x))
    const gy = Math.min(...ghost.cells.map(([, y]) => y))
    const grade = fx.hint.grade
    const font = 'bold 14px ui-monospace, Menlo, monospace'
    ctx.font = font
    ctx.textAlign = 'left'
    const gradeText = grade ? `${grade.toUpperCase()}` : ''
    const pips = grade ? '●'.repeat(GRADE_STEPS[grade]) + '○'.repeat(4 - GRADE_STEPS[grade]) : ''
    const textW = ctx.measureText(fx.hint.text).width
    const extraW = grade ? ctx.measureText(`${pips}  ${gradeText}`).width + 14 : 0
    const pad = 13
    const boxW = textW + extraW + pad * 2
    const boxH = 34
    let bx = (gx + 2.5) * CELL
    let by = (gy - 1) * CELL - boxH / 2
    if (bx + boxW > W - 6)
      bx = Math.max(6, (Math.min(...ghost.cells.map(([x]) => x)) - 2.5) * CELL - boxW)
    by = Math.min(Math.max(6, by), H - boxH - 6)
    ctx.fillStyle = 'rgba(7,10,16,0.97)'
    ctx.strokeStyle = grade ? GRADE_COLORS[grade] : 'rgba(255,150,120,0.8)'
    ctx.lineWidth = 1.5
    ctx.beginPath()
    ctx.roundRect(bx, by, boxW, boxH, 8)
    ctx.fill()
    ctx.stroke()
    const midY = by + boxH / 2 + 5
    ctx.fillStyle = grade ? '#dbe5f4' : '#ffb3a0'
    ctx.fillText(fx.hint.text, bx + pad, midY)
    if (grade) {
      ctx.fillStyle = GRADE_COLORS[grade]
      ctx.fillText(`${pips}  ${gradeText}`, bx + pad + textW + 14, midY)
    }
  }

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
