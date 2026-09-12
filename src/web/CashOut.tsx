import { useEffect, useState } from 'react'
import { sfx } from './audio'
import type { AshRow } from './meta'
import { TIER_COLORS } from './render'
import { bestPattern, type ExperimentLog } from './runlog'
import { describeDaily, type DailyBest } from './daily'

interface CashOutProps {
  breakdown: { rows: AshRow[]; total: number }
  bank: number
  /** Header meta, e.g. "8 turns · 128 generations · the neighbor". */
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
  /** True when the round was lost — suppresses win-flavored carrot copy. */
  lost?: boolean
  /** The run so far, as a recordable experiment. */
  experiment: ExperimentLog
  /** When this run is the day's shared seed: the date, the standing record,
   *  whether THIS run took it, and this run's own readout. */
  daily: { date: string; best: DailyBest | null; newBest: boolean; result: DailyBest } | null
  onGenome: () => void
  primary: { label: string; onClick: () => void }
}

/**
 * The ash ledger (HANDOFF §5.4): an engraved plate — grooved rows landing one
 * by one with ticks, the total pulled out, the two actions welded to the bottom
 * edge. Above the ledger: the highlight reel (peak cascade, records) and the
 * LAB NOTES — the run read out as an experiment: what you engineered, how
 * honest your forecasts were, which pattern did the causing, the run code.
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
  lost,
  experiment,
  daily,
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
    if (done && ((newBest && peak > 0) || daily?.newBest)) sfx.play('newbest')
  }, [done, newBest, peak, daily?.newBest])

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

  const x = experiment
  const top = bestPattern(x)
  const honesty = x.forecastCells > 0 ? Math.round((100 * x.forecastHeld) / x.forecastCells) : null

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
      <div className="lab-notes" aria-label="lab notes">
        <span className="lbl-sm">
          LAB NOTES{x.rounds > 1 ? ` · ${x.rounds} ROUNDS` : ''}
          <span className="code">run code {seed}</span>
        </span>
        <span className="k">engineered</span>
        <span className="v">
          <span className="num">{x.cascades}</span> cascade{x.cascades === 1 ? '' : 's'}
          {x.cascades > 0 && (
            <>
              {' '}· longest <span className="num">{x.longest}</span> gens · peak <span className="num">×{Math.round(x.peak)}</span>
            </>
          )}
        </span>
        <span className="k">culture</span>
        <span className="v">
          <span className="num">{x.radicals}</span> radical cells assimilated · <span className="num">{x.rivalLysed.toLocaleString()}</span> rival
          lysed
          {x.rivalTurned > 0 && (
            <>
              {' '}· <span className="num">{x.rivalTurned}</span> turned
            </>
          )}
        </span>
        <span className="k">forecast</span>
        <span className="v">
          {honesty === null ? (
            'no placements graded'
          ) : (
            <>
              held <span className="num">{honesty}%</span> of what the ghost promised ({x.forecastHeld}/{x.forecastCells} cells) over{' '}
              <span className="num">{x.placements}</span> placement{x.placements === 1 ? '' : 's'}
            </>
          )}
        </span>
        <span className="k">caused most</span>
        <span className="v">
          {top && top.chain > 0 ? (
            <>
              <span className="pat">{top.name}</span> — {top.cascades} cascade{top.cascades === 1 ? '' : 's'}, ×{Math.round(top.chain)} over {top.plays} play{top.plays === 1 ? '' : 's'}
            </>
          ) : top ? (
            <>
              nothing cascaded yet — <span className="pat">{top.name}</span> was played most ({top.plays})
            </>
          ) : (
            'nothing placed'
          )}
        </span>
        {daily && (
          <>
            <span className="k">daily</span>
            <span className="v daily">
              culture {daily.date} · this run {describeDaily(daily.result)}
              {daily.newBest ? (
                <span className="badge">NEW DAILY BEST</span>
              ) : daily.best ? (
                <> · best {describeDaily(daily.best)}</>
              ) : null}
            </span>
          </>
        )}
      </div>
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
          {done && total === 0 && <span className="bank">the universe owes you nothing</span>}
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
          ) : lost ? (
            <span className="carrot-next" /> // no triumphant carrot under a loss
          ) : (
            <span className="carrot-next">everything within reach — go bigger</span>
          )}
          <button
            className="seed-share"
            onClick={copySeed}
            aria-label={copied ? 'seed link copied to clipboard' : "copy this run's seed link"}
          >
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
