import { useEffect, useState } from 'react'
import { sfx } from './audio'
import type { AshRow } from './meta'

interface CashOutProps {
  breakdown: { rows: AshRow[]; total: number }
  bank: number
}

/**
 * The reward, itemized and savored: each line lands with a tick, the total
 * runs up as lines land. What you watch count up is exactly what you earned.
 */
export function CashOut({ breakdown, bank }: CashOutProps) {
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
    <div className="cashout">
      {rows.slice(0, revealed).map((r) => (
        <div className="cashout-row" key={r.label}>
          <span className="cashout-label">{r.label}</span>
          <span className="cashout-detail">{r.detail}</span>
          <span className="cashout-value">+{r.value}</span>
        </div>
      ))}
      <div className={`cashout-total ${done ? 'done' : ''}`}>
        <span>ash earned</span>
        <span className="cashout-sum">⬡ {running}</span>
      </div>
      {done && <div className="cashout-bank">bank ⬡ {bank}</div>}
      {done && total === 0 && <div className="cashout-bank">the universe owes you nothing</div>}
    </div>
  )
}
