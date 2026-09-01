import { GENES } from '../sim'
import { nextSlotCost, type MetaState } from './meta'

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
            const owned = meta.owned.includes(g.key)
            const equipped = meta.equipped.includes(g.key)
            return (
              <div key={g.key} className={`gene ${owned ? 'owned' : ''} ${equipped ? 'on' : ''}`}>
                <div className="gene-head">
                  <span className="gene-name">{g.name}</span>
                  <span className={`gene-kind kind-${g.kind}`}>
                    {g.kind === 'card' ? 'card' : 'rule'}
                  </span>
                </div>
                <p>{g.desc}</p>
                {owned ? (
                  <button
                    className={equipped ? 'equipped' : ''}
                    disabled={!equipped && meta.equipped.length >= meta.slots}
                    onClick={() => onToggleEquip(g.key)}
                  >
                    {equipped ? 'equipped ✓' : 'equip'}
                  </button>
                ) : (
                  <button disabled={meta.ash < g.ashCost} onClick={() => onBuyGene(g.key)}>
                    buy · ⬡ {g.ashCost}
                  </button>
                )}
              </div>
            )
          })}
        </div>

        <footer>changes apply on your next run</footer>
      </div>
    </div>
  )
}
