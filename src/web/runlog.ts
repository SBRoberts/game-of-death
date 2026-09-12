/**
 * The experiment log — a run as a recordable experiment. Each finished round
 * folds its ledger in: cascades engineered, the longest one, cultures
 * assimilated, cells lysed, how honest the forecasts were, and which pattern
 * actually caused things. Read out on the cash-out plate as LAB NOTES.
 */

import { RIVAL, type Duel } from '../sim'

export interface PatternTally {
  id: string
  name: string
  plays: number
  chain: number
  cascades: number
}

export interface ExperimentLog {
  rounds: number
  turns: number
  placements: number
  cascades: number
  /** Longest cascade in generations; biggest cascade by total. */
  longest: number
  peak: number
  radicals: number
  rivalLysed: number
  rivalTurned: number
  forecastHeld: number
  forecastCells: number
  patterns: Record<string, PatternTally>
}

export const emptyLog = (): ExperimentLog => ({
  rounds: 0,
  turns: 0,
  placements: 0,
  cascades: 0,
  longest: 0,
  peak: 0,
  radicals: 0,
  rivalLysed: 0,
  rivalTurned: 0,
  forecastHeld: 0,
  forecastCells: 0,
  patterns: {},
})

/** Fold a finished round into the run's log (pure — returns a new log). */
export function foldRound(log: ExperimentLog, d: Duel): ExperimentLog {
  const s = d.summary
  const patterns = { ...log.patterns }
  for (const st of d.patternStats) {
    const prev = patterns[st.id] ?? { id: st.id, name: st.name, plays: 0, chain: 0, cascades: 0 }
    patterns[st.id] = {
      ...prev,
      plays: prev.plays + st.plays,
      chain: prev.chain + st.chain,
      cascades: prev.cascades + st.cascades,
    }
  }
  let held = 0
  let cells = 0
  for (const r of d.turnReports) {
    held += r.held
    cells += r.forecastCells
  }
  return {
    rounds: log.rounds + 1,
    turns: log.turns + d.turnReports.length,
    placements: log.placements + d.placements.length,
    cascades: log.cascades + s.cascades,
    longest: Math.max(log.longest, s.longestChain),
    peak: Math.max(log.peak, s.peakChain),
    radicals: log.radicals + s.radicalsClaimed,
    rivalLysed: log.rivalLysed + d.state.combatDeaths[RIVAL],
    rivalTurned: log.rivalTurned + s.rivalConverted,
    forecastHeld: log.forecastHeld + held,
    forecastCells: log.forecastCells + cells,
    patterns,
  }
}

/** The pattern that caused the most — by cascade credit, then count, then plays. */
export function bestPattern(log: ExperimentLog): PatternTally | null {
  const all = Object.values(log.patterns)
  if (all.length === 0) return null
  return all.reduce((a, b) => (b.chain > a.chain || (b.chain === a.chain && (b.cascades > a.cascades || (b.cascades === a.cascades && b.plays > a.plays))) ? b : a))
}
