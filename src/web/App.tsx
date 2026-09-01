import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Duel,
  PLAYER,
  RIVAL,
  WILDS,
  TUNING,
  impactScore,
  patternById,
  projectImpact,
  rotateDir,
  type Impact,
} from '../sim'
import { CELL, render, type Flash, type Ghost, type Pulse } from './render'
import { Hand } from './Hand'
import { Genome } from './Genome'
import { sfx } from './audio'
import { ashFor, buyGene, buySlot, earnAsh, loadMeta, toggleEquip } from './meta'

const SPEEDS = TUNING.speeds // generations per second per throttle stop
const SPEED_LABELS = ['⏸', '1×', '2×', '4×', '8×']

function randomSeed(): string {
  const bytes = new Uint32Array(2)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (b) => b.toString(36)).join('')
}

function initialSeed(): string {
  return new URLSearchParams(location.search).get('seed') ?? randomSeed()
}

interface Hud {
  gen: number
  biomass: number
  rate: string
  playerPop: number
  rivalPop: number
  wildsPop: number
  inset: number
  stormEta: number
  status: Duel['status']
  outcome: string
  hint: string | null
  grade: 'poor' | 'fair' | 'good' | 'great' | null
}

const PROBLEM_TEXT: Record<string, string> = {
  storm: 'outside the safe zone',
  occupied: 'blocked by live cells',
  far: 'too far from your colony',
  blocked: 'needs open ground — clear of ash',
  poor: 'not enough biomass',
}

/** Default a traveler's rotation so its heading points at the rival. */
function aimRotation(patternId: string): number {
  const dir = patternById(patternId).dir
  if (!dir) return 0
  for (let r = 0; r < 4; r++) {
    if (rotateDir(dir, r)[0] > 0) return r
  }
  return 0
}

export function App() {
  const [seed, setSeed] = useState(initialSeed)
  const [run, setRun] = useState(0)
  const [meta, setMeta] = useState(loadMeta)
  const [showGenome, setShowGenome] = useState(false)
  const [ashEarned, setAshEarned] = useState<number | null>(null)
  const metaRef = useRef(meta)
  metaRef.current = meta
  // eslint-disable-next-line react-hooks/exhaustive-deps -- loadout snapshots at run start
  const duel = useMemo(() => new Duel(seed, {}, metaRef.current.equipped), [seed, run])

  const [speedIdx, setSpeedIdx] = useState(1)
  const [selected, setSelected] = useState<number | null>(null)
  const [rotation, setRotation] = useState(0)
  const [hud, setHud] = useState<Hud | null>(null)

  const canvasRef = useRef<HTMLCanvasElement>(null)
  const hoverRef = useRef<{ x: number; y: number } | null>(null)
  const flashesRef = useRef<Flash[]>([])
  const pulsesRef = useRef<Pulse[]>([])
  const stormFlashRef = useRef(0)
  const [muted, setMuted] = useState(sfx.muted)
  const speedRef = useRef(speedIdx)
  const selectedRef = useRef(selected)
  const rotationRef = useRef(rotation)
  const lastSpeedRef = useRef(1)
  speedRef.current = speedIdx
  selectedRef.current = selected
  rotationRef.current = rotation
  if (speedIdx > 0) lastSpeedRef.current = speedIdx

  const newRun = useCallback(() => {
    setSeed(randomSeed())
    setRun((r) => r + 1)
    setSelected(null)
    setSpeedIdx(1)
    setAshEarned(null)
    setShowGenome(false)
    flashesRef.current = []
  }, [])

  const togglePause = useCallback(() => {
    setSpeedIdx((s) => (s === 0 ? lastSpeedRef.current : 0))
  }, [])

  // The loop: fixed-timestep sim ticks driven by rAF, render every frame.
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const dpr = window.devicePixelRatio || 1
    canvas.width = duel.t.width * CELL * dpr
    canvas.height = duel.t.height * CELL * dpr
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

    let raf = 0
    let last = performance.now()
    let acc = 0
    let hudAt = 0
    let prevInset = duel.state.ringInset
    let prevStatus = duel.status
    let hintText: string | null = null
    let hintGrade: Hud['grade'] = null

    const frame = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000)
      last = now
      const gps = SPEEDS[speedRef.current]
      if (duel.status === 'running' && gps > 0) {
        acc += dt * gps
        let batch = 0
        while (acc >= 1 && batch < 64) {
          duel.tick()
          acc -= 1
          batch++
        }
      } else {
        acc = 0
      }

      // Event edges: the storm's first bite, and the duel's verdict.
      if (prevInset === 0 && duel.state.ringInset > 0) {
        stormFlashRef.current = 1
        sfx.play('storm')
      }
      prevInset = duel.state.ringInset
      if (prevStatus === 'running' && duel.status !== 'running') {
        sfx.play(duel.status === 'won' ? 'win' : 'lose')
        const amount = ashFor(duel)
        setAshEarned(amount)
        setMeta((m) => earnAsh(m, amount))
      }
      prevStatus = duel.status
      stormFlashRef.current *= 0.955

      const ghost = computeGhost()
      const impact = ghost?.valid ? computeImpact(ghost) : null

      // Live placement hint: the planner's own evaluation of the hovered spot.
      hintText = null
      hintGrade = null
      if (ghost) {
        if (!ghost.valid) {
          hintText = PROBLEM_TEXT[ghost.problem] ?? null
        } else if (impact) {
          const cells = duel.state.cells
          let rivalHit = 0
          let wildsTouched = 0
          for (const i of impact.destroyed) {
            if (cells[i] === RIVAL) rivalHit++
            else if (cells[i] === WILDS) wildsTouched++
          }
          for (const i of impact.gained) if (cells[i] === WILDS) wildsTouched++
          const score = impactScore(cells, impact, RIVAL, ghost.cost)
          const ratio = score / ghost.cost
          hintGrade = ratio < 0 ? 'poor' : ratio < 0.5 ? 'fair' : ratio < 1.5 ? 'good' : 'great'
          hintText = `+${impact.gained.length} you · −${rivalHit} rival · ${wildsTouched} wilds`
        }
      }

      flashesRef.current = flashesRef.current
        .map((f) => ({ ...f, ttl: f.ttl - 1 }))
        .filter((f) => f.ttl > 0)
      pulsesRef.current = pulsesRef.current
        .map((p) => ({ ...p, ttl: p.ttl - 1 }))
        .filter((p) => p.ttl > 0)
      render(ctx, duel, ghost, impact, flashesRef.current, {
        pulses: pulsesRef.current,
        hoverCell: ghost ? null : hoverRef.current,
        now,
        stormFlash: stormFlashRef.current,
      })

      if (now - hudAt > 100) {
        hudAt = now
        const s = duel.state
        setHud({
          gen: s.gen,
          biomass: Math.floor(duel.biomass[PLAYER]),
          rate: (duel.income(PLAYER) * SPEEDS[speedRef.current]).toFixed(1),
          playerPop: s.pops[PLAYER],
          rivalPop: s.pops[RIVAL],
          wildsPop: s.pops[WILDS],
          inset: s.ringInset,
          stormEta: Math.max(0, duel.t.ringGrace - s.gen),
          status: duel.status,
          outcome: duel.outcome,
          hint: hintText,
          grade: hintGrade,
        })
      }
      raf = requestAnimationFrame(frame)
    }

    type GhostInfo = Ghost & { problem: string; cost: number }
    const computeGhost = (): GhostInfo | null => {
      const sel = selectedRef.current
      const hover = hoverRef.current
      if (sel === null || !hover || duel.status !== 'running') return null
      const id = duel.hand[sel]
      if (!id) return null
      const rot = rotationRef.current
      const { pattern, cells, valid, problem } = duel.ghostFor(PLAYER, id, hover.x, hover.y, rot)
      const dir = pattern.dir ? rotateDir(pattern.dir, rot) : undefined
      return { cells, valid, dir, problem, cost: pattern.cost }
    }

    // Foresight is ~1ms of double-simulation; cache it per (spot, card, gen).
    let impactKey = ''
    let impactCache: Impact | null = null
    const computeImpact = (ghost: Ghost): Impact | null => {
      const hover = hoverRef.current
      if (!hover) return null
      const key = `${hover.x},${hover.y},${rotationRef.current},${duel.hand[selectedRef.current ?? -1]},${duel.state.gen}`
      if (key !== impactKey) {
        impactKey = key
        impactCache = projectImpact(duel.state, PLAYER, ghost.cells, duel.t.foresightGens, (g) =>
          duel.insetAt(g),
        )
      }
      return impactCache
    }

    raf = requestAnimationFrame(frame)
    return () => cancelAnimationFrame(raf)
  }, [duel])

  // Pointer input on the board.
  const cellFromEvent = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const scaleX = (duel.t.width * CELL) / rect.width
    const scaleY = (duel.t.height * CELL) / rect.height
    return {
      x: Math.floor(((e.clientX - rect.left) * scaleX) / CELL),
      y: Math.floor(((e.clientY - rect.top) * scaleY) / CELL),
    }
  }

  const onMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    hoverRef.current = cellFromEvent(e)
  }

  const onClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (selected === null) return
    const { x, y } = cellFromEvent(e)
    const placed = duel.playCard(selected, x, y, rotation)
    if (placed) {
      flashesRef.current.push({ cells: placed, ttl: 12 })
      const cx = placed.reduce((a, [px]) => a + px, 0) / placed.length + 0.5
      const cy = placed.reduce((a, [, py]) => a + py, 0) / placed.length + 0.5
      pulsesRef.current.push({ x: cx, y: cy, ttl: 22, max: 22 })
      sfx.play('place')
    } else {
      sfx.play('invalid')
    }
  }

  const onContextMenu = (e: React.MouseEvent<HTMLCanvasElement>) => {
    e.preventDefault()
    setRotation((r) => (r + 1) % 4)
  }

  // Keyboard: space pause, 1-4 throttle, R rotate, N new run, Esc deselect.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === ' ') {
        e.preventDefault()
        togglePause()
      } else if (e.key >= '1' && e.key <= '4') setSpeedIdx(Number(e.key))
      else if (e.key === 'r' || e.key === 'R') setRotation((r) => (r + 1) % 4)
      else if (e.key === 'n' || e.key === 'N') newRun()
      else if (e.key === 'Escape') setSelected(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [togglePause, newRun])

  const stormLabel =
    hud === null ? '' : hud.inset > 0 ? `storm +${hud.inset}` : `storm in ${hud.stormEta}g`

  return (
    <div className="app">
      <header className="hud">
        <h1>THE GAME OF DEATH</h1>
        <div className="hud-stats">
          <span className="stat">gen {hud?.gen ?? 0}</span>
          <span className="stat biomass">
            ⬢ {hud?.biomass ?? 0} <em>+{hud?.rate ?? '0.0'}/s</em>
          </span>
          <span className="stat you">you {hud?.playerPop ?? 0}</span>
          <span className="stat rival">rival {hud?.rivalPop ?? 0}</span>
          <span className="stat wilds">wilds {hud?.wildsPop ?? 0}</span>
          <span className="stat storm">{stormLabel}</span>
        </div>
        <div className="hud-controls">
          {SPEED_LABELS.map((label, i) => (
            <button
              key={label}
              className={`speed ${speedIdx === i ? 'active' : ''}`}
              onClick={() => setSpeedIdx(i)}
            >
              {label}
            </button>
          ))}
          <button className="newrun" onClick={newRun}>
            new run
          </button>
          <button
            className="mute"
            title={muted ? 'unmute' : 'mute'}
            onClick={() => setMuted(sfx.toggle())}
          >
            {muted ? '🔇' : '🔊'}
          </button>
          <button className="genome-btn" onClick={() => setShowGenome(true)}>
            genome · ⬡ {meta.ash}
          </button>
        </div>
      </header>

      <div className="board-wrap">
        {hud?.hint && (
          <div className={`impact-readout ${hud.grade ?? 'problem'}`}>
            {hud.hint}
            {hud.grade && <b>{hud.grade}</b>}
          </div>
        )}
        <canvas
          ref={canvasRef}
          style={{ width: duel.t.width * CELL, maxWidth: '100%', aspectRatio: `${duel.t.width} / ${duel.t.height}` }}
          onMouseMove={onMove}
          onMouseLeave={() => (hoverRef.current = null)}
          onClick={onClick}
          onContextMenu={onContextMenu}
        />
        {hud && hud.status !== 'running' && (
          <div className={`overlay ${hud.status}`}>
            <div className="verdict">{hud.status === 'won' ? 'VICTORY' : 'DEATH'}</div>
            <div className="outcome">{hud.outcome}</div>
            {ashEarned !== null && (
              <div className="ash-earned">
                +{ashEarned} ash <span>· ⬡ {meta.ash} total</span>
              </div>
            )}
            <div className="overlay-actions">
              <button onClick={() => setShowGenome(true)}>genome</button>
              <button onClick={newRun}>new run [n]</button>
            </div>
          </div>
        )}
      </div>

      <Hand
        duel={duel}
        biomass={hud?.biomass ?? 0}
        selected={selected}
        rotation={rotation}
        onSelect={(i) =>
          setSelected((cur) => {
            if (cur === i) return null
            const id = duel.hand[i]
            if (id) {
              setRotation(aimRotation(id))
              sfx.play('select')
            }
            return i
          })
        }
      />

      {showGenome && (
        <Genome
          meta={meta}
          onBuySlot={() => setMeta(buySlot)}
          onBuyGene={(k) => setMeta((m) => buyGene(m, k))}
          onToggleEquip={(k) => setMeta((m) => toggleEquip(m, k))}
          onClose={() => setShowGenome(false)}
        />
      )}

      <footer className="help">
        <span>click card → click board to seed</span>
        <span>ghost previews the impact {TUNING.foresightGens} generations out</span>
        <span>right-click / R rotate</span>
        <span>space pause · 1–4 throttle</span>
        <span className="seed">seed {seed}</span>
      </footer>
    </div>
  )
}
