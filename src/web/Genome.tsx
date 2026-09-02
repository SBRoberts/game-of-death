import { GENES, SEEDS, SLOT_COSTS, geneByKey, seedById, type Seed } from '../sim'
import { nextSlotCost, upgradeCost, type MetaState } from './meta'

interface GenomeProps {
  meta: MetaState
  onBuySlot: () => void
  onBuyGene: (key: string) => void
  onToggleEquip: (key: string) => void
  onBuySeed: (id: string) => void
  onSelectSeed: (id: string) => void
  onClose: () => void
}

const CATEGORY_LABEL: Record<string, string> = {
  soup: 'soup',
  oscillator: 'oscillator',
  generator: 'generator',
  methuselah: 'methuselah',
  challenge: 'challenge',
}

/** A tiny normalized preview of a seed's starting formation. */
function SeedGlyph({ seed }: { seed: Seed }) {
  if (!seed.cells) {
    // Soup: a scatter of dots, drawn deterministically.
    const dots = Array.from({ length: 22 }, (_, i) => [(i * 7) % 9, (i * 5) % 6] as const)
    return (
      <svg viewBox="0 0 9 6" className="seed-glyph" aria-hidden="true">
        {dots.map(([x, y], i) => (
          <circle key={i} cx={x + 0.5} cy={y + 0.5} r={0.4} fill="var(--you)" opacity={0.55} />
        ))}
      </svg>
    )
  }
  const w = Math.max(...seed.cells.map(([x]) => x)) + 1
  const h = Math.max(...seed.cells.map(([, y]) => y)) + 1
  const s = Math.max(w, h)
  return (
    <svg viewBox={`0 0 ${s} ${s}`} className="seed-glyph" aria-hidden="true">
      {seed.cells.map(([x, y], i) => (
        <circle
          key={i}
          cx={x + (s - w) / 2 + 0.5}
          cy={y + (s - h) / 2 + 0.5}
          r={0.42}
          fill={seed.category === 'challenge' ? 'var(--rival)' : 'var(--you)'}
        />
      ))}
    </svg>
  )
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
export function Genome({
  meta,
  onBuySlot,
  onBuyGene,
  onToggleEquip,
  onBuySeed,
  onSelectSeed,
  onClose,
}: GenomeProps) {
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

  const selSeed = seedById(meta.seedSel)
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
        <div className="seed-summary">
          <span className="lbl-xs">STARTING SEED</span>
          <div className="seed-summary-body">
            <span className="seed-tile">
              <SeedGlyph seed={selSeed} />
            </span>
            <div className="seed-summary-text">
              <span className="seed-name">{selSeed.name}</span>
              <span className="seed-cat">{CATEGORY_LABEL[selSeed.category]}</span>
            </div>
          </div>
        </div>

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

        <div className="seed-shop">
          <div className="seed-shop-head">
            <span className="lbl-sm">SEEDS — YOUR STARTING FORMATION</span>
          </div>
          <div className="seed-strip">
            {SEEDS.map((s) => {
              const owned = meta.seedsOwned.includes(s.id)
              const selected = meta.seedSel === s.id
              const affordable = meta.ash >= s.ashCost
              const done = s.challenge && meta.challenges.includes(s.id)
              return (
                <button
                  key={s.id}
                  className={`seed-chip ${selected ? 'selected' : ''} ${owned ? 'owned' : ''} ${
                    s.category === 'challenge' ? 'challenge' : ''
                  }`}
                  onClick={() => (owned ? onSelectSeed(s.id) : affordable && onBuySeed(s.id))}
                  disabled={!owned && !affordable}
                  aria-pressed={selected}
                  aria-label={`${s.name}, ${s.category}. ${s.blurb}${owned ? (selected ? ' Currently selected.' : ' Owned — select.') : ` Unlock for ${s.ashCost} ash.`}`}
                >
                  <span className="seed-tile">
                    <SeedGlyph seed={s} />
                  </span>
                  <span className="seed-chip-name">{s.name}</span>
                  <span className="seed-chip-cat">{CATEGORY_LABEL[s.category]}</span>
                  <span className="seed-chip-foot">
                    {selected ? (
                      <span className="chip-sel">selected ✓</span>
                    ) : owned ? (
                      <span className="chip-select">select</span>
                    ) : (
                      <span className={`chip-cost ${affordable ? 'ok' : ''}`}>⬡ {s.ashCost}</span>
                    )}
                  </span>
                  {s.challenge && (
                    <span className={`seed-badge ${done ? 'done' : ''}`}>
                      {done ? `✓ +${s.challenge.rewardAsh}` : `⬡ ${s.challenge.rewardAsh}`}
                    </span>
                  )}
                </button>
              )
            })}
          </div>
          <div className="seed-blurb">{selSeed.blurb}</div>
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
