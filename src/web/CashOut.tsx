import { useEffect, useState } from 'react'
import { sfx } from './audio'
import type { AshRow } from './meta'
import { TIER_COLORS } from './render'

interface CashOutProps {
  breakdown: { rows: AshRow[]; total: number }
  bank: number
  /** Header meta, e.g. "240 generations · the neighbor". */
  meta: string
  /** This run's biggest cascade (peak chain ×N); 0 if none banked. */
  peak: number
  /** Whether this run set a new personal-best cascade. */
  newBest: boolean
  /** Whether this run reached a new furthest round. */
  newFrontier: boolean
  /** The cheapest thing still out of reach, for the carrot line. */
  nextUnlock: { gap: number; label: string } | null
  /** The run's seed, offered as a shareable copy chip. */
  seed: string
  onGenome: () => void
  primary: { label: string; onClick: () => void }
}

/**
 * The ash ledger (HANDOFF §5.4): an engraved plate — grooved rows landing one
 * by one with ticks, the total pulled out, the two actions welded to the bottom
 * edge. The fun pass adds a highlight-reel header (your peak cascade, with a
 * NEW BEST stamp) and a next-unlock carrot, so the ledger reads as a payoff.
 */
export function CashOut({
  breakdown,
  bank,
  meta,
  peak,
  newBest,
  newFrontier,
  nextUnlock,
  seed,
  onGenome,
  primary,
}: CashOutProps) {
  const { rows, total } = breakdown
  const [revealed, setRevealed] = useState(0)
  const [copied, setCopied] = useState(false)

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

  // The NEW BEST flourish lands once the reel has finished counting.
  const done = revealed >= rows.length
  useEffect(() => {
    if (done && newBest && peak > 0) sfx.play('newbest')
  }, [done, newBest, peak])

  const running = rows.slice(0, revealed).reduce((a, r) => a + r.value, 0)

  const copySeed = () => {
    try {
      void navigator.clipboard?.writeText(`${location.origin}${location.pathname}?seed=${seed}`)
      setCopied(true)
      sfx.play('select')
      setTimeout(() => setCopied(false), 1600)
    } catch {
      /* clipboard blocked */
    }
  }

  return (
    <div className="plate" role="group" aria-label="ash ledger">
      <div className="plate-head">
        <span className="lbl-sm">ASH LEDGER</span>
        <span className="meta">{meta}</span>
      </div>
      {peak > 0 && (
        <div className="reel-head">
          <span className="reel-lbl">PEAK CASCADE</span>
          <span className="reel-peak num">×{peak}</span>
          {newBest && <span className="reel-badge best">NEW BEST</span>}
          {!newBest && newFrontier && <span className="reel-badge frontier">NEW FRONTIER</span>}
        </div>
      )}
      <div className="plate-rows">
        {rows.slice(0, revealed).map((r) => (
          <div
            className={`plate-row ${r.label === 'victory' ? 'victory' : ''} ${r.tier !== undefined ? 'cascade' : ''}`}
            key={r.label}
            style={r.tier !== undefined ? { color: TIER_COLORS[r.tier] } : undefined}
          >
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
      {done && (nextUnlock || seed) && (
        <div className="plate-carrot">
          {nextUnlock ? (
            <span className="carrot-next">
              <span className="num">⬡ {nextUnlock.gap}</span> to {nextUnlock.label}
            </span>
          ) : (
            <span className="carrot-next">everything within reach — go bigger</span>
          )}
          <button className="seed-share" onClick={copySeed} aria-label="copy this run's seed link">
            {copied ? 'COPIED ✓' : `SEED ${seed} ⧉`}
          </button>
        </div>
      )}
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
