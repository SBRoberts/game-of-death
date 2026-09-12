/**
 * DAILY CULTURE — one deterministic seed per calendar day, the same slide for
 * everyone. Same seed + same actions = same universe, so a day's result is a
 * comparable experiment: "can you solve this universe better than I did?"
 * The date is read here, in the web layer; the sim never sees a clock.
 */

const pad = (n: number) => String(n).padStart(2, '0')

export function dailySeed(d = new Date()): string {
  return `daily-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export const isDailySeed = (seed: string): boolean => seed.startsWith('daily-')
export const dailyDate = (seed: string): string => seed.slice('daily-'.length)

export interface DailyBest {
  seed: string
  /** Round reached (1-based) and whether the whole gauntlet was cleared. */
  round: number
  cleared: boolean
  /** Your colony's cells when the run ended — the territory you held. */
  territory: number
  cascades: number
}

const KEY = 'god-daily-best'

export function loadDailyBest(seed: string): DailyBest | null {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return null
    const b = JSON.parse(raw) as DailyBest
    return b.seed === seed ? b : null
  } catch {
    return null
  }
}

/** Deeper round beats shallower; a clear beats a death; then more territory.
 *  Saves and returns true when the day's record falls. */
export function recordDaily(result: DailyBest): boolean {
  const prev = loadDailyBest(result.seed)
  const better =
    !prev ||
    result.round > prev.round ||
    (result.round === prev.round &&
      (Number(result.cleared) > Number(prev.cleared) ||
        (result.cleared === prev.cleared && result.territory > prev.territory)))
  if (better) {
    try {
      localStorage.setItem(KEY, JSON.stringify(result))
    } catch {
      /* private mode */
    }
  }
  return better
}

/** "R3 ✓ · 412 cells" — the compact readout for the title and the plate. */
export function describeDaily(b: DailyBest): string {
  return `R${b.round}${b.cleared ? ' ✓' : ''} · ${b.territory} cells`
}
