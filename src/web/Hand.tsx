import { useRef } from 'react'
import { patternById, rotate, type Duel } from '../sim'
import { COLORS } from './render'

interface HandProps {
  duel: Duel
  biomass: number
  selected: number | null
  rotation: number
  onSelect: (idx: number) => void
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

export function Hand({ duel, biomass, selected, rotation, onSelect }: HandProps) {
  // A slot whose card id changed gets a fresh key → deal-in animation.
  const prevIds = useRef<string[]>([])
  const bumps = useRef<number[]>([])
  duel.hand.forEach((id, i) => {
    if (prevIds.current[i] !== undefined && prevIds.current[i] !== id) {
      bumps.current[i] = (bumps.current[i] ?? 0) + 1
    }
  })
  prevIds.current = [...duel.hand]

  return (
    <div className="hand">
      {duel.hand.map((id, i) => {
        const p = patternById(id)
        const cells = rotate(p.cells, selected === i ? rotation : 0)
        const w = Math.max(...cells.map(([x]) => x)) + 1
        const h = Math.max(...cells.map(([, y]) => y)) + 1
        const size = Math.max(w, h, 4)
        const poor = biomass < p.cost
        return (
          <button
            key={`${i}-${id}-${bumps.current[i] ?? 0}`}
            className={`card dealt ${selected === i ? 'selected' : ''} ${poor ? 'poor' : ''}`}
            onClick={() => onSelect(i)}
            onMouseMove={tiltMove}
            onMouseLeave={tiltReset}
            disabled={duel.status !== 'running'}
          >
            <svg viewBox={`0 0 ${size} ${size}`} className="card-preview">
              {cells.map(([x, y]) => (
                <circle
                  key={`${x},${y}`}
                  cx={x + (size - w) / 2 + 0.45}
                  cy={y + (size - h) / 2 + 0.45}
                  r={0.44}
                  fill={id === 'vampire' ? COLORS.vampire : COLORS.player}
                />
              ))}
            </svg>
            <span className="card-name">{p.name}</span>
            <span className="card-meta">
              <span className="card-cost">⬢ {p.cost}</span>
              <span className={`card-role role-${p.role}`}>{p.role}</span>
            </span>
            <span className="card-blurb">{p.tip}</span>
          </button>
        )
      })}
      <div className="hand-note">seeds must land within {duel.radii[1]} cells of your colony</div>
    </div>
  )
}
