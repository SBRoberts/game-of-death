/**
 * TURN-BASED DUEL SPIKE — disposable prototype (reach it at /?spike=1).
 *
 * Tests one hypothesis: does time-boxing resolution into committed turns make
 * EXPRESS legible and produce a "spin"? It reuses the real deterministic engine
 * (Duel: Conway + faction combat + the Chain) but drives it turn-by-turn on a
 * 72×48 board with the validated legible "Founders" formation.
 *
 * A turn: DEPLOY (paused — spend biomass placing cards) → pick STEADY/HOT →
 * RESOLVE (watch K generations run as an uninterruptable reel) → repeat.
 * Income accrues over the resolved gens, so the budget is earned-per-turn for
 * free. Nothing here is wired to the shipped build.
 */

import { useCallback, useEffect, useRef, useState, type CSSProperties, type MouseEvent } from 'react'
import { Duel, PLAYER, RIVAL, RADICALS, CHAIN_TIERS } from '../../sim'

const W = 72
const H = 48
const CELL = 15
const TURNS = 8
const K_STEADY = 12
const K_HOT = 24
const COLOR = ['#05070c', '#42f59b', '#ff5340', '#7f96ff'] // dead / you / rival / radical

function makeDuel(seed: string): Duel {
  return new Duel(
    seed,
    { width: W, height: H, radicalsCount: 14, startBiomass: 40, ringGrace: 200, aiActEvery: K_STEADY },
    [{ key: 'vampire', level: 3 }], // one signature build so we can watch it express
    [],
    'founders',
    'founders', // both sides start legible so the test isn't muddied by rival soup
  )
}

type Phase = 'deploy' | 'resolve' | 'over'

export function TurnSpike() {
  const seedRef = useRef('spike-1')
  const duelRef = useRef<Duel>(makeDuel(seedRef.current))
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const reachRef = useRef<Uint8Array>(new Uint8Array(W * H))
  const timerRef = useRef<number>(0)

  const [phase, setPhase] = useState<Phase>('deploy')
  const [turn, setTurn] = useState(1)
  const [sel, setSel] = useState<number | null>(null)
  const [rot, setRot] = useState(0)
  const [hover, setHover] = useState<{ x: number; y: number } | null>(null)
  const [callout, setCallout] = useState<string>('')
  const [, forceDraw] = useState(0)
  const redraw = useCallback(() => forceDraw((n) => n + 1), [])

  // ── reach mask: cells within the player's placement radius of a living cell ──
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

  // ── render ────────────────────────────────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    canvas.width = W * CELL * dpr
    canvas.height = H * CELL * dpr
    const ctx = canvas.getContext('2d')!
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    const d = duelRef.current
    const cells = d.state.cells

    ctx.fillStyle = COLOR[0]
    ctx.fillRect(0, 0, W * CELL, H * CELL)

    // reach tint (deploy only, with a card selected)
    if (phase === 'deploy' && sel !== null) {
      ctx.fillStyle = 'rgba(66,245,155,0.06)'
      const mask = reachRef.current
      for (let y = 0; y < H; y++)
        for (let x = 0; x < W; x++)
          if (mask[y * W + x] && cells[y * W + x] === 0) ctx.fillRect(x * CELL, y * CELL, CELL, CELL)
    }

    // live cells as puncta
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const f = cells[y * W + x]
        if (!f) continue
        ctx.fillStyle = COLOR[f]
        ctx.shadowColor = COLOR[f]
        ctx.shadowBlur = f === RADICALS ? 3 : 6
        ctx.beginPath()
        ctx.arc(x * CELL + CELL / 2, y * CELL + CELL / 2, CELL * 0.36, 0, Math.PI * 2)
        ctx.fill()
      }
    ctx.shadowBlur = 0

    // ghost preview
    if (phase === 'deploy' && sel !== null && hover) {
      const id = d.hand[sel]
      const g = d.ghostFor(PLAYER, id, hover.x, hover.y, rot)
      ctx.strokeStyle = g.valid ? '#42f59b' : '#ff5340'
      ctx.lineWidth = 1.5
      for (const [cx, cy] of g.cells) {
        if (cx < 0 || cx >= W || cy < 0 || cy >= H) continue
        ctx.beginPath()
        ctx.arc(cx * CELL + CELL / 2, cy * CELL + CELL / 2, CELL * 0.36, 0, Math.PI * 2)
        ctx.stroke()
      }
    }
  })

  const cellFromEvent = (e: MouseEvent): { x: number; y: number } => {
    const rect = canvasRef.current!.getBoundingClientRect()
    return { x: Math.floor((e.clientX - rect.left) / CELL), y: Math.floor((e.clientY - rect.top) / CELL) }
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

  // ── resolve: run K generations as a reel ────────────────────────────────────
  const resolve = (K: number) => {
    if (phase !== 'deploy') return
    setPhase('resolve')
    setSel(null)
    const d = duelRef.current
    const banksBefore = d.bankedCombos.length
    let g = 0
    timerRef.current = window.setInterval(() => {
      d.tick()
      g++
      // surface the biggest chain that banked this turn, live
      if (d.bankedCombos.length > banksBefore) {
        const c = d.bankedCombos[d.bankedCombos.length - 1]
        setCallout(`${CHAIN_TIERS[c.tier]?.name ?? 'CHAIN'} +${c.total}`)
      }
      redraw()
      if (g >= K || d.status !== 'running') {
        window.clearInterval(timerRef.current)
        endTurn()
      }
    }, 55)
  }

  const endTurn = () => {
    const d = duelRef.current
    if (d.status !== 'running') { setPhase('over'); return }
    if (turn >= TURNS) {
      const [p, r] = [d.state.pops[PLAYER], d.state.pops[RIVAL]]
      d.forceEnd(p > r ? 'won' : 'lost')
      d.outcome = `The turns ran out. Territory: ${p} vs ${r}.`
      setPhase('over')
      return
    }
    setTurn((t) => t + 1)
    computeReach()
    setPhase('deploy')
  }

  useEffect(() => () => window.clearInterval(timerRef.current), [])

  // keyboard: 1/2/3 select, R rotate, Enter steady, H hot
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
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
    window.clearInterval(timerRef.current)
    seedRef.current = 'spike-' + Math.floor(performance.now() % 100000)
    duelRef.current = makeDuel(seedRef.current)
    setTurn(1); setSel(null); setRot(0); setCallout(''); setPhase('deploy')
    computeReach(); redraw()
  }

  const d = duelRef.current
  const you = d.state.pops[PLAYER]
  const rival = d.state.pops[RIVAL]
  const s = d.summary

  return (
    <div style={S.stage}>
      <div style={S.hud}>
        <span style={S.badge}>TURN {Math.min(turn, TURNS)}/{TURNS}</span>
        <span style={S.big}>◈ {Math.floor(d.biomass[PLAYER])}</span>
        <span style={{ color: COLOR[1] }}>you {you}</span>
        <span style={{ color: '#5c6a80' }}>vs</span>
        <span style={{ color: COLOR[2] }}>rival {rival}</span>
        {/* player-attributable signal: combat kills + conversions + peak chain (raw deaths would count soup self-churn) */}
        <span style={{ color: '#8391a8' }}>☠ {d.state.combatDeaths[RIVAL]} · converted {s.radicalsClaimed + s.rivalConverted} · chain {Math.round(d.peakChain)}</span>
        <button style={S.ghostBtn} onClick={restart}>↺ new</button>
      </div>

      <div style={S.boardWrap}>
        <canvas
          ref={canvasRef}
          style={{ width: W * CELL, height: H * CELL, borderRadius: 8, cursor: phase === 'deploy' && sel !== null ? 'crosshair' : 'default' }}
          onClick={onClick}
          onMouseMove={(e) => phase === 'deploy' && sel !== null && setHover(cellFromEvent(e))}
          onMouseLeave={() => setHover(null)}
        />
        {phase === 'resolve' && callout && <div style={S.callout}>{callout}</div>}
        {phase === 'over' && (
          <div style={S.overlay}>
            <div style={{ fontSize: 40, letterSpacing: 8, color: d.status === 'won' ? COLOR[1] : COLOR[2] }}>
              {d.status === 'won' ? 'CLEARED' : 'DEATH'}
            </div>
            <div style={{ color: '#8391a8', marginTop: 8 }}>{d.outcome}</div>
            <button style={S.primary} onClick={restart}>NEW DUEL</button>
          </div>
        )}
      </div>

      {phase !== 'over' && (
        <div style={S.dock}>
          <div style={S.hand}>
            {d.hand.map((id, i) => {
              const p = d.patternFor(PLAYER, id)
              const afford = d.biomass[PLAYER] >= p.cost
              return (
                <button
                  key={i}
                  disabled={phase !== 'deploy' || !afford}
                  onClick={() => setSel(i)}
                  style={{ ...S.card, ...(sel === i ? S.cardSel : {}), opacity: afford ? 1 : 0.4 }}
                >
                  <span style={S.cardKey}>{i + 1}</span>
                  <span style={S.cardName}>{p.name}</span>
                  <span style={S.cardMeta}>◈ {p.cost} · {p.role}</span>
                </button>
              )
            })}
          </div>
          <div style={S.actions}>
            <span style={S.hint}>{sel !== null ? 'click a lit cell to place · R rotates' : 'pick a card (1–3), place, then resolve'}</span>
            <button style={S.steady} disabled={phase !== 'deploy'} onClick={() => resolve(K_STEADY)}>STEADY · {K_STEADY}g ⏎</button>
            <button style={S.hot} disabled={phase !== 'deploy'} onClick={() => resolve(K_HOT)}>HOT · {K_HOT}g (H)</button>
          </div>
        </div>
      )}

      <div style={S.note}>
        Watching for: <b>attribution</b> (after a resolve, can you say "I flipped that front"?) ·
        <b> spin</b> (is the reel satisfying?) · <b>chain</b> (does the vampire build visibly fire?) ·
        <b> greed</b> (is HOT a real temptation?)
      </div>
    </div>
  )
}

const S: Record<string, CSSProperties> = {
  stage: { minHeight: '100vh', background: '#05070c', color: '#c3cfe0', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14, padding: 20, fontFamily: 'ui-monospace, Menlo, monospace' },
  hud: { display: 'flex', alignItems: 'center', gap: 18, fontSize: 13, width: W * CELL },
  badge: { fontWeight: 700, letterSpacing: 2, color: '#c3cfe0' },
  big: { fontSize: 20, fontWeight: 700, color: '#e8c463' },
  ghostBtn: { marginLeft: 'auto', background: 'transparent', color: '#8391a8', border: '1px solid #1b2331', borderRadius: 6, padding: '4px 10px', cursor: 'pointer' },
  boardWrap: { position: 'relative', border: '1px solid #1b2331', borderRadius: 8, lineHeight: 0 },
  callout: { position: 'absolute', top: 16, left: '50%', transform: 'translateX(-50%)', fontSize: 26, fontWeight: 700, letterSpacing: 4, color: '#ffd84a', textShadow: '0 0 20px rgba(255,216,74,.6)', pointerEvents: 'none' },
  overlay: { position: 'absolute', inset: 0, background: 'rgba(5,7,12,0.82)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', borderRadius: 8 },
  dock: { display: 'flex', flexDirection: 'column', gap: 10, width: W * CELL },
  hand: { display: 'flex', gap: 10 },
  card: { flex: 1, display: 'flex', flexDirection: 'column', gap: 2, padding: '10px 12px', textAlign: 'left', background: '#0b0f16', border: '1px solid #1b2331', borderRadius: 10, color: '#c3cfe0', cursor: 'pointer', position: 'relative' },
  cardSel: { border: '1px solid #42f59b', boxShadow: '0 0 16px rgba(66,245,155,.25)' },
  cardKey: { position: 'absolute', top: 8, right: 10, fontSize: 10, color: '#45536b' },
  cardName: { fontWeight: 700, fontSize: 14 },
  cardMeta: { fontSize: 11, color: '#8391a8' },
  actions: { display: 'flex', alignItems: 'center', gap: 12 },
  hint: { fontSize: 12, color: '#8391a8', marginRight: 'auto' },
  steady: { padding: '10px 16px', background: 'rgba(66,245,155,.1)', border: '1px solid #42f59b', color: '#42f59b', borderRadius: 8, cursor: 'pointer', fontWeight: 700, letterSpacing: 1 },
  hot: { padding: '10px 16px', background: 'rgba(255,138,112,.12)', border: '1px solid #ff8a70', color: '#ff8a70', borderRadius: 8, cursor: 'pointer', fontWeight: 700, letterSpacing: 1 },
  primary: { marginTop: 18, padding: '12px 22px', background: '#42f59b', border: 'none', color: '#05070c', borderRadius: 8, cursor: 'pointer', fontWeight: 700, letterSpacing: 2 },
  note: { fontSize: 11.5, color: '#5c6a80', maxWidth: W * CELL, lineHeight: 1.6 },
}
