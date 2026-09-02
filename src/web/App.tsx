import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Duel,
  GENES,
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
  SCHEMES,
  render,
  setCell,
  setPalette,
  type Flash,
  type FloatText,
  type Ghost,
  type PaletteMode,
  type Pulse,
  type Spark,
} from './render'
import { Hand } from './Hand'
import { Genome } from './Genome'
import { CashOut } from './CashOut'
import { Settings } from './Settings'
import { sfx, type SfxName } from './audio'
import {
  ashBreakdown,
  ashFor,
  buyGene,
  buySeed,
  buySlot,
  claimChallenge,
  earnAsh,
  loadMeta,
  loadoutOf,
  nextSlotCost,
  selectSeed,
  toggleEquip,
  upgradeCost,
} from './meta'
import { seedById } from '../sim'

const PLACE_SOUND: Record<string, SfxName> = {
  hold: 'place_hold',
  grow: 'place_grow',
  strike: 'place_strike',
  guard: 'place_guard',
  bomb: 'place_bomb',
}

const SPEEDS = TUNING.speeds
const SPEED_LABELS = ['⏸', '1×', '2×', '4×', '8×']
const SPEED_KEYS = ['space', '1', '2', '3', '4']

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

// ── the mount system (HANDOFF §1, §3) ──────────────────────────────────────
type Mount = 'float' | 'rail' | 'bottom' | 'portrait'

interface Layout {
  mount: Mount
  cell: number
  railW: number
  /** CSS pixel size for the canvas (differs from cell grid when upscaling). */
  cssW: number
  cssH: number
}

function computeLayout(w: number, h: number): Layout {
  const aspect = w / h
  if (aspect < 1.0) return { mount: 'portrait', cell: 8, railW: 0, cssW: 0, cssH: 0 }
  let mount: Mount
  // Float ("tray") covers the common desktop range — 16:10 (1.6) AND 16:9
  // (1.78). Only true ultrawides (> 2.0) dock to the rail, where the wings
  // would otherwise go to waste; narrow/tall goes to the bottom dock.
  if (aspect > 2.0 || w < 1024) mount = 'rail'
  else if (aspect < 1.4) mount = 'bottom'
  else mount = 'float'
  const railW = mount === 'rail' ? (w < 900 ? 148 : 264) : 0
  let availW: number
  let availH: number
  if (mount === 'float') {
    availW = w
    availH = h
  } else if (mount === 'rail') {
    availW = w - railW - 36
    // The narrow rail drops the label/footer strips (HANDOFF §5.2 phone).
    availH = railW === 148 ? h - 24 : h - 24 - 40 - 30 - 20
  } else {
    availW = w - 24
    availH = h - 24 - 40 - 30 - 176 - 30
  }
  let cell = Math.floor(Math.min(availW / 128, availH / 80))
  let cssW: number
  let cssH: number
  if (cell < 6) {
    // Landscape-phone rule: render crisp at 4px, CSS-upscale ≤1.5× (§3).
    cell = 4
    const scale = Math.min(1.5, availW / (128 * 4), availH / (80 * 4))
    cssW = Math.floor(128 * 4 * scale)
    cssH = Math.floor(80 * 4 * scale)
  } else {
    // Float fills a 16:10 window, so let its cells grow with the screen; the
    // dock keeps a moderate cap. Islands anchor to the board, not the window,
    // so any residual mat is a hairline margin rather than detached chrome.
    cell = Math.min(cell, mount === 'float' ? 20 : 14)
    cssW = 128 * cell
    cssH = 80 * cell
  }
  return { mount, cell, railW, cssW, cssH }
}

function useLayout(): Layout {
  const [layout, setLayout] = useState(() => computeLayout(window.innerWidth, window.innerHeight))
  useEffect(() => {
    const onResize = () => setLayout(computeLayout(window.innerWidth, window.innerHeight))
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])
  return layout
}

// ── shared instrument pieces ───────────────────────────────────────────────
function Mark() {
  return <span className="mark" aria-hidden="true" />
}

function RoundPips({ round, cleared }: { round: number; cleared: boolean }) {
  return (
    <span className="round-pips" aria-label={`round ${round} of ${ROUNDS.length}`}>
      {ROUNDS.map((r, i) => (
        <i key={r.label} className={i < round ? `done ${cleared && i === round - 1 ? 'glow' : ''}` : ''} />
      ))}
    </span>
  )
}

function StormTrack({ hud, grace, maxInset }: { hud: Hud | null; grace: number; maxInset: number }) {
  const active = (hud?.inset ?? 0) > 0
  const frac = hud
    ? active
      ? Math.min(1, hud.inset / maxInset)
      : Math.min(1, 1 - hud.stormEta / grace)
    : 0
  const side = `${(frac * 50).toFixed(1)}%`
  return (
    <div className="storm-group">
      <span className="lbl-xs">STORM</span>
      <div className={`storm-track ${active ? 'active' : ''}`}>
        <span className="from-left" style={{ width: side }} />
        <span className="from-right" style={{ width: side }} />
      </div>
      <span className="storm-val num">{active ? `+${hud?.inset}` : `${hud?.stormEta ?? 0}g`}</span>
    </div>
  )
}

function ThrottleWell({
  speedIdx,
  onSet,
  legends,
  skipOne,
}: {
  speedIdx: number
  onSet: (i: number) => void
  legends: boolean
  skipOne?: boolean
}) {
  const detents = SPEED_LABELS.map((label, i) => ({ label, i })).filter(
    (d) => !(skipOne && d.i === 1),
  )
  return (
    <div>
      <div className="throttle-well" role="radiogroup" aria-label="simulation throttle">
        {detents.map(({ label, i }) => (
          <button
            key={label}
            role="radio"
            aria-checked={speedIdx === i}
            aria-label={i === 0 ? 'pause (space)' : `speed ${label} (key ${i})`}
            className="detent"
            onClick={() => onSet(i)}
          >
            {label}
          </button>
        ))}
      </div>
      {legends && (
        <div className="throttle-legends" aria-hidden="true">
          {detents.map(({ i }) => (
            <span key={i}>{SPEED_KEYS[i]}</span>
          ))}
        </div>
      )}
    </div>
  )
}

function FilterSet({ scheme, onOpen }: { scheme: PaletteMode; onOpen: () => void }) {
  const s = SCHEMES[scheme]
  return (
    <button
      className="filter-set"
      title="filter set & vision options"
      aria-label={`filter set ${s.youName} and ${s.rivalName}; open vision settings`}
      onClick={onOpen}
    >
      <span className="lbl-xs">FILTER SET</span>
      <span className="stains">
        <span className="stain-you">{s.youName}</span>
        <span className="stain-sep">/</span>
        <span className="stain-rival">{s.rivalName}</span>
      </span>
    </button>
  )
}

function Tickers({ hud }: { hud: Hud | null }) {
  return (
    <div className="tickers">
      <span className="kills num" key={`k${hud?.destroyed ?? 0}`}>
        ☠ {(hud?.destroyed ?? 0).toLocaleString()}
      </span>
      <span className="captures num" key={`c${hud?.captured ?? 0}`}>
        ◈ {hud?.captured ?? 0}
      </span>
    </div>
  )
}

function CoachStep({
  n,
  title,
  state,
  className,
  children,
}: {
  n: number
  title: string
  state: 'active' | 'pending'
  className?: string
  children: React.ReactNode
}) {
  return (
    <div className={`coach-step ${state} ${className ?? ''}`}>
      <div className="step-head">
        <span className="disc">{n}</span>
        <span className="step-title">{title}</span>
      </div>
      <div className="step-body">{children}</div>
    </div>
  )
}

export function App() {
  const [seed, setSeed] = useState(initialSeed)
  const [run, setRun] = useState(0)
  const [round, setRound] = useState(1)
  const [meta, setMeta] = useState(loadMeta)
  const [showGenome, setShowGenome] = useState(false)
  const [ashEarned, setAshEarned] = useState<number | null>(null)
  const [challengeBounty, setChallengeBounty] = useState(0)
  const metaRef = useRef(meta)
  metaRef.current = meta
  const duelRef = useRef<Duel | null>(null)
  const debug = useMemo(() => new URLSearchParams(location.search).has('debug'), [])
  const layout = useLayout()
  // eslint-disable-next-line react-hooks/exhaustive-deps -- loadout snapshots at run start
  const duel = useMemo(() => {
    const r = ROUNDS[round - 1]
    return new Duel(
      round === 1 ? seed : `${seed}-r${round}`,
      { aiSamples: r.aiSamples, aiActEvery: r.aiActEvery },
      loadoutOf(metaRef.current),
      r.rivalLoadout,
      metaRef.current.seedSel,
      r.rivalSeed,
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
  const [placedOnce, setPlacedOnce] = useState(false)
  const stormFlashRef = useRef(0)
  const [muted, setMuted] = useState(sfx.muted)
  const [showSettings, setShowSettings] = useState(false)
  const [scheme, setScheme] = useState<PaletteMode>(() => {
    const stored = localStorage.getItem('god-palette')
    // Migrate the old binary toggle to the named schemes.
    if (stored === 'cfp') return 'deuteranopia'
    if (stored && stored in SCHEMES) return stored as PaletteMode
    return 'standard'
  })
  useEffect(() => {
    setPalette(scheme)
    try {
      localStorage.setItem('god-palette', scheme)
    } catch {
      /* private mode */
    }
  }, [scheme])
  const [announce, setAnnounce] = useState('')
  const [shake, setShake] = useState('')
  const shakeTimer = useRef(0)
  const boom = useCallback(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
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

  // Portrait pauses the run and resumes on rotate (HANDOFF §8).
  const prePortraitSpeed = useRef<number | null>(null)
  useEffect(() => {
    if (layout.mount === 'portrait') {
      if (prePortraitSpeed.current === null) {
        prePortraitSpeed.current = speedRef.current
        setSpeedIdx(0)
        setAnnounce('Turn the slide — the specimen needs the long edge of your screen. The round is paused.')
      }
    } else if (prePortraitSpeed.current !== null) {
      setSpeedIdx(prePortraitSpeed.current)
      prePortraitSpeed.current = null
    }
  }, [layout.mount])

  const newRun = useCallback(() => {
    setSeed(randomSeed())
    setRun((r) => r + 1)
    setRound(1)
    setSelected(null)
    setSpeedIdx(1)
    setAshEarned(null)
    setChallengeBounty(0)
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
    setChallengeBounty(0)
    flashesRef.current = []
  }, [])

  const togglePause = useCallback(() => {
    setSpeedIdx((s) => (s === 0 ? lastSpeedRef.current : 0))
  }, [])

  const coarse = useMemo(() => window.matchMedia('(pointer: coarse)').matches, [])

  const selectCard = useCallback(
    (i: number) => {
      setSelected((cur) => {
        if (cur === i) return null
        const id = duel.hand[i]
        if (!id) return cur
        setRotation(aimRotation(id))
        sfx.play('select')
        // On touch, arming a card is what pauses the game (HANDOFF §6).
        if (coarse) setSpeedIdx(0)
        return i
      })
    },
    [duel, coarse],
  )

  // The loop: fixed-timestep sim ticks driven by rAF, render every frame.
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || layout.mount === 'portrait') return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    setCell(layout.cell)
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
        setAnnounce('The entropy storm has begun closing in from the edges.')
      }
      prevInset = duel.state.ringInset
      if (prevStatus === 'running' && duel.status !== 'running') {
        const won = duel.status === 'won'
        sfx.play(won ? 'win' : 'lose')
        const runClear = won && round === ROUNDS.length
        const base = ashFor(duel, runClear)
        // A challenge seed pays a one-time bounty the first time it's cleared.
        const cseed = seedById(duel.colonySeed)
        const challengeHit = won && !!cseed.challenge && !metaRef.current.challenges.includes(duel.colonySeed)
        const bounty = challengeHit ? cseed.challenge!.rewardAsh : 0
        setChallengeBounty(bounty)
        setAshEarned(base + bounty)
        setMeta((m) => {
          const earned = earnAsh(m, base)
          return challengeHit ? claimChallenge(earned, duel.colonySeed).meta : earned
        })
        setAnnounce(
          won
            ? `${runClear ? 'Run complete — the universe yields.' : `Round ${round} cleared.`} ${base + bounty} ash earned.${challengeHit ? ` Challenge complete: the ${cseed.name} paid a ${bounty} ash bounty.` : ''}`
            : `Your colony is dead. Reached round ${round}. ${base} ash earned.`,
        )
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
        reach: selectedRef.current !== null ? duel.radii[PLAYER] : null,
      })

      if (now - hudAt > 100) {
        hudAt = now
        const s = duel.state
        const sum = duel.summary
        setHud({
          gen: s.gen,
          biomass: Math.floor(duel.biomass[PLAYER]),
          rate: (duel.income(PLAYER) * SPEEDS[speedRef.current]).toFixed(1),
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
  }, [duel, round, boom, layout.mount, layout.cell])

  // Pointer input on the board.
  const cellFromPoint = (clientX: number, clientY: number) => {
    const canvas = canvasRef.current
    if (!canvas) return { x: -1, y: -1 }
    const rect = canvas.getBoundingClientRect()
    const scaleX = (duel.t.width * CELL) / rect.width
    const scaleY = (duel.t.height * CELL) / rect.height
    return {
      x: Math.floor(((clientX - rect.left) * scaleX) / CELL),
      y: Math.floor(((clientY - rect.top) * scaleY) / CELL),
    }
  }

  const placeAt = (x: number, y: number) => {
    if (selected === null) return
    const id = duel.hand[selected]
    const placed = duel.playCard(selected, x, y, rotation)
    if (placed && id) {
      setPlacedOnce(true)
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

  // The coach completes when time is released after the first placement.
  useEffect(() => {
    if (!coached && placedOnce && speedIdx > 0) {
      setCoached(true)
      localStorage.setItem('god-coached', '1')
    }
  }, [coached, placedOnce, speedIdx])

  const onMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (e.nativeEvent instanceof PointerEvent && (e.nativeEvent as PointerEvent).pointerType !== 'mouse') return
    hoverRef.current = cellFromPoint(e.clientX, e.clientY)
  }

  const onClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (selected === null) return
    const { x, y } = cellFromPoint(e.clientX, e.clientY)
    placeAt(x, y)
  }

  // Touch: drag to aim with the ghost 40px above the fingertip; lift commits
  // inside the reach, cancels outside (HANDOFF §6).
  const [touchDrag, setTouchDrag] = useState<{ x: number; y: number } | null>(null)
  const touchDragRef = useRef(false)
  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (e.pointerType === 'mouse' || selected === null) return
    e.preventDefault()
    touchDragRef.current = true
    const p = cellFromPoint(e.clientX, e.clientY - 40)
    hoverRef.current = p
    setTouchDrag({ x: e.clientX, y: e.clientY })
    e.currentTarget.setPointerCapture(e.pointerId)
  }
  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (e.pointerType === 'mouse' || !touchDragRef.current) return
    hoverRef.current = cellFromPoint(e.clientX, e.clientY - 40)
    setTouchDrag({ x: e.clientX, y: e.clientY })
  }
  const onPointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (e.pointerType === 'mouse' || !touchDragRef.current) return
    touchDragRef.current = false
    setTouchDrag(null)
    const p = cellFromPoint(e.clientX, e.clientY - 40)
    const sel = selectedRef.current
    if (sel !== null) {
      const id = duel.hand[sel]
      if (id && duel.ghostFor(PLAYER, id, p.x, p.y, rotationRef.current).valid) {
        placeAt(p.x, p.y)
      } else {
        sfx.play('invalid')
      }
    }
    hoverRef.current = null
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
      else if (e.key === 'Escape') {
        setShowSettings(false)
        setShowGenome(false)
        setSelected(null)
      } else if (debug && e.key === 'v') duel.forceEnd('won')
      else if (debug && e.key === 'x') duel.forceEnd('lost')
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [togglePause, requestNewRun, debug, duel, selectCard])

  // ── derived bits shared by the mounts ────────────────────────────────────
  const over = hud !== null && hud.status !== 'running'
  const canShop = useMemo(() => {
    const slotCost = nextSlotCost(meta)
    return (
      (slotCost !== null && meta.ash >= slotCost) ||
      GENES.some((g) => {
        const c = upgradeCost(meta, g.key)
        return c !== null && meta.ash >= c
      })
    )
  }, [meta])
  const runClear = over && hud.status === 'won' && round === ROUNDS.length
  const coachStep = coached ? 0 : selected === null && !placedOnce ? 1 : !placedOnce ? 2 : 3

  const canvasEl = (
    <canvas
      ref={canvasRef}
      role="img"
      aria-label="The battlefield: a Game of Life simulation. Your colony grows from the left, the rival from the right; the board's border shows territory share."
      style={{ width: layout.cssW, height: layout.cssH }}
      onMouseMove={onMove}
      onMouseLeave={() => {
        if (!touchDragRef.current) hoverRef.current = null
      }}
      onClick={onClick}
      onContextMenu={onContextMenu}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
    />
  )

  const verdictText = over
    ? hud.status !== 'won'
      ? 'DEATH'
      : round < ROUNDS.length
        ? `ROUND ${round} CLEARED`
        : 'THE UNIVERSE YIELDS'
    : ''
  const outcomeText = over
    ? hud.status !== 'won'
      ? `${hud.outcome.toLowerCase().replace(/\.$/, '')} · reached round ${round} of ${ROUNDS.length}`
      : round < ROUNDS.length
        ? `${hud.outcome.toLowerCase().replace(/\.$/, '')} · next, ${ROUNDS[round].label}`
        : `${hud.outcome.toLowerCase().replace(/\.$/, '')} · a full gauntlet, survived`
    : ''

  const cashBreakdown = () => {
    const bd = ashBreakdown(duel, runClear)
    if (challengeBounty > 0) {
      return {
        rows: [
          ...bd.rows,
          {
            label: 'challenge',
            detail: `${seedById(duel.colonySeed).name} cleared`,
            value: challengeBounty,
          },
        ],
        total: bd.total + challengeBounty,
      }
    }
    return bd
  }

  const overlayEl = over && (
    <div className={`overlay ${hud.status}`}>
      <div className="verdict-block">
        <div className="verdict">{verdictText}</div>
        <div className="outcome">{outcomeText}</div>
      </div>
      {ashEarned !== null && (
        <CashOut
          key={`${seed}-${round}`}
          breakdown={cashBreakdown()}
          bank={meta.ash}
          meta={`${hud.gen} generations · ${ROUNDS[round - 1].label}`}
          onGenome={() => setShowGenome(true)}
          primary={
            hud.status === 'won' && round < ROUNDS.length
              ? { label: 'NEXT ROUND →', onClick: nextRound }
              : { label: 'NEW RUN [N]', onClick: newRun }
          }
        />
      )}
    </div>
  )

  // ── portrait ─────────────────────────────────────────────────────────────
  if (layout.mount === 'portrait') {
    return (
      <div className="portrait">
        <div className="head">
          <Mark />
          <span>GAME OF DEATH</span>
        </div>
        <div className="spacer" />
        <div className="rotate-glyph" aria-hidden="true" />
        <div className="turn">TURN THE SLIDE</div>
        <div className="why">
          The specimen is 128 × 80 cells. It needs the long edge of your screen — anything less and
          the puncta stop being readable.
        </div>
        <div className="spacer" />
        <div className="status">
          <div className="row">
            <span className="lbl-sm">RUN IN PROGRESS</span>
            <span className="v">
              round {round}/{ROUNDS.length} · gen {hud?.gen ?? 0}
            </span>
          </div>
          <div className="row">
            <span className="lbl-sm">ASH</span>
            <span className="v gold">⬡ {meta.ash}</span>
          </div>
          <div className="fine">nothing is lost — the round is paused where you left it</div>
        </div>
        <div className="sr-only" role="status" aria-live="polite">
          {announce}
        </div>
      </div>
    )
  }

  const genomeEl = showGenome && (
    <Genome
      meta={meta}
      onBuySlot={() => setMeta(buySlot)}
      onBuyGene={(k) => setMeta((m) => buyGene(m, k))}
      onToggleEquip={(k) => setMeta((m) => toggleEquip(m, k))}
      onBuySeed={(id) => setMeta((m) => buySeed(m, id))}
      onSelectSeed={(id) => setMeta((m) => selectSeed(m, id))}
      onClose={() => setShowGenome(false)}
    />
  )

  const settingsEl = showSettings && (
    <Settings
      scheme={scheme}
      muted={muted}
      onScheme={setScheme}
      onMute={() => setMuted(sfx.toggle())}
      onClose={() => setShowSettings(false)}
    />
  )

  const srLive = (
    <div className="sr-only" role="status" aria-live="polite">
      {announce}
    </div>
  )

  const rotateDetent = touchDrag && (
    <button
      className="rotate-detent"
      style={{
        left: Math.min(window.innerWidth - 54, touchDrag.x + 60),
        top: Math.max(10, touchDrag.y - 90),
      }}
      onPointerDown={(e) => {
        e.stopPropagation()
        e.preventDefault()
        setRotation((r) => (r + 1) % 4)
      }}
      aria-label="rotate pattern"
    >
      R
    </button>
  )

  // ── float mount ──────────────────────────────────────────────────────────
  if (layout.mount === 'float') {
    return (
      <div className={`stage mount-float ${shake} ${(hud?.inset ?? 0) > 4 ? 'receded' : ''}`}>
        <div className="board-slot">
        <div className="board-frame" style={{ width: layout.cssW, height: layout.cssH }}>
        {canvasEl}

        <div className="island isl-tl">
          <div className="frost" aria-hidden="true" />
          <div className="specimen-body">
            <Mark />
            <div className="kv">
              <span className="lbl-xs">SPECIMEN</span>
              <span className="v">DEATH · {seed.slice(0, 8)}</span>
            </div>
            <div className="vdiv" />
            <div className="kv">
              <span className="lbl-xs">BIOMASS</span>
              <span className="biomass-inline">
                <span className="val num">{hud?.biomass ?? 0}</span>
                <span className="rate num">+{hud?.rate ?? '0.0'}/s</span>
              </span>
            </div>
          </div>
        </div>

        <div className="island isl-tc">
          <div className="round-line">
            <RoundPips round={round} cleared={over && hud.status === 'won'} />
            <span className="rn">
              ROUND {round}/{ROUNDS.length}
            </span>
            <span className="rlabel">{ROUNDS[round - 1].label}</span>
          </div>
          <StormTrack hud={hud} grace={duel.t.ringGrace} maxInset={duel.maxInset} />
        </div>

        <div className="island isl-tr">
          <FilterSet scheme={scheme} onOpen={() => setShowSettings(true)} />
          <div className="vdiv" />
          <button
            className="glyph-btn"
            aria-label="settings"
            title="settings"
            onClick={() => setShowSettings(true)}
          >
            ⚙
          </button>
          <button
            className={`glyph-btn newrun-island ${armAbandon ? 'armed' : ''}`}
            aria-label={armAbandon ? 'confirm abandon run' : 'new run'}
            title={armAbandon ? 'abandon run?' : 'new run'}
            onClick={requestNewRun}
          >
            {armAbandon ? 'abandon?' : '↺'}
          </button>
          <div className="vdiv" />
          <button
            className="ash-readout"
            onClick={() => setShowGenome(true)}
            aria-label={`genome — ${meta.ash} ash banked`}
          >
            <span className="lbl-xs">ASH</span>
            <span className="val num">⬡ {meta.ash}</span>
            {canShop && <span className="shop-badge" />}
          </button>
        </div>

        <div className="island isl-bl">
          <ThrottleWell speedIdx={speedIdx} onSet={setSpeedIdx} legends />
          {coachStep > 0 && !over && (
            <CoachStep n={3} title="RELEASE TIME" state={coachStep === 3 ? 'active' : 'pending'} className="coach-3">
              Income accrues per generation. Running hot is how you get rich.
            </CoachStep>
          )}
        </div>

        <div className="island isl-bc">
          <Hand
            duel={duel}
            biomass={hud?.biomass ?? 0}
            selected={selected}
            rotation={rotation}
            onSelect={selectCard}
            variant="float"
          />
          {coachStep > 0 && !over && (
            <CoachStep n={1} title="PICK A CARD" state={coachStep === 1 ? 'active' : 'pending'} className="coach-1">
              Press <b>Q</b>, <b>W</b> or <b>E</b> — or click one. Time is already held.
            </CoachStep>
          )}
        </div>

        <div className="island isl-br">
          <Tickers hud={hud} />
          <div className="ticker-meta num">
            <span>gen {hud?.gen ?? 0}</span>
            <span>10× objective</span>
          </div>
        </div>

        {coachStep > 0 && !over && (
          <CoachStep n={2} title="AIM ON THE SLIDE" state={coachStep === 2 ? 'active' : 'pending'} className="coach-2">
            The ghost double-simulates {TUNING.foresightGens} generations and grades the spot before you pay.
          </CoachStep>
        )}
        {overlayEl}
        </div>
        </div>
        {rotateDetent}
        {genomeEl}
        {settingsEl}
        {srLive}
      </div>
    )
  }

  // ── dock mounts (rail / bottom) ──────────────────────────────────────────
  const labelStrip = (
    <div className="label-strip">
      <Mark />
      <div className="lockup">
        <span className="lockup-over">THE GAME OF</span>
        <span className="lockup-name">DEATH</span>
      </div>
      <div className="vdiv" />
      <div className="kv">
        <span className="lbl-sm">SPECIMEN</span>
        <span style={{ fontSize: 12, color: 'var(--dim)' }}>seed {seed.slice(0, 10)}</span>
      </div>
      <div style={{ flex: 1 }} />
      <div className="round-line">
        <span className="lbl-sm">ROUND</span>
        <RoundPips round={round} cleared={over && hud.status === 'won'} />
        <span className="rn">
          {round}/{ROUNDS.length}
        </span>
        <span className="rlabel">{over && hud.status === 'won' ? 'cleared' : ROUNDS[round - 1].label}</span>
      </div>
    </div>
  )

  const footerStrip = (
    <div className={`footer-strip ${over ? 'spent' : ''}`}>
      <div className="gen-group">
        <span className="lbl-sm">GEN</span>
        <span className="val num">{hud?.gen ?? 0}</span>
      </div>
      <StormTrack hud={hud} grace={duel.t.ringGrace} maxInset={duel.maxInset} />
      <Tickers hud={hud} />
    </div>
  )

  const narrow = layout.railW === 148

  const rail = (
    <div className={`rail ${narrow ? 'narrow' : ''} ${over ? 'dimmed' : ''}`}>
      <div className="rail-panel">
        <span className="lbl-sm">BIOMASS</span>
        <div className="readout">
          <span className="glyph">⬢</span>
          <span className="val num">{hud?.biomass ?? 0}</span>
          <span className="rate num">+{hud?.rate ?? '0.0'}/s</span>
        </div>
        <div className="capacity-track">
          <span style={{ width: `${Math.min(100, ((hud?.biomass ?? 0) / 170) * 100)}%` }} />
        </div>
      </div>

      {narrow && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <RoundPips round={round} cleared={over && hud.status === 'won'} />
          <StormTrack hud={hud} grace={duel.t.ringGrace} maxInset={duel.maxInset} />
        </div>
      )}

      <div className="throttle-block">
        <div className="rail-group-label">
          <span className="lbl-sm">THROTTLE</span>
        </div>
        <ThrottleWell speedIdx={speedIdx} onSet={setSpeedIdx} legends={!narrow} skipOne={narrow} />
        {coachStep > 0 && !over && (
          <div style={{ marginTop: 8 }}>
            <CoachStep n={3} title="RELEASE TIME" state={coachStep === 3 ? 'active' : 'pending'}>
              Income accrues per generation. Running hot is how you get rich.
            </CoachStep>
          </div>
        )}
      </div>

      <div className="rail-spacer" />

      <div className="hand-block">
        <div className="rail-group-label">
          <span className="lbl-sm">{over ? 'HAND · SPENT' : 'HAND'}</span>
          <span className="aside">REACH {duel.radii[PLAYER]} ON SLIDE</span>
        </div>
        <Hand
          duel={duel}
          biomass={hud?.biomass ?? 0}
          selected={selected}
          rotation={rotation}
          onSelect={selectCard}
          variant={narrow ? 'compact' : 'rail'}
        />
        {coachStep > 0 && !over && (
          <div style={{ marginTop: 8 }}>
            <CoachStep n={1} title="PICK A CARD" state={coachStep === 1 ? 'active' : 'pending'}>
              Press <b>Q</b>, <b>W</b> or <b>E</b> — or click one. Time is already held.
            </CoachStep>
          </div>
        )}
      </div>

      <button
        className={`genome-plate ${over ? 'lit' : ''}`}
        onClick={() => setShowGenome(true)}
        aria-label={`open genome — ${meta.ash} ash banked`}
      >
        <div className="kv">
          <span className="lbl-sm">GENOME</span>
          <span className="ash-readout">
            <span className="val num">⬡ {meta.ash}</span>
            {canShop && <span className="shop-badge" />}
          </span>
        </div>
        <span className="spend-chip">SPEND</span>
      </button>

      <div className="utility-row">
        <button
          aria-label={muted ? 'unmute sound' : 'mute sound'}
          aria-pressed={muted}
          onClick={() => setMuted(sfx.toggle())}
        >
          {muted ? '🔇' : '♪'}
        </button>
        <button aria-label="settings & vision options" title="settings" onClick={() => setShowSettings(true)}>
          ⚙
        </button>
        <button
          className={`newrun ${armAbandon ? 'armed' : ''}`}
          onClick={requestNewRun}
          aria-label={armAbandon ? 'confirm abandon run' : 'start a new run'}
        >
          {armAbandon ? 'abandon?' : 'NEW RUN'}
        </button>
      </div>
    </div>
  )

  return (
    <div className={`stage mount-${layout.mount}`}>
      <div className="board-col">
        {!narrow && labelStrip}
        <div className={`board-wrap ${shake}`}>
          {canvasEl}
          {coachStep > 0 && !over && (
            <CoachStep n={2} title="AIM ON THE SLIDE" state={coachStep === 2 ? 'active' : 'pending'} className="coach-2">
              The ghost double-simulates {TUNING.foresightGens} generations and grades the spot
              before you pay.
            </CoachStep>
          )}
          {overlayEl}
        </div>
        {!narrow && footerStrip}
      </div>
      {rail}
      {rotateDetent}
      {genomeEl}
      {settingsEl}
      {srLive}
    </div>
  )
}
