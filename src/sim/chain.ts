/**
 * The Chain — scoring Conway's own emergent cascades. When your placement
 * triggers a run of generations that net a stream of enemy losses (deaths +
 * captures, minus your own combat losses), that's a chain; sustained chains
 * escalate through named tiers. Pure, deterministic, gen-indexed — no minted
 * matter (the ash payout lives in the meta layer). Bleach deaths are excluded
 * upstream (combatDeaths), and the tracker only arms for the turn you placed
 * in, so a chain is legibly the player's doing rather than ambient grind or
 * the closing field — and every banked chain names the placement that caused it.
 */

export interface ChainTier {
  name: string
  at: number // cumulative net enemy losses to reach this tier
}

/**
 * The ladder, set against the MEASURED distribution of honest cascades
 * (src/harness/_chain calibration, planner mirror, 8-turn rounds): banked
 * totals run median 4, p75 6, p90 8, p97 12, max ~20-26. So SKIRMISH names
 * about half of what banks, ROUT is a good turn, MASSACRE a great one, and the
 * top two need a genuinely engineered collapse. These were an order of
 * magnitude higher when the scorer was counting the rival's own soup churning
 * as losses; they are honest now, so the numbers are smaller and mean something.
 */
export const CHAIN_TIERS: readonly ChainTier[] = [
  { name: 'SKIRMISH', at: 5 },
  { name: 'ROUT', at: 9 },
  { name: 'MASSACRE', at: 14 },
  { name: 'CATACLYSM', at: 22 },
  { name: 'EXTINCTION EVENT', at: 34 },
]

/** The first tier that earns a full celebration (slam + hit-stop + audio);
 *  SKIRMISH/ROUT stay ambient (a spark and a small tick). */
export const CHAIN_CELEBRATE_TIER = 2 // MASSACRE and up

/** Highest tier index reached by a total; -1 = below the first tier. */
export function chainTier(total: number): number {
  let t = -1
  for (let i = 0; i < CHAIN_TIERS.length; i++) if (total >= CHAIN_TIERS[i].at) t = i
  return t
}

export const CHAIN_FLOOR = 3 // per-gen spike above baseline that keeps a chain alive
export const CHAIN_SPIKE_CAP = 12 // max one gen can contribute (one detonation can't insta-max)
export const CHAIN_BREAK_GENS = 3 // consecutive quiet gens before a chain banks

/** Ash a banked chain pays, convex by tier so peaks out-earn grind. */
export function chainAshValue(tierIdx: number): number {
  return [3, 8, 14, 22, 34][tierIdx] ?? 0
}

export interface BankedChain {
  tier: number
  total: number
  gen: number
  cx: number
  cy: number
  /** Generations the cascade kept scoring — "longest cascade: 11 generations". */
  len: number
  /** The placement this cascade is attributed to (nearest source), so the
   *  slide can draw cause → effect. Null when no placement was on record. */
  src: { x: number; y: number; patternId: string } | null
}

/** Live combo state, exposed for the web meter/callout. */
export interface Combo {
  active: boolean
  len: number
  total: number
  tier: number
  cx: number
  cy: number
}
