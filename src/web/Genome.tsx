import { GENES, SLOT_COSTS, geneByKey } from '../sim'
import { nextSlotCost, upgradeCost, type MetaState } from './meta'

interface GenomeProps {
  meta: MetaState
  onBuySlot: () => void
  onBuyGene: (key: string) => void
  onToggleEquip: (key: string) => void
  onClose: () => void
}

const ROMAN = ['I', 'II', 'III']
const CELL_DOTS: Record<string, string> = {
  elder: '#eafcff',
  vampire: '#c46bff',
  martyr: 'var(--gold)',
}

/**
 * The genome as a strand, not a settings page (HANDOFF §5.5): your build is
 * five sockets on a connector line, and above them the actual rule string you
 * are playing — B3/S23 mutating into what you've become, additions lit.
 */
export function Genome({ meta, onBuySlot, onBuyGene, onToggleEquip, onClose }: GenomeProps) {
  // The live rule readout: base B3/S23 plus every equipped rule-gene's digits.
  const birth = new Set([3])
  const survive = new Set([2, 3])
  let mutations = 0
  for (const key of meta.equipped) {
    const gene = geneByKey(key)
    const lvl = gene.levels[(meta.levels[key] ?? 1) - 1]
    if (lvl.addBirth) {
      lvl.addBirth.forEach((d) => birth.add(d))
      mutations++
    }
    if (lvl.addSurvive) {
      lvl.addSurvive.forEach((d) => survive.add(d))
      mutations++
    }
  }
  const digitRun = (set: Set<number>, base: number[]) =>
    [...set]
      .sort((a, b) => a - b)
      .map((d) => (base.includes(d) ? <span key={d}>{d}</span> : <b key={d}>{d}</b>))

  const slotCost = nextSlotCost(meta)
  const sockets = Array.from({ length: SLOT_COSTS.length }, (_, i) => {
    if (i < meta.equipped.length) {
      const key = meta.equipped[i]
      return { kind: 'filled' as const, name: geneByKey(key).name, level: meta.levels[key] ?? 1 }
    }
    if (i < meta.slots) return { kind: 'open' as const }
    return { kind: 'locked' as const, price: SLOT_COSTS[i] }
  })

  return (
    <div
      className="genome-surface"
      role="dialog"
      aria-modal="true"
      aria-label="Genome — spend ash on slots and genes"
      onClick={onClose}
    >
      <div className="strand" onClick={(e) => e.stopPropagation()}>
        <div className="rule-readout">
          <span className="lbl-xs">YOUR RULE</span>
          <span className="rule num" aria-label="your current birth and survival rule">
            B{digitRun(birth, [3])}/S{digitRun(survive, [2, 3])}
          </span>
          <span className="base">
            base B3/S23 · {mutations > 0 ? `+${mutations} mutation${mutations > 1 ? 's' : ''} equipped` : 'unmutated'}
          </span>
        </div>

        <div>
          <div className="lbl-xs" style={{ marginBottom: 10 }}>
            THE STRAND
          </div>
          <div className="strand-list">
            {sockets.map((s, i) => (
              <div key={i}>
                {i > 0 && <div className="strand-connector" />}
                <div className={`socket-row ${s.kind}`}>
                  <span className="node" />
                  {s.kind === 'filled' ? (
                    <div className="plate-mini">
                      <span className="gname">{s.name}</span>
                      <span className="roman">{ROMAN[s.level - 1]}</span>
                    </div>
                  ) : s.kind === 'open' ? (
                    <div className="plate-mini">OPEN SLOT</div>
                  ) : (
                    <div className="plate-mini">
                      LOCKED
                      <span className="price num">⬡ {s.price}</span>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="strand-foot">
          Changes apply on your next run. The rival fields these genes too, from round two.
        </div>
      </div>

      <div className="gene-main" onClick={(e) => e.stopPropagation()}>
        <div className="gene-header">
          <span className="gtitle">GENOME</span>
          <span className="ash">
            <span className="lbl-sm">ASH</span>
            <span className="val num">⬡ {meta.ash}</span>
          </span>
          <button className="close" aria-label="close genome" onClick={onClose}>
            ✕
          </button>
        </div>

        <div className="gene-grid">
          {GENES.map((g) => {
            const level = meta.levels[g.key] ?? 0
            const equipped = meta.equipped.includes(g.key)
            const cost = upgradeCost(meta, g.key)
            const affordable = cost !== null && meta.ash >= cost
            const shown = g.levels[Math.max(level, 1) - 1]
            const isCard = g.kind === 'card'
            return (
              <div
                key={g.key}
                className={`slip ${level > 0 ? 'owned' : ''} ${equipped ? 'equipped' : ''} ${
                  isCard && affordable && level === 0 ? 'card-buyable' : ''
                }`}
              >
                <div className="head">
                  <span className="gname">{g.name}</span>
                  <span className={`kind ${isCard ? 'cardkind' : 'rule'}`}>
                    {isCard ? 'CARD' : 'RULE'}
                  </span>
                </div>
                <div className="rungs" aria-label={`level ${level} of ${g.levels.length}`}>
                  {g.levels.map((_, i) => (
                    <i key={i} className={i < level ? 'owned' : ''} />
                  ))}
                </div>
                {isCard ? (
                  <div className="cell-row">
                    <span className="cell-tile" aria-hidden="true">
                      <i
                        style={{
                          background: CELL_DOTS[g.key] ?? 'var(--you)',
                          boxShadow: `0 0 10px ${g.key === 'martyr' ? 'rgba(232,196,99,.8)' : g.key === 'vampire' ? 'rgba(196,107,255,.8)' : 'rgba(234,252,255,.8)'}`,
                        }}
                      />
                    </span>
                    <span className="effect">{shown.desc}</span>
                  </div>
                ) : (
                  <div className="effect">{shown.desc}</div>
                )}
                {level > 0 && level < g.levels.length && (
                  <div className="next-rung">
                    {ROMAN[level]} · {g.levels[level].desc}
                  </div>
                )}
                <div className="actions">
                  {level > 0 && (
                    <button
                      className={equipped ? 'equip-on' : ''}
                      disabled={!equipped && meta.equipped.length >= meta.slots}
                      aria-pressed={equipped}
                      onClick={() => onToggleEquip(g.key)}
                    >
                      {equipped ? 'equipped ✓' : 'equip'}
                    </button>
                  )}
                  {cost !== null ? (
                    <button
                      className={affordable ? 'buyable' : ''}
                      disabled={!affordable}
                      onClick={() => onBuyGene(g.key)}
                    >
                      {level === 0 ? 'buy' : 'upgrade'} · ⬡ {cost}
                    </button>
                  ) : (
                    <button disabled>maxed</button>
                  )}
                </div>
              </div>
            )
          })}

          {slotCost !== null && (
            <div className="slot-card">
              <div className="kv">
                <span className="lbl-sm">SLOT {meta.slots + 1}</span>
                <span className="why">
                  breadth beats power — another gene changes builds more than another rung.
                </span>
              </div>
              <button className="unlock" disabled={meta.ash < slotCost} onClick={onBuySlot}>
                unlock · ⬡ {slotCost}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
