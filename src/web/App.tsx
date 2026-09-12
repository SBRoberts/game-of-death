import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Duel,
  SEEDS,
  PLAYER,
  RIVAL,
  ROUNDS,
  RADICALS,
  TUNING,
  impactScore,
  patternById,
  projectImpact,
  rotate,
  rotateDir,
  type Impact,
  type Placed,
  type TurnReport,
  type PlacementRecord,
} from '../sim'
import {
  CELL,
  COLORS,
  SCHEMES,
  TIER_COLORS,
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
import { CHAIN_CELEBRATE_TIER, CHAIN_TIERS, chainAshValue } from '../sim'
import { Hand } from './Hand'
import { Genome } from './Genome'
import { CashOut } from './CashOut'
import { ChestPicker } from './ChestPicker'
import { Shop } from './Shop'
import { Settings } from './Settings'
import { TitleScreen } from './TitleScreen'
import { HowTo } from './HowTo'
import { Settle } from './Settle'
import { dailyDate, dailySeed, isDailySeed, loadDailyBest, recordDaily, type DailyBest } from './daily'
import { emptyLog, foldRound, type ExperimentLog } from './runlog'
import { sfx, type SfxName } from './audio'
import {
  ashBreakdown,
  ashFor,
  buySeed,
  claimChallenge,
  earnAsh,
  loadMeta,
  nextUnlockGap,
  recordRun,
  selectSeed,
  perkEffects,
  perkCost,
  PERKS,
  buyPerk,
  selectBsl,
  bslDef,
  recordBslClear,
} from './meta'
import { seedById, rollShop, shopRerollCost, type GeneChoice, type ChestOption, type ShopItem } from '../sim'

const PLACE_SOUND: Record<string, SfxName> = {
  hold: 'place_hold',
  grow: 'place_grow',
  strike: 'place_strike',
  guard: 'place_guard',
  bomb: 'place_bomb',
}

// Turn-based duel (the locked gameplay model — see docs/design/adr-turn-based.md):
// a round is turnsPerRound turns of DEPLOY (paused) → INCUBATE (exactly turnGens
// generations, animated) → SETTLE (the scorecard); it ends by extinction or on
// territory at the last settle. The cadence itself lives in the sim's tuning.
const TURNS_PER_ROUND = TUNING.turnsPerRound
const INCUBATE_GENS = TUNING.turnGens
const GEN_DUR = 120 // ms per generation during a resolve — the life-event animation window

/** The settle report, spoken for assistive tech. */
function describeReport(r: TurnReport): string {
  const parts = [
    `Turn ${r.turn} settled.`,
    `You ${r.you >= 0 ? 'grew by' : 'lost'} ${Math.abs(r.you)} cells; the rival ${r.rival >= 0 ? 'grew by' : 'lost'} ${Math.abs(r.rival)}.`,
  ]
  if (r.radicals) parts.push(`${r.radicals} radical cells assimilated.`)
  if (r.chains.length) parts.push(`${r.chains.length} cascade${r.chains.length > 1 ? 's' : ''}, peak ${Math.round(r.peak)}.`)
  if (r.forecast) parts.push(`Forecast held ${r.held} of ${r.forecastCells} cells.`)
  return parts.join(' ')
}

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
  /** The next BLEACH compression this round (turn + inset), or null if none. */
  nextBleach: { turn: number; inset: number } | null
  /** Where the bleach ends this round — the clock's full extent. */
  roundMaxInset: number
  status: Duel['status']
  outcome: string
  pendingChests: number
  plasm: number
  warp: number
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
  /** Phone-class screen: the float HUD renders as full-viewport touch bars
   *  instead of board-hugging corner islands. */
  compact: boolean
}

function computeLayout(w: number, h: number): Layout {
  const aspect = w / h
  const compact = w < 1024
  if (aspect < 1.0) {
    // Portrait PLAY: the board is width-limited (128 columns across the short
    // edge); the tall remainder holds a roomy, thumb-reachable control panel.
    // Render crisp at 3px cells, CSS-upscale to fill the width — capped so the
    // board never eats more than ~half the height (the dock gets the rest).
    const base = 3
    const scale = Math.min(2.6, (w - 12) / (128 * base), (h * 0.52) / (80 * base))
    return {
      mount: 'portrait',
      cell: base,
      railW: 0,
      cssW: Math.round(128 * base * scale),
      cssH: Math.round(80 * base * scale),
      compact: true,
    }
  }
  let mount: Mount
  // Float ("tray") overlays the HUD on the board's corners — the most
  // space-efficient layout, and the only one that fits a phone in landscape
  // (a reserved rail/dock overflows a small screen). So every small screen
  // floats; only roomy desktops split off a rail (ultrawide) or bottom dock
  // (squat), where the reserved band has room to live.
  if (w < 1024) mount = 'float'
  else if (aspect > 2.0) mount = 'rail'
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
  return { mount, cell, railW, cssW, cssH, compact }
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

/** BLEACH — the tactical clock, read in turns: when the field next compresses
 *  and by how much, how far it has closed, and where it ends this round. */
function BleachTrack({ hud }: { hud: Hud | null }) {
  const inset = hud?.inset ?? 0
  const max = hud?.roundMaxInset ?? 0
  const next = hud?.nextBleach ?? null
  if (max <= 0) return null // an open field all round — no clock to read
  const active = inset > 0
  const side = `${(Math.min(1, inset / max) * 50).toFixed(1)}%`
  const label = next ? `T${next.turn} · −${next.inset - inset}` : active ? `−${inset} · closed` : ''
  return (
    <div
      className={`bleach-group ${active ? 'active' : ''}`}
      aria-label={`bleach: field inset ${inset} of ${max}${next ? `, next compression on turn ${next.turn}` : ''}`}
    >
      <span className="lbl-xs">BLEACH</span>
      <div className={`bleach-track ${active ? 'active' : ''}`}>
        <span className="from-left" style={{ width: side }} />
        <span className="from-right" style={{ width: side }} />
      </div>
      <span className="bleach-val num">{label}</span>
    </div>
  )
}

/** How far the specimen has strayed from pure Conway, filling toward the
 *  round's warp cap. The spectral fill is the pure→warped gradient made visible. */
function WarpMeter({ warp, cap }: { warp: number; cap: number }) {
  if (cap <= 0) return null // round 1's cap is 0 — no warp is possible, so hide the empty rail
  const capShown = Number.isFinite(cap) ? cap : 10
  const frac = capShown > 0 ? Math.min(1, warp / capShown) : warp > 0 ? 1 : 0
  return (
    <div className="warp-group" aria-label={`warp ${warp} of ${capShown}`}>
      <span className="lbl-xs">WARP</span>
      <div className={`warp-track ${warp > 0 ? 'lit' : ''}`}>
        <span className="warp-fill" style={{ width: `${(frac * 100).toFixed(1)}%` }} />
      </div>
      <span className="warp-val num">
        {warp}
        <span className="warp-cap">/{capShown}</span>
      </span>
    </div>
  )
}

/** The turn instrument: a turn tracker + the commit button (replaces the throttle). */
function IncubateControl({
  turn,
  phase,
  disabled,
  onIncubate,
}: {
  turn: number
  phase: 'deploy' | 'incubate'
  disabled: boolean
  onIncubate: () => void
}) {
  return (
    <div className="incubate-well">
      <div className="turn-line">
        <span className="lbl-xs">TURN</span>
        <span className="turn-pips" aria-label={`turn ${turn} of ${TURNS_PER_ROUND}`}>
          {Array.from({ length: TURNS_PER_ROUND }, (_, i) => (
            <i key={i} className={i < turn ? 'done' : ''} />
          ))}
        </span>
        <span className="turn-count num">{turn}/{TURNS_PER_ROUND}</span>
      </div>
      <button
        className={`incubate-btn ${phase === 'incubate' ? 'running' : ''}`}
        disabled={disabled || phase === 'incubate'}
        onClick={onIncubate}
        aria-label="incubate — run the culture forward one turn (space)"
      >
        {phase === 'incubate' ? 'INCUBATING…' : <>INCUBATE <span className="ib-key">SPACE</span></>}
      </button>
    </div>
  )
}

const ROLE_COLOR: Record<string, string> = {
  hold: '#9db2d0', grow: 'var(--you)', strike: 'var(--rival)', guard: '#6ea8ff', bomb: 'var(--gold)',
}

/** The armed-card readout: with a card selected the bulky hand tray hides so the
 *  slide is clear to aim on, and THIS shows the card's detail + aim hints instead
 *  (the tray's own blurb would render off the bottom of the screen). */
function ArmedCard({
  duel,
  selected,
  rotation,
  onSelect,
  onCancel,
  onRotate,
  compact = false,
}: {
  duel: Duel
  selected: number
  rotation: number
  onSelect: (i: number) => void
  onCancel: () => void
  onRotate: () => void
  compact?: boolean
}) {
  const p = duel.patternFor(PLAYER, duel.hand[selected])
  const cells = rotate(p.cells, rotation)
  const w = Math.max(...cells.map(([x]) => x)) + 1
  const h = Math.max(...cells.map(([, y]) => y)) + 1
  const size = Math.max(w, h, 4)
  const roleColor = ROLE_COLOR[p.role] ?? 'var(--dim)'
  return (
    <div className={`armed-card ${compact ? 'compact' : ''}`} role="status" aria-label={`aiming ${p.name}: ${p.tip}`}>
      <div className="armed-tile" aria-hidden="true">
        <svg viewBox={`0 0 ${size} ${size}`}>
          {cells.map(([x, y]) => (
            <circle key={`${x},${y}`} cx={x + (size - w) / 2 + 0.45} cy={y + (size - h) / 2 + 0.45} r={0.44} fill={COLORS.player} />
          ))}
        </svg>
      </div>
      <div className="armed-body">
        <div className="armed-head">
          <span className="armed-name" style={{ color: roleColor }}>{p.name}</span>
          <span className="armed-role" style={{ color: roleColor }}>{p.role}</span>
          <span className="armed-cost num">⬢ {p.cost}</span>
        </div>
        <div className="armed-tip">{p.tip}</div>
      </div>
      <div className="armed-switch" role="group" aria-label="switch card">
        {duel.hand.map((_, i) => (
          <button key={i} className={`armed-chip ${i === selected ? 'on' : ''}`} onClick={() => onSelect(i)} aria-label={`card ${['Q', 'W', 'E'][i]}`}>
            {['Q', 'W', 'E'][i]}
          </button>
        ))}
      </div>
      {compact ? (
        <div className="armed-hints">
          <span className="armed-howto">drag the slide · lift to place</span>
          {p.dir !== undefined && (
            <button className="armed-btn" onClick={onRotate} aria-label="rotate piece">⟳ turn</button>
          )}
          <button className="armed-btn armed-cancel" onClick={onCancel} aria-label="cancel">✕</button>
        </div>
      ) : (
        <div className="armed-hints">
          <span>click a lit cell</span>
          {p.dir !== undefined && <span><kbd>R</kbd> rotate</span>}
          <button className="armed-cancel" onClick={onCancel}><kbd>Esc</kbd> cancel</button>
        </div>
      )}
    </div>
  )
}

function FilterSet({ scheme }: { scheme: PaletteMode }) {
  const s = SCHEMES[scheme]
  // A passive readout of the active dye pair — the gear beside it opens settings.
  return (
    <div className="filter-set" aria-label={`filter set: ${s.youName} and ${s.rivalName}`}>
      <span className="lbl-xs">FILTER SET</span>
      <span className="stains">
        <span className="stain-you">{s.youName}</span>
        <span className="stain-sep">/</span>
        <span className="stain-rival">{s.rivalName}</span>
      </span>
    </div>
  )
}

function Tickers({ hud }: { hud: Hud | null }) {
  return (
    <div className="tickers">
      <span className="lysed num" key={`k${hud?.destroyed ?? 0}`} title="rival cells lysed">
        <span className="lbl-xs">LYSED</span>
        {(hud?.destroyed ?? 0).toLocaleString()}
      </span>
      <span className="assim num" key={`c${hud?.captured ?? 0}`} title="cells assimilated into your culture">
        <span className="lbl-xs">ASSIM</span>
        {hud?.captured ?? 0}
      </span>
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
  // Records set by the run that just ended, for the cash-out's headline.
  const [runRecord, setRunRecord] = useState<{
    peak: number
    newBest: boolean
    newFrontier: boolean
  } | null>(null)
  // The title screen shows first; START drops into a fresh run.
  const [screen, setScreen] = useState<'title' | 'game'>('title')
  const [showHowTo, setShowHowTo] = useState(false)
  const metaRef = useRef(meta)
  metaRef.current = meta
  const duelRef = useRef<Duel | null>(null)
  // The build DRAFTED during this run (shop + chests). It persists across the
  // 3 rounds (round 1's harvest is round 3's power) and is wiped on a new run.
  // Every run's BASE loadout is now empty — no start-of-run power; the board
  // opens pure B3/S23 and only strays as you draft, gated by the round's warp cap.
  const runLoadoutRef = useRef<GeneChoice[]>([])
  // PLASM harvested this run, spent in the between-round shop. Persists across
  // the 3 rounds, wiped on a new run.
  const runPlasmRef = useRef(0)
  const debug = useMemo(() => new URLSearchParams(location.search).has('debug'), [])
  const layout = useLayout()
  // eslint-disable-next-line react-hooks/exhaustive-deps -- loadout snapshots at run start
  const duel = useMemo(() => {
    const r = ROUNDS[round - 1]
    const b = bslDef(metaRef.current.bsl) // difficulty scales the rival + storm
    const d = new Duel(
      round === 1 ? seed : `${seed}-r${round}`,
      {
        aiSamples: r.aiSamples + b.aiSamplesAdd,
        rivalActs: r.rivalActs + b.rivalActsAdd,
        // Per-round BLEACH schedule (a turn clock), started earlier by the difficulty (BSL).
        bleachFromTurn: r.bleachFromTurn > 0 ? Math.max(1, r.bleachFromTurn - b.bleachEarlier) : 0,
        bleachPerTurn: r.bleachPerTurn,
      },
      [], // no equipped start-power — power is earned in-run
      r.rivalLoadout,
      metaRef.current.seedSel,
      r.rivalSeed,
    )
    d.warpCap = r.warpCap
    d.runLoadout = runLoadoutRef.current
    d.perkIncome = perkEffects(metaRef.current).incomeBonus // Vitality perk (survives rebuilds)
    d.rebuildPlayer()
    d.autoRival = false // the rival deploys at the start of YOUR deploy phase (telegraphed), never mid-incubation
    return d
  }, [seed, run, round])
  duelRef.current = duel
  if (debug) (window as unknown as { __duel?: unknown }).__duel = duel

  // Turn-based driver state (source of truth in refs; state mirrors drive the UI).
  const [turnNum, setTurnNum] = useState(1)
  const [turnPhase, setTurnPhase] = useState<'deploy' | 'incubate'>('deploy')
  const turnRef = useRef(1)
  const phaseRef = useRef<'deploy' | 'incubate'>('deploy')
  const incTargetRef = useRef(0)
  const [selected, setSelected] = useState<number | null>(null)
  const [rotation, setRotation] = useState(0)
  const [hud, setHud] = useState<Hud | null>(null)

  const canvasRef = useRef<HTMLCanvasElement>(null)
  const hoverRef = useRef<{ x: number; y: number } | null>(null)
  const flashesRef = useRef<Flash[]>([])
  const pulsesRef = useRef<Pulse[]>([])
  const sparksRef = useRef<Spark[]>([])
  const floatsRef = useRef<FloatText[]>([])
  // The SETTLE scorecard for the turn that just resolved (dismissed by planning input).
  const [settleReport, setSettleReport] = useState<TurnReport | null>(null)
  const dismissSettle = useCallback(() => setSettleReport(null), [])
  /** This turn's placements while it resolves — the causal sources drawn on the slide. */
  const turnPlacementsRef = useRef<PlacementRecord[]>([])
  /** The run as an experiment: folded from each finished round, read out as LAB NOTES. */
  const runLogRef = useRef<ExperimentLog>(emptyLog())
  const seedRef = useRef(seed)
  seedRef.current = seed
  const [dailyOutcome, setDailyOutcome] = useState<{ best: DailyBest | null; newBest: boolean; result: DailyBest } | null>(null)
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
  const boom = useCallback(
    (strength = 1) => {
      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
      setShake(strength >= 1.5 ? 'shaking hard' : 'shaking')
      window.clearTimeout(shakeTimer.current)
      shakeTimer.current = window.setTimeout(() => setShake(''), strength >= 1.5 ? 420 : 280)
    },
    [],
  )
  // Bloom/brightness spike shared between the frame loop and the release beat.
  const punchRef = useRef(0)
  const [surge, setSurge] = useState('')
  const surgeTimer = useRef(0)
  const selectedRef = useRef(selected)
  const rotationRef = useRef(rotation)
  selectedRef.current = selected
  rotationRef.current = rotation

  // The rival's telegraphed deploy: flash + ring + name each placement in its
  // hue, so you read what it seeded before you plan against it.
  const telegraph = useCallback((placed: Placed[]) => {
    for (const p of placed) {
      flashesRef.current.push({ cells: p.cells, ttl: 14, color: COLORS.rival })
      const cx = p.cells.reduce((a, [x]) => a + x, 0) / p.cells.length + 0.5
      const cy = p.cells.reduce((a, [, y]) => a + y, 0) / p.cells.length + 0.5
      pulsesRef.current.push({ x: cx, y: cy, ttl: 26, max: 26, maxR: 3.6 * CELL, color: COLORS.rival })
      floatsRef.current.push({
        x: cx,
        y: cy - 1.2,
        text: `▲ ${patternById(p.patternId).name.toUpperCase()}`,
        color: COLORS.rival,
        ttl: 110,
        max: 110,
      })
    }
    if (placed.length) sfx.play('place_strike')
  }, [])


  const startRun = useCallback((nextSeed: string) => {
    runLoadoutRef.current = [] // wipe the drafted build — every run starts pure
    runPlasmRef.current = perkEffects(metaRef.current).startPlasm // Reserve Culture perk
    runLogRef.current = emptyLog()
    setDailyOutcome(null)
    setSettleReport(null)
    setSeed(nextSeed)
    setRun((r) => r + 1)
    setRound(1)
    setSelected(null)
    setAshEarned(null)
    setChallengeBounty(0)
    setRunRecord(null)
    setShowGenome(false)
    flashesRef.current = []
  }, [])
  const newRun = useCallback(() => startRun(randomSeed()), [startRun])

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
    setAshEarned(null)
    setChallengeBounty(0)
    setRunRecord(null)
    flashesRef.current = []
  }, [])

  // Commit the turn: run one INCUBATE window. The loop advances the turn (or ends
  // the round via forceEnd at the last turn), which fires the existing meta flow.
  const incubate = useCallback(() => {
    const d = duelRef.current
    if (!d || d.status !== 'running' || phaseRef.current !== 'deploy') return
    incTargetRef.current = d.state.gen + INCUBATE_GENS
    d.beginIncubate() // the settle report measures what the culture does from here
    turnPlacementsRef.current = d.placements.filter((p) => p.turn === d.turn)
    phaseRef.current = 'incubate'
    setTurnPhase('incubate')
    setSelected(null)
    setSettleReport(null)
    sfx.play('release')
    // The release beat: a bloom surge as time lets go.
    if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      punchRef.current = Math.max(punchRef.current, 0.55)
      setSurge('surge')
      window.clearTimeout(surgeTimer.current)
      surgeTimer.current = window.setTimeout(() => setSurge(''), 340)
    }
  }, [])

  // A fresh round: reset the turn cursor, then let the rival telegraph its
  // opening deploy so you plan turn 1 against it (exactly once per duel).
  const deployedFor = useRef(new WeakSet<Duel>())
  useEffect(() => {
    turnRef.current = duel.turn; setTurnNum(duel.turn)
    phaseRef.current = 'deploy'; setTurnPhase('deploy')
    setSettleReport(null)
    if (!deployedFor.current.has(duel)) {
      deployedFor.current.add(duel)
      telegraph(duel.rivalDeploy())
    }
  }, [duel, telegraph])

  const selectCard = useCallback(
    (i: number) => {
      setSelected((cur) => {
        if (cur === i) return null
        const id = duel.hand[i]
        if (!id) return cur
        setRotation(aimRotation(id))
        sfx.play('select')
        setSettleReport(null) // planning input dismisses the scorecard
        return i
      })
    },
    [duel],
  )

  // Reroll: spend biomass to dig for a better hand. A version bump forces an
  // immediate re-render (the ~100ms HUD tick would otherwise lag the new hand);
  // bumping unconditionally covers the whole-hand case where nothing was
  // selected, so setSelected(null) alone wouldn't have scheduled a render.
  const [, bumpHand] = useState(0)
  const rerollCard = useCallback((i: number) => {
    if (duelRef.current?.rerollCard(i)) {
      sfx.play('place_grow')
      setSelected(null)
      bumpHand((n) => n + 1)
    } else sfx.play('invalid')
  }, [])
  const rerollHand = useCallback(() => {
    if (duelRef.current?.rerollHand()) {
      sfx.play('release')
      setSelected(null)
      bumpHand((n) => n + 1)
    } else sfx.play('invalid')
  }, [])

  // ── in-run chests: crack a plasmid, splice a mutagen ──────────────────────
  const [chestOpen, setChestOpen] = useState(false)
  const [, setChestNonce] = useState(0) // bump to recompute the offer after a pick
  const openChest = useCallback(() => {
    const d = duelRef.current
    if (d && d.pendingChests > 0 && d.status === 'running') {
      setChestOpen(true)
      sfx.play('select')
    }
  }, [])
  const pickChest = useCallback((opt: ChestOption) => {
    const d = duelRef.current
    if (!d) return
    d.applyChestPick({ key: opt.key, level: opt.level })
    sfx.play(opt.warp >= 3 ? 'newbest' : 'place_grow')
    punchRef.current = Math.max(punchRef.current, 0.7)
    setChestNonce((n) => n + 1)
    if (d.pendingChests <= 0) setChestOpen(false)
  }, [])

  // ── between-round shop: spend PLASM to choose what strays next round ───────
  const [shopOpen, setShopOpen] = useState(false)
  const [shopRerolls, setShopRerolls] = useState(0)
  const [shopStock, setShopStock] = useState<ShopItem[]>([])
  const [shopBought, setShopBought] = useState<Set<string>>(new Set())
  const [, bumpShop] = useState(0)
  const mergeDraft = (key: string, level: number) => {
    const arr = runLoadoutRef.current
    const i = arr.findIndex((x) => (typeof x === 'string' ? x : x.key) === key)
    if (i >= 0) arr[i] = { key, level }
    else arr.push({ key, level })
  }
  const openShop = useCallback(() => {
    setShopRerolls(0)
    setShopBought(new Set())
    setShopStock(rollShop(seed, round, 0, runLoadoutRef.current))
    setShopOpen(true)
  }, [seed, round])
  const buyItem = useCallback(
    (it: ShopItem) => {
      if (runPlasmRef.current < it.price || shopBought.has(it.key)) return
      runPlasmRef.current -= it.price
      mergeDraft(it.key, it.level)
      setShopBought((s) => new Set(s).add(it.key))
      sfx.play(it.warp >= 3 ? 'newbest' : 'place_grow')
      bumpShop((n) => n + 1)
    },
    [shopBought],
  )
  const shopRerollEffCost = (rerolls: number) => {
    const free = perkEffects(metaRef.current).freeRerolls
    return rerolls < free ? 0 : shopRerollCost(rerolls - free)
  }
  const rerollShop = useCallback(() => {
    const cost = shopRerollEffCost(shopRerolls)
    if (runPlasmRef.current < cost) return
    runPlasmRef.current -= cost
    const r = shopRerolls + 1
    setShopRerolls(r)
    setShopBought(new Set())
    setShopStock(rollShop(seed, round, r, runLoadoutRef.current))
    sfx.play('select')
  }, [seed, round, shopRerolls])

  // The loop: fixed-timestep sim ticks driven by rAF, render every frame.
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || screen !== 'game') return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    setCell(layout.cell)
    const dpr = window.devicePixelRatio || 1
    canvas.width = duel.t.width * CELL * dpr
    canvas.height = duel.t.height * CELL * dpr
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

    let raf = 0
    let last = performance.now()
    let lastTick = last // generation clock: one tick per GEN_DUR (the anim window)
    let hudAt = 0
    let prevInset = duel.state.ringInset
    let prevStatus = duel.status
    let settledAtGen = -1 // the gen the last settle() ran at, so a round-ending settle isn't filed twice
    let hintText: string | null = null
    let hintGrade: 'poor' | 'fair' | 'good' | 'great' | null = null
    let lastBoomAt = 0
    let lastCrunchAt = 0
    let lastDeaths = 0
    const onBoom = boom
    // ── hit-stop + The Chain ────────────────────────────────────────────────
    const hs = !window.matchMedia('(prefers-reduced-motion: reduce)').matches
    let freezeUntil = 0
    let prevBanks = duel.bankedCombos.length
    let banner: {
      text: string
      sub: string
      color: string
      ttl: number
      max: number
    } | null = null
    let taught = localStorage.getItem('god-taught') === '1'
    let clockNow = last // shared frame clock, so freeze() can schedule off it
    const freeze = (ms: number, p: number) => {
      if (!hs) return
      freezeUntil = Math.max(freezeUntil, clockNow + ms)
      punchRef.current = Math.max(punchRef.current, p)
    }

    const frame = (now: number) => {
      clockNow = now
      last = now
      const incubating = phaseRef.current === 'incubate' && duel.status === 'running'
      const frozen = now < freezeUntil // hit-stop holds the sim on impact frames
      let ticked = false
      // Generation clock: exactly one tick per GEN_DUR, so each transition has a
      // window to animate over (render interpolates on fx.genT below).
      if (incubating && !frozen && now - lastTick >= GEN_DUR) {
        lastTick = now
        {
          duel.tick()
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
                text: `−${b.kills}`,
                color: COLORS.martyr,
                ttl: 50,
                max: 50,
              })
            }
            if (now - lastBoomAt > 180) {
              sfx.play('boom')
              lastBoomAt = now
              onBoom()
              freeze(90, 0.8) // a detonation freezes the frame so the blast reads
            }
          }
        }
        // Turn complete: SETTLE. The sim files the scorecard and, on the last
        // turn, ends the round on territory (the status-change block below then
        // runs the round-end meta). Otherwise: read the report, watch the rival
        // telegraph its next move, and plan again.
        if (duel.state.gen >= incTargetRef.current && duel.status === 'running') {
          const report = duel.settle()
          settledAtGen = duel.state.gen
          // Wipe the resolution's transient callouts so they don't linger over
          // the board while you line up the next move.
          floatsRef.current = []
          if (duel.status === 'running') {
            phaseRef.current = 'deploy'; setTurnPhase('deploy'); setSelected(null)
            turnRef.current = duel.turn; setTurnNum(duel.turn)
            setSettleReport(report)
            telegraph(duel.rivalDeploy())
            setAnnounce(describeReport(report))
          }
        }
      }

      // Conversion sparks: any cell that changed hands this generation. During
      // an active chain they burn brighter and in the tier's color.
      if (ticked) {
        const { cells, prev } = duel.state
        const w = duel.t.width
        const combo = duel.combo
        const tierCol = combo.active ? TIER_COLORS[Math.max(0, combo.tier)] : '#fff'
        const sparkTtl = combo.active ? 13 : 8
        let budget = 90
        for (let i = 0; i < cells.length && budget > 0; i++) {
          if (cells[i] > 0 && prev[i] > 0 && cells[i] !== prev[i]) {
            sparksRef.current.push({ x: i % w, y: Math.floor(i / w), ttl: sparkTtl, color: tierCol })
            budget--
            // Teach the faction hook in-situ the first time it happens.
            if (!taught) {
              const fx0 = i % w
              const fy0 = Math.floor(i / w)
              if (cells[i] === PLAYER && (prev[i] === RIVAL || prev[i] === RADICALS)) {
                floatsRef.current.push({ x: fx0, y: fy0 - 0.6, text: 'FLANKED — the front is yours', color: COLORS.player, ttl: 95, max: 95 })
                taught = true
                localStorage.setItem('god-taught', '1')
              } else if (cells[i] === RIVAL && prev[i] === PLAYER) {
                floatsRef.current.push({ x: fx0, y: fy0 - 0.6, text: 'OUTNUMBERED — your cells defect', color: COLORS.rival, ttl: 95, max: 95 })
                taught = true
                localStorage.setItem('god-taught', '1')
              }
            }
          }
        }
        // A front collapsing all at once earns a crunch + a small hit-stop.
        const rd = duel.state.deaths[RIVAL] + duel.state.deaths[PLAYER]
        const delta = rd - lastDeaths
        if (delta >= 14 && now - lastCrunchAt > 220) {
          sfx.play('crunch')
          lastCrunchAt = now
          freeze(Math.min(130, 40 + delta * 2), Math.min(0.6, delta / 45))
        }
        lastDeaths = rd
      }

      // The Chain: a banked cascade slams a tier callout (MASSACRE+) or floats a
      // small one, steps the audio arpeggio up, and freezes the frame.
      if (duel.bankedCombos.length > prevBanks) {
        for (let k = prevBanks; k < duel.bankedCombos.length; k++) {
          const bc = duel.bankedCombos[k]
          const name = CHAIN_TIERS[bc.tier].name
          const col = TIER_COLORS[bc.tier]
          sfx.chain(bc.tier)
          if (bc.tier >= CHAIN_CELEBRATE_TIER) {
            banner = {
              text: name,
              sub: `CHAIN ×${Math.round(bc.total)} · +${chainAshValue(bc.tier)} ash`,
              color: col,
              ttl: 80,
              max: 80,
            }
            freeze(70 + bc.tier * 22, 0.95)
            onBoom(bc.tier >= 3 ? 1.6 : 1)
          } else {
            floatsRef.current.push({ x: bc.cx, y: bc.cy - 1, text: `${name} +${chainAshValue(bc.tier)}`, color: col, ttl: 60, max: 60 })
          }
        }
        prevBanks = duel.bankedCombos.length
      }
      if (banner) {
        banner.ttl--
        if (banner.ttl <= 0) banner = null
      }

      // Event edges: a bleach step (the clock ticking), and the duel's verdict.
      if (duel.state.ringInset > prevInset) {
        stormFlashRef.current = 0.9
        sfx.play('storm')
        setAnnounce(`Bleach: the field closed by ${duel.state.ringInset - prevInset} cells on every edge.`)
      }
      prevInset = duel.state.ringInset
      if (prevStatus === 'running' && duel.status !== 'running') {
        const won = duel.status === 'won'
        sfx.play(won ? 'win' : 'lose')
        freeze(150, 1) // the climax lands on a held frame
        // File the last turn's report (an extinction mid-incubation never reached
        // settle) and fold the round into the run's experiment log.
        if (duel.state.gen !== settledAtGen) duel.settle()
        runLogRef.current = foldRound(runLogRef.current, duel)
        // Bank the round's harvest into the run wallet for the between-round shop.
        runPlasmRef.current += duel.plasm
        setChestOpen(false)
        const runClear = won && round === ROUNDS.length
        // DAILY CULTURE: the run's result is comparable against the day's record.
        if (isDailySeed(seedRef.current) && (!won || runClear)) {
          const result: DailyBest = {
            seed: seedRef.current,
            round,
            cleared: runClear,
            territory: duel.state.pops[PLAYER],
            cascades: runLogRef.current.cascades,
          }
          const prevBest = loadDailyBest(seedRef.current)
          setDailyOutcome({ best: prevBest, newBest: recordDaily(result), result })
        }
        // A round deeper than you've ever reached pays a frontier bounty — read
        // the pre-update record so win and loss are scored the same way.
        const frontier = round > metaRef.current.bestRound
        // BSL difficulty multiplies the payout: harder specimen, more research.
        const bslMult = bslDef(metaRef.current.bsl).ashMult
        const base = Math.round(ashFor(duel, runClear, { newFrontier: frontier }) * bslMult)
        // Clearing the full gauntlet at your ceiling unlocks the next BSL.
        const bslUnlock =
          runClear && metaRef.current.bsl === metaRef.current.bslMax && metaRef.current.bslMax < 4
        // A challenge seed pays a one-time bounty the first time it's cleared.
        const cseed = seedById(duel.colonySeed)
        const challengeHit = won && !!cseed.challenge && !metaRef.current.challenges.includes(duel.colonySeed)
        const bounty = challengeHit ? cseed.challenge!.rewardAsh : 0
        setChallengeBounty(bounty)
        setAshEarned(base + bounty)
        const peak = Math.round(duel.summary.peakChain)
        // Records read from the pre-update meta, matching what recordRun will do.
        const newBest = peak > metaRef.current.best
        setMeta((m) => {
          const earned = earnAsh(m, base)
          const paid = challengeHit ? claimChallenge(earned, duel.colonySeed).meta : earned
          const rec = recordRun(paid, peak, round)
          const cleared = runClear ? recordBslClear(rec.meta).meta : rec.meta
          setRunRecord({ peak, newBest: rec.newBest, newFrontier: rec.newFrontier })
          return cleared
        })
        // Speak any record so it reaches assistive tech, not just the visual badge.
        const records = `${newBest ? ` New best cascade: ${peak}.` : ''}${frontier ? ' New frontier reached — deepest round yet.' : ''}${bslUnlock ? ` Biosafety Level ${metaRef.current.bslMax + 1} unlocked.` : ''}`
        setAnnounce(
          won
            ? `${runClear ? 'Run complete — the universe yields.' : `Round ${round} cleared.`} ${base + bounty} ash earned.${challengeHit ? ` Challenge complete: the ${cseed.name} paid a ${bounty} ash bounty.` : ''}${records}`
            : `Your colony is dead. Reached round ${round}. ${base} ash earned.${records}`,
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
          impact.destroyed.forEach((_, k) => {
            const owner = impact.destroyedOwner[k]
            if (owner === RIVAL) rivalHit++
            else if (owner === RADICALS) radicalsTouched++
          })
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
          // No predicted-chain tier here: the forecast is an end-of-horizon
          // snapshot, but chains score cumulative net losses over the arm
          // window — classifying one with the other's ladder would promise a
          // tier that can't be honored. The honest "−N rival" stands on its own;
          // the chain is the emergent payoff you discover as it banks.
          // Own cells the move would smother — the honest downside, shown only
          // when it actually costs you something so a clean placement stays terse.
          const selfCost = impact.ownLost.length > 0 ? ` · −${impact.ownLost.length} yours` : ''
          hintText = `+${impact.gained.length} you${settle} · −${rivalHit} rival${selfCost} · ${radicalsTouched} radicals`
          if (debug)
            (window as unknown as { __impact?: unknown }).__impact = {
              gained: impact.gained.length,
              destroyed: rivalHit,
              ownLost: impact.ownLost.length,
              text: hintText,
            }
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
      const cb = duel.combo
      render(ctx, duel, ghost, impact, flashesRef.current, {
        pulses: pulsesRef.current,
        sparks: sparksRef.current,
        floats: floatsRef.current,
        hoverCell: ghost ? null : hoverRef.current,
        now,
        stormFlash: stormFlashRef.current,
        hint: hintText ? { text: hintText, grade: hintGrade } : null,
        reach: selectedRef.current !== null ? duel.radii[PLAYER] : null,
        punch: punchRef.current,
        warp: duel.playerWarp,
        // Only while the cascade is actually resolving. The sim freezes `combo`
        // when incubate ends, so without this gate a banked "CHAIN N" callout
        // would hang over the frontier through the whole deploy phase — right
        // where you're trying to aim your next placement.
        combo: incubating && cb.active && cb.total >= 5 ? { total: cb.total, tier: cb.tier, x: cb.cx, y: cb.cy } : null,
        banner,
        genT: incubating && !frozen ? Math.min(1, (now - lastTick) / GEN_DUR) : 1,
        anim: incubating && hs,
        sources: incubating
          ? turnPlacementsRef.current.map((p) => ({ x: p.cx, y: p.cy, name: p.name, chain: p.chain }))
          : null,
        // While you plan: the field the next incubation opens with, if it shrinks.
        nextInset: !incubating && duel.status === 'running' ? duel.bleachAtTurn(duel.turn) : null,
      })
      punchRef.current *= 0.82 // the impact spike decays quickly

      if (now - hudAt > 100) {
        hudAt = now
        const s = duel.state
        const sum = duel.summary
        setHud({
          gen: s.gen,
          biomass: Math.floor(duel.biomass[PLAYER]),
          // Income per TURN — what one incubation banks at the current population.
          rate: (duel.income(PLAYER) * INCUBATE_GENS).toFixed(1),
          destroyed: sum.rivalDestroyed,
          captured: sum.radicalsClaimed + sum.rivalConverted,
          inset: s.ringInset,
          nextBleach: duel.nextBleach(),
          roundMaxInset: duel.roundMaxInset,
          status: duel.status,
          outcome: duel.outcome,
          pendingChests: duel.pendingChests,
          plasm: Math.floor(duel.plasm),
          warp: duel.playerWarp,
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
  }, [duel, round, boom, layout.mount, layout.cell, screen, telegraph])

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
    if (selected === null || phaseRef.current !== 'deploy') return // deploy-phase only
    const id = duel.hand[selected]
    const placed = duel.playCard(selected, x, y, rotation)
    if (placed && id) {
      setSettleReport(null)
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

  const onMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
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
      // While any overlay owns the screen, don't let game hotkeys fire behind it
      // (a stray 'n' in the shop would wipe the run; '1'–'4' would resume time).
      if ((chestOpen || shopOpen || showGenome || showSettings || showHowTo) && e.key !== 'Escape')
        return
      if (e.key === ' ' || e.key === 'Enter') {
        e.preventDefault()
        incubate() // commit the turn
      } else if (e.key === 'r' || e.key === 'R') setRotation((r) => (r + 1) % 4)
      else if (e.key === 'n' || e.key === 'N') requestNewRun()
      else if (e.key === 'q' || e.key === 'Q') selectCard(0)
      else if (e.key === 'w' || e.key === 'W') selectCard(1)
      else if (e.key === 'e' || e.key === 'E') selectCard(2)
      else if (e.key === 'c' || e.key === 'C') openChest()
      else if (e.key === 'Escape') {
        setShowSettings(false)
        setShowGenome(false)
        setSelected(null)
      } else if (debug && e.key === 'v') duel.forceEnd('won')
      else if (debug && e.key === 'x') duel.forceEnd('lost')
      else if (debug && e.key === 'b') {
        duel.pendingChests++ // grant a test chest + harvest
        duel.plasm += 30
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [incubate, requestNewRun, debug, duel, selectCard, openChest, chestOpen, shopOpen, showGenome, showSettings, showHowTo])

  // ── derived bits shared by the mounts ────────────────────────────────────
  const over = hud !== null && hud.status !== 'running'
  const canShop = useMemo(
    () =>
      PERKS.some((p) => {
        const c = perkCost(meta, p.key)
        return c !== null && meta.ash >= c
      }) || SEEDS.some((s) => !meta.seedsOwned.includes(s.id) && meta.ash >= s.ashCost),
    [meta],
  )
  const runClear = over && hud.status === 'won' && round === ROUNDS.length

  const canvasEl = (
    <canvas
      ref={canvasRef}
      role="img"
      aria-label="The slide: a living Game of Life culture. Your colony grows from the left, the rival's from the right; the frame shows territory share."
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
        ? ROUNDS[round].boss
          ? `${hud.outcome.toLowerCase().replace(/\.$/, '')} · next: the final specimen — ${ROUNDS[round].label}`
          : `${hud.outcome.toLowerCase().replace(/\.$/, '')} · next, ${ROUNDS[round].label}`
        : `${hud.outcome.toLowerCase().replace(/\.$/, '')} · a full gauntlet, survived`
    : ''

  const cashBreakdown = () => {
    const bd = ashBreakdown(duel, runClear, { newFrontier: runRecord?.newFrontier ?? false })
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
          meta={`${duel.turnReports.length} turns · ${hud.gen} generations · ${ROUNDS[round - 1].label}`}
          peak={runRecord?.peak ?? 0}
          newBest={runRecord?.newBest ?? false}
          newFrontier={runRecord?.newFrontier ?? false}
          nextUnlock={nextUnlockGap(meta)}
          seed={seed}
          lost={hud.status !== 'won'}
          experiment={runLogRef.current}
          daily={dailyOutcome && isDailySeed(seed) ? { date: dailyDate(seed), ...dailyOutcome } : null}
          onGenome={() => setShowGenome(true)}
          primary={
            hud.status === 'won' && round < ROUNDS.length
              ? { label: 'TO THE SHOP →', onClick: openShop }
              : { label: 'NEW RUN [N]', onClick: newRun }
          }
        />
      )}
    </div>
  )

  // The SETTLE scorecard, over the slide while you plan the next turn.
  const settleEl =
    settleReport && !over && turnPhase === 'deploy' ? (
      <Settle report={settleReport} turnsPerRound={TURNS_PER_ROUND} onDismiss={dismissSettle} />
    ) : null

  // A pulsing prompt while a plasmid chest is waiting, and the picker itself.
  const chestPill =
    (hud?.pendingChests ?? 0) > 0 && !over ? (
      <button
        className="chest-pill"
        onClick={openChest}
        aria-label={`${hud?.pendingChests} plasmid chest${(hud?.pendingChests ?? 0) > 1 ? 's' : ''} ready — open`}
      >
        <span className="chest-pill-glyph" aria-hidden="true">
          ⬢
        </span>
        <span className="chest-pill-text">
          PLASMID{(hud?.pendingChests ?? 0) > 1 ? ` ×${hud?.pendingChests}` : ' READY'}
        </span>
        <span className="chest-pill-key" aria-hidden="true">
          C
        </span>
      </button>
    ) : null
  const chestEl =
    chestOpen && duel.pendingChests > 0 ? (
      <ChestPicker
        key={duel.chestIndex}
        options={duel.chestOptions(duel.chestIndex, perkEffects(meta).chestOptions)}
        remaining={duel.pendingChests}
        onPick={pickChest}
        onClose={() => setChestOpen(false)}
      />
    ) : null
  const shopEl = shopOpen ? (
    <div className="shop-backdrop">
      <Shop
        stock={shopStock}
        plasm={Math.floor(runPlasmRef.current)}
        rerollCost={shopRerollEffCost(shopRerolls)}
        nextCap={ROUNDS[round]?.warpCap ?? Infinity}
        bought={shopBought}
        nextRoundLabel={ROUNDS[round]?.label ?? ''}
        round={round + 1}
        nextBoss={ROUNDS[round]?.boss ?? false}
        onBuy={buyItem}
        onReroll={rerollShop}
        onContinue={() => {
          setShopOpen(false)
          nextRound()
        }}
      />
    </div>
  ) : null

  // ── title screen ─────────────────────────────────────────────────────────
  if (screen === 'title') {
    const startGame = (nextSeed?: string) => {
      setShowHowTo(false)
      // The session's first run doesn't route through newRun(): seed the Reserve
      // Culture starting PLASM here so the perk isn't silently skipped on run 1.
      if (nextSeed) startRun(nextSeed)
      else runPlasmRef.current = perkEffects(metaRef.current).startPlasm
      setScreen('game')
    }
    const today = dailySeed()
    return (
      <div className="stage title-stage">
        <TitleScreen
          onStart={() => startGame()}
          onHowTo={() => setShowHowTo(true)}
          onDaily={() => startGame(today)}
          dailyDate={dailyDate(today)}
          dailyBest={loadDailyBest(today)}
        />
        {showHowTo && <HowTo onClose={() => setShowHowTo(false)} onStart={() => startGame()} />}
        <div className="sr-only" role="status" aria-live="polite">
          Title screen. Press Start to begin, or How to Play for the rules.
        </div>
      </div>
    )
  }

  const genomeEl = showGenome && (
    <Genome
      meta={meta}
      onBuySeed={(id) => setMeta((m) => buySeed(m, id))}
      onSelectSeed={(id) => setMeta((m) => selectSeed(m, id))}
      onBuyPerk={(k) => setMeta((m) => buyPerk(m, k))}
      onSelectBsl={(n) => setMeta((m) => selectBsl(m, n))}
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

  // ── portrait mount (phone held upright) ────────────────────────────────────
  // The slide is width-limited up top; a roomy, thumb-reachable dock sits below.
  // Landscape still gives a bigger board for anyone who rotates.
  if (layout.mount === 'portrait') {
    return (
      <div className={`stage mount-portrait ${shake} ${surge}`}>
        <div className="p-top">
          <div className="p-biomass">
            <span className="lbl-xs">BIOMASS</span>
            <span className="biomass-inline">
              <span className="val num">{hud?.biomass ?? 0}</span>
              <span className="rate num">+{hud?.rate ?? '0.0'}/turn</span>
            </span>
          </div>
          <div className="p-round">
            <RoundPips round={round} cleared={over && hud.status === 'won'} />
            <span className="rn">{ROUNDS[round - 1].boss ? 'FINAL' : `R${round}/${ROUNDS.length}`}</span>
          </div>
          <div className="p-menu">
            <button className="ash-readout" onClick={() => setShowGenome(true)} aria-label={`genome — ${meta.ash} ash banked`}>
              <span className="lbl-xs">ASH</span>
              <span className="val num">⬡ {meta.ash}</span>
              {canShop && <span className="shop-badge" />}
            </button>
            <button className="glyph-btn" aria-label="settings" title="settings" onClick={() => setShowSettings(true)}>⚙</button>
            <button
              className={`glyph-btn newrun-island ${armAbandon ? 'armed' : ''}`}
              aria-label={armAbandon ? 'confirm abandon run' : 'new run'}
              onClick={requestNewRun}
            >
              {armAbandon ? '?' : '↺'}
            </button>
          </div>
        </div>

        <div className="p-board">
          <div className="board-frame" style={{ width: layout.cssW, height: layout.cssH }}>
            {canvasEl}
          </div>
        </div>

        <div className="p-dock">
          <div className={`p-hand ${selected !== null ? 'armed' : ''}`}>
            {selected !== null && !over ? (
              <ArmedCard
                duel={duel}
                selected={selected}
                rotation={rotation}
                onSelect={selectCard}
                onCancel={() => setSelected(null)}
                onRotate={() => setRotation((r) => (r + 1) % 4)}
                compact
              />
            ) : (
              <Hand
                duel={duel}
                biomass={hud?.biomass ?? 0}
                selected={selected}
                rotation={rotation}
                onSelect={selectCard}
                onRerollCard={rerollCard}
                onRerollHand={rerollHand}
                variant="rail"
              />
            )}
          </div>
          <IncubateControl turn={turnNum} phase={turnPhase} disabled={over} onIncubate={incubate} />
        </div>

        {settleEl}
        {overlayEl}
        {chestPill}
        {chestEl}
        {shopEl}
        {genomeEl}
        {settingsEl}
        {rotateDetent}
        {srLive}
      </div>
    )
  }

  // ── float mount ──────────────────────────────────────────────────────────
  if (layout.mount === 'float') {
    // The HUD islands. On a roomy screen they hug the board's corners (inside
    // board-frame). On a phone (compact) they render in a full-viewport layer
    // instead — laid out as touch-first top/bottom bars (see .m-hud in CSS) —
    // because the letterboxed board rect is far too narrow to hold them.
    const hudIslands = (
      <>
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
                <span className="rate num">+{hud?.rate ?? '0.0'}/turn</span>
              </span>
            </div>
          </div>
        </div>

        <div className="island isl-tc">
          <div className="round-line">
            <RoundPips round={round} cleared={over && hud.status === 'won'} />
            <span className="rn">
              {ROUNDS[round - 1].boss ? 'FINAL' : `ROUND ${round}/${ROUNDS.length}`}
            </span>
            <span className={`rlabel ${ROUNDS[round - 1].boss ? 'boss' : ''}`}>{ROUNDS[round - 1].label}</span>
          </div>
          <BleachTrack hud={hud} />
          <WarpMeter warp={hud?.warp ?? 0} cap={ROUNDS[round - 1].warpCap} />
        </div>

        <div className="island isl-tr">
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
          <IncubateControl turn={turnNum} phase={turnPhase} disabled={over} onIncubate={incubate} />
        </div>

        <div className={`island isl-bc ${selected !== null ? 'armed' : ''}`}>
          {selected !== null && !over ? (
            <ArmedCard
              duel={duel}
              selected={selected}
              rotation={rotation}
              onSelect={selectCard}
              onCancel={() => setSelected(null)}
              onRotate={() => setRotation((r) => (r + 1) % 4)}
              compact={layout.compact}
            />
          ) : (
            <Hand
              duel={duel}
              biomass={hud?.biomass ?? 0}
              selected={selected}
              rotation={rotation}
              onSelect={selectCard}
              onRerollCard={rerollCard}
              onRerollHand={rerollHand}
              variant="float"
            />
          )}
        </div>

        <div className="island isl-br">
          <Tickers hud={hud} />
          <div className="ticker-meta num">
            <span>gen {hud?.gen ?? 0}</span>
          </div>
        </div>
      </>
    )
    return (
      <div className={`stage mount-float ${shake} ${surge} ${layout.compact ? 'compact' : ''} ${(hud?.inset ?? 0) > 4 ? 'receded' : ''}`}>
        <div className="board-slot">
          <div className="board-frame" style={{ width: layout.cssW, height: layout.cssH }}>
            {canvasEl}
            {!layout.compact && hudIslands}
            {settleEl}
            {overlayEl}
            {chestPill}
            {chestEl}
            {shopEl}
          </div>
          {layout.compact && <div className="m-hud">{hudIslands}</div>}
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
        <span className="lbl-sm">{ROUNDS[round - 1].boss ? 'FINAL' : 'ROUND'}</span>
        <RoundPips round={round} cleared={over && hud.status === 'won'} />
        <span className="rn">
          {round}/{ROUNDS.length}
        </span>
        <span className={`rlabel ${ROUNDS[round - 1].boss ? 'boss' : ''}`}>{over && hud.status === 'won' ? 'cleared' : ROUNDS[round - 1].label}</span>
      </div>
    </div>
  )

  const footerStrip = (
    <div className={`footer-strip ${over ? 'spent' : ''}`}>
      <div className="gen-group">
        <span className="lbl-sm">GEN</span>
        <span className="val num">{hud?.gen ?? 0}</span>
      </div>
      <BleachTrack hud={hud} />
        <WarpMeter warp={hud?.warp ?? 0} cap={ROUNDS[round - 1].warpCap} />
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
          <span className="rate num">+{hud?.rate ?? '0.0'}/turn</span>
        </div>
        <div className="capacity-track">
          <span style={{ width: `${Math.min(100, ((hud?.biomass ?? 0) / 170) * 100)}%` }} />
        </div>
      </div>

      {narrow && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <RoundPips round={round} cleared={over && hud.status === 'won'} />
          <BleachTrack hud={hud} />
        <WarpMeter warp={hud?.warp ?? 0} cap={ROUNDS[round - 1].warpCap} />
        </div>
      )}

      <div className="throttle-block">
        <div className="rail-group-label">
          <span className="lbl-sm">THROTTLE</span>
        </div>
        <IncubateControl turn={turnNum} phase={turnPhase} disabled={over} onIncubate={incubate} />
      </div>

      <div className="rail-spacer" />

      <div className="hand-block">
        <div className="rail-group-label">
          <span className="lbl-sm">{over ? 'HAND · SPENT' : 'HAND'}</span>
          <span className="aside">REACH · {duel.radii[PLAYER]} ON SLIDE</span>
        </div>
        <Hand
          duel={duel}
          biomass={hud?.biomass ?? 0}
          selected={selected}
          rotation={rotation}
          onSelect={selectCard}
          onRerollCard={rerollCard}
          onRerollHand={rerollHand}
          variant={narrow ? 'compact' : 'rail'}
        />
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
        <div className={`board-wrap ${shake} ${surge}`}>
          {canvasEl}
          {settleEl}
          {overlayEl}
        {chestPill}
        {chestEl}
        {shopEl}
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
