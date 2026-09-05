/**
 * TURN-BASED DUEL SPIKE — disposable prototype (reach it at /?spike=1).
 *
 * Tests whether time-boxing resolution into committed turns makes EXPRESS
 * legible and produces a satisfying "spin". Reuses the real deterministic engine
 * (Duel: Conway + faction combat + the Chain) driven turn-by-turn.
 *
 * MOTION SYSTEM (kept intentional & consistent):
 *  - easings: ENTRANCE = confident decelerate; SETTLE = overshoot-and-land.
 *  - the reel runs steady then decelerates into its landing (ritardando), and
 *    hit-stops on every chain bank (bigger tier → longer freeze) — weight.
 *  - committing dims the chrome and spotlights the board (cinematic focus).
 *  - placement blooms; selection & buttons are tactile; the projection reads in
 *    a tooltip that glides with the cursor.
 */

import { useCallback, useEffect, useRef, useState, type CSSProperties, type MouseEvent } from 'react'
import { Duel, PLAYER, RIVAL, RADICALS, CHAIN_TIERS, projectImpact, type Impact } from '../../sim'

const W = 72
const H = 48
const TURNS = 8
const RESOLVE_GENS = 16 // one fixed resolution window (difficulty-for-reward lives in meta stakes, not here)
const PREVIEW = RESOLVE_GENS // the ghost previews exactly what resolves — WYSIWYG
const COLOR = ['#05070c', '#42f59b', '#ff5340', '#7f96ff']
// Faction emission colours. Additive compositing means green over red sums toward
// gold — contested ground warms on its own, no UI element.
const LUT: Array<[number, number, number] | null> = [null, [66, 245, 155], [255, 83, 64], [127, 150, 255]]

// Three aesthetic directions, selectable via ?look=  (default fluoro).
type Look = 'fluoro' | 'crt' | 'eyepiece'
const LOOK: Look =
  ((typeof location !== 'undefined' && (new URLSearchParams(location.search).get('look') as Look)) || 'fluoro')
const mixWhite = (v: number, t: number) => Math.round(v + (255 - v) * t)
const mixBlack = (v: number, t: number) => Math.round(v * (1 - t))
const rgb = (c: [number, number, number]) => `rgb(${c[0]},${c[1]},${c[2]})`

// ── Life-event animation (design language: "living culture on a lab CRT") ────
// Per-cell transition kinds detected by diffing the pre/post generation boards.
const EV_SURV = 0, EV_BORN = 1, EV_DIE_NAT = 2, EV_DIE_COMBAT = 3, EV_CONVERT = 4
const clamp01 = (t: number) => (t < 0 ? 0 : t > 1 ? 1 : t)
// The five shared curves — one motion vocabulary across every event.
const easeOutCubic = (t: number) => 1 - (1 - t) ** 3        // entrance / confident decel
const easeOutBack = (t: number) => { const s = 1.6; const u = t - 1; return 1 + (s + 1) * u ** 3 + s * u ** 2 } // settle overshoot
const easeInQuad = (t: number) => t * t                      // natural-death collapse
const easeOutQuint = (t: number) => 1 - (1 - t) ** 5         // fast-attack, long tail
const REDUCED = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches

/** Eyepiece reticle ticked into the board's inner edge (HANDOFF §4.3). */
function graticule(ctx: CanvasRenderingContext2D, boardW: number, boardH: number, cell: number) {
  const off = 7
  ctx.strokeStyle = 'rgba(195,207,224,0.20)'
  ctx.lineWidth = 1
  ctx.beginPath()
  for (let x = 8; x < W; x += 8) {
    const len = x % 32 === 0 ? 7 : 3.5
    const px = Math.round(x * cell) + 0.5
    ctx.moveTo(px, off); ctx.lineTo(px, off + len)
    ctx.moveTo(px, boardH - off); ctx.lineTo(px, boardH - off - len)
  }
  for (let y = 8; y < H; y += 8) {
    const len = y % 32 === 0 ? 7 : 3.5
    const py = Math.round(y * cell) + 0.5
    ctx.moveTo(off, py); ctx.lineTo(off + len, py)
    ctx.moveTo(boardW - off, py); ctx.lineTo(boardW - off - len, py)
  }
  ctx.stroke()
}
const TIER_SIZE = [26, 34, 46, 58, 70]
const TIER_COLOR = ['#ffd84a', '#ff9a3a', '#ff6a2a', '#ff4530', '#fff0e0']
const GRADE_COLOR: Record<string, string> = { A: '#42f59b', B: '#8affc4', C: '#e8c463', D: '#8391a8' }

function fitCell(): number {
  const availW = (typeof window !== 'undefined' ? window.innerWidth : 1200) - 48
  const availH = (typeof window !== 'undefined' ? window.innerHeight : 900) - 250
  return Math.max(7, Math.min(16, Math.floor(Math.min(availW / W, availH / H))))
}

function makeDuel(seed: string): Duel {
  const d = new Duel(
    seed,
    { width: W, height: H, radicalsCount: 14, startBiomass: 40, ringGrace: 200, aiActEvery: 12 },
    [{ key: 'vampire', level: 3 }],
    [],
    'founders',
    'founders',
  )
  d.hand[0] = 'vampire'
  return d
}

type Phase = 'deploy' | 'winding' | 'resolve' | 'settled' | 'over'
interface Callout { text: string; tier: number; id: number }
interface Score { dYou: number; kills: number; conv: number; tier: number }

export function TurnSpike() {
  const seedRef = useRef('spike-1')
  const duelRef = useRef<Duel>(makeDuel(seedRef.current))
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const reachRef = useRef<Uint8Array>(new Uint8Array(W * H))
  const timerRef = useRef<number>(0)
  const windRef = useRef<number>(0)
  const settleRef = useRef<number>(0)
  const rafRef = useRef<number>(0)
  const flashRef = useRef<{ cells: Array<[number, number]>; t0: number } | null>(null)
  const snapRef = useRef({ you: 0, kills: 0, conv: 0 })
  const lastingRef = useRef<number[]>([])
  const genRafRef = useRef<number>(0)
  // Life-event animation state — reused typed arrays, filled once per committed
  // generation (never per frame). `active` gates the interpolated render.
  const animRef = useRef({
    active: false, genStart: 0, D: 1,
    prev: new Uint8Array(W * H), kind: new Uint8Array(W * H), cause: new Uint8Array(W * H),
    delay: new Float32Array(W * H), cx: 0, cy: 0,
  })
  // Optics buffers — allocated once per board size, reused every frame.
  const opticsRef = useRef<{
    key: string
    bloom: HTMLCanvasElement; bloomB: HTMLCanvasElement; persist: HTMLCanvasElement; dust: HTMLCanvasElement
    noise: HTMLCanvasElement; hot: Array<[number, number, number]>
  } | null>(null)

  const [cell, setCell] = useState(fitCell())
  const [phase, setPhase] = useState<Phase>('deploy')
  const [turn, setTurn] = useState(1)
  const [sel, setSel] = useState<number | null>(null)
  const [rot, setRot] = useState(0)
  const [hover, setHover] = useState<{ x: number; y: number } | null>(null)
  const [proj, setProj] = useState<{ cells: Array<[number, number]>; valid: boolean; impact: Impact | null }>(
    { cells: [], valid: false, impact: null },
  )
  const [callout, setCallout] = useState<Callout | null>(null)
  const [wind, setWind] = useState(false)
  const [rivalTag, setRivalTag] = useState(false)
  const [score, setScore] = useState<Score | null>(null)
  const [, forceDraw] = useState(0)
  const redraw = useCallback(() => forceDraw((n) => n + 1), [])
  const boardW = W * cell
  const boardH = H * cell
  const dim = phase === 'winding' || phase === 'resolve' // focus-pull: recede the chrome during the spin

  useEffect(() => {
    const onResize = () => setCell(fitCell())
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  const computeReach = useCallback(() => {
    const d = duelRef.current
    const r = d.radii[PLAYER]
    const mask = new Uint8Array(W * H)
    const cells = d.state.cells
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        if (cells[y * W + x] !== PLAYER) continue
        for (let yy = Math.max(0, y - r); yy <= Math.min(H - 1, y + r); yy++)
          for (let xx = Math.max(0, x - r); xx <= Math.min(W - 1, x + r); xx++)
            mask[yy * W + xx] = 1
      }
    reachRef.current = mask
  }, [])

  useEffect(() => { computeReach() }, [computeReach])

  const firstAffordable = useCallback((): number | null => {
    const d = duelRef.current
    const i = d.hand.findIndex((id) => d.biomass[PLAYER] >= d.patternFor(PLAYER, id).cost)
    return i >= 0 ? i : null
  }, [])

  useEffect(() => {
    if (phase === 'deploy' && sel === null) setSel(firstAffordable())
  }, [phase, turn, sel, firstAffordable])

  // Diff the pre/post-tick boards into per-cell life-events. Combat vs natural
  // is a render-side heuristic (an enemy prev-neighbour) so the sim stays pure.
  const diffGen = useCallback(() => {
    const a = animRef.current, cells = duelRef.current.state.cells
    const { prev, kind, cause, delay } = a
    let sx = 0, sy = 0, n = 0
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const i = y * W + x, A = prev[i], B = cells[i]
        if (A === B) { kind[i] = EV_SURV; cause[i] = 0; continue }
        if (A === 0) { kind[i] = EV_BORN; cause[i] = B; continue }
        if (B === 0) {
          let e1 = 0, e2 = 0, e3 = 0
          for (let dy = -1; dy <= 1; dy++)
            for (let dx = -1; dx <= 1; dx++) {
              if (!dx && !dy) continue
              const xx = x + dx, yy = y + dy
              if (xx < 0 || xx >= W || yy < 0 || yy >= H) continue
              const nf = prev[yy * W + xx]
              if (nf > 0 && nf !== A) { if (nf === PLAYER) e1++; else if (nf === RIVAL) e2++; else e3++ }
            }
          if (e1 + e2 + e3 > 0) { kind[i] = EV_DIE_COMBAT; cause[i] = e1 >= e2 && e1 >= e3 ? PLAYER : e2 >= e3 ? RIVAL : RADICALS; sx += x; sy += y; n++ }
          else { kind[i] = EV_DIE_NAT; cause[i] = A }
          continue
        }
        kind[i] = EV_CONVERT; cause[i] = B; sx += x; sy += y; n++ // A>0,B>0,A!=B
      }
    a.cx = n ? sx / n : W / 2; a.cy = n ? sy / n : H / 2
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const i = y * W + x
        delay[i] = kind[i] === EV_SURV ? 0 : Math.min(0.15, Math.max(Math.abs(x - a.cx), Math.abs(y - a.cy)) * 0.02)
      }
  }, [])

  useEffect(() => {
    const d = duelRef.current
    if (phase !== 'deploy' || sel === null || !hover) { setProj({ cells: [], valid: false, impact: null }); return }
    const pattern = d.patternFor(PLAYER, d.hand[sel])
    const cells = d.patternCells(pattern, hover.x, hover.y, rot)
    const valid = d.ghostFor(PLAYER, d.hand[sel], hover.x, hover.y, rot).valid
    const impact = valid
      ? projectImpact(d.state, PLAYER, cells, PREVIEW, (g) => d.insetAt(g), pattern.cellType ?? 0)
      : null
    setProj({ cells, valid, impact })
  }, [phase, sel, rot, turn, hover])

  const buildOptics = useCallback((bW: number, bH: number) => {
    const key = `${bW}x${bH}`
    if (opticsRef.current?.key === key) return opticsRef.current
    const mk = (w: number, h: number) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c }
    const bloom = mk(bW, bH), bloomB = mk(bW, bH), persist = mk(bW, bH)
    // one static noise tile (grain)
    const noise = mk(128, 128)
    const nc = noise.getContext('2d')!, img = nc.createImageData(128, 128)
    for (let i = 0; i < img.data.length; i += 4) {
      const v = 128 + (Math.random() - 0.5) * 2 * 40
      img.data[i] = img.data[i + 1] = img.data[i + 2] = v; img.data[i + 3] = 255
    }
    nc.putImageData(img, 0, 0)
    let s = 0x2f6e2b1
    const rnd = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff)
    const hot: Array<[number, number, number]> = Array.from({ length: 11 }, () => [rnd(), rnd(), 0.4 + rnd() * 0.4])
    // eyepiece dust: seeded motes + coverslip lines, baked once
    const dust = mk(bW, bH), dc = dust.getContext('2d')!
    for (let i = 0; i < 44; i++) {
      const x = rnd() * bW, y = rnd() * bH, r = 2 + rnd() * 5, a = 0.05 + rnd() * 0.07
      const g = dc.createRadialGradient(x, y, 0, x, y, r)
      g.addColorStop(0, `rgba(${rnd() > 0.5 ? '210,200,180' : '180,200,220'},${a})`)
      g.addColorStop(1, 'rgba(0,0,0,0)')
      dc.fillStyle = g; dc.beginPath(); dc.arc(x, y, r, 0, Math.PI * 2); dc.fill()
    }
    for (let i = 0; i < 6; i++) { dc.fillStyle = 'rgba(10,14,20,0.5)'; dc.fillRect(rnd() * bW, rnd() * bH, 1, 1) }
    dc.strokeStyle = 'rgba(200,220,255,0.09)'; dc.lineWidth = 1
    dc.beginPath(); dc.moveTo(bW * 0.06, 0); dc.lineTo(bW * 0.12, bH); dc.stroke()
    opticsRef.current = { key, bloom, bloomB, persist, dust, noise, hot }
    return opticsRef.current
  }, [])

  // ── render — three selectable looks over a shared crisp-cell baseline ─────
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    canvas.width = boardW * dpr
    canvas.height = boardH * dpr
    const ctx = canvas.getContext('2d')!
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    const d = duelRef.current
    const cells = d.state.cells
    const opt = buildOptics(boardW, boardH)
    const C = cell
    const at = (x: number, y: number) => [x * C + C / 2, y * C + C / 2] as const
    const forEachLive = (fn: (x: number, y: number, f: number) => void) => {
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const f = cells[y * W + x]; if (f) fn(x, y, f) }
    }
    // life-event animation clock for this frame
    const anim = animRef.current
    const animOn = anim.active && phase === 'resolve'
    const p = animOn ? clamp01((performance.now() - anim.genStart) / anim.D) : 1
    const sub = (i: number, a: number, b: number) => (animOn ? clamp01((p - a - anim.delay[i]) / (b - a)) : 1)
    const PI2 = Math.PI * 2
    // one fluorescent cell (disc + brighter membrane + hot nucleus), scaled + faded
    const fluoroBody = (px: number, py: number, c: [number, number, number], scale: number, alpha: number) => {
      const rD = C * 0.4 * scale
      ctx.globalAlpha = 0.88 * alpha; ctx.fillStyle = rgb(c); ctx.beginPath(); ctx.arc(px, py, rD, 0, PI2); ctx.fill()
      ctx.globalAlpha = 0.9 * alpha; ctx.lineWidth = Math.max(1, C * 0.12 * scale)
      ctx.strokeStyle = `rgb(${Math.min(255, c[0] + 80)},${Math.min(255, c[1] + 80)},${Math.min(255, c[2] + 80)})`
      ctx.beginPath(); ctx.arc(px, py, rD, 0, PI2); ctx.stroke()
      ctx.globalAlpha = alpha; ctx.fillStyle = `rgb(${mixWhite(c[0], 0.65)},${mixWhite(c[1], 0.65)},${mixWhite(c[2], 0.65)})`
      ctx.beginPath(); ctx.arc(px, py, Math.max(1, C * 0.16 * scale), 0, PI2); ctx.fill()
      ctx.globalAlpha = 1
    }

    // ── FIELD ───────────────────────────────────────────────────────────────
    if (LOOK === 'crt') {
      const base = ctx.createRadialGradient(boardW / 2, boardH / 2, 0, boardW / 2, boardH / 2, boardW * 0.62)
      base.addColorStop(0, '#06170e'); base.addColorStop(1, '#030a06')
      ctx.fillStyle = base; ctx.fillRect(0, 0, boardW, boardH)
      const glow = ctx.createRadialGradient(boardW / 2, boardH / 2, 0, boardW / 2, boardH / 2, boardW * 0.55)
      glow.addColorStop(0, 'rgba(90,255,170,0.05)'); glow.addColorStop(1, 'rgba(0,0,0,0)')
      ctx.globalCompositeOperation = 'lighter'; ctx.fillStyle = glow; ctx.fillRect(0, 0, boardW, boardH)
      ctx.globalCompositeOperation = 'source-over'
      // oscilloscope grid every 8 cells
      ctx.strokeStyle = 'rgba(120,255,180,0.05)'; ctx.lineWidth = 1; ctx.beginPath()
      for (let x = 8; x < W; x += 8) { const px = Math.round(x * C) + 0.5; ctx.moveTo(px, 0); ctx.lineTo(px, boardH) }
      for (let y = 8; y < H; y += 8) { const py = Math.round(y * C) + 0.5; ctx.moveTo(0, py); ctx.lineTo(boardW, py) }
      ctx.stroke()
    } else if (LOOK === 'eyepiece') {
      const base = ctx.createRadialGradient(boardW * 0.47, boardH * 0.44, 0, boardW * 0.47, boardH * 0.44, boardW * 0.66)
      base.addColorStop(0, '#10161f'); base.addColorStop(0.6, '#0a0f18'); base.addColorStop(1, '#05070d')
      ctx.fillStyle = base; ctx.fillRect(0, 0, boardW, boardH)
      ctx.drawImage(opt.dust, 0, 0)
    } else { // fluoro
      ctx.fillStyle = '#05080d'; ctx.fillRect(0, 0, boardW, boardH)
      const kohler = ctx.createRadialGradient(boardW / 2, boardH * 0.44, 0, boardW / 2, boardH * 0.44, boardW * 0.6)
      kohler.addColorStop(0, 'rgba(30,50,70,0.06)'); kohler.addColorStop(1, 'rgba(0,0,0,0)')
      ctx.fillStyle = kohler; ctx.fillRect(0, 0, boardW, boardH)
    }

    // reach zone (deploy substrate)
    if (phase === 'deploy' && sel !== null) {
      ctx.fillStyle = 'rgba(66,245,155,0.07)'
      const mask = reachRef.current
      for (let y = 0; y < H; y++)
        for (let x = 0; x < W; x++)
          if (mask[y * W + x] && cells[y * W + x] === 0) ctx.fillRect(x * C, y * C, C, C)
    }

    // ── CORE-ONLY BLOOM (the baseline fix): sub-cell blur so halos never cross ─
    const bl = opt.bloom.getContext('2d')!, blb = opt.bloomB.getContext('2d')!
    bl.clearRect(0, 0, boardW, boardH)
    forEachLive((x, y, f) => {
      const [px, py] = at(x, y)
      bl.fillStyle = rgb(LUT[f]!); bl.globalAlpha = f === RADICALS ? 0.6 : 1
      bl.beginPath(); bl.arc(px, py, C * 0.18, 0, Math.PI * 2); bl.fill()
    })
    bl.globalAlpha = 1
    blb.clearRect(0, 0, boardW, boardH); blb.filter = `blur(${Math.max(2, C * 0.22)}px)`; blb.drawImage(opt.bloom, 0, 0); blb.filter = 'none'
    const drawBloom = (alpha: number) => { ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = alpha; ctx.drawImage(opt.bloomB, 0, 0); ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over' }

    // eyepiece: bloom sits UNDER the opaque cells
    if (LOOK === 'eyepiece') drawBloom(0.5)

    // ── CELLS (per look; every look keeps a hard dark gutter) ─────────────────
    if (LOOK === 'crt') {
      // P7 persistence ghost trails
      const pc = opt.persist.getContext('2d')!
      pc.globalCompositeOperation = 'source-over'; pc.fillStyle = 'rgba(3,12,7,0.35)'; pc.fillRect(0, 0, boardW, boardH)
      pc.globalCompositeOperation = 'lighter'
      forEachLive((x, y, f) => { pc.fillStyle = rgb(LUT[f]!); pc.globalAlpha = 0.5; pc.fillRect(x * C + C * 0.14, y * C + C * 0.14, C * 0.72, C * 0.72) })
      pc.globalAlpha = 1
      ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = 0.6; ctx.drawImage(opt.persist, 0, 0); ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over'
      // phosphor tiles
      const s2 = C * 0.78, o2 = (C - s2) / 2, rr = Math.min(2, C * 0.18)
      forEachLive((x, y, f) => {
        ctx.fillStyle = rgb(LUT[f]!); ctx.globalAlpha = 0.92
        ctx.beginPath(); ctx.roundRect(x * C + o2, y * C + o2, s2, s2, rr); ctx.fill()
      })
      ctx.globalAlpha = 1
      const s3 = C * 0.34, o3 = (C - s3) / 2
      ctx.globalCompositeOperation = 'lighter'
      forEachLive((x, y, f) => {
        const c = LUT[f]!; ctx.fillStyle = `rgb(${mixWhite(c[0], 0.6)},${mixWhite(c[1], 0.6)},${mixWhite(c[2], 0.6)})`
        ctx.beginPath(); ctx.roundRect(x * C + o3, y * C + o3, s3, s3, rr * 0.6); ctx.fill()
      })
      ctx.globalCompositeOperation = 'source-over'
    } else if (LOOK === 'eyepiece') {
      forEachLive((x, y, f) => {
        const c = LUT[f]!, [px, py] = at(x, y)
        ctx.fillStyle = rgb(c); ctx.beginPath(); ctx.arc(px, py, C * 0.42, 0, Math.PI * 2); ctx.fill()
        ctx.strokeStyle = `rgb(${mixBlack(c[0], 0.35)},${mixBlack(c[1], 0.35)},${mixBlack(c[2], 0.35)})`; ctx.lineWidth = Math.max(1, C * 0.12)
        ctx.beginPath(); ctx.arc(px, py, C * 0.42, 0, Math.PI * 2); ctx.stroke()
        ctx.fillStyle = `rgb(${mixWhite(c[0], 0.9)},${mixWhite(c[1], 0.9)},${mixWhite(c[2], 0.9)})`
        ctx.beginPath(); ctx.arc(px, py, C * 0.17, 0, Math.PI * 2); ctx.fill()
      })
    } else { // fluoro — animation-aware: survivors hold, changers move
      // DYING cells, drawn UNDER the living so regrowth overgrows the corpse
      if (animOn) {
        for (let y = 0; y < H; y++)
          for (let x = 0; x < W; x++) {
            const i = y * W + x, k = anim.kind[i], A = anim.prev[i]
            if (!A || (k !== EV_DIE_NAT && k !== EV_DIE_COMBAT)) continue
            const c = LUT[A]!, [px, py] = at(x, y)
            if (k === EV_DIE_NAT) { // starve: quiet accelerating collapse, no ring
              const u = sub(i, 0.05, 0.45), s = 1 - 0.85 * easeInQuad(u)
              const pale: [number, number, number] = [mixBlack(c[0], 0.3 * u), mixBlack(c[1], 0.3 * u), mixBlack(c[2], 0.3 * u)]
              fluoroBody(px, py, pale, s, 1 - u)
            } else { // lyse: flinch (swell) then burst
              const u = sub(i, 0.12, 0.45), s = u < 0.15 ? 1 + 1.7 * u : 1.25 * (1 - easeOutQuint((u - 0.15) / 0.85))
              fluoroBody(px, py, c, Math.max(0.02, s), 1 - easeOutQuint(u))
            }
          }
      }
      // LIVING cells (survivors + born + converted-to)
      forEachLive((x, y, f) => {
        const i = y * W + x, [px, py] = at(x, y), k = animOn ? anim.kind[i] : EV_SURV
        if (k === EV_BORN) { const u = easeOutCubic(sub(i, 0.20, 0.50)); fluoroBody(px, py, LUT[f]!, 0.35 + 0.65 * u, 0.4 + 0.6 * u) }
        else if (k === EV_CONVERT) { // hard A→B switch at the midpoint, small settle
          const u = sub(i, 0.15, 0.45), before = u < 0.5, face = before ? (anim.prev[i] || f) : f
          fluoroBody(px, py, LUT[face]!, before ? 1 : 0.9 + 0.1 * easeOutCubic((u - 0.5) / 0.5), 1)
        } else fluoroBody(px, py, LUT[f]!, 1, 1)
      })
    }

    // bloom over cells (fluoro / crt)
    if (LOOK !== 'eyepiece') drawBloom(LOOK === 'crt' ? 0.45 : 0.55)

    // ── LIFE-EVENT TRANSIENTS (additive; cause leads effect) ──────────────────
    if (animOn) {
      ctx.globalCompositeOperation = 'lighter'
      for (let y = 0; y < H; y++)
        for (let x = 0; x < W; x++) {
          const i = y * W + x, k = anim.kind[i]
          if (k === EV_SURV) continue
          const [px, py] = at(i % W, (i / W) | 0)
          if (k === EV_BORN) {
            const u = sub(i, 0.20, 0.70)
            // nucleus ignition pop
            if (u > 0 && u < 1) {
              const pu = u < 0.4 ? u / 0.4 : 1 - (u - 0.4) / 0.6, c = LUT[cells[i]]!
              ctx.globalAlpha = 0.9 * clamp01(pu); ctx.fillStyle = `rgb(${mixWhite(c[0], 0.9)},${mixWhite(c[1], 0.9)},${mixWhite(c[2], 0.9)})`
              ctx.beginPath(); ctx.arc(px, py, C * 0.14 * easeOutBack(clamp01(u * 1.4)), 0, PI2); ctx.fill()
            }
            // cytokinesis bridge to nearest same-faction parent (snaps at u≈0.8)
            if (u < 0.8) {
              const f = cells[i]
              let bx = 0, by = 0, found = false
              for (let dy = -1; dy <= 1 && !found; dy++) for (let dx = -1; dx <= 1; dx++) {
                if (!dx && !dy) continue; const xx = (i % W) + dx, yy = ((i / W) | 0) + dy
                if (xx < 0 || xx >= W || yy < 0 || yy >= H) continue
                if (anim.prev[yy * W + xx] === f) { bx = xx; by = yy; found = true; break }
              }
              if (found) {
                const [sx, syy] = at(bx, by), c = LUT[f]!
                ctx.globalAlpha = 0.6 * (1 - u / 0.8); ctx.strokeStyle = `rgb(${mixWhite(c[0], 0.6)},${mixWhite(c[1], 0.6)},${mixWhite(c[2], 0.6)})`; ctx.lineWidth = 1
                ctx.beginPath(); ctx.moveTo(sx, syy); ctx.lineTo(px, py); ctx.stroke()
              }
            }
          } else if (k === EV_DIE_COMBAT) {
            const ag = LUT[anim.cause[i]] || [255, 240, 214]
            // strike chord from the aggressor's side, first
            const su = sub(i, 0.0, 0.12)
            if (su < 1) {
              const ang = Math.atan2(py - anim.cy * C - C / 2, px - anim.cx * C - C / 2)
              ctx.globalAlpha = 0.85 * (1 - su); ctx.strokeStyle = rgb(ag as [number, number, number]); ctx.lineWidth = 1.25
              ctx.beginPath(); ctx.moveTo(px - Math.cos(ang) * C * 1.6 * (1 - su), py - Math.sin(ang) * C * 1.6 * (1 - su)); ctx.lineTo(px, py); ctx.stroke()
            }
            // aggressor-hued lyse ring blooming outward — the attribution beat
            const ru = sub(i, 0.15, 0.95)
            if (ru > 0 && ru < 1 && C >= 8) {
              ctx.globalAlpha = 0.8 * (1 - ru); ctx.strokeStyle = `rgb(${mixWhite(ag[0], 0.3)},${mixWhite(ag[1], 0.3)},${mixWhite(ag[2], 0.3)})`
              ctx.lineWidth = 1.5 * (1 - ru) + 0.3; ctx.beginPath(); ctx.arc(px, py, C * (0.4 + 1.2 * easeOutCubic(ru)), 0, PI2); ctx.stroke()
            }
          } else if (k === EV_CONVERT) {
            const fu = sub(i, 0.08, 0.30)
            if (fu < 1) { ctx.globalAlpha = 0.9 * (1 - fu); ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.arc(px, py, C * 0.3, 0, PI2); ctx.fill() }
          }
        }
      ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over'
    }

    // placement flash (part of the signal)
    if (flashRef.current) {
      const age = Math.min(1, (performance.now() - flashRef.current.t0) / 320), k = 1 - age
      ctx.globalCompositeOperation = 'lighter'
      for (const [cx, cy] of flashRef.current.cells) {
        const [px, py] = at(cx, cy), r2 = C * (0.5 + age * 1.3)
        const g = ctx.createRadialGradient(px, py, 0, px, py, r2)
        g.addColorStop(0, `rgba(255,255,255,${0.7 * k})`); g.addColorStop(1, 'rgba(255,255,255,0)')
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(px, py, r2, 0, Math.PI * 2); ctx.fill()
      }
      ctx.globalCompositeOperation = 'source-over'
    }

    // ── POST-FX (per look) ────────────────────────────────────────────────────
    const grain = ctx.createPattern(opt.noise, 'repeat')!
    if (LOOK === 'crt') {
      // aperture-grille vertical triad
      ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = 1
      for (let x = 0; x < boardW; x += 3) {
        ctx.fillStyle = 'rgba(255,70,70,0.05)'; ctx.fillRect(x, 0, 1, boardH)
        ctx.fillStyle = 'rgba(70,255,120,0.05)'; ctx.fillRect(x + 1, 0, 1, boardH)
        ctx.fillStyle = 'rgba(120,120,255,0.05)'; ctx.fillRect(x + 2, 0, 1, boardH)
      }
      ctx.globalCompositeOperation = 'source-over'
      // hard period-2 scanlines
      ctx.fillStyle = 'rgba(0,0,0,0.28)'
      for (let y = 0; y < boardH; y += 2) ctx.fillRect(0, y, boardW, 1)
      ctx.globalCompositeOperation = 'overlay'; ctx.globalAlpha = 0.05; ctx.fillStyle = grain; ctx.fillRect(0, 0, boardW, boardH)
      ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over'
    } else {
      // subtle scanlines
      if (C >= 7) { ctx.fillStyle = LOOK === 'eyepiece' ? 'rgba(0,0,0,0.10)' : 'rgba(0,0,0,0.16)'; for (let y = 0; y < boardH; y += 3) ctx.fillRect(0, y, boardW, 1) }
      ctx.globalCompositeOperation = 'overlay'; ctx.globalAlpha = LOOK === 'eyepiece' ? 0.06 : 0.05; ctx.fillStyle = grain; ctx.fillRect(0, 0, boardW, boardH)
      ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over'
      // hot pixels
      ctx.globalCompositeOperation = 'lighter'
      for (const [fx, fy, a] of opt.hot) { ctx.globalAlpha = a; ctx.fillStyle = '#dff3ff'; ctx.fillRect(Math.round(fx * boardW), Math.round(fy * boardH), 1, 1) }
      ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over'
    }

    // ── VIGNETTE / FIELD STOP ─────────────────────────────────────────────────
    if (LOOK === 'eyepiece') {
      // round eyepiece FOV biting the corners into brass shadow
      const cxp = boardW / 2, cyp = boardH / 2, Rap = 0.94 * Math.hypot(boardW, boardH) / 2
      const fov = ctx.createRadialGradient(cxp, cyp, Rap - C * 3, cxp, cyp, Rap + C * 2)
      fov.addColorStop(0, 'rgba(2,4,10,0)'); fov.addColorStop(0.7, 'rgba(2,4,10,0.7)'); fov.addColorStop(1, 'rgba(2,4,10,1)')
      ctx.fillStyle = fov; ctx.fillRect(0, 0, boardW, boardH)
    } else {
      const vig = ctx.createRadialGradient(boardW / 2, boardH / 2, boardH * 0.35, boardW / 2, boardH / 2, boardW * 0.62)
      vig.addColorStop(0, 'rgba(2,4,10,0)')
      vig.addColorStop(1, LOOK === 'crt' ? 'rgba(1,4,2,0.6)' : 'rgba(2,4,10,0.46)')
      ctx.fillStyle = vig; ctx.fillRect(0, 0, boardW, boardH)
    }

    // graticule reticle (crt draws its own grid in the field)
    if (cell >= 6 && LOOK !== 'crt') graticule(ctx, boardW, boardH, cell)

    // ── foresight / projection — LAST, UNBLURRED (plan drawn on the glass) ────
    const ring = (idx: number, color: string, wide = false, dash = false) => {
      const x = (idx % W) * cell + cell / 2
      const y = ((idx / W) | 0) * cell + cell / 2
      ctx.strokeStyle = color
      ctx.lineWidth = wide ? 2 : 1.25
      if (dash) ctx.setLineDash([3, 3])
      ctx.beginPath()
      ctx.arc(x, y, cell * 0.36, 0, Math.PI * 2)
      ctx.stroke()
      if (dash) ctx.setLineDash([])
    }

    if (phase === 'settled') for (const idx of lastingRef.current) ring(idx, 'rgba(66,245,155,0.75)', true)

    if (phase === 'deploy' && sel !== null && proj.cells.length) {
      if (proj.valid && proj.impact) {
        for (const idx of proj.impact.destroyed) ring(idx, 'rgba(255,83,64,0.85)', false, true)
        for (const idx of proj.impact.lasting) ring(idx, '#42f59b', true)
      }
      ctx.strokeStyle = proj.valid ? 'rgba(255,255,255,0.55)' : '#ff5340'
      ctx.lineWidth = 1.25
      for (const [cx, cy] of proj.cells) {
        if (cx < 0 || cx >= W || cy < 0 || cy >= H) continue
        ctx.beginPath()
        ctx.arc(cx * cell + cell / 2, cy * cell + cell / 2, cell * 0.36, 0, Math.PI * 2)
        ctx.stroke()
      }
    }
  })

  const cellFromEvent = (e: MouseEvent): { x: number; y: number } => {
    const rect = canvasRef.current!.getBoundingClientRect()
    return { x: Math.floor((e.clientX - rect.left) / cell), y: Math.floor((e.clientY - rect.top) / cell) }
  }

  const startFlash = (cells: Array<[number, number]>) => {
    flashRef.current = { cells, t0: performance.now() }
    const loop = () => {
      redraw()
      if (flashRef.current && performance.now() - flashRef.current.t0 < 320) rafRef.current = requestAnimationFrame(loop)
      else { flashRef.current = null; redraw() }
    }
    cancelAnimationFrame(rafRef.current)
    rafRef.current = requestAnimationFrame(loop)
  }

  const onClick = (e: MouseEvent) => {
    if (phase !== 'deploy' || sel === null) return
    const { x, y } = cellFromEvent(e)
    const d = duelRef.current
    if (!d.ghostFor(PLAYER, d.hand[sel], x, y, rot).valid) return
    const placed = d.playCard(sel, x, y, rot)
    if (placed) startFlash(placed)
    setSel(null)
    setRot(0)
    computeReach()
    redraw()
  }

  // ── resolve: wind-up ceremony → reel (ritardando + hit-stop) → scorecard ──
  const resolve = () => {
    if (phase !== 'deploy') return
    const d = duelRef.current
    lastingRef.current = proj.impact?.lasting ?? []
    snapRef.current = { you: d.state.pops[PLAYER], kills: d.state.combatDeaths[RIVAL], conv: d.summary.radicalsClaimed + d.summary.rivalConverted }
    setSel(null)
    setCallout(null)
    setHover(null)
    setWind(true)
    setPhase('winding')
    windRef.current = window.setTimeout(() => {
      setWind(false)
      setPhase('resolve')
      const banksBefore = d.bankedCombos.length
      let g = 0
      let prevRival = d.state.pops[RIVAL]
      let tagUntil = -1
      // Generation clock: each tick's transition plays over D ms (the reel's own
      // ritardando/hit-stop gap becomes the animation window — zero added latency).
      const step = () => {
        const a = animRef.current
        a.prev.set(d.state.cells) // pre-tick board
        d.tick()
        g++
        let freeze = 0
        if (d.bankedCombos.length > banksBefore) {
          const c = d.bankedCombos[d.bankedCombos.length - 1]
          setCallout((cur) => (cur && cur.tier > c.tier ? cur : { text: `${CHAIN_TIERS[c.tier]?.name ?? 'CHAIN'} +${Math.round(c.total)}`, tier: Math.max(0, c.tier), id: d.bankedCombos.length }))
          freeze = 130 + Math.max(0, c.tier) * 95 // hit-stop: bigger tier, longer freeze-frame
        }
        if (d.state.pops[RIVAL] > prevRival + 2) { setRivalTag(true); tagUntil = g + 2 }
        if (g >= tagUntil && rivalTag) setRivalTag(false)
        prevRival = d.state.pops[RIVAL]
        diffGen()
        const t = g / RESOLVE_GENS
        const decel = t > 0.66 ? ((t - 0.66) / 0.34) ** 2 * 165 : 0 // ritardando into the landing
        const D = REDUCED ? 0 : Math.min(340, Math.max(110, 52 + decel + freeze))
        a.genStart = performance.now(); a.D = Math.max(1, D); a.active = !REDUCED && D > 0
        const done = () => {
          a.active = false; redraw()
          if (g >= RESOLVE_GENS || d.status !== 'running') { setRivalTag(false); timerRef.current = window.setTimeout(finishReel, 320); return }
          timerRef.current = window.setTimeout(step, 0)
        }
        if (!a.active) { redraw(); done(); return }
        const frame = () => {
          redraw()
          if (performance.now() - a.genStart >= a.D) done()
          else genRafRef.current = requestAnimationFrame(frame)
        }
        genRafRef.current = requestAnimationFrame(frame)
      }
      timerRef.current = window.setTimeout(step, 90)
    }, 400)
  }

  const finishReel = () => {
    const d = duelRef.current
    if (d.status !== 'running' || turn >= TURNS) { concludeTurn(); return }
    const s = snapRef.current
    setScore({
      dYou: d.state.pops[PLAYER] - s.you,
      kills: d.state.combatDeaths[RIVAL] - s.kills,
      conv: d.summary.radicalsClaimed + d.summary.rivalConverted - s.conv,
      tier: callout?.tier ?? -1,
    })
    setPhase('settled')
    settleRef.current = window.setTimeout(concludeTurn, 1100) // patient: hold the payoff
  }

  const concludeTurn = () => {
    window.clearTimeout(settleRef.current)
    const d = duelRef.current
    setScore(null)
    if (d.status !== 'running') { setPhase('over'); return }
    if (turn >= TURNS) {
      const [p, r] = [d.state.pops[PLAYER], d.state.pops[RIVAL]]
      const kp = d.state.combatDeaths[RIVAL], kr = d.state.combatDeaths[PLAYER]
      const win = p !== r ? p > r : kp > kr
      d.forceEnd(win ? 'won' : 'lost')
      d.outcome = p !== r ? `Territory ${p} vs ${r}.` : `Even at ${p} — decided on kills ${kp} vs ${kr}.`
      setPhase('over')
      return
    }
    setTurn((t) => t + 1)
    setCallout(null)
    computeReach()
    setPhase('deploy')
  }

  const clearTimers = () => { window.clearTimeout(timerRef.current); window.clearTimeout(windRef.current); window.clearTimeout(settleRef.current); cancelAnimationFrame(rafRef.current); cancelAnimationFrame(genRafRef.current); animRef.current.active = false }
  useEffect(() => clearTimers, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (phase === 'settled' && (e.key === 'Enter' || e.key === ' ')) { concludeTurn(); return }
      if (phase !== 'deploy') return
      if (e.key >= '1' && e.key <= '3') setSel(Number(e.key) - 1)
      else if (e.key === 'r' || e.key === 'R') setRot((r) => (r + 1) % 4)
      else if (e.key === 'Enter' || e.key === ' ') resolve()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const restart = () => {
    clearTimers()
    flashRef.current = null
    seedRef.current = 'spike-' + Math.floor(performance.now() % 100000)
    duelRef.current = makeDuel(seedRef.current)
    setTurn(1); setSel(null); setRot(0); setCallout(null); setWind(false); setRivalTag(false); setScore(null); setHover(null); setPhase('deploy')
    computeReach(); redraw()
  }

  const d = duelRef.current
  const you = d.state.pops[PLAYER]
  const rival = d.state.pops[RIVAL]
  const s = d.summary
  const selName = sel !== null ? d.patternFor(PLAYER, d.hand[sel]).name : null
  const gradeOf = (imp: Impact) => {
    const g = imp.lasting.length + imp.destroyed.length * 2
    return g >= 10 ? 'A' : g >= 5 ? 'B' : g >= 2 ? 'C' : 'D'
  }
  const winType = d.status === 'won' ? (rival === 0 ? 'CLEARED' : 'DOMINANT') : you === 0 ? 'DEATH' : 'OUTGROWN'
  const tierC = callout ? TIER_COLOR[Math.min(4, callout.tier)] : '#ffd84a'
  const bio = Math.floor(d.biomass[PLAYER])

  // tooltip position (glides with the cursor, clamped to the board)
  const tip = hover && proj.valid && proj.impact
    ? { left: Math.min(hover.x * cell + cell * 1.4, boardW - 168), top: Math.max(6, hover.y * cell - cell * 2.6), g: gradeOf(proj.impact) }
    : null

  return (
    <div style={S.stage}>
      <style>{CSS}</style>
      <div style={{ ...S.hud, width: boardW, opacity: dim ? 0.4 : 1, transition: 'opacity .38s ease' }}>
        <span style={S.badge}>TURN {Math.min(turn, TURNS)}/{TURNS}</span>
        <span key={bio} style={{ ...S.big, display: 'inline-block', animation: 'numPulse .34s cubic-bezier(.34,1.56,.64,1)' }}>◈ {bio}</span>
        <span style={{ color: COLOR[1] }}>you {you}</span>
        <span style={{ color: '#5c6a80' }}>vs</span>
        <span style={{ color: COLOR[2] }}>rival {rival}</span>
        <span style={{ color: '#8391a8', fontSize: 12 }}>kills {d.state.combatDeaths[RIVAL]} · conv {s.radicalsClaimed + s.rivalConverted} · peak chain {Math.round(d.peakChain)}</span>
        <button className="spk-btn" style={S.ghostBtn} onClick={restart}>↺ new</button>
      </div>

      <div style={{ ...S.bar, width: boardW }}>
        <div style={{ width: `${(100 * you) / Math.max(1, you + rival)}%`, background: COLOR[1], transition: 'width .3s ease' }} />
        <div style={{ flex: 1, background: COLOR[2] }} />
      </div>

      <div style={{ ...S.boardWrap, width: boardW, height: boardH, boxShadow: dim ? '0 0 40px rgba(66,245,155,.06)' : undefined, animation: phase === 'resolve' ? 'spikeGlow 1.4s ease-in-out infinite' : undefined }}>
        <canvas
          ref={canvasRef}
          style={{ width: boardW, height: boardH, borderRadius: 8, cursor: phase === 'deploy' && sel !== null ? 'crosshair' : 'default' }}
          onClick={onClick}
          onMouseMove={(e) => {
            if (phase !== 'deploy' || sel === null) return
            const c = cellFromEvent(e)
            setHover((h) => (h && h.x === c.x && h.y === c.y ? h : c))
          }}
          onMouseLeave={() => setHover(null)}
        />

        {/* projection tooltip — reads next to the placement, glides with the cursor */}
        {phase === 'deploy' && tip && proj.impact && (
          <div style={{ ...S.tip, left: tip.left, top: tip.top }}>
            <span style={{ color: GRADE_COLOR[tip.g], fontWeight: 700 }}>{tip.g}</span>
            <span style={{ color: '#c3cfe0' }}>{selName}</span>
            <span style={{ color: COLOR[1] }}>+{proj.impact.lasting.length} settle</span>
            <span style={{ color: COLOR[2] }}>{proj.impact.destroyed.length} cleared</span>
          </div>
        )}

        {phase === 'resolve' && <div style={S.phaseTag}>◉ RESOLVING</div>}
        {rivalTag && <div style={S.rivalTag}>RIVAL DEPLOYS</div>}
        {wind && (
          <div style={{ ...S.placard, color: '#42f59b', textShadow: '0 0 34px rgba(66,245,155,.5)' }}>
            INCUBATE ×{RESOLVE_GENS}
          </div>
        )}
        {(phase === 'resolve' || phase === 'settled') && callout && (
          <div key={callout.id} style={{ ...S.callout, fontSize: TIER_SIZE[Math.min(4, callout.tier)], color: tierC, textShadow: `0 0 ${18 + callout.tier * 11}px ${tierC}`, animation: callout.tier >= 3 ? 'pop .34s cubic-bezier(.34,1.56,.64,1), shake .34s ease-in-out' : 'pop .34s cubic-bezier(.34,1.56,.64,1)' }}>
            {callout.text}
          </div>
        )}
        {phase === 'settled' && score && (
          <div style={S.scorecard}>
            <div style={{ fontSize: 12, letterSpacing: 3, color: '#8391a8' }}>TURN {turn} SETTLED</div>
            <div style={{ fontSize: 17, marginTop: 8 }}>
              <b style={{ color: score.dYou >= 0 ? COLOR[1] : COLOR[2] }}>{score.dYou >= 0 ? '+' : ''}{score.dYou} you</b>
              <span style={{ color: '#5c6a80' }}>  ·  </span>
              <span style={{ color: COLOR[2] }}>{score.kills} cleared</span>
              {score.conv > 0 && <span style={{ color: '#8affc4' }}>  ·  +{score.conv} converted</span>}
            </div>
            {score.tier >= 0 && <div style={{ marginTop: 6, color: TIER_COLOR[Math.min(4, score.tier)], fontWeight: 700 }}>{CHAIN_TIERS[score.tier]?.name}</div>}
            <div style={{ fontSize: 11, color: '#5c6a80', marginTop: 12 }}>click / space →</div>
          </div>
        )}
        {phase === 'over' && (
          <div style={S.overlay}>
            <div style={{ fontSize: 46, letterSpacing: 8, color: d.status === 'won' ? COLOR[1] : COLOR[2], textShadow: `0 0 44px ${d.status === 'won' ? 'rgba(66,245,155,.55)' : 'rgba(255,83,64,.55)'}` }}>
              {winType}
            </div>
            <div style={{ color: '#8391a8', marginTop: 10 }}>{d.outcome}</div>
            <button className="spk-btn" style={S.primary} onClick={restart}>NEW DUEL</button>
          </div>
        )}
      </div>

      {phase !== 'over' && (
        <div style={{ ...S.dock, width: boardW, opacity: dim ? 0.32 : 1, transition: 'opacity .38s ease', pointerEvents: dim ? 'none' : 'auto' }}>
          <div style={S.hand}>
            {d.hand.map((id, i) => {
              const p = d.patternFor(PLAYER, id)
              const afford = d.biomass[PLAYER] >= p.cost
              return (
                <button
                  key={i}
                  className="spk-card"
                  disabled={phase !== 'deploy' || !afford}
                  onClick={() => setSel(i)}
                  style={{ ...S.card, ...(sel === i ? S.cardSel : {}), borderLeft: `3px solid ${ROLE_COLOR[p.role] ?? '#1b2331'}`, opacity: afford ? 1 : 0.4 }}
                >
                  <span style={S.cardKey}>{i + 1}</span>
                  <span style={S.cardName}>{p.name}</span>
                  <span style={S.cardMeta}>◈ {p.cost} · {p.role}</span>
                </button>
              )
            })}
          </div>
          <div style={S.actions}>
            <span style={S.hint}>
              {phase === 'winding' ? 'committing…'
                : phase === 'resolve' ? 'watching the reel…'
                : phase === 'settled' ? 'front settled'
                : sel === null ? 'pick a card (1–3)'
                : 'hover the lit zone to preview · click to place · R rotates'}
            </span>
            <button className="spk-btn" style={S.resolve} disabled={phase !== 'deploy'} onClick={resolve}>
              INCUBATE · {RESOLVE_GENS}g ⏎<em style={S.sub}>run the culture forward</em>
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

const ROLE_COLOR: Record<string, string> = { bomb: '#ff5340', strike: '#ff8a70', grow: '#42f59b', hold: '#5b8cff', guard: '#3fd9d0' }

const CSS = `
@keyframes pop { 0% { transform: translateX(-50%) scale(.5); opacity: 0 } 60% { transform: translateX(-50%) scale(1.12); opacity: 1 } 100% { transform: translateX(-50%) scale(1) } }
@keyframes shake { 0%,100% { margin-left: 0 } 20% { margin-left: -5px } 60% { margin-left: 4px } 80% { margin-left: -2px } }
@keyframes spikeGlow { 0%,100% { box-shadow: 0 0 0 rgba(66,245,155,0) } 50% { box-shadow: 0 0 30px rgba(66,245,155,.24) } }
@keyframes placardIn { 0% { transform: translate(-50%,-50%) scale(.62); opacity: 0 } 62% { transform: translate(-50%,-50%) scale(1.06); opacity: 1 } 100% { transform: translate(-50%,-50%) scale(1) } }
@keyframes cardIn { 0% { transform: translate(-50%,-50%) scale(.8) translateY(8px); opacity: 0 } 100% { transform: translate(-50%,-50%) scale(1) translateY(0); opacity: 1 } }
@keyframes tipIn { 0% { opacity: 0; transform: translateY(5px) } 100% { opacity: 1; transform: translateY(0) } }
@keyframes numPulse { 0% { transform: scale(1.32) } 100% { transform: scale(1) } }
@keyframes overlayIn { 0% { opacity: 0 } 100% { opacity: 1 } }
.spk-card { transition: transform .16s cubic-bezier(.34,1.56,.64,1), box-shadow .22s ease, background .22s ease }
.spk-card:hover:not(:disabled) { transform: translateY(-2px) }
.spk-card:active:not(:disabled) { transform: translateY(-1px) scale(.99) }
.spk-btn { transition: transform .13s cubic-bezier(.34,1.56,.64,1), box-shadow .2s ease, filter .2s ease }
.spk-btn:hover:not(:disabled) { transform: translateY(-1px); filter: brightness(1.14) }
.spk-btn:active:not(:disabled) { transform: translateY(0) scale(.97) }
@media (prefers-reduced-motion: reduce) { *, *::before, *::after { animation-duration: .01ms !important; transition-duration: .01ms !important } }
`

const S: Record<string, CSSProperties> = {
  stage: { minHeight: '100vh', background: '#05070c', color: '#c3cfe0', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, padding: 16, fontFamily: 'ui-monospace, Menlo, monospace' },
  hud: { display: 'flex', alignItems: 'center', gap: 16, fontSize: 13 },
  badge: { fontWeight: 700, letterSpacing: 2, color: '#c3cfe0' },
  big: { fontSize: 20, fontWeight: 700, color: '#e8c463' },
  bar: { display: 'flex', height: 4, borderRadius: 2, overflow: 'hidden', background: '#0b0f16' },
  ghostBtn: { marginLeft: 'auto', background: 'transparent', color: '#8391a8', border: '1px solid #1b2331', borderRadius: 6, padding: '4px 10px', cursor: 'pointer' },
  boardWrap: { position: 'relative', border: '1px solid #1b2331', borderRadius: 8, lineHeight: 0, transition: 'box-shadow .38s ease' },
  tip: { position: 'absolute', display: 'flex', gap: 9, alignItems: 'center', padding: '5px 10px', fontSize: 12, lineHeight: 1.1, background: 'rgba(8,11,18,0.94)', border: '1px solid #1b2331', borderRadius: 7, whiteSpace: 'nowrap', pointerEvents: 'none', animation: 'tipIn .16s ease-out', transition: 'left .12s ease-out, top .12s ease-out', boxShadow: '0 6px 20px rgba(0,0,0,.4)' },
  phaseTag: { position: 'absolute', top: 12, left: 14, fontSize: 12, letterSpacing: 3, color: '#42f59b', pointerEvents: 'none' },
  rivalTag: { position: 'absolute', top: 12, right: 16, fontSize: 12, letterSpacing: 2, fontWeight: 700, color: '#ff5340', textShadow: '0 0 12px rgba(255,83,64,.6)', pointerEvents: 'none', animation: 'tipIn .16s ease-out' },
  placard: { position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', fontSize: 42, fontWeight: 700, letterSpacing: 5, lineHeight: 1.1, animation: 'placardIn .42s cubic-bezier(.16,1,.3,1)', pointerEvents: 'none' },
  callout: { position: 'absolute', top: 26, left: '50%', transform: 'translateX(-50%)', fontWeight: 700, letterSpacing: 3, lineHeight: 1.1, pointerEvents: 'none', whiteSpace: 'nowrap' },
  scorecard: { position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', textAlign: 'center', lineHeight: 1.5, padding: '20px 34px', borderRadius: 12, background: 'rgba(8,11,18,0.92)', border: '1px solid #1b2331', animation: 'cardIn .34s cubic-bezier(.16,1,.3,1)', boxShadow: '0 18px 50px rgba(0,0,0,.5)' },
  overlay: { position: 'absolute', inset: 0, background: 'rgba(5,7,12,0.5)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', lineHeight: 1.4, borderRadius: 8, animation: 'overlayIn .5s ease-out' },
  dock: { display: 'flex', flexDirection: 'column', gap: 8 },
  hand: { display: 'flex', gap: 10 },
  card: { flex: 1, display: 'flex', flexDirection: 'column', gap: 2, padding: '8px 12px', textAlign: 'left', background: '#0b0f16', border: '1px solid #1b2331', borderRadius: 10, color: '#c3cfe0', cursor: 'pointer', position: 'relative' },
  cardSel: { boxShadow: '0 0 18px rgba(66,245,155,.28)', background: '#101724' },
  cardKey: { position: 'absolute', top: 8, right: 10, fontSize: 10, color: '#45536b' },
  cardName: { fontWeight: 700, fontSize: 14 },
  cardMeta: { fontSize: 11, color: '#8391a8' },
  actions: { display: 'flex', alignItems: 'center', gap: 12 },
  hint: { fontSize: 12.5, color: '#8391a8', marginRight: 'auto' },
  resolve: { display: 'flex', flexDirection: 'column', alignItems: 'flex-start', padding: '8px 20px', background: 'rgba(66,245,155,.14)', border: '1px solid #42f59b', color: '#42f59b', borderRadius: 8, cursor: 'pointer', fontWeight: 700, letterSpacing: 1 },
  sub: { fontSize: 9.5, fontWeight: 400, fontStyle: 'normal', opacity: 0.75, letterSpacing: 0.2, marginTop: 2 },
  primary: { marginTop: 20, padding: '12px 24px', background: '#42f59b', border: 'none', color: '#05070c', borderRadius: 8, cursor: 'pointer', fontWeight: 700, letterSpacing: 2 },
}
