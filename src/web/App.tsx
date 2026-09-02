import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Duel,
  PLAYER,
  RIVAL,
  ROUNDS,
  RADICALS,
  TUNING,
  impactScore,
  patternById,
  projectImpact,
  rotateDir,
  type Impact,
} from '../sim'
import {
  CELL,
  COLORS,
  render,
  type Flash,
  type FloatText,
  type Ghost,
  type Pulse,
  type Spark,
} from './render'
import { Hand } from './Hand'
import { Genome } from './Genome'
import { CashOut } from './CashOut'
import { sfx, type SfxName } from './audio'
import {
  ashBreakdown,
  ashFor,
  buyGene,
  buySlot,
  earnAsh,
  loadMeta,
  loadoutOf,
  nextSlotCost,
  toggleEquip,
  upgradeCost,
} from './meta'
import { GENES } from '../sim'

const PLACE_SOUND: Record<string, SfxName> = {
  hold: 'place_hold',
  grow: 'place_grow',
  strike: 'place_strike',
  guard: 'place_guard',
  bomb: 'place_bomb',
}

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
  radicalsPop: number
  destroyed: number
  captured: number
  inset: number
  stormEta: number
  status: Duel['status']
  outcome: string
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
  const [round, setRound] = useState(1)
  const [meta, setMeta] = useState(loadMeta)
  const [showGenome, setShowGenome] = useState(false)
  const [ashEarned, setAshEarned] = useState<number | null>(null)
  const metaRef = useRef(meta)
  metaRef.current = meta
  const duelRef = useRef<Duel | null>(null)
  const debug = useMemo(() => new URLSearchParams(location.search).has('debug'), [])
  // eslint-disable-next-line react-hooks/exhaustive-deps -- loadout snapshots at run start
  const duel = useMemo(() => {
    const r = ROUNDS[round - 1]
    return new Duel(
      round === 1 ? seed : `${seed}-r${round}`,
      { aiSamples: r.aiSamples, aiActEvery: r.aiActEvery },
      loadoutOf(metaRef.current),
      r.rivalLoadout,
    )
  }, [seed, run, round])
  duelRef.current = duel

  const [speedIdx, setSpeedIdx] = useState(1)
  const [selected, setSelected] = useState<number | null>(null)
  const [rotation, setRotation] = useState(0)
  const [hud, setHud] = useState<Hud | null>(null)

  const canvasRef = useRef<HTMLCanvasElement>(null)
  const hoverRef = useRef<{ x: number; y: number } | null>(null)
  const flashesRef = useRef<Flash[]>([])
  const pulsesRef = useRef<Pulse[]>([])
  const sparksRef = useRef<Spark[]>([])
  const floatsRef = useRef<FloatText[]>([])
  const [coached, setCoached] = useState(() => localStorage.getItem('god-coached') === '1')
  const stormFlashRef = useRef(0)
  const [muted, setMuted] = useState(sfx.muted)
  const [shake, setShake] = useState('')
  const shakeTimer = useRef(0)
  const boom = useCallback(() => {
    setShake('shaking')
    window.clearTimeout(shakeTimer.current)
    shakeTimer.current = window.setTimeout(() => setShake(''), 280)
  }, [])
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
    setRound(1)
    setSelected(null)
    setSpeedIdx(1)
    setAshEarned(null)
    setShowGenome(false)
    flashesRef.current = []
  }, [])

  // Abandoning a live run requires a second click within 3 seconds.
  const [armAbandon, setArmAbandon] = useState(false)
  const armTimer = useRef(0)
  const requestNewRun = useCallback(() => {
    const running = duelRef.current?.status === 'running'
    if (!running || armAbandon) {
      window.clearTimeout(armTimer.current)
      setArmAbandon(false)
      newRun()
      return
    }
    sfx.play('select')
    setArmAbandon(true)
    window.clearTimeout(armTimer.current)
    armTimer.current = window.setTimeout(() => setArmAbandon(false), 3000)
  }, [armAbandon, newRun])

  const nextRound = useCallback(() => {
    setRound((r) => Math.min(r + 1, ROUNDS.length))
    setSelected(null)
    setSpeedIdx(1)
    setAshEarned(null)
    flashesRef.current = []
  }, [])

  const togglePause = useCallback(() => {
    setSpeedIdx((s) => (s === 0 ? lastSpeedRef.current : 0))
  }, [])

  const selectCard = useCallback(
    (i: number) => {
      setSelected((cur) => {
        if (cur === i) return null
        const id = duel.hand[i]
        if (!id) return cur
        setRotation(aimRotation(id))
        sfx.play('select')
        return i
      })
    },
    [duel],
  )

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
    let hintGrade: 'poor' | 'fair' | 'good' | 'great' | null = null
    let lastBoomAt = 0
    let lastCrunchAt = 0
    let lastDeaths = 0
    const onBoom = boom

    const frame = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000)
      last = now
      const gps = SPEEDS[speedRef.current]
      let ticked = false
      if (duel.status === 'running' && gps > 0) {
        acc += dt * gps
        let batch = 0
        while (acc >= 1 && batch < 64) {
          duel.tick()
          acc -= 1
          batch++
          ticked = true
          // Martyr detonations: ring, boom, kill count, a kick of the slide.
          for (const b of duel.state.blasts) {
            const w = duel.t.width
            const bx = (b.i % w) + 0.5
            const by = Math.floor(b.i / w) + 0.5
            pulsesRef.current.push({
              x: bx,
              y: by,
              ttl: 26,
              max: 26,
              maxR: 4.5 * CELL,
              color: COLORS.martyr,
            })
            if (b.kills > 0) {
              floatsRef.current.push({
                x: bx,
                y: by - 0.8,
                text: `☠${b.kills}`,
                color: COLORS.martyr,
                ttl: 50,
                max: 50,
              })
            }
            if (now - lastBoomAt > 180) {
              sfx.play('boom')
              lastBoomAt = now
              onBoom()
            }
          }
        }
      } else {
        acc = 0
      }

      // Conversion sparks: any cell that changed hands this generation.
      if (ticked) {
        const { cells, prev } = duel.state
        const w = duel.t.width
        let budget = 80
        for (let i = 0; i < cells.length && budget > 0; i++) {
          if (cells[i] > 0 && prev[i] > 0 && cells[i] !== prev[i]) {
            sparksRef.current.push({ x: i % w, y: Math.floor(i / w), ttl: 8, color: '#fff' })
            budget--
          }
        }
        // A front collapsing all at once earns a crunch.
        const rd = duel.state.deaths[RIVAL] + duel.state.deaths[PLAYER]
        if (rd - lastDeaths >= 14 && now - lastCrunchAt > 220) {
          sfx.play('crunch')
          lastCrunchAt = now
        }
        lastDeaths = rd
      }

      // Event edges: the storm's first bite, and the duel's verdict.
      if (prevInset === 0 && duel.state.ringInset > 0) {
        stormFlashRef.current = 1
        sfx.play('storm')
      }
      prevInset = duel.state.ringInset
      if (prevStatus === 'running' && duel.status !== 'running') {
        sfx.play(duel.status === 'won' ? 'win' : 'lose')
        const runClear = duel.status === 'won' && round === ROUNDS.length
        const amount = ashFor(duel, runClear)
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
          let radicalsTouched = 0
          for (const i of impact.destroyed) {
            if (cells[i] === RIVAL) rivalHit++
            else if (cells[i] === RADICALS) radicalsTouched++
          }
          for (const i of impact.gained) if (cells[i] === RADICALS) radicalsTouched++
          const score = impactScore(cells, impact, RIVAL, ghost.cost)
          const ratio = score / ghost.cost
          hintGrade = ratio < 0 ? 'poor' : ratio < 0.5 ? 'fair' : ratio < 1.5 ? 'good' : 'great'
          const settle =
            impact.lasting.length > 0
              ? ` (${impact.lasting.length} settle)`
              : impact.gained.length > 2
                ? ' (burns out)'
                : ''
          hintText = `+${impact.gained.length} you${settle} · −${rivalHit} rival · ${radicalsTouched} radicals`
        }
      }

      flashesRef.current = flashesRef.current
        .map((f) => ({ ...f, ttl: f.ttl - 1 }))
        .filter((f) => f.ttl > 0)
      pulsesRef.current = pulsesRef.current
        .map((p) => ({ ...p, ttl: p.ttl - 1 }))
        .filter((p) => p.ttl > 0)
      sparksRef.current = sparksRef.current
        .map((sp) => ({ ...sp, ttl: sp.ttl - 1 }))
        .filter((sp) => sp.ttl > 0)
      floatsRef.current = floatsRef.current
        .map((f) => ({ ...f, ttl: f.ttl - 1 }))
        .filter((f) => f.ttl > 0)
      render(ctx, duel, ghost, impact, flashesRef.current, {
        pulses: pulsesRef.current,
        sparks: sparksRef.current,
        floats: floatsRef.current,
        hoverCell: ghost ? null : hoverRef.current,
        now,
        stormFlash: stormFlashRef.current,
        hint: hintText ? { text: hintText, grade: hintGrade } : null,
      })

      if (now - hudAt > 100) {
        hudAt = now
        const s = duel.state
        const sum = duel.summary
        setHud({
          gen: s.gen,
          biomass: Math.floor(duel.biomass[PLAYER]),
          rate: (duel.income(PLAYER) * SPEEDS[speedRef.current]).toFixed(1),
          playerPop: s.pops[PLAYER],
          rivalPop: s.pops[RIVAL],
          radicalsPop: s.pops[RADICALS],
          destroyed: sum.rivalDestroyed,
          captured: sum.radicalsClaimed + sum.rivalConverted,
          inset: s.ringInset,
          stormEta: Math.max(0, duel.t.ringGrace - s.gen),
          status: duel.status,
          outcome: duel.outcome,
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
      return { cells, valid, dir, problem, cost: pattern.cost, blastZone: id === 'martyr' }
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
  }, [duel, round, boom])

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
    const id = duel.hand[selected]
    const placed = duel.playCard(selected, x, y, rotation)
    if (placed && id) {
      if (!coached) {
        setCoached(true)
        localStorage.setItem('god-coached', '1')
      }
      const pattern = patternById(id)
      flashesRef.current.push({ cells: placed, ttl: 12 })
      const cx = placed.reduce((a, [px]) => a + px, 0) / placed.length + 0.5
      const cy = placed.reduce((a, [, py]) => a + py, 0) / placed.length + 0.5
      pulsesRef.current.push({
        x: cx,
        y: cy,
        ttl: 22,
        max: 22,
        maxR: 3.4 * CELL,
        color: id === 'vampire' ? COLORS.vampire : COLORS.player,
      })
      // Every piece sounds like what it is.
      sfx.play(id === 'vampire' ? 'place_dark' : (PLACE_SOUND[pattern.role] ?? 'place'))
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
      else if (e.key === 'n' || e.key === 'N') requestNewRun()
      else if (e.key === 'q' || e.key === 'Q') selectCard(0)
      else if (e.key === 'w' || e.key === 'W') selectCard(1)
      else if (e.key === 'e' || e.key === 'E') selectCard(2)
      else if (e.key === 'Escape') setSelected(null)
      else if (debug && e.key === 'v') duel.forceEnd('won')
      else if (debug && e.key === 'x') duel.forceEnd('lost')
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [togglePause, requestNewRun, debug, duel, selectCard])

  const stormLabel =
    hud === null ? '' : hud.inset > 0 ? `storm +${hud.inset}` : `storm in ${hud.stormEta}g`

  return (
    <div className="app">
      <header className="hud">
        <h1>THE GAME OF DEATH</h1>
        <div className="hud-stats">
          <span className="stat round">
            round {round}/{ROUNDS.length} · {ROUNDS[round - 1].label}
          </span>
          <span className="stat">gen {hud?.gen ?? 0}</span>
          <span className="stat biomass">
            ⬢ {hud?.biomass ?? 0} <em>+{hud?.rate ?? '0.0'}/s</em>
          </span>
          <span className="stat you">you {hud?.playerPop ?? 0}</span>
          <span className="stat rival">rival {hud?.rivalPop ?? 0}</span>
          <span className="stat radicals">radicals {hud?.radicalsPop ?? 0}</span>
          <span className="stat kills" key={`k${hud?.destroyed ?? 0}`}>
            ☠ {(hud?.destroyed ?? 0).toLocaleString()}
          </span>
          <span className="stat captures" key={`c${hud?.captured ?? 0}`}>
            ◈ {hud?.captured ?? 0}
          </span>
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
          <button className={`newrun ${armAbandon ? 'armed' : ''}`} onClick={requestNewRun}>
            {armAbandon ? 'abandon run?' : 'new run'}
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
            {(() => {
              const slotCost = nextSlotCost(meta)
              const canShop =
                (slotCost !== null && meta.ash >= slotCost) ||
                GENES.some((g) => {
                  const c = upgradeCost(meta, g.key)
                  return c !== null && meta.ash >= c
                })
              return canShop ? <span className="shop-badge" /> : null
            })()}
          </button>
        </div>
      </header>

      <div className="popbar" title="territory: you vs the free radicals vs rival">
        {(() => {
          const total = (hud?.playerPop ?? 1) + (hud?.rivalPop ?? 1) + (hud?.radicalsPop ?? 0) || 1
          return (
            <>
              <span className="pop-you" style={{ width: `${((hud?.playerPop ?? 0) / total) * 100}%` }} />
              <span className="pop-radicals" style={{ width: `${((hud?.radicalsPop ?? 0) / total) * 100}%` }} />
              <span className="pop-rival" style={{ width: `${((hud?.rivalPop ?? 0) / total) * 100}%` }} />
            </>
          )
        })()}
      </div>

      <div className={`board-wrap ${shake} ${speedIdx === 0 ? 'planning' : ''}`}>
        <canvas
          ref={canvasRef}
          style={{ aspectRatio: `${duel.t.width} / ${duel.t.height}` }}
          onMouseMove={onMove}
          onMouseLeave={() => (hoverRef.current = null)}
          onClick={onClick}
          onContextMenu={onContextMenu}
        />
        {!coached && hud && hud.status === 'running' && (
          <div className="coach">
            <span>
              <b>Q/W/E</b> pick a card
            </span>
            <span>
              <b>R</b> rotates · click the slide to seed
            </span>
            <span>
              <b>space</b> holds time while you plan
            </span>
          </div>
        )}
        {hud && hud.status !== 'running' && (
          <div className={`overlay ${hud.status}`}>
            <div className="verdict">
              {hud.status !== 'won'
                ? 'DEATH'
                : round < ROUNDS.length
                  ? `ROUND ${round} CLEARED`
                  : 'THE UNIVERSE YIELDS'}
            </div>
            <div className="outcome">
              {hud.status !== 'won'
                ? `${hud.outcome} You reached round ${round} of ${ROUNDS.length}.`
                : round < ROUNDS.length
                  ? `${hud.outcome} Next: ${ROUNDS[round].label}.`
                  : `${hud.outcome} A full gauntlet, survived.`}
            </div>
            {ashEarned !== null && (
              <CashOut
                key={`${seed}-${round}`}
                breakdown={ashBreakdown(duel, hud.status === 'won' && round === ROUNDS.length)}
                bank={meta.ash}
              />
            )}
            <div className="overlay-actions">
              <button onClick={() => setShowGenome(true)}>genome</button>
              {hud.status === 'won' && round < ROUNDS.length ? (
                <button className="primary" onClick={nextRound}>
                  next round →
                </button>
              ) : (
                <button className="primary" onClick={newRun}>
                  new run [n]
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      <Hand
        duel={duel}
        biomass={hud?.biomass ?? 0}
        selected={selected}
        rotation={rotation}
        onSelect={selectCard}
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
