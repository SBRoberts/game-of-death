import { patternById, rotate, type Duel } from '../sim'
import { COLORS } from './render'

interface HandProps {
  duel: Duel
  biomass: number
  selected: number | null
  rotation: number
  onSelect: (idx: number) => void
}

export function Hand({ duel, biomass, selected, rotation, onSelect }: HandProps) {
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
            key={`${i}-${id}`}
            className={`card ${selected === i ? 'selected' : ''} ${poor ? 'poor' : ''}`}
            onClick={() => onSelect(i)}
            disabled={duel.status !== 'running'}
          >
            <svg viewBox={`0 0 ${size} ${size}`} className="card-preview">
              {cells.map(([x, y]) => (
                <rect
                  key={`${x},${y}`}
                  x={x + (size - w) / 2}
                  y={y + (size - h) / 2}
                  width={0.9}
                  height={0.9}
                  fill={COLORS.player}
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
      <div className="hand-note">seeds must land within {duel.t.placementRadius} cells of your colony</div>
    </div>
  )
}
