import { useRef } from 'react'
import { rotate, type Duel } from '../sim'
import { COLORS } from './render'

const ROLE_COLORS: Record<string, string> = {
  hold: '#9db2d0',
  grow: 'var(--you)',
  strike: 'var(--rival)',
  guard: '#6ea8ff',
  bomb: 'var(--gold)',
}

export type HandVariant = 'rail' | 'float' | 'compact'

interface HandProps {
  duel: Duel
  biomass: number
  selected: number | null
  rotation: number
  onSelect: (idx: number) => void
  onRerollCard: (idx: number) => void
  onRerollHand: () => void
  variant: HandVariant
}

const tiltMove = (e: React.MouseEvent<HTMLButtonElement>) => {
  const el = e.currentTarget
  const r = el.getBoundingClientRect()
  el.style.setProperty('--tx', ((e.clientX - r.left) / r.width - 0.5).toFixed(3))
  el.style.setProperty('--ty', ((e.clientY - r.top) / r.height - 0.5).toFixed(3))
}

const tiltReset = (e: React.MouseEvent<HTMLButtonElement>) => {
  e.currentTarget.style.setProperty('--tx', '0')
  e.currentTarget.style.setProperty('--ty', '0')
}

export function Hand({
  duel,
  biomass,
  selected,
  rotation,
  onSelect,
  onRerollCard,
  onRerollHand,
  variant,
}: HandProps) {
  // A slot whose card id changed gets a fresh key → deal-in animation.
  const prevIds = useRef<string[]>([])
  const bumps = useRef<number[]>([])
  duel.hand.forEach((id, i) => {
    if (prevIds.current[i] !== undefined && prevIds.current[i] !== id) {
      bumps.current[i] = (bumps.current[i] ?? 0) + 1
    }
  })
  prevIds.current = [...duel.hand]

  const running = duel.status === 'running'
  const costOne = duel.rerollCost(false)
  const costAll = duel.rerollCost(true)
  const canOne = running && selected !== null && biomass >= costOne
  const canAll = running && biomass >= costAll

  return (
    <>
      <div className={`hand-cards ${variant === 'float' ? 'row' : ''}`}>
      {duel.hand.map((id, i) => {
        const p = duel.patternFor(1, id)
        const cells = rotate(p.cells, selected === i ? rotation : 0)
        const w = Math.max(...cells.map(([x]) => x)) + 1
        const h = Math.max(...cells.map(([, y]) => y)) + 1
        const size = Math.max(w, h, 4)
        const poor = biomass < p.cost
        const isSel = selected === i
        const roleColor = ROLE_COLORS[p.role] ?? 'var(--dim)'
        const traveler = p.dir !== undefined
        const preview = (
          <div className="tile" aria-hidden="true">
            <svg viewBox={`0 0 ${size} ${size}`}>
              {cells.map(([x, y]) => (
                <circle
                  key={`${x},${y}`}
                  cx={x + (size - w) / 2 + 0.45}
                  cy={y + (size - h) / 2 + 0.45}
                  r={0.44}
                  fill={id === 'vampire' ? COLORS.vampire : isSel ? '#8affc4' : COLORS.player}
                />
              ))}
            </svg>
          </div>
        )
        const nameRow = (
          <div className="name-row">
            <span className="name">{p.name}</span>
            <span className="cost num">⬢ {p.cost}</span>
          </div>
        )
        const roleRow = (
          <div className="role-row">
            <span className="role-bar" style={{ background: roleColor }} />
            <span className="role-word" style={{ color: roleColor }}>
              {p.role}
            </span>
          </div>
        )
        // The blurb appears only on the selected card (HANDOFF §5.3).
        const detail = isSel && (
          <>
            <div className="blurb">{p.tip}</div>
            {traveler && (
              <div className="rotate-row">
                <span className="keycap">R</span>
                <span className="hint">rotate · aimed →</span>
              </div>
            )}
          </>
        )
        return (
          <button
            key={`${i}-${id}-${bumps.current[i] ?? 0}`}
            className={`card dealt ${variant === 'float' ? 'float-card' : ''} ${isSel ? 'selected' : ''} ${poor ? 'poor' : ''}`}
            onClick={() => onSelect(i)}
            onMouseMove={tiltMove}
            onMouseLeave={tiltReset}
            disabled={duel.status !== 'running'}
            aria-pressed={isSel}
            aria-label={`${p.name}, ${p.role}, costs ${p.cost} biomass${poor ? ', cannot afford' : ''}. ${p.tip}`}
          >
            {variant === 'float' ? (
              <>
                <div className="head">
                  {preview}
                  <div className="col">
                    {nameRow}
                    {roleRow}
                  </div>
                </div>
                {detail}
              </>
            ) : (
              <>
                {variant !== 'compact' && preview}
                <div className="col">
                  {nameRow}
                  {roleRow}
                  {variant !== 'compact' && detail}
                </div>
              </>
            )}
            <span className="keycap card-key" aria-hidden="true">
              {['Q', 'W', 'E'][i] ?? ''}
            </span>
          </button>
        )
      })}
      </div>
      {running && (
        <div className={`reroll-bar ${variant}`}>
          <button
            className="reroll swap"
            onClick={() => selected !== null && onRerollCard(selected)}
            disabled={!canOne}
            aria-label={
              selected === null
                ? 'select a card to redraw it'
                : `redraw the selected card for ${costOne} biomass`
            }
            title={selected === null ? 'pick a card first' : undefined}
          >
            ↻ swap <span className="rc num">⬢ {costOne}</span>
          </button>
          <button
            className="reroll all"
            onClick={onRerollHand}
            disabled={!canAll}
            aria-label={`redraw the whole hand for ${costAll} biomass`}
          >
            ↻ new hand <span className="rc num">⬢ {costAll}</span>
          </button>
        </div>
      )}
    </>
  )
}
