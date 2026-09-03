import { useEffect, useRef } from 'react'
import { createState, setCells, step } from '../sim'
import { COLORS } from './render'

/**
 * The title screen: "THE GAME OF DEATH" generated in living cells. A real
 * B3/S23 soup boils behind. A bright "constructor" head sweeps letter by
 * letter, and each letter materializes in its wake — cells blooming from a
 * point into the glyph — as if the automaton were writing the title. Inherits
 * the active colorblind scheme; respects reduced motion.
 */

// 5×7 cell font, just the glyphs "THE GAME OF DEATH" needs.
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

const BOARD_W = 120
const BOARD_H = 68
const SCALE = 2

interface LetterCell {
  x: number
  y: number
  letter: number // assembly order (0-based), spaces excluded
  jitter: number // per-cell 0..1 stagger within the letter's bloom
}
interface TitleData {
  cells: LetterCell[]
  centers: { cx: number; cy: number }[] // per letter, for the constructor head
}

/** Lay a line of text into cells, assigning each cell its letter index. */
function layoutLine(
  text: string,
  ox: number,
  oy: number,
  startLetter: number,
  centers: { cx: number; cy: number }[],
): { cells: LetterCell[]; nextLetter: number } {
  const cells: LetterCell[] = []
  let cx = ox
  let letter = startLetter
  for (const ch of text) {
    const glyph = FONT[ch] ?? FONT[' ']
    if (ch !== ' ') {
      const before = cells.length
      for (let gy = 0; gy < 7; gy++)
        for (let gx = 0; gx < 5; gx++)
          if (glyph[gy][gx] === '1')
            for (let sy = 0; sy < SCALE; sy++)
              for (let sx = 0; sx < SCALE; sx++)
                cells.push({ x: cx + gx * SCALE + sx, y: oy + gy * SCALE + sy, letter, jitter: 0 })
      // Per-cell jitter and the letter's center.
      const slice = cells.slice(before)
      const mcx = slice.reduce((a, c) => a + c.x, 0) / slice.length
      const mcy = slice.reduce((a, c) => a + c.y, 0) / slice.length
      centers[letter] = { cx: mcx, cy: mcy }
      let seed = (letter + 1) * 2654435761
      for (const c of slice) {
        seed = (seed ^ (seed << 13)) >>> 0
        c.jitter = (seed % 1000) / 1000
      }
      letter++
    }
    cx += (5 + 1) * SCALE
  }
  return { cells, nextLetter: letter }
}

function buildTitle(): TitleData {
  const line1 = 'THE GAME'
  const line2 = 'OF DEATH'
  const lineW = (t: string) => t.length * 6 * SCALE - SCALE
  const centers: { cx: number; cy: number }[] = []
  const a = layoutLine(line1, Math.floor((BOARD_W - lineW(line1)) / 2), 18, 0, centers)
  const b = layoutLine(line2, Math.floor((BOARD_W - lineW(line2)) / 2), 36, a.nextLetter, centers)
  return { cells: [...a.cells, ...b.cells], centers }
}

interface TitleScreenProps {
  onStart: () => void
  onHowTo: () => void
}

const easeOut = (t: number) => 1 - Math.pow(1 - t, 3)

export function TitleScreen({ onStart, onHowTo }: TitleScreenProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const titleRef = useRef<TitleData | null>(null)
  if (!titleRef.current) titleRef.current = buildTitle()

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const cellPx = Math.max(6, Math.min(12, Math.floor((Math.min(window.innerWidth, 1100) - 40) / BOARD_W)))
    const dpr = window.devicePixelRatio || 1
    canvas.width = BOARD_W * cellPx * dpr
    canvas.height = BOARD_H * cellPx * dpr
    canvas.style.width = `${BOARD_W * cellPx}px`
    canvas.style.height = `${BOARD_H * cellPx}px`
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const title = titleRef.current!
    const letterCount = title.centers.length

    // Pure B3/S23 soup boils behind the title in its own board.
    const s = createState({
      width: BOARD_W,
      height: BOARD_H,
      factions: [
        { name: 'dead', rule: { birth: 1 << 3, survive: (1 << 2) | (1 << 3) } },
        { name: 'soup', rule: { birth: 1 << 3, survive: (1 << 2) | (1 << 3) } },
      ],
      flankingMargin: 2,
      casualtyMargin: 1,
    })
    let rngState = 0x9e3779b9
    const rng = () => {
      rngState ^= rngState << 13
      rngState ^= rngState >>> 17
      rngState ^= rngState << 5
      return ((rngState >>> 0) % 1000) / 1000
    }
    const soup: Array<[number, number]> = []
    for (let y = 0; y < BOARD_H; y++)
      for (let x = 0; x < BOARD_W; x++) if (rng() < 0.3) soup.push([x, y])
    setCells(s, 1, soup)
    const titleSet = new Uint8Array(BOARD_W * BOARD_H)
    for (const c of title.cells) titleSet[c.y * BOARD_W + c.x] = 1

    // Assembly timing: the head dwells on each letter; cells bloom in its wake.
    const LETTER_MS = 200 // stagger between letters
    const BLOOM_MS = 360 // per-letter materialize duration
    const assembleMs = reduced ? 0 : letterCount * LETTER_MS + BLOOM_MS

    let raf = 0
    let last = performance.now()
    let acc = 0
    const t0 = performance.now()

    const frame = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000)
      last = now
      acc += dt * 8
      while (acc >= 1) {
        acc -= 1
        step(s)
        if (!reduced) {
          const drops: Array<[number, number]> = []
          for (let k = 0; k < 30; k++) drops.push([Math.floor(rng() * BOARD_W), Math.floor(rng() * BOARD_H)])
          setCells(s, 1, drops)
        }
      }
      const elapsed = now - t0
      // Which letter the constructor head is on (fractional).
      const headF = reduced ? letterCount : Math.min(letterCount, elapsed / LETTER_MS)

      const W = BOARD_W * cellPx
      const H = BOARD_H * cellPx
      ctx.fillStyle = '#04060b'
      ctx.fillRect(0, 0, W, H)

      // Soup behind — faint, dimmer under the title footprint.
      const cells = s.cells
      ctx.fillStyle = COLORS.radicals
      for (let i = 0; i < cells.length; i++) {
        if (cells[i] === 1) {
          ctx.globalAlpha = titleSet[i] ? 0.08 : 0.24
          const x = (i % BOARD_W) * cellPx
          const y = Math.floor(i / BOARD_W) * cellPx
          ctx.fillRect(x + 1, y + 1, cellPx - 2, cellPx - 2)
        }
      }
      ctx.globalAlpha = 1

      // Title cells: each blooms once the head reaches its letter.
      for (let pass = 0; pass < 2; pass++) {
        ctx.fillStyle = COLORS.player
        for (const c of title.cells) {
          const cellStart = c.letter * LETTER_MS + c.jitter * (BLOOM_MS * 0.6)
          const p = reduced ? 1 : Math.max(0, Math.min(1, (elapsed - cellStart) / (BLOOM_MS * 0.4)))
          if (p <= 0) continue
          const e = easeOut(p)
          const cx = c.x * cellPx + cellPx / 2
          const cy = c.y * cellPx + cellPx / 2
          const r = (cellPx / 2 - (pass === 0 ? -1.5 : 1)) * e
          ctx.globalAlpha = (pass === 0 ? 0.2 : 1) * p
          ctx.beginPath()
          ctx.arc(cx, cy, Math.max(0.5, r), 0, Math.PI * 2)
          ctx.fill()
        }
      }
      ctx.globalAlpha = 1

      // The constructor head: a bright pulsing ring writing the current letter.
      const li = Math.max(0, Math.min(letterCount - 1, Math.floor(headF)))
      const c = title.centers[li]
      if (!reduced && c && headF < letterCount && elapsed < assembleMs) {
        const hx = c.cx * cellPx + cellPx / 2
        const hy = c.cy * cellPx + cellPx / 2
        const pulse = 0.6 + 0.4 * Math.sin(now / 90)
        const rad = cellPx * (4 + 1.5 * Math.sin(now / 120))
        const grad = ctx.createRadialGradient(hx, hy, 1, hx, hy, rad)
        grad.addColorStop(0, COLORS.player)
        grad.addColorStop(1, 'rgba(0,0,0,0)')
        ctx.globalAlpha = 0.35 * pulse
        ctx.fillStyle = grad
        ctx.beginPath()
        ctx.arc(hx, hy, rad, 0, Math.PI * 2)
        ctx.fill()
        ctx.globalAlpha = pulse
        ctx.strokeStyle = '#eafcff'
        ctx.lineWidth = 1.5
        ctx.beginPath()
        ctx.arc(hx, hy, cellPx * 1.6, 0, Math.PI * 2)
        ctx.stroke()
        ctx.globalAlpha = 1
      }

      // Vignette.
      const g = ctx.createRadialGradient(W / 2, H / 2, H * 0.4, W / 2, H / 2, H * 0.95)
      g.addColorStop(0, 'rgba(2,4,10,0)')
      g.addColorStop(1, 'rgba(2,4,10,0.55)')
      ctx.fillStyle = g
      ctx.fillRect(0, 0, W, H)

      raf = requestAnimationFrame(frame)
    }
    raf = requestAnimationFrame(frame)
    return () => cancelAnimationFrame(raf)
  }, [])

  return (
    <div className="title-screen">
      <canvas ref={canvasRef} className="title-canvas" aria-label="THE GAME OF DEATH" role="img" />
      <div className="title-tagline">Your colony must evolve to overcome its foes.</div>
      <div className="title-actions">
        <button className="title-btn primary" onClick={onStart} autoFocus>
          START
        </button>
        <button className="title-btn" onClick={onHowTo}>
          HOW TO PLAY
        </button>
      </div>
      <div className="title-foot">a roguelike duel on Conway's Game of Life</div>
    </div>
  )
}
