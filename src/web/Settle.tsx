import { useEffect } from 'react'
import { CHAIN_TIERS, type TurnReport } from '../sim'
import { TIER_COLORS } from './render'

interface SettleProps {
  report: TurnReport
  turnsPerRound: number
  onDismiss: () => void
  /** ms before it fades on its own — any planning input dismisses it sooner. */
  ttl?: number
}

const sign = (n: number) => (n > 0 ? `+${n}` : `${n}`)

/**
 * SETTLE — the turn's scorecard. Reads what the incubation did (growth, lysis,
 * assimilation, cascades) and grades the forecast you committed on: what the
 * ghost promised → what the slide delivered. Legibility is the mechanic; this
 * is where "I saw that coming" gets confirmed or corrected.
 */
export function Settle({ report: r, turnsPerRound, onDismiss, ttl = 5600 }: SettleProps) {
  useEffect(() => {
    const t = window.setTimeout(onDismiss, ttl)
    return () => window.clearTimeout(t)
  }, [onDismiss, ttl, r])

  const top = r.chains.length ? r.chains.reduce((a, c) => (c.total > a.total ? c : a)) : null
  const fc = r.forecast
  const exact = r.forecastCells > 0 && r.held === r.forecastCells && r.struck === r.forecastHits

  return (
    <div className="settle-card" role="status" onClick={onDismiss} title="click to dismiss">
      <div className="settle-head">
        <span className="lbl-xs">
          TURN {r.turn}/{turnsPerRound} · SETTLED
        </span>
        <span className="settle-gens num">{r.gens} gens</span>
      </div>
      <div className="settle-row">
        <span className={`stat you ${r.you < 0 ? 'neg' : ''}`}>
          <b className="num">{sign(r.you)}</b> you
        </span>
        <span className={`stat rival ${r.rival > 0 ? 'neg' : ''}`}>
          <b className="num">{sign(r.rival)}</b> rival
        </span>
        {r.radicals > 0 && (
          <span className="stat dapi">
            <b className="num">{r.radicals}</b> assimilated
          </span>
        )}
        {r.rivalTurned > 0 && (
          <span className="stat you">
            <b className="num">{r.rivalTurned}</b> turned
          </span>
        )}
        {r.ownLysed > 0 && r.ownLysed >= r.rivalLysed && (
          <span className="stat rival neg">
            <b className="num">−{r.ownLysed}</b> yours lysed
          </span>
        )}
        {top && (
          <span className="stat cascade" style={{ color: TIER_COLORS[top.tier] }}>
            {CHAIN_TIERS[top.tier].name} <b className="num">×{Math.round(top.total)}</b>
            <i> · {top.len} gens{r.chains.length > 1 ? ` · +${r.chains.length - 1} more` : ''}</i>
          </span>
        )}
      </div>
      {fc ? (
        <div className="settle-forecast">
          <span className="lbl-xs">FORECAST</span>
          <span className="num">
            {fc.settle} settle · −{fc.rival} rival{fc.own ? ` · −${fc.own} yours` : ''}
          </span>
          <span className="settle-sep" aria-hidden="true">
            →
          </span>
          <span className={`num settle-held ${exact ? 'exact' : ''}`}>
            held {r.held}/{r.forecastCells}
            {r.forecastHits ? ` · struck ${r.struck}/${r.forecastHits}` : ''}
            {exact ? ' · exact' : ''}
          </span>
        </div>
      ) : (
        <div className="settle-forecast dim">
          <span className="lbl-xs">FORECAST</span>
          <span>nothing placed — the culture ran on its own</span>
        </div>
      )}
    </div>
  )
}
