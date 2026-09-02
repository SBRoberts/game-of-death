import { useEffect, useState } from 'react'
import { sfx } from './audio'
import type { AshRow } from './meta'

interface CashOutProps {
  breakdown: { rows: AshRow[]; total: number }
  bank: number
  /** Header meta, e.g. "240 generations · the neighbor". */
  meta: string
  onGenome: () => void
  primary: { label: string; onClick: () => void }
}

/**
 * The ash ledger (HANDOFF §5.4): an engraved plate — grooved 36px rows landing
 * one by one with ticks, the total pulled out at 34px, and the two actions
 * welded to the plate's bottom edge. What you watch count up is what you earn.
 */
export function CashOut({ breakdown, bank, meta, onGenome, primary }: CashOutProps) {
  const { rows, total } = breakdown
  const [revealed, setRevealed] = useState(0)

  useEffect(() => {
    if (revealed >= rows.length) return
    const t = setTimeout(
      () => {
        sfx.play('tick')
        setRevealed((r) => r + 1)
      },
      revealed === 0 ? 400 : 340,
    )
    return () => clearTimeout(t)
  }, [revealed, rows.length])

  const running = rows.slice(0, revealed).reduce((a, r) => a + r.value, 0)
  const done = revealed >= rows.length

  return (
    <div className="plate" role="group" aria-label="ash ledger">
      <div className="plate-head">
        <span className="lbl-sm">ASH LEDGER</span>
        <span className="meta">{meta}</span>
      </div>
      <div className="plate-rows">
        {rows.slice(0, revealed).map((r) => (
          <div className={`plate-row ${r.label === 'victory' ? 'victory' : ''}`} key={r.label}>
            <span className="rname">{r.label}</span>
            <span className="rdetail">{r.detail}</span>
            <span className="rval num">+{r.value}</span>
          </div>
        ))}
      </div>
      <div className={`plate-total ${done ? 'done' : ''}`}>
        <div className="kv">
          <span className="lbl-sm">ASH EARNED</span>
          <span className="bank">
            bank ⬡ {bank}
            {done && total === 0 ? ' · the universe owes you nothing' : ''}
          </span>
        </div>
        <span className="sum">
          <span className="glyph">⬡</span>
          <span className="val num">{running}</span>
        </span>
      </div>
      <div className="plate-actions">
        <button className="secondary" onClick={onGenome}>
          GENOME <span className="gold num">⬡ {bank}</span>
        </button>
        <button className="primary" onClick={primary.onClick}>
          {primary.label}
        </button>
      </div>
    </div>
  )
}
