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
// Confocal LUT (per HANDOFF §4.0): each faction is a grayscale channel pseudo-
// coloured and SUMMED additively, so where green sits in red's PSF the sum warms
// toward gold — contested ground announces itself with no UI element.
const LUT: Array<[number, number, number] | null> = [null, [66, 245, 155], [255, 83, 64], [127, 150, 255]]
const CH_CORE_ALPHA = [0, 1, 1, 0.72] // radicals read dimmer
// PSF, in buffer-px (buffer is 2px/cell, upscaled → the rest of the PSF for free)
const WING_BLUR = 3.4
const CORE_BLUR = 0.85
const WING_ALPHA = 0.26

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
  // Optics buffers — allocated once, reused every frame (HANDOFF §10).
  const opticsRef = useRef<{
    src: HTMLCanvasElement; blur: HTMLCanvasElement
    noise: HTMLCanvasElement[]; hot: Array<[number, number, number]>
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

  const buildOptics = useCallback(() => {
    if (opticsRef.current) return opticsRef.current
    const mk = (w: number, h: number) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c }
    const src = mk(W * 2, H * 2)
    const blur = mk(W * 2, H * 2)
    // three pre-baked shot-noise tiles (Poisson-ish film grain, cycled)
    const noise = [0, 1, 2].map(() => {
      const c = mk(128, 128)
      const nc = c.getContext('2d')!
      const img = nc.createImageData(128, 128)
      for (let i = 0; i < img.data.length; i += 4) {
        const v = 128 + (Math.random() - 0.5) * 2 * 34
        img.data[i] = img.data[i + 1] = img.data[i + 2] = v
        img.data[i + 3] = 255
      }
      nc.putImageData(img, 0, 0)
      return c
    })
    // 11 seeded fixed hot pixels (fraction x, fraction y, alpha)
    let s = 0x2f6e2b1
    const rnd = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff)
    const hot: Array<[number, number, number]> = Array.from({ length: 11 }, () => [rnd(), rnd(), 0.4 + rnd() * 0.4])
    opticsRef.current = { src, blur, noise, hot }
    return opticsRef.current
  }, [])

  // ── render — the confocal optics pipeline (HANDOFF §4.0) ─────────────────
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
    const opt = buildOptics()
    const bw = W * 2, bh = H * 2

    // 1. background + faint linear illumination gradient
    ctx.fillStyle = '#05070d'
    ctx.fillRect(0, 0, boardW, boardH)
    const illum = ctx.createLinearGradient(0, 0, boardW, boardH)
    illum.addColorStop(0, 'rgba(30,44,66,0.16)')
    illum.addColorStop(0.5, 'rgba(22,32,50,0.06)')
    illum.addColorStop(1, 'rgba(30,44,66,0.14)')
    ctx.fillStyle = illum
    ctx.fillRect(0, 0, boardW, boardH)

    // reach zone (illuminated substrate; drawn under the signal so puncta glow over it)
    if (phase === 'deploy' && sel !== null) {
      ctx.fillStyle = 'rgba(66,245,155,0.08)'
      const mask = reachRef.current
      for (let y = 0; y < H; y++)
        for (let x = 0; x < W; x++)
          if (mask[y * W + x] && cells[y * W + x] === 0) ctx.fillRect(x * cell, y * cell, cell, cell)
    }

    // 2. per channel (radicals → rival → player): PSF wings then core, additive
    const sctx = opt.src.getContext('2d')!
    const bctx = opt.blur.getContext('2d')!
    ctx.imageSmoothingEnabled = true
    for (const f of [RADICALS, RIVAL, PLAYER]) {
      const [r, g, b] = LUT[f]!
      sctx.clearRect(0, 0, bw, bh)
      sctx.fillStyle = `rgb(${r},${g},${b})`
      for (let y = 0; y < H; y++)
        for (let x = 0; x < W; x++)
          if (cells[y * W + x] === f) sctx.fillRect(x * 2, y * 2, 2, 2)
      ctx.globalCompositeOperation = 'lighter'
      // wings
      bctx.clearRect(0, 0, bw, bh); bctx.filter = `blur(${WING_BLUR}px)`; bctx.drawImage(opt.src, 0, 0); bctx.filter = 'none'
      ctx.globalAlpha = WING_ALPHA
      ctx.drawImage(opt.blur, 0, 0, boardW, boardH)
      // core
      bctx.clearRect(0, 0, bw, bh); bctx.filter = `blur(${CORE_BLUR}px)`; bctx.drawImage(opt.src, 0, 0); bctx.filter = 'none'
      ctx.globalAlpha = CH_CORE_ALPHA[f]
      ctx.drawImage(opt.blur, 0, 0, boardW, boardH)
    }
    ctx.globalAlpha = 1

    // 3. clipping — saturated cores read white where a faction crowds itself
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const f = cells[y * W + x]
        if (!f) continue
        let n = 0
        for (let dy = -1; dy <= 1; dy++)
          for (let dx = -1; dx <= 1; dx++) {
            if (!dx && !dy) continue
            const xx = x + dx, yy = y + dy
            if (xx >= 0 && xx < W && yy >= 0 && yy < H && cells[yy * W + xx] === f) n++
          }
        if (n < 4) continue
        const [r, g, b] = LUT[f]!
        const w = 0.72
        ctx.fillStyle = `rgb(${Math.round(r + (255 - r) * w)},${Math.round(g + (255 - g) * w)},${Math.round(b + (255 - b) * w)})`
        ctx.globalAlpha = f === RADICALS ? 0.3 : 0.55
        ctx.beginPath()
        ctx.arc(x * cell + cell / 2, y * cell + cell / 2, cell * 0.3, 0, Math.PI * 2)
        ctx.fill()
      }
    ctx.globalAlpha = 1

    // placement bloom — a weighty flash where a card just dropped (part of the signal)
    if (flashRef.current) {
      const age = Math.min(1, (performance.now() - flashRef.current.t0) / 320)
      const k = 1 - age
      for (const [cx, cy] of flashRef.current.cells) {
        const px = cx * cell + cell / 2, py = cy * cell + cell / 2, rr = cell * (0.5 + age * 1.3)
        const bloom = ctx.createRadialGradient(px, py, 0, px, py, rr)
        bloom.addColorStop(0, `rgba(255,255,255,${0.7 * k})`)
        bloom.addColorStop(1, 'rgba(255,255,255,0)')
        ctx.fillStyle = bloom
        ctx.beginPath(); ctx.arc(px, py, rr, 0, Math.PI * 2); ctx.fill()
      }
    }
    ctx.globalCompositeOperation = 'source-over'

    // 4. shot noise — signal-tracking grain, tiled + cycled
    const tile = opt.noise[(performance.now() / 90 | 0) % 3]
    const pat = ctx.createPattern(tile, 'repeat')!
    ctx.globalCompositeOperation = 'overlay'; ctx.globalAlpha = 0.13; ctx.fillStyle = pat; ctx.fillRect(0, 0, boardW, boardH)
    ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = 0.035; ctx.fillRect(0, 0, boardW, boardH)
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over'

    // 5. hot pixels
    ctx.globalCompositeOperation = 'lighter'
    for (const [fx, fy, a] of opt.hot) {
      ctx.globalAlpha = a; ctx.fillStyle = '#dff3ff'
      ctx.fillRect(Math.round(fx * boardW), Math.round(fy * boardH), 1, 1)
    }
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over'

    // 6. vignette
    const vig = ctx.createRadialGradient(boardW / 2, boardH / 2, boardH * 0.35, boardW / 2, boardH / 2, boardW * 0.62)
    vig.addColorStop(0, 'rgba(2,4,10,0)')
    vig.addColorStop(1, 'rgba(2,4,10,0.46)')
    ctx.fillStyle = vig
    ctx.fillRect(0, 0, boardW, boardH)

    // 8. graticule (reticle) — after the field, before the crisp overlay
    if (cell >= 6) graticule(ctx, boardW, boardH, cell)

    // 9. foresight / projection — LAST, UNBLURRED (plan drawn on the glass)
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
      const stepOnce = () => {
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
        redraw()
        if (g >= RESOLVE_GENS || d.status !== 'running') {
          setRivalTag(false)
          timerRef.current = window.setTimeout(finishReel, 320) // let the final board land before the payoff
          return
        }
        const t = g / RESOLVE_GENS
        const decel = t > 0.66 ? ((t - 0.66) / 0.34) ** 2 * 165 : 0 // ritardando into the landing
        timerRef.current = window.setTimeout(stepOnce, 52 + decel + freeze)
      }
      timerRef.current = window.setTimeout(stepOnce, 90)
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

  const clearTimers = () => { window.clearTimeout(timerRef.current); window.clearTimeout(windRef.current); window.clearTimeout(settleRef.current); cancelAnimationFrame(rafRef.current) }
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
