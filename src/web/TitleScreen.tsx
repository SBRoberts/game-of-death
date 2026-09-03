import { useEffect, useRef, useState } from 'react'
import { createState, setCells, step } from '../sim'
import { COLORS } from './render'

/**
 * The title screen: "THE GAME OF DEATH" spelled in living cells. A real
 * two-faction B3/S23 board runs behind it — the letters are re-asserted each
 * generation so they persist as a glowing structure while Life boils and
 * shimmers at their edges. The title assembles column by column on load, as if
 * the automaton were building it. Inherits the active colorblind scheme.
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
const SCALE = 2 // each font pixel → 2×2 cells

/** Lay a line of text into board cells, returning [x,y] pairs at a top-left origin. */
function textCells(text: string, ox: number, oy: number): Array<[number, number]> {
  const out: Array<[number, number]> = []
  let cx = ox
  for (const ch of text) {
    const glyph = FONT[ch] ?? FONT[' ']
    for (let gy = 0; gy < 7; gy++) {
      for (let gx = 0; gx < 5; gx++) {
        if (glyph[gy][gx] === '1') {
          for (let sy = 0; sy < SCALE; sy++)
            for (let sx = 0; sx < SCALE; sx++) out.push([cx + gx * SCALE + sx, oy + gy * SCALE + sy])
        }
      }
    }
    cx += (5 + 1) * SCALE // glyph width + 1-col spacing
  }
  return out
}

interface TitleScreenProps {
  onStart: () => void
  onHowTo: () => void
}

export function TitleScreen({ onStart, onHowTo }: TitleScreenProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  // Title cells for both lines, centered, with each cell's reveal column.
  const titleRef = useRef<{ idx: number; col: number }[]>([])
  if (titleRef.current.length === 0) {
    const line1 = 'THE GAME'
    const line2 = 'OF DEATH'
    const lineW = (t: string) => t.length * 6 * SCALE - SCALE // minus trailing space
    const cells: Array<[number, number]> = [
      ...textCells(line1, Math.floor((BOARD_W - lineW(line1)) / 2), 18),
      ...textCells(line2, Math.floor((BOARD_W - lineW(line2)) / 2), 36),
    ]
    titleRef.current = cells
      .filter(([x, y]) => x >= 0 && x < BOARD_W && y >= 0 && y < BOARD_H)
      .map(([x, y]) => ({ idx: y * BOARD_W + x, col: x }))
  }

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

    // Pure B3/S23 soup boils in its own board, behind the title. The title
    // itself is drawn crisp on top (still Life cells, just not stepped — so
    // births never blob the letters). The soup is the live "game logic"; the
    // reveal is the title being written cell by cell.
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
    const seedSoup = (density: number) => {
      const soup: Array<[number, number]> = []
      for (let y = 0; y < BOARD_H; y++)
        for (let x = 0; x < BOARD_W; x++) if (rng() < density) soup.push([x, y])
      setCells(s, 1, soup)
    }
    seedSoup(0.3)

    const title = titleRef.current
    const titleSet = new Uint8Array(BOARD_W * BOARD_H)
    for (const t of title) titleSet[t.idx] = 1
    const maxCol = Math.max(...title.map((t) => t.col))

    let raf = 0
    let last = performance.now()
    let acc = 0
    const revealStart = performance.now()

    const frame = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000)
      last = now
      acc += dt * 8 // ~8 generations/sec
      while (acc >= 1) {
        acc -= 1
        step(s)
        // Keep the soup alive: settled Life turns to ash, so drizzle in a few
        // fresh cells each generation (deterministic count, random positions).
        if (!reduced) {
          const drops: Array<[number, number]> = []
          for (let k = 0; k < 30; k++) drops.push([Math.floor(rng() * BOARD_W), Math.floor(rng() * BOARD_H)])
          setCells(s, 1, drops)
        }
      }
      // Reveal the title left→right over ~1.5s, then hold.
      const revealFront = reduced ? maxCol : Math.min(maxCol, ((now - revealStart) / 1500) * maxCol)

      // Render.
      const W = BOARD_W * cellPx
      const H = BOARD_H * cellPx
      ctx.fillStyle = '#04060b'
      ctx.fillRect(0, 0, W, H)
      const cells = s.cells
      // Soup behind, faint DAPI — but dimmed where the title sits so it reads.
      for (let i = 0; i < cells.length; i++) {
        if (cells[i] === 1) {
          ctx.globalAlpha = titleSet[i] ? 0.08 : 0.26
          ctx.fillStyle = COLORS.radicals
          const x = (i % BOARD_W) * cellPx
          const y = Math.floor(i / BOARD_W) * cellPx
          ctx.fillRect(x + 1, y + 1, cellPx - 2, cellPx - 2)
        }
      }
      ctx.globalAlpha = 1
      // Title: crisp bright green puncta with a soft glow pass.
      for (let pass = 0; pass < 2; pass++) {
        ctx.fillStyle = COLORS.player
        ctx.globalAlpha = pass === 0 ? 0.2 : 1
        const pad = pass === 0 ? -1.5 : 1
        for (const t of title) {
          if (t.col > revealFront) continue
          const x = (t.idx % BOARD_W) * cellPx
          const y = Math.floor(t.idx / BOARD_W) * cellPx
          ctx.beginPath()
          ctx.arc(x + cellPx / 2, y + cellPx / 2, cellPx / 2 - pad, 0, Math.PI * 2)
          ctx.fill()
        }
      }
      ctx.globalAlpha = 1
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
      <div className="title-tagline">a roguelike duel on Conway's Game of Life</div>
      <div className="title-actions">
        <button className="title-btn primary" onClick={onStart} autoFocus>
          START
        </button>
        <button className="title-btn" onClick={onHowTo}>
          HOW TO PLAY
        </button>
      </div>
      <div className="title-foot">
        seed your colony · open the throttle · outlive the storm
      </div>
    </div>
  )
}
