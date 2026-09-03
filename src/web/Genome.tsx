import { useRef } from 'react'
import { SEEDS, type Seed } from '../sim'
import { useModal } from './useModal'
import {
  BSL,
  PERKS,
  perkCap,
  perkCost,
  perkLevel,
  perksMaxed,
  type MetaState,
} from './meta'

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

interface GenomeProps {
  meta: MetaState
  onBuySeed: (id: string) => void
  onSelectSeed: (id: string) => void
  onBuyPerk: (key: string) => void
  onSelectBsl: (n: number) => void
  onClose: () => void
}

/**
 * The Culture Lab — the permanent, breadth-first meta. Power is earned in-run;
 * here you pick your BIOSAFETY LEVEL (harder specimen → more ash), buy a short,
 * CAPPED ramp of baseline perks (which plateau), and choose your starting seed.
 * Nothing here makes a run start stronger than pure B3/S23.
 */
export function Genome({
  meta,
  onBuySeed,
  onSelectSeed,
  onBuyPerk,
  onSelectBsl,
  onClose,
}: GenomeProps) {
  const maxed = perksMaxed(meta)
  const labRef = useRef<HTMLDivElement>(null)
  useModal(labRef, onClose) // focus in, trap Tab, Esc to close, restore on close
  return (
    <div
      className="genome-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label="the culture lab"
      onClick={onClose}
    >
      <div className="lab" ref={labRef} onClick={(e) => e.stopPropagation()}>
        <div className="lab-head">
          <span className="gtitle">THE CULTURE · LAB</span>
          <span className="ash">
            <span className="lbl-sm">ASH</span>
            <span className="val num">⬡ {meta.ash}</span>
          </span>
          <button className="close" aria-label="close the lab" onClick={onClose}>
            ✕
          </button>
        </div>

        {/* ── Biosafety Level: the difficulty / reward dial ── */}
        <div className="lab-section">
          <div className="lab-shead">
            <span className="lbl-sm">BIOSAFETY LEVEL — difficulty &amp; reward</span>
            <span className="lab-note">clear a full gauntlet at your ceiling to unlock the next</span>
          </div>
          <div className="bsl-row">
            {BSL.map((b) => {
              const locked = b.level > meta.bslMax
              const sel = meta.bsl === b.level
              return (
                <button
                  key={b.level}
                  className={`bsl-card ${sel ? 'selected' : ''} ${locked ? 'locked' : ''}`}
                  disabled={locked}
                  onClick={() => onSelectBsl(b.level)}
                  aria-label={`${b.label}. ${b.blurb} ${locked ? 'Locked.' : sel ? 'Selected.' : ''}`}
                >
                  <span className="bsl-name">{b.label}</span>
                  <span className="bsl-blurb">{b.blurb}</span>
                  <span className="bsl-mult num">×{b.ashMult.toFixed(1)} ash</span>
                  {locked && <span className="bsl-lock">LOCKED</span>}
                </button>
              )
            })}
          </div>
        </div>

        {/* ── Capped baseline perks ── */}
        <div className="lab-section">
          <div className="lab-shead">
            <span className="lbl-sm">BASELINE — permanent starting perks</span>
            <span className="lab-note">small boosts, each capped — never stronger than a pure run</span>
            {maxed && <span className="lab-complete">✓ BASELINE COMPLETE</span>}
          </div>
          <div className="perk-row">
            {PERKS.map((p) => {
              const lvl = perkLevel(meta, p.key)
              const cap = perkCap(p.key)
              const cost = perkCost(meta, p.key)
              const canBuy = cost !== null && meta.ash >= cost
              return (
                <div key={p.key} className={`perk-card ${lvl >= cap ? 'maxed' : ''}`}>
                  <div className="perk-top">
                    <span className="perk-name">{p.name}</span>
                    <span className="perk-pips" aria-label={`level ${lvl} of ${cap}`}>
                      {Array.from({ length: cap }, (_, i) => (
                        <i key={i} className={i < lvl ? 'on' : ''} />
                      ))}
                    </span>
                  </div>
                  <span className="perk-desc">{p.desc}</span>
                  <button
                    className="perk-buy"
                    disabled={!canBuy}
                    onClick={() => onBuyPerk(p.key)}
                    aria-label={
                      cost === null
                        ? `${p.name} maxed`
                        : `upgrade ${p.name} for ${cost} ash`
                    }
                  >
                    {cost === null ? 'MAXED' : <>upgrade <span className="num">⬡ {cost}</span></>}
                  </button>
                </div>
              )
            })}
          </div>
        </div>

        {/* ── Seeds: your starting formation / character ── */}
        <div className="lab-section">
          <div className="lab-shead">
            <span className="lbl-sm">SEED — your starting formation</span>
            <span className="lab-note">
              playing as <b>{SEEDS.find((s) => s.id === meta.seedSel)?.name ?? '—'}</b>
            </span>
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
                  disabled={!owned && !affordable}
                  onClick={() => (owned ? onSelectSeed(s.id) : affordable && onBuySeed(s.id))}
                  aria-label={`${s.name}, ${CATEGORY_LABEL[s.category]}. ${
                    owned ? (selected ? 'selected' : 'select') : `unlock for ${s.ashCost} ash`
                  }`}
                >
                  <SeedGlyph seed={s} />
                  <span className="seed-chip-name">{s.name}</span>
                  <span className="seed-chip-cat">{CATEGORY_LABEL[s.category]}</span>
                  <span className="seed-chip-foot">
                    {owned ? (
                      done ? (
                        <span className="seed-done">✓ bounty</span>
                      ) : (
                        <span className="seed-own">owned</span>
                      )
                    ) : (
                      <span className="seed-price num">⬡ {s.ashCost}</span>
                    )}
                  </span>
                </button>
              )
            })}
          </div>
        </div>

        <div className="lab-foot">
          Power is earned in-run and wiped each run — the lab only sets the terms.
        </div>
      </div>
    </div>
  )
}
