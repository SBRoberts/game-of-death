import { GENES } from '../sim'
import { nextSlotCost, upgradeCost, type MetaState } from './meta'

interface GenomeProps {
  meta: MetaState
  onBuySlot: () => void
  onBuyGene: (key: string) => void
  onToggleEquip: (key: string) => void
  onClose: () => void
}

export function Genome({ meta, onBuySlot, onBuyGene, onToggleEquip, onClose }: GenomeProps) {
  const slotCost = nextSlotCost(meta)
  return (
    <div className="genome-backdrop" onClick={onClose}>
      <div className="genome" onClick={(e) => e.stopPropagation()}>
        <header>
          <h2>GENOME</h2>
          <span className="genome-ash">⬡ {meta.ash} ash</span>
          <button className="genome-close" onClick={onClose}>
            ✕
          </button>
        </header>

        <div className="genome-slots">
          {Array.from({ length: 5 }, (_, i) => (
            <span
              key={i}
              className={`slot ${i < meta.slots ? 'open' : 'locked'} ${
                i < meta.equipped.length ? 'filled' : ''
              }`}
              title={i < meta.slots ? 'genome slot' : 'locked slot'}
            >
              {i < meta.equipped.length ? '●' : i < meta.slots ? '○' : '·'}
            </span>
          ))}
          {slotCost !== null && (
            <button className="buy-slot" disabled={meta.ash < slotCost} onClick={onBuySlot}>
              unlock slot · ⬡ {slotCost}
            </button>
          )}
          <span className="slot-note">
            {meta.slots === 0
              ? 'Your first run is pure B3/S23. Earn ash; buy capacity.'
              : `equip up to ${meta.slots}`}
          </span>
        </div>

        <div className="genome-list">
          {GENES.map((g) => {
            const level = meta.levels[g.key] ?? 0
            const equipped = meta.equipped.includes(g.key)
            const cost = upgradeCost(meta, g.key)
            // Show what you HAVE, or what level 1 would give you.
            const shown = g.levels[Math.max(level, 1) - 1]
            return (
              <div key={g.key} className={`gene ${level > 0 ? 'owned' : ''} ${equipped ? 'on' : ''}`}>
                <div className="gene-head">
                  <span className="gene-name">{g.name}</span>
                  <span className="gene-pips">
                    {g.levels.map((_, i) => (
                      <i key={i} className={i < level ? 'pip full' : 'pip'}>
                        {i < level ? '◆' : '◇'}
                      </i>
                    ))}
                  </span>
                  <span className={`gene-kind kind-${g.kind}`}>
                    {g.kind === 'card' ? 'card' : 'rule'}
                  </span>
                </div>
                <p>{shown.desc}</p>
                {level > 0 && cost !== null && (
                  <p className="gene-next">next: {g.levels[level].desc}</p>
                )}
                <div className="gene-actions">
                  {level > 0 && (
                    <button
                      className={equipped ? 'equipped' : ''}
                      disabled={!equipped && meta.equipped.length >= meta.slots}
                      onClick={() => onToggleEquip(g.key)}
                    >
                      {equipped ? 'equipped ✓' : 'equip'}
                    </button>
                  )}
                  {cost !== null ? (
                    <button disabled={meta.ash < cost} onClick={() => onBuyGene(g.key)}>
                      {level === 0 ? 'buy' : 'upgrade'} · ⬡ {cost}
                    </button>
                  ) : (
                    <button disabled>maxed</button>
                  )}
                </div>
              </div>
            )
          })}
        </div>

        <footer>changes apply on your next run</footer>
      </div>
    </div>
  )
}
