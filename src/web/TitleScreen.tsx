import { useEffect, useRef, useState } from 'react'
import { sfx } from './audio'

/**
 * The title screen — "FIRST LIGHT".
 *
 * A microscope rack-focus pulls the game's name out of chromatic-fringed blur
 * into razor GFP puncta, spelled in living cells on a real B3/S23 board. Then
 * the specimen simply lives: the title boils on a self-healing substrate while
 * a sparse green-vs-red war drifts around it, and the cursor is a pipette that
 * seeds glowing life. One canvas, additive fluorescence bloom, no assets.
 * Inherits nothing but the palette; respects prefers-reduced-motion.
 */

// 5×7 cell font — just the glyphs "THE GAME OF DEATH" needs.
const FONT: Record<string, string[]> = {
  T: ['11111', '00100', '00100', '00100', '00100', '00100', '00100'],
  H: ['10001', '10001', '10001', '11111', '10001', '10001', '10001'],
  E: ['11111', '10000', '10000', '11110', '10000', '10000', '11111'],
  G: ['01110', '10001', '10000', '10111', '10001', '10001', '01111'],
  A: ['01110', '10001', '10001', '11111', '10001', '10001', '10001'],
  M: ['10001', '11011', '10101', '10101', '10001', '10001', '10001'],
  O: ['01110', '10001', '10001', '10001', '10001', '10001', '01110'],
  F: ['11111', '10000', '10000', '11110', '10000', '10000', '10000'],
  D: ['11110', '10001', '10001', '10001', '10001', '10001', '11110'],
  ' ': ['00000', '00000', '00000', '00000', '00000', '00000', '00000'],
}

// Fluorescence palette (GFP / mCherry / DAPI).
const GFP = [66, 245, 155] as const // your colony — life, the hero
const MCHERRY = [255, 83, 64] as const // the rival — danger, casualty
const DAPI = [127, 150, 255] as const // free radicals, UI chrome

const rgb = (c: readonly number[], a = 1) => `rgba(${c[0]},${c[1]},${c[2]},${a})`
const lerp = (a: number, b: number, t: number) => a + (b - a) * t
const easeOut = (t: number) => 1 - Math.pow(1 - t, 3)

interface GlyphCell {
  x: number
  y: number
}

/** Bake a soft radial punctum sprite (core → transparent) for additive bloom. */
function bakeSprite(color: readonly number[], px: number): HTMLCanvasElement {
  const r = Math.ceil(px * 2.6)
  const c = document.createElement('canvas')
  c.width = c.height = r * 2
  const g = c.getContext('2d')!
  const grad = g.createRadialGradient(r, r, 0, r, r, r)
  grad.addColorStop(0, rgb([255, 255, 255], 0.95))
  grad.addColorStop(0.28, rgb(color, 0.95))
  grad.addColorStop(0.55, rgb(color, 0.4))
  grad.addColorStop(1, rgb(color, 0))
  g.fillStyle = grad
  g.beginPath()
  g.arc(r, r, r, 0, Math.PI * 2)
  g.fill()
  return c
}

interface TitleScreenProps {
  onStart: () => void
  onHowTo: () => void
}

export function TitleScreen({ onStart, onHowTo }: TitleScreenProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [muted, setMuted] = useState(sfx.muted)
  const bootRef = useRef(false) // audio armed on first gesture

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d', { alpha: false })
    if (!ctx) return
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches

    // ── grid + layout, rebuilt on resize ─────────────────────────────────────
    let W = 0
    let H = 0
    let cell = 12
    let gw = 0
    let gh = 0
    let dpr = 1
    let cur = new Uint8Array(0) // faction per cell: 0 dead, 1 you (green), 2 rival (red)
    let nxt = new Uint8Array(0)
    let mask = new Uint8Array(0) // 1 where a glyph cell lives (healed to green)
    let glyphs: GlyphCell[] = []
    let colMin = 0
    let colMax = 1
    let rowMin = 0
    let rowMax = 1
    let sprites: Record<string, HTMLCanvasElement> = {}
    let cellBuf: HTMLCanvasElement | null = null
    let bctx: CanvasRenderingContext2D | null = null
    let marqueePts: [number, number][] = [] // perimeter chase-light positions, cached

    const layoutLine = (text: string, ox: number, oy: number, s: number) => {
      let cx = ox
      for (const ch of text) {
        const glyph = FONT[ch] ?? FONT[' ']
        if (ch !== ' ') {
          for (let gy = 0; gy < 7; gy++)
            for (let gx = 0; gx < 5; gx++)
              if (glyph[gy][gx] === '1')
                for (let sy = 0; sy < s; sy++)
                  for (let sx = 0; sx < s; sx++)
                    glyphs.push({ x: cx + gx * s + sx, y: oy + gy * s + sy })
        }
        cx += (5 + 1) * s
      }
    }

    const build = () => {
      dpr = Math.min(2, window.devicePixelRatio || 1)
      W = window.innerWidth
      H = window.innerHeight
      cell = Math.max(9, Math.min(15, Math.round(Math.min(W, H) / 66)))
      gw = Math.ceil(W / cell) + 1
      gh = Math.ceil(H / cell) + 1
      canvas.width = Math.floor(W * dpr)
      canvas.height = Math.floor(H * dpr)
      canvas.style.width = `${W}px`
      canvas.style.height = `${H}px`
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

      cur = new Uint8Array(gw * gh)
      nxt = new Uint8Array(gw * gh)
      mask = new Uint8Array(gw * gh)
      glyphs = []

      // Title: two lines, scaled to fill ~62% of width, sitting a little high.
      const lineChars = 8 // "THE GAME" / "OF DEATH"
      const s = Math.max(1, Math.min(3, Math.floor((gw * 0.66) / (lineChars * 6 - 1))))
      const lineW = lineChars * 6 * s - s
      const oy = Math.floor(gh * 0.3)
      layoutLine('THE GAME', Math.floor((gw - lineW) / 2), oy, s)
      layoutLine('OF DEATH', Math.floor((gw - lineW) / 2), oy + 9 * s, s)
      colMin = gw
      colMax = 0
      rowMin = gh
      rowMax = 0
      for (const c of glyphs) {
        mask[c.y * gw + c.x] = 1
        if (c.x < colMin) colMin = c.x
        if (c.x > colMax) colMax = c.x
        if (c.y < rowMin) rowMin = c.y
        if (c.y > rowMax) rowMax = c.y
      }

      // Pre-bake bloom sprites once per color.
      sprites = {
        you: bakeSprite(GFP, cell),
        rival: bakeSprite(MCHERRY, cell),
        white: bakeSprite([235, 252, 255], cell),
      }
      cellBuf = document.createElement('canvas')
      cellBuf.width = canvas.width
      cellBuf.height = canvas.height
      bctx = cellBuf.getContext('2d')
      if (bctx) bctx.setTransform(dpr, 0, 0, dpr, 0, 0)

      // Pre-compute the marquee chase-light ring (geometry depends only on size).
      const bm = 16
      const bstep = Math.max(22, cell * 2)
      marqueePts = []
      for (let x = bm; x < W - bm; x += bstep) marqueePts.push([x, bm])
      for (let y = bm; y < H - bm; y += bstep) marqueePts.push([W - bm, y])
      for (let x = W - bm; x > bm; x -= bstep) marqueePts.push([x, H - bm])
      for (let y = H - bm; y > bm; y -= bstep) marqueePts.push([bm, y])

      seedLife()
    }

    // deterministic-ish rng for the ambient soup
    let rngState = 0x9e3779b9
    const rng = () => {
      rngState ^= rngState << 13
      rngState ^= rngState >>> 17
      rngState ^= rngState << 5
      return ((rngState >>> 0) % 100000) / 100000
    }

    const seedLife = () => {
      cur.fill(0)
      for (const c of glyphs) cur[c.y * gw + c.x] = 1
      // a sparse boil around the title (kept clear of it so the word dominates),
      // with rival territory massing on the right
      const gyTop = rowMin - 5
      const gyBot = rowMax + 5
      for (let i = 0; i < gw * gh; i++) {
        if (mask[i]) continue
        const x = i % gw
        const y = (i / gw) | 0
        const nearTitle = y > gyTop && y < gyBot && x > colMin - 4 && x < colMax + 4
        const dens = nearTitle ? 0.012 : 0.03
        if (rng() < dens) cur[i] = x > gw * 0.6 && rng() < 0.55 ? 2 : 1
      }
    }

    // ── faction B3/S23 step ──────────────────────────────────────────────────
    const step = () => {
      for (let y = 0; y < gh; y++) {
        for (let x = 0; x < gw; x++) {
          let n = 0
          let you = 0
          let rival = 0
          for (let dy = -1; dy <= 1; dy++) {
            const yy = y + dy
            if (yy < 0 || yy >= gh) continue
            for (let dx = -1; dx <= 1; dx++) {
              if (!dx && !dy) continue
              const xx = x + dx
              if (xx < 0 || xx >= gw) continue
              const v = cur[yy * gw + xx]
              if (v) {
                n++
                if (v === 1) you++
                else rival++
              }
            }
          }
          const i = y * gw + x
          const alive = cur[i]
          let out = 0
          if (alive) out = n === 2 || n === 3 ? alive : 0
          else if (n === 3) out = you >= rival ? 1 : 2
          nxt[i] = out
        }
      }
      // heal the glyph substrate back to green so the word stays legible
      for (const c of glyphs) nxt[c.y * gw + c.x] = 1
      const t = cur
      cur = nxt
      nxt = t
    }

    const seedCell = (gx: number, gy: number, faction = 1) => {
      if (gx < 1 || gy < 1 || gx >= gw - 1 || gy >= gh - 1) return
      cur[gy * gw + gx] = faction
      if (rng() < 0.6) cur[gy * gw + gx + 1] = faction
      if (rng() < 0.6) cur[(gy + 1) * gw + gx] = faction
    }

    // ── interaction: the pipette seeds glowing life ──────────────────────────
    let pointerX = -1
    let pointerY = -1
    const onPointer = (e: PointerEvent) => {
      pointerX = e.clientX
      pointerY = e.clientY
      // (audio arms on pointerdown — a real user-activation gesture — not here)
      const gx = Math.floor(e.clientX / cell)
      const gy = Math.floor(e.clientY / cell)
      seedCell(gx, gy, 1)
    }
    const onLeave = () => {
      pointerX = pointerY = -1
    }
    const onDown = (e: PointerEvent) => {
      arm()
      sfx.play('place_grow')
      const gx = Math.floor(e.clientX / cell)
      const gy = Math.floor(e.clientY / cell)
      for (let k = 0; k < 14; k++)
        seedCell(gx + Math.floor((rng() - 0.5) * 6), gy + Math.floor((rng() - 0.5) * 6), 1)
    }

    // ── audio: a one-shot scope power-up, armed on the first gesture ──────────
    let audioCtx: AudioContext | null = null
    const arm = () => {
      if (bootRef.current || sfx.muted) return
      bootRef.current = true
      try {
        audioCtx = new AudioContext()
        const t = audioCtx.currentTime
        // rising filtered swell — the objective finding focus
        const osc = audioCtx.createOscillator()
        const sub = audioCtx.createOscillator()
        const filt = audioCtx.createBiquadFilter()
        const g = audioCtx.createGain()
        osc.type = 'sawtooth'
        sub.type = 'sine'
        osc.frequency.setValueAtTime(60, t)
        osc.frequency.exponentialRampToValueAtTime(420, t + 1.1)
        sub.frequency.setValueAtTime(48, t)
        sub.frequency.exponentialRampToValueAtTime(96, t + 1.1)
        filt.type = 'lowpass'
        filt.frequency.setValueAtTime(200, t)
        filt.frequency.exponentialRampToValueAtTime(6000, t + 1.0)
        g.gain.setValueAtTime(0.0001, t)
        g.gain.exponentialRampToValueAtTime(0.12, t + 0.5)
        g.gain.exponentialRampToValueAtTime(0.0001, t + 1.4)
        osc.connect(filt)
        sub.connect(filt)
        filt.connect(g).connect(audioCtx.destination)
        osc.start(t)
        sub.start(t)
        osc.stop(t + 1.5)
        sub.stop(t + 1.5)
      } catch {
        /* no audio */
      }
    }

    // ── the loop: a one-time rack-focus reveal, then the specimen simply lives ─
    const t0 = performance.now()
    const ENTRANCE = reduced ? 0 : 2400
    let last = t0
    let simAcc = 0

    let raf = 0
    const frame = (now: number) => {
      const dtMs = Math.min(50, now - last)
      last = now
      const sinceStart = now - t0
      const entering = sinceStart < ENTRANCE
      // focusAmount: the rack-focus resolve, 0 (blur) → 1 (sharp). A brief held
      // blur, then a strong pull into razor puncta.
      const focus = reduced
        ? 1
        : entering
          ? easeOut(Math.max(0, Math.min(1, (sinceStart - 300) / (ENTRANCE - 900))))
          : 1

      // Advance the automaton — the title boils on its self-healing substrate
      // while a sparse green-vs-red war drifts around it.
      if (!reduced) {
        simAcc += dtMs
        const stepMs = 82
        let guard = 0
        while (simAcc >= stepMs && guard++ < 3) {
          simAcc -= stepMs
          step()
          // rival probes from the right edge; a little stray drift keeps the war
          // alive without crowding the title
          seedCell(gw - 2, 2 + Math.floor(rng() * (gh - 4)), 2)
          if (rng() < 0.6) seedCell(1 + Math.floor(rng() * (gw - 2)), 1 + Math.floor(rng() * (gh - 2)), rng() < 0.4 ? 2 : 1)
        }
      } else {
        // barely-breathing boil for reduced motion
        simAcc += dtMs
        if (simAcc > 500) {
          simAcc = 0
          step()
        }
      }

      // ── render ───────────────────────────────────────────────────────────
      // phosphor afterglow: never hard-clear, so life leaves decaying streaks
      ctx.globalCompositeOperation = 'source-over'
      ctx.fillStyle = reduced ? '#04060b' : 'rgba(4,6,11,0.22)'
      ctx.fillRect(0, 0, W, H)

      // draw the living cells to the bloom buffer (additive)
      if (bctx && cellBuf) {
        bctx.setTransform(dpr, 0, 0, dpr, 0, 0)
        bctx.globalCompositeOperation = 'source-over'
        bctx.clearRect(0, 0, W, H)
        bctx.globalCompositeOperation = 'lighter'
        // scale of each punctum, driven by the focus pull (big+soft → small+sharp)
        for (let i = 0; i < cur.length; i++) {
          const v = cur[i]
          if (!v) continue
          const isGlyph = mask[i]
          const x = i % gw
          const y = (i / gw) | 0
          const sprite = v === 2 ? sprites.rival : sprites.you
          const px = x * cell + cell / 2
          const py = y * cell + cell / 2
          const scale = lerp(4.4, 1, focus) // blurred discs contract into sharp puncta
          // glyph puncta run a touch bigger + brighter so the word owns the field
          const size = cell * scale * (isGlyph ? 1.16 : 0.9)
          bctx.globalAlpha = (isGlyph ? 1 : 0.4) * lerp(0.5, 1, focus)
          bctx.drawImage(sprite, px - size / 2, py - size / 2, size, size)
        }
        bctx.globalAlpha = 1

        // composite the bloom buffer to the screen with chromatic aberration
        // (fat RGB fringing during the focus pull, collapsing to nothing)
        const split = lerp(13, 0.6, focus) * (W / 1440)
        ctx.globalCompositeOperation = 'lighter'
        // soft oversized glow blit (cheap gaussian)
        ctx.globalAlpha = 0.5
        ctx.drawImage(cellBuf, -6, -4, W + 12, H + 8)
        ctx.globalAlpha = 1
        // The RGB fringe is an entrance effect — collapse it fully once focused
        // (gating on focus, not an absolute px, so wide displays don't keep it).
        if (focus < 0.99) {
          ctx.globalAlpha = 0.5
          ctx.drawImage(cellBuf, split, 0, W, H)
          ctx.drawImage(cellBuf, -split, 0, W, H)
          ctx.globalAlpha = 1
        }
        ctx.drawImage(cellBuf, 0, 0, W, H)
        ctx.globalCompositeOperation = 'source-over'
      }

      // the pipette tip: a bright bloom that follows the cursor
      if (pointerX >= 0 && sprites.white) {
        ctx.globalCompositeOperation = 'lighter'
        const s2 = cell * 3.4
        ctx.globalAlpha = reduced ? 0.55 : 0.5 + 0.2 * Math.sin(now / 140)
        ctx.drawImage(sprites.white, pointerX - s2 / 2, pointerY - s2 / 2, s2, s2)
        ctx.globalAlpha = 1
        ctx.globalCompositeOperation = 'source-over'
      }

      // ── eyepiece chrome ────────────────────────────────────────────────────
      drawReticle(ctx, W, H, now, focus, reduced)
      drawMarquee(ctx, marqueePts, now, reduced)
      drawGrain(ctx, W, H, now, reduced)
      drawVignette(ctx, W, H)

      raf = requestAnimationFrame(frame)
    }

    build()
    raf = requestAnimationFrame(frame)
    // Debounce the (expensive) rebuild so a resize drag doesn't re-bake sprites
    // and reseed the colony dozens of times per second — rebuild once it settles.
    let resizeTimer = 0
    const onResize = () => {
      window.clearTimeout(resizeTimer)
      resizeTimer = window.setTimeout(build, 160)
    }
    window.addEventListener('resize', onResize)
    canvas.addEventListener('pointermove', onPointer)
    canvas.addEventListener('pointerdown', onDown)
    canvas.addEventListener('pointerleave', onLeave)
    return () => {
      cancelAnimationFrame(raf)
      window.clearTimeout(resizeTimer)
      window.removeEventListener('resize', onResize)
      canvas.removeEventListener('pointermove', onPointer)
      canvas.removeEventListener('pointerdown', onDown)
      canvas.removeEventListener('pointerleave', onLeave)
      audioCtx?.close()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const toggleMute = () => setMuted(sfx.toggle())

  return (
    <div className="title-screen">
      <canvas ref={canvasRef} className="title-canvas" aria-label="THE GAME OF DEATH" role="img" />
      <div className="title-scanlines" aria-hidden="true" />

      <div className="title-caption" aria-hidden="true">
        <span className="cap-strong">SPECIMEN No. 0x23</span>
        <span>SUBJECT · MORTALITY</span>
        <span className="cap-dim">B3 / S23 · 40×</span>
      </div>

      <div className="title-console">
        <div className="title-tagline">Your colony must evolve to overcome its foes.</div>
        <div className="title-actions">
          <button className="title-btn primary" onClick={onStart} autoFocus>
            <span className="btn-label">START</span>
            <span className="btn-sub">▸ collect specimen</span>
          </button>
          <button className="title-btn" onClick={onHowTo}>
            <span className="btn-label">HOW TO PLAY</span>
          </button>
        </div>
        <div className="title-foot">a roguelike duel on Conway's Game of Life — cause of death: pending</div>
      </div>

      <button
        className="title-mute"
        onClick={toggleMute}
        aria-label={muted ? 'unmute' : 'mute'}
        title={muted ? 'sound off' : 'sound on'}
      >
        {muted ? '🔇' : '🔊'}
      </button>
    </div>
  )
}

// ── chrome helpers ───────────────────────────────────────────────────────────

function drawReticle(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  now: number,
  focus: number,
  reduced: boolean,
) {
  const cx = W / 2
  const cy = H * 0.42
  const drift = reduced ? 0 : Math.sin(now / 2600) * 3
  ctx.save()
  ctx.translate(drift, Math.cos(now / 3100) * 2 * (reduced ? 0 : 1))
  ctx.strokeStyle = rgb(DAPI, 0.22 * focus)
  ctx.fillStyle = rgb(DAPI, 0.5 * focus)
  ctx.lineWidth = 1
  ctx.font = '9px ui-monospace, Menlo, monospace'
  // crosshair with a central gap
  const gap = 26
  const reach = Math.min(W, H) * 0.44
  ctx.beginPath()
  ctx.moveTo(cx - reach, cy)
  ctx.lineTo(cx - gap, cy)
  ctx.moveTo(cx + gap, cy)
  ctx.lineTo(cx + reach, cy)
  ctx.moveTo(cx, cy - reach * 0.62)
  ctx.lineTo(cx, cy - gap)
  ctx.moveTo(cx, cy + gap)
  ctx.lineTo(cx, cy + reach * 0.62)
  ctx.stroke()
  // tick marks along the horizontal
  ctx.beginPath()
  for (let i = 1; i <= 6; i++) {
    const d = gap + (i * (reach - gap)) / 6.5
    const h = i % 2 === 0 ? 7 : 4
    for (const sgn of [-1, 1]) {
      ctx.moveTo(cx + sgn * d, cy - h)
      ctx.lineTo(cx + sgn * d, cy + h)
    }
  }
  ctx.stroke()
  // corner brackets
  const m = 26
  const L = 34
  ctx.beginPath()
  for (const [ex, sx] of [[m, 1], [W - m, -1]] as const)
    for (const [ey, sy] of [[m, 1], [H - m, -1]] as const) {
      ctx.moveTo(ex, ey + sy * L)
      ctx.lineTo(ex, ey)
      ctx.lineTo(ex + sx * L, ey)
    }
  ctx.stroke()
  ctx.restore()
}

function drawMarquee(
  ctx: CanvasRenderingContext2D,
  pts: [number, number][],
  now: number,
  reduced: boolean,
) {
  const phase = reduced ? 0 : now / 420
  ctx.globalCompositeOperation = 'lighter'
  for (let i = 0; i < pts.length; i++) {
    const b = reduced ? 0.16 : 0.12 + 0.5 * Math.max(0, Math.sin(phase - i * 0.5))
    ctx.fillStyle = rgb(i % 9 === 0 ? MCHERRY : GFP, b)
    ctx.beginPath()
    ctx.arc(pts[i][0], pts[i][1], 1.6 + b * 1.6, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.globalCompositeOperation = 'source-over'
}

let grainTile: HTMLCanvasElement | null = null
function drawGrain(ctx: CanvasRenderingContext2D, W: number, H: number, now: number, reduced: boolean) {
  if (!grainTile) {
    grainTile = document.createElement('canvas')
    grainTile.width = grainTile.height = 128
    const g = grainTile.getContext('2d')!
    const img = g.createImageData(128, 128)
    for (let i = 0; i < img.data.length; i += 4) {
      const v = (Math.random() * 255) | 0
      img.data[i] = img.data[i + 1] = img.data[i + 2] = v
      img.data[i + 3] = 255
    }
    g.putImageData(img, 0, 0)
  }
  const pat = ctx.createPattern(grainTile, 'repeat')!
  ctx.globalCompositeOperation = 'overlay'
  ctx.globalAlpha = reduced ? 0.03 : 0.05
  ctx.save()
  if (!reduced) ctx.translate((now / 40) % 128, (now / 55) % 128)
  ctx.fillStyle = pat
  ctx.fillRect(-128, -128, W + 256, H + 256)
  ctx.restore()
  ctx.globalAlpha = 1
  ctx.globalCompositeOperation = 'source-over'
}

let vgKey = ''
let vg: CanvasGradient | null = null
function drawVignette(ctx: CanvasRenderingContext2D, W: number, H: number) {
  const key = `${W}x${H}`
  if (key !== vgKey) {
    vg = ctx.createRadialGradient(W / 2, H * 0.42, Math.min(W, H) * 0.28, W / 2, H * 0.5, Math.max(W, H) * 0.72)
    vg.addColorStop(0, 'rgba(2,4,10,0)')
    vg.addColorStop(0.7, 'rgba(2,4,10,0.35)')
    vg.addColorStop(1, 'rgba(1,2,6,0.86)')
    vgKey = key
  }
  ctx.fillStyle = vg!
  ctx.fillRect(0, 0, W, H)
}
