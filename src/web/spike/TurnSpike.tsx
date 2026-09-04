/**
 * TURN-BASED DUEL SPIKE — disposable prototype (reach it at /?spike=1).
 *
 * Tests one hypothesis: does time-boxing resolution into committed turns make
 * EXPRESS legible and produce a "spin"? Reuses the real deterministic engine
 * (Duel: Conway + faction combat + the Chain) driven turn-by-turn on a 72×48
 * board with the validated legible "Founders" formation.
 *
 * A turn: DEPLOY (paused, projection ghost grades placements) → WIND-UP (commit
 * ceremony) → RESOLVE (watch K gens run as a reel; chain callouts escalate by
 * tier) → SETTLED (a scorecard confirms what your move did) → repeat 8 turns.
 * Nothing here is wired to the shipped build.
 */

import { useCallback, useEffect, useRef, useState, type CSSProperties, type MouseEvent } from 'react'
import { Duel, PLAYER, RIVAL, RADICALS, CHAIN_TIERS, projectImpact, type Impact } from '../../sim'

const W = 72
const H = 48
const TURNS = 8
const K_STEADY = 12
const K_HOT = 24
const PREVIEW = K_STEADY // the ghost projects the steady window — a WYSIWYG promise
const COLOR = ['#05070c', '#42f59b', '#ff5340', '#7f96ff'] // dead / you / rival / radical
const GLOW = ['rgba(0,0,0,0)', 'rgba(66,245,155,0.55)', 'rgba(255,83,64,0.55)', 'rgba(127,150,255,0.5)']
const CORE = [0, 0.92, 0.92, 0.52] // white-core intensity by faction (radicals dimmer)

// Chain celebration ramp, indexed by tier (SKIRMISH … EXTINCTION EVENT).
const TIER_SIZE = [24, 32, 44, 56, 68]
const TIER_COLOR = ['#ffd84a', '#ff9a3a', '#ff6a2a', '#ff4530', '#fff0e0']

function fitCell(): number {
  const availW = (typeof window !== 'undefined' ? window.innerWidth : 1200) - 48
  const availH = (typeof window !== 'undefined' ? window.innerHeight : 900) - 250
  return Math.max(7, Math.min(16, Math.floor(Math.min(availW / W, availH / H))))
}

function makeDuel(seed: string): Duel {
  const d = new Duel(
    seed,
    { width: W, height: H, radicalsCount: 14, startBiomass: 40, ringGrace: 200, aiActEvery: K_STEADY },
    [{ key: 'vampire', level: 3 }],
    [],
    'founders',
    'founders',
  )
  d.hand[0] = 'vampire' // seat the signature card so the build is visible to test
  return d
}

type Phase = 'deploy' | 'winding' | 'resolve' | 'settled' | 'over'
interface Callout { text: string; tier: number; id: number }
interface Score { dYou: number; dRival: number; kills: number; conv: number; tier: number }

export function TurnSpike() {
  const seedRef = useRef('spike-1')
  const duelRef = useRef<Duel>(makeDuel(seedRef.current))
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const reachRef = useRef<Uint8Array>(new Uint8Array(W * H))
  const timerRef = useRef<number>(0)
  const windRef = useRef<number>(0)
  const settleRef = useRef<number>(0)
  const snapRef = useRef({ you: 0, rival: 0, kills: 0, conv: 0 })
  const lastingRef = useRef<number[]>([]) // the deploy projection's settle cells, echoed after resolve

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
  const [wind, setWind] = useState<{ hot: boolean } | null>(null)
  const [rivalTag, setRivalTag] = useState(false)
  const [score, setScore] = useState<Score | null>(null)
  const [, forceDraw] = useState(0)
  const redraw = useCallback(() => forceDraw((n) => n + 1), [])
  const boardW = W * cell

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

  // Projection: what the hovered placement wins / clears / settles, PREVIEW gens out.
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

  // ── render ──────────────────────────────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    canvas.width = boardW * dpr
    canvas.height = H * cell * dpr
    const ctx = canvas.getContext('2d')!
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    const d = duelRef.current
    const cells = d.state.cells

    // faint illumination pool ground
    const bg = ctx.createRadialGradient(boardW / 2, H * cell * 0.42, 0, boardW / 2, H * cell * 0.42, boardW * 0.7)
    bg.addColorStop(0, '#0a0e18')
    bg.addColorStop(1, '#04060a')
    ctx.fillStyle = bg
    ctx.fillRect(0, 0, boardW, H * cell)

    // reach zone (deploy, card selected)
    if (phase === 'deploy' && sel !== null) {
      ctx.fillStyle = 'rgba(66,245,155,0.09)'
      const mask = reachRef.current
      for (let y = 0; y < H; y++)
        for (let x = 0; x < W; x++)
          if (mask[y * W + x] && cells[y * W + x] === 0) ctx.fillRect(x * cell, y * cell, cell, cell)
    }

    // live cells as additive fluorescent puncta (dense mass blooms brighter)
    ctx.globalCompositeOperation = 'lighter'
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const f = cells[y * W + x]
        if (!f) continue
        const cx = x * cell + cell / 2
        const cy = y * cell + cell / 2
        const r = cell * 0.6
        const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r)
        g.addColorStop(0, `rgba(255,255,255,${CORE[f]})`)
        g.addColorStop(0.38, GLOW[f])
        g.addColorStop(1, 'rgba(0,0,0,0)')
        ctx.fillStyle = g
        ctx.beginPath()
        ctx.arc(cx, cy, r, 0, Math.PI * 2)
        ctx.fill()
      }
    ctx.globalCompositeOperation = 'source-over'

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

    // settle echo: after a resolve, confirm the DEPLOY promise on the settled board
    if (phase === 'settled') for (const idx of lastingRef.current) ring(idx, 'rgba(66,245,155,0.75)', true)

    // projection ghost (deploy)
    if (phase === 'deploy' && sel !== null && proj.cells.length) {
      if (proj.valid && proj.impact) {
        for (const idx of proj.impact.destroyed) ring(idx, 'rgba(255,83,64,0.85)', false, true) // cleared: dashed red
        for (const idx of proj.impact.lasting) ring(idx, '#42f59b', true) // settles: solid green
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

  const onClick = (e: MouseEvent) => {
    if (phase !== 'deploy' || sel === null) return
    const { x, y } = cellFromEvent(e)
    const d = duelRef.current
    if (!d.ghostFor(PLAYER, d.hand[sel], x, y, rot).valid) return
    d.playCard(sel, x, y, rot)
    setSel(null)
    setRot(0)
    computeReach()
    redraw()
  }

  // ── resolve: wind-up ceremony → K-gen reel → settle scorecard ─────────────
  const resolve = (K: number) => {
    if (phase !== 'deploy') return
    const d = duelRef.current
    lastingRef.current = proj.impact?.lasting ?? []
    snapRef.current = {
      you: d.state.pops[PLAYER], rival: d.state.pops[RIVAL],
      kills: d.state.combatDeaths[RIVAL], conv: d.summary.radicalsClaimed + d.summary.rivalConverted,
    }
    setSel(null)
    setCallout(null)
    const hot = K === K_HOT
    setWind({ hot })
    setPhase('winding')
    // HOT trades economy for board: it earns no more income than STEADY (the greed dial).
    let bioAtSteady = 0
    windRef.current = window.setTimeout(() => {
      setWind(null)
      setPhase('resolve')
      const banksBefore = d.bankedCombos.length
      let g = 0
      let prevRival = d.state.pops[RIVAL]
      let tagUntil = -1
      timerRef.current = window.setInterval(() => {
        d.tick()
        g++
        if (hot && g === K_STEADY) bioAtSteady = d.biomass[PLAYER]
        // chain callout — escalate, never let a small late bank stomp the big banner
        if (d.bankedCombos.length > banksBefore) {
          const c = d.bankedCombos[d.bankedCombos.length - 1]
          setCallout((cur) => (cur && cur.tier > c.tier ? cur : { text: `${CHAIN_TIERS[c.tier]?.name ?? 'CHAIN'} +${Math.round(c.total)}`, tier: Math.max(0, c.tier), id: d.bankedCombos.length }))
        }
        // rival deploy telegraph (honest: it acts every aiActEvery gens)
        if (d.state.pops[RIVAL] > prevRival + 2) { setRivalTag(true); tagUntil = g + 2 }
        if (g >= tagUntil && rivalTag) setRivalTag(false)
        prevRival = d.state.pops[RIVAL]
        redraw()
        if (g >= K || d.status !== 'running') {
          window.clearInterval(timerRef.current)
          if (hot && bioAtSteady) d.biomass[PLAYER] = bioAtSteady
          setRivalTag(false)
          finishReel()
        }
      }, 55)
    }, hot ? 460 : 340)
  }

  const finishReel = () => {
    const d = duelRef.current
    if (d.status !== 'running' || turn >= TURNS) { concludeTurn(); return }
    const s = snapRef.current
    setScore({
      dYou: d.state.pops[PLAYER] - s.you,
      dRival: d.state.pops[RIVAL] - s.rival,
      kills: d.state.combatDeaths[RIVAL] - s.kills,
      conv: d.summary.radicalsClaimed + d.summary.rivalConverted - s.conv,
      tier: callout?.tier ?? -1,
    })
    setPhase('settled')
    settleRef.current = window.setTimeout(concludeTurn, 900)
  }

  const concludeTurn = () => {
    window.clearTimeout(settleRef.current)
    const d = duelRef.current
    setScore(null)
    if (d.status !== 'running') { setPhase('over'); return }
    if (turn >= TURNS) {
      const [p, r] = [d.state.pops[PLAYER], d.state.pops[RIVAL]]
      const kp = d.state.combatDeaths[RIVAL], kr = d.state.combatDeaths[PLAYER]
      const win = p !== r ? p > r : kp > kr // tie broken on kills, not silently lost
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

  useEffect(() => () => { window.clearInterval(timerRef.current); window.clearTimeout(windRef.current); window.clearTimeout(settleRef.current) }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (phase === 'settled' && (e.key === 'Enter' || e.key === ' ')) { concludeTurn(); return }
      if (phase !== 'deploy') return
      if (e.key >= '1' && e.key <= '3') setSel(Number(e.key) - 1)
      else if (e.key === 'r' || e.key === 'R') setRot((r) => (r + 1) % 4)
      else if (e.key === 'Enter') resolve(K_STEADY)
      else if (e.key === 'h' || e.key === 'H') resolve(K_HOT)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const restart = () => {
    window.clearInterval(timerRef.current); window.clearTimeout(windRef.current); window.clearTimeout(settleRef.current)
    seedRef.current = 'spike-' + Math.floor(performance.now() % 100000)
    duelRef.current = makeDuel(seedRef.current)
    setTurn(1); setSel(null); setRot(0); setCallout(null); setWind(null); setRivalTag(false); setScore(null); setPhase('deploy')
    computeReach(); redraw()
  }

  const d = duelRef.current
  const you = d.state.pops[PLAYER]
  const rival = d.state.pops[RIVAL]
  const s = d.summary
  const selName = sel !== null ? d.patternFor(PLAYER, d.hand[sel]).name : null
  const grade = (imp: Impact) => {
    const g = imp.lasting.length + imp.destroyed.length * 2
    return g >= 10 ? 'A' : g >= 5 ? 'B' : g >= 2 ? 'C' : 'D'
  }
  const winType = d.status === 'won' ? (rival === 0 ? 'CLEARED' : 'DOMINANT') : you === 0 ? 'DEATH' : 'OUTGROWN'
  const tierC = callout ? TIER_COLOR[Math.min(4, callout.tier)] : '#ffd84a'

  return (
    <div style={S.stage}>
      <style>{KEYFRAMES}</style>
      <div style={{ ...S.hud, width: boardW }}>
        <span style={S.badge}>TURN {Math.min(turn, TURNS)}/{TURNS}</span>
        <span style={S.big}>◈ {Math.floor(d.biomass[PLAYER])}</span>
        <span style={{ color: COLOR[1] }}>you {you}</span>
        <span style={{ color: '#5c6a80' }}>vs</span>
        <span style={{ color: COLOR[2] }}>rival {rival}</span>
        <span style={{ color: '#8391a8', fontSize: 12 }}>kills {d.state.combatDeaths[RIVAL]} · conv {s.radicalsClaimed + s.rivalConverted} · peak chain {Math.round(d.peakChain)}</span>
        <button style={S.ghostBtn} onClick={restart}>↺ new</button>
      </div>

      {/* you/rival balance bar — the most important read, at a glance */}
      <div style={{ ...S.bar, width: boardW }}>
        <div style={{ width: `${(100 * you) / Math.max(1, you + rival)}%`, background: COLOR[1] }} />
        <div style={{ flex: 1, background: COLOR[2] }} />
      </div>

      <div style={{ ...S.boardWrap, width: boardW, height: H * cell, animation: phase === 'resolve' ? 'spikeGlow 1.1s ease-in-out infinite' : undefined }}>
        <canvas
          ref={canvasRef}
          style={{ width: boardW, height: H * cell, borderRadius: 8, cursor: phase === 'deploy' && sel !== null ? 'crosshair' : 'default' }}
          onClick={onClick}
          onMouseMove={(e) => {
            if (phase !== 'deploy' || sel === null) return
            const c = cellFromEvent(e)
            setHover((h) => (h && h.x === c.x && h.y === c.y ? h : c))
          }}
          onMouseLeave={() => setHover(null)}
        />
        {phase === 'resolve' && <div style={S.phaseTag}>◉ RESOLVING</div>}
        {rivalTag && <div style={S.rivalTag}>RIVAL DEPLOYS</div>}
        {wind && (
          <div key={wind.hot ? 'h' : 's'} style={{ ...S.placard, color: wind.hot ? '#ff8a70' : '#42f59b', textShadow: `0 0 30px ${wind.hot ? 'rgba(255,138,112,.6)' : 'rgba(66,245,155,.5)'}` }}>
            {wind.hot ? `HOT ×${K_HOT}` : `STEADY ×${K_STEADY}`}
          </div>
        )}
        {(phase === 'resolve' || phase === 'settled') && callout && (
          <div key={callout.id} style={{ ...S.callout, fontSize: TIER_SIZE[Math.min(4, callout.tier)], color: tierC, textShadow: `0 0 ${16 + callout.tier * 10}px ${tierC}`, animation: callout.tier >= 3 ? 'pop .28s ease-out, shake .3s ease-in-out' : 'pop .28s ease-out' }}>
            {callout.text}
          </div>
        )}
        {phase === 'settled' && score && (
          <div style={S.scorecard}>
            <div style={{ fontSize: 12, letterSpacing: 3, color: '#8391a8' }}>TURN {turn} SETTLED</div>
            <div style={{ fontSize: 16, marginTop: 6 }}>
              <b style={{ color: score.dYou >= 0 ? COLOR[1] : COLOR[2] }}>{score.dYou >= 0 ? '+' : ''}{score.dYou} you</b>
              <span style={{ color: '#5c6a80' }}>  ·  </span>
              <span style={{ color: COLOR[2] }}>{score.kills} cleared</span>
              {score.conv > 0 && <span style={{ color: '#8affc4' }}>  ·  +{score.conv} converted</span>}
            </div>
            {score.tier >= 0 && <div style={{ marginTop: 4, color: TIER_COLOR[Math.min(4, score.tier)], fontWeight: 700 }}>{CHAIN_TIERS[score.tier]?.name}</div>}
            <div style={{ fontSize: 11, color: '#5c6a80', marginTop: 10 }}>click / space →</div>
          </div>
        )}
        {phase === 'over' && (
          <div style={S.overlay}>
            <div style={{ fontSize: 44, letterSpacing: 8, color: d.status === 'won' ? COLOR[1] : COLOR[2], textShadow: `0 0 40px ${d.status === 'won' ? 'rgba(66,245,155,.5)' : 'rgba(255,83,64,.5)'}` }}>
              {winType}
            </div>
            <div style={{ color: '#8391a8', marginTop: 8 }}>{d.outcome}</div>
            <button style={S.primary} onClick={restart}>NEW DUEL</button>
          </div>
        )}
      </div>

      {phase !== 'over' && (
        <div style={{ ...S.dock, width: boardW }}>
          <div style={S.hand}>
            {d.hand.map((id, i) => {
              const p = d.patternFor(PLAYER, id)
              const afford = d.biomass[PLAYER] >= p.cost
              return (
                <button
                  key={i}
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
          {/* projection legend — learn the ghost before hovering */}
          {phase === 'deploy' && sel !== null && (
            <div style={S.legend}>
              <span style={{ color: COLOR[1] }}>◍ settles</span>
              <span style={{ color: COLOR[2] }}>◌ rival cleared</span>
              <span style={{ color: '#c3cfe0' }}>▢ drop</span>
            </div>
          )}
          <div style={S.actions}>
            <span style={S.hint}>
              {phase === 'winding' ? 'committing…'
                : phase === 'resolve' ? 'watching the reel…'
                : phase === 'settled' ? 'front settled'
                : sel === null ? 'pick a card (1–3)'
                : proj.valid && proj.impact
                  ? <>[{grade(proj.impact)}] {selName} · <b style={{ color: COLOR[1] }}>+{proj.impact.lasting.length} settle</b> · <b style={{ color: COLOR[2] }}>{proj.impact.destroyed.length} cleared</b> — click to place</>
                  : `placing ${selName} — hover the lit zone, click to place (R rotates)`}
            </span>
            <button style={S.steady} disabled={phase !== 'deploy'} onClick={() => resolve(K_STEADY)}>
              STEADY · {K_STEADY}g ⏎<em style={S.sub}>safe · rival moves once</em>
            </button>
            <button style={S.hot} disabled={phase !== 'deploy'} onClick={() => resolve(K_HOT)}>
              HOT · {K_HOT}g (H)<em style={S.sub}>greedy · no extra income · rival ×2</em>
            </button>
          </div>
        </div>
      )}

      <div style={{ ...S.note, width: boardW }}>
        pick a card · hover the lit zone to preview what settles · click to place · STEADY or HOT to resolve
      </div>
    </div>
  )
}

const ROLE_COLOR: Record<string, string> = { bomb: '#ff5340', strike: '#ff8a70', grow: '#42f59b', hold: '#5b8cff', guard: '#3fd9d0' }

const KEYFRAMES = `
@keyframes pop { 0% { transform: translateX(-50%) scale(.6); opacity: 0 } 60% { transform: translateX(-50%) scale(1.12); opacity: 1 } 100% { transform: translateX(-50%) scale(1) } }
@keyframes shake { 0%,100% { margin-left: 0 } 25% { margin-left: -4px } 75% { margin-left: 4px } }
@keyframes spikeGlow { 0%,100% { box-shadow: 0 0 0 rgba(66,245,155,0) } 50% { box-shadow: 0 0 26px rgba(66,245,155,.28) } }
@keyframes placardIn { 0% { transform: translate(-50%,-50%) scale(.7); opacity: 0 } 100% { transform: translate(-50%,-50%) scale(1); opacity: 1 } }
@media (prefers-reduced-motion: reduce) { * { animation: none !important } }
`

const S: Record<string, CSSProperties> = {
  stage: { minHeight: '100vh', background: '#05070c', color: '#c3cfe0', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, padding: 16, fontFamily: 'ui-monospace, Menlo, monospace' },
  hud: { display: 'flex', alignItems: 'center', gap: 16, fontSize: 13 },
  badge: { fontWeight: 700, letterSpacing: 2, color: '#c3cfe0' },
  big: { fontSize: 20, fontWeight: 700, color: '#e8c463' },
  bar: { display: 'flex', height: 4, borderRadius: 2, overflow: 'hidden', background: '#0b0f16' },
  ghostBtn: { marginLeft: 'auto', background: 'transparent', color: '#8391a8', border: '1px solid #1b2331', borderRadius: 6, padding: '4px 10px', cursor: 'pointer' },
  boardWrap: { position: 'relative', border: '1px solid #1b2331', borderRadius: 8, lineHeight: 0 },
  phaseTag: { position: 'absolute', top: 10, left: 12, fontSize: 12, letterSpacing: 3, color: '#42f59b', pointerEvents: 'none' },
  rivalTag: { position: 'absolute', top: 10, right: 14, fontSize: 12, letterSpacing: 2, fontWeight: 700, color: '#ff5340', textShadow: '0 0 12px rgba(255,83,64,.6)', pointerEvents: 'none' },
  // NB: .boardWrap sets line-height:0 (canvas gap fix) — these text overlays must reset it.
  placard: { position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', fontSize: 40, fontWeight: 700, letterSpacing: 4, lineHeight: 1.1, animation: 'placardIn .3s ease-out', pointerEvents: 'none' },
  callout: { position: 'absolute', top: 24, left: '50%', fontWeight: 700, letterSpacing: 3, lineHeight: 1.1, pointerEvents: 'none', whiteSpace: 'nowrap' },
  scorecard: { position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', textAlign: 'center', lineHeight: 1.5, padding: '18px 30px', borderRadius: 12, background: 'rgba(8,11,18,0.92)', border: '1px solid #1b2331', animation: 'placardIn .25s ease-out' },
  overlay: { position: 'absolute', inset: 0, background: 'rgba(5,7,12,0.5)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', lineHeight: 1.4, borderRadius: 8 },
  dock: { display: 'flex', flexDirection: 'column', gap: 8 },
  hand: { display: 'flex', gap: 10 },
  card: { flex: 1, display: 'flex', flexDirection: 'column', gap: 2, padding: '8px 12px', textAlign: 'left', background: '#0b0f16', border: '1px solid #1b2331', borderRadius: 10, color: '#c3cfe0', cursor: 'pointer', position: 'relative' },
  cardSel: { boxShadow: '0 0 16px rgba(66,245,155,.25)', background: '#101724' },
  cardKey: { position: 'absolute', top: 8, right: 10, fontSize: 10, color: '#45536b' },
  cardName: { fontWeight: 700, fontSize: 14 },
  cardMeta: { fontSize: 11, color: '#8391a8' },
  legend: { display: 'flex', gap: 16, fontSize: 11, color: '#8391a8', letterSpacing: 0.5 },
  actions: { display: 'flex', alignItems: 'center', gap: 12 },
  hint: { fontSize: 12.5, color: '#8391a8', marginRight: 'auto' },
  steady: { display: 'flex', flexDirection: 'column', alignItems: 'flex-start', padding: '7px 14px', background: 'rgba(66,245,155,.1)', border: '1px solid #42f59b', color: '#42f59b', borderRadius: 8, cursor: 'pointer', fontWeight: 700, letterSpacing: 1 },
  hot: { display: 'flex', flexDirection: 'column', alignItems: 'flex-start', padding: '7px 14px', background: 'rgba(255,138,112,.12)', border: '1px solid #ff8a70', color: '#ff8a70', borderRadius: 8, cursor: 'pointer', fontWeight: 700, letterSpacing: 1 },
  sub: { fontSize: 9.5, fontWeight: 400, fontStyle: 'normal', opacity: 0.75, letterSpacing: 0.2, marginTop: 2 },
  primary: { marginTop: 18, padding: '12px 22px', background: '#42f59b', border: 'none', color: '#05070c', borderRadius: 8, cursor: 'pointer', fontWeight: 700, letterSpacing: 2 },
  note: { fontSize: 11.5, color: '#5c6a80', lineHeight: 1.6, textAlign: 'center' },
}
