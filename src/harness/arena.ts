/**
 * Arena sweep (`npm run arena`) — sizing the board for the TURN model.
 *
 * A round is turnsPerRound × turnGens generations. A Life front creeps outward
 * on the order of 0.2 cells/gen, so an arena sized for the old 800-generation
 * real-time round leaves the two colonies growing in separate jars: no contact,
 * no radicals in reach, no harvest, and a "duel" decided by whose soup happened
 * to bloom bigger. This measures, per candidate geometry:
 *
 *   contact   the generation your front first touches the rival's (want it
 *             inside the first third of the round, so most turns are a fight)
 *   harvest   the generation you first assimilate a radical, and the PLASM /
 *             chests a round yields (0 = the whole chest+shop economy is dead)
 *   lysis     real combat deaths (post-attribution-fix: an honest number)
 *
 * Run it after touching width/height/colonyX/radical* or the turn structure.
 */

import { Duel, PLAYER, RADICALS, RIVAL, TUNING } from '../sim'
import { POLICIES, playTurnRound } from './turnloop'

const nSeeds = Number(process.argv[2] ?? 8)

interface Geometry {
  width: number
  height: number
  colonyX: number
  radicalFrom: number
  radicalSpan: number
  radicalsCount: number
}

function probe(g: Geometry, seed: string) {
  const d = new Duel(seed, g)
  const s = d.state
  const { width: w, height: h } = s.cfg
  const nf = s.cfg.factions.length
  const round = d.t.turnsPerRound * d.t.turnGens
  let contact = -1
  let harvest = -1
  // BOTH sides play the real turn loop — a probe where only the rival acts
  // measures a colony sitting still, not the game.
  const watch = () => {
    if (contact < 0) {
      outer: for (let y = 1; y < h - 1; y++) {
        for (let x = 1; x < w - 1; x++) {
          if (s.cells[y * w + x] !== PLAYER) continue
          for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
              if (s.cells[(y + dy) * w + (x + dx)] === RIVAL) {
                contact = s.gen
                break outer
              }
            }
          }
        }
      }
    }
    if (harvest < 0 && s.converts[RADICALS * nf + PLAYER] > 0) harvest = s.gen
  }
  const origTick = d.tick.bind(d)
  d.tick = () => {
    origTick()
    watch()
  }
  playTurnRound(d, POLICIES.planner, POLICIES.planner, seed, { order: 'rivalFirst' })
  return {
    contact,
    harvest,
    plasm: d.plasm,
    chests: d.pendingChests,
    lysed: s.combatDeaths[RIVAL],
    natural: s.naturalDeaths[RIVAL],
    cascades: d.bankedCombos.length,
    peak: d.peakChain,
    you: s.pops[PLAYER],
    rival: s.pops[RIVAL],
  }
}

const base: Geometry = {
  width: TUNING.width,
  height: TUNING.height,
  colonyX: TUNING.colonyX,
  radicalFrom: TUNING.radicalFrom,
  radicalSpan: TUNING.radicalSpan,
  radicalsCount: TUNING.radicalsCount,
}

const candidates: Array<{ label: string; g: Geometry }> = []
const arg = process.argv[3] ?? 'geometry'
if (arg === 'geometry') {
  for (const width of [128, 112, 96, 84]) {
    for (const colonyX of [0.2, 0.26]) {
      candidates.push({
        label: `${width}×${Math.round((width * 5) / 8 / 4) * 4} x${colonyX}`,
        g: { ...base, width, height: Math.round((width * 5) / 8 / 4) * 4, colonyX },
      })
    }
  }
} else {
  // Focused: the promising region — tighter colonies and a denser midfield, so
  // the radicals are a prize worth crossing for rather than scenery.
  for (const [width, height] of [[84, 52], [76, 48]] as const) {
    for (const colonyX of [0.26, 0.3]) {
      for (const radicalsCount of [36, 60, 90]) {
        candidates.push({
          label: `${width}×${height} x${colonyX} r${radicalsCount}`,
          g: { ...base, width, height, colonyX, radicalsCount },
        })
      }
    }
  }
}
// The shipped geometry always appears, whatever it is.
candidates.unshift({ label: `CURRENT ${base.width}×${base.height} x${base.colonyX}`, g: base })

const round = TUNING.turnsPerRound * TUNING.turnGens
console.log(`\nARENA SWEEP — ${TUNING.turnsPerRound} turns × ${TUNING.turnGens} gens = ${round} gens/round, ${nSeeds} seeds\n`)
console.log('geometry             contact   harvest   plasm  chests   lysed  natural  casc   you/rival')
for (const { label, g } of candidates) {
  const runs = Array.from({ length: nSeeds }, (_, i) => probe(g, `arena-${i}`))
  const mean = (f: (r: ReturnType<typeof probe>) => number) => runs.reduce((a, r) => a + f(r), 0) / runs.length
  // A run that never made contact counts as the full round, not as "gen -1".
  const orRound = (v: number) => (v < 0 ? round : v)
  const never = (f: (r: ReturnType<typeof probe>) => number) => runs.filter((r) => f(r) < 0).length
  console.log(
    label.padEnd(21) +
      `${Math.round(mean((r) => orRound(r.contact))).toString().padStart(5)}${never((r) => r.contact) ? `(${never((r) => r.contact)}✗)` : '    '}` +
      `${Math.round(mean((r) => orRound(r.harvest))).toString().padStart(7)}${never((r) => r.harvest) ? `(${never((r) => r.harvest)}✗)` : '    '}` +
      `${mean((r) => r.plasm).toFixed(0).padStart(6)}` +
      `${mean((r) => r.chests).toFixed(1).padStart(8)}` +
      `${Math.round(mean((r) => r.lysed)).toString().padStart(8)}` +
      `${Math.round(mean((r) => r.natural)).toString().padStart(9)}` +
      `${mean((r) => r.cascades).toFixed(1).padStart(6)}` +
      `   ${Math.round(mean((r) => r.you))}/${Math.round(mean((r) => r.rival))}`,
  )
}
console.log('\n✗ = seeds where it never happened at all. Want: contact well inside the round,')
console.log('harvest early enough that chests actually open, and lysed >> 0 (a real fight).')
