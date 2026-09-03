interface HowToProps {
  onClose: () => void
  onStart: () => void
}

/** A tiny 3×3 before→after diagram of one Conway rule. */
function RuleDiagram({
  neighbors,
  before,
  after,
}: {
  neighbors: Array<[number, number]>
  before: boolean
  after: boolean
}) {
  const nSet = new Set(neighbors.map(([x, y]) => `${x},${y}`))
  const grid = (centerAlive: boolean, dimNeighbors: boolean) => (
    <svg viewBox="-0.1 -0.1 3.2 3.2" className="rule-grid" aria-hidden="true">
      {[0, 1, 2].map((y) =>
        [0, 1, 2].map((x) => {
          const isCenter = x === 1 && y === 1
          const isNeighbor = nSet.has(`${x - 1},${y - 1}`)
          const alive = isCenter ? centerAlive : isNeighbor
          return (
            <circle
              key={`${x},${y}`}
              cx={x + 0.5}
              cy={y + 0.5}
              r={isCenter ? 0.42 : 0.34}
              fill={alive ? (isCenter ? 'var(--you)' : dimNeighbors ? 'rgba(127,150,255,.4)' : 'var(--dapi)') : 'transparent'}
              stroke={isCenter ? 'var(--you)' : 'transparent'}
              strokeWidth={0.08}
              opacity={alive ? 1 : isCenter ? 0.35 : 0}
            />
          )
        }),
      )}
    </svg>
  )
  return (
    <span className="rule-diagram">
      {grid(before, false)}
      <span className="rule-arrow">→</span>
      {grid(after, true)}
    </span>
  )
}

/** A 3×3 before→after showing what a contested cell becomes. `you`/`foe`
 *  positions are neighbors; `center` is the cell whose fate is drawn. */
function DuelDiagram({
  neighbors,
  before,
  after,
}: {
  neighbors: Array<[number, number, 'you' | 'foe']>
  before: 'you' | 'foe' | null
  after: 'you' | 'foe' | null
}) {
  const col = (f: 'you' | 'foe' | null) =>
    f === 'you' ? 'var(--you)' : f === 'foe' ? 'var(--rival)' : 'transparent'
  const nMap = new Map(neighbors.map(([x, y, f]) => [`${x},${y}`, f]))
  const grid = (center: 'you' | 'foe' | null) => (
    <svg viewBox="-0.1 -0.1 3.2 3.2" className="rule-grid" aria-hidden="true">
      {[0, 1, 2].map((y) =>
        [0, 1, 2].map((x) => {
          const isCenter = x === 1 && y === 1
          const nb = nMap.get(`${x - 1},${y - 1}`)
          const f = isCenter ? center : (nb ?? null)
          return (
            <circle
              key={`${x},${y}`}
              cx={x + 0.5}
              cy={y + 0.5}
              r={isCenter ? 0.42 : 0.34}
              fill={col(f)}
              stroke={isCenter ? col(center) || 'var(--dim)' : 'transparent'}
              strokeWidth={0.08}
              opacity={f ? 1 : isCenter ? 0.3 : 0}
            />
          )
        }),
      )}
    </svg>
  )
  return (
    <span className="rule-diagram">
      {grid(before)}
      <span className="rule-arrow">→</span>
      {grid(after)}
    </span>
  )
}

/** A concise rules panel, in the game's own voice. */
export function HowTo({ onClose, onStart }: HowToProps) {
  return (
    <div className="howto-backdrop" role="dialog" aria-modal="true" aria-label="How to play" onClick={onClose}>
      <div className="howto" onClick={(e) => e.stopPropagation()}>
        <div className="howto-head">
          <span className="gtitle">HOW TO PLAY</span>
          <button className="close" aria-label="close" onClick={onClose}>
            ✕
          </button>
        </div>

        <div className="howto-scroll">
        <p className="howto-lede">
          In <b>THE GAME OF DEATH</b> you grow a colony on Conway's Game of Life — four simple rules
          decide who lives and who dies each generation:
        </p>

        <div className="rules-grid">
          <div className="rule">
            <RuleDiagram neighbors={[[0, -1]]} before after={false} />
            <div className="rule-text">
              <b>Underpopulation</b>
              <span>a live cell with fewer than 2 neighbors dies</span>
            </div>
          </div>
          <div className="rule">
            <RuleDiagram neighbors={[[-1, 0], [1, 0]]} before after />
            <div className="rule-text">
              <b>Survival</b>
              <span>a live cell with 2 or 3 neighbors lives on</span>
            </div>
          </div>
          <div className="rule">
            <RuleDiagram neighbors={[[0, -1], [-1, 0], [1, 0], [0, 1]]} before after={false} />
            <div className="rule-text">
              <b>Overpopulation</b>
              <span>a live cell with more than 3 neighbors dies</span>
            </div>
          </div>
          <div className="rule">
            <RuleDiagram neighbors={[[0, -1], [-1, 0], [1, 0]]} before={false} after />
            <div className="rule-text">
              <b>Reproduction</b>
              <span>a dead cell with exactly 3 neighbors is born</span>
            </div>
          </div>
        </div>

        <div className="howto-divider">YOUR MOVE</div>

        <div className="howto-grid">
          <div className="howto-step">
            <span className="n">1</span>
            <div>
              <b>Plan while paused.</b> Time holds still until you release it. Pick a pattern card
              — a glider, an eater, a bomb — with <kbd>Q</kbd> <kbd>W</kbd> <kbd>E</kbd>.
            </div>
          </div>
          <div className="howto-step">
            <span className="n">2</span>
            <div>
              <b>Aim on the slide.</b> Place near your colony; a translucent preview — the ghost —
              simulates 24 generations ahead and grades the spot. <kbd>R</kbd> rotates. Cells that
              will settle glow solid.
            </div>
          </div>
          <div className="howto-step">
            <span className="n">3</span>
            <div>
              <b>Release time.</b> <kbd>space</kbd> to run, <kbd>1</kbd>–<kbd>4</kbd> for speed. Feed
              your colony so it grows, and turn Life's rules against the rival.
            </div>
          </div>
          <div className="howto-step">
            <span className="n">4</span>
            <div>
              <b>Win the board.</b> Its border is the territory gauge — your color from the left,
              the rival's from the right. Drive them extinct before the entropy storm closes in.
            </div>
          </div>
        </div>

        <div className="howto-divider">THE DUEL</div>

        <p className="howto-lede">
          Two colonies share one board, so Life's rules become weapons. Where fronts collide, three
          things can happen — learn to force them and a single placement can turn a whole flank:
        </p>

        <div className="rules-grid rules-grid--duel">
          <div className="rule">
            <DuelDiagram
              neighbors={[[0, -1, 'you'], [-1, 0, 'you'], [1, 0, 'you']]}
              before={null}
              after="you"
            />
            <div className="rule-text">
              <b>Recruitment</b>
              <span>a newborn joins whichever faction surrounds it — push into contested ground and the births are yours</span>
            </div>
          </div>
          <div className="rule">
            <DuelDiagram
              neighbors={[[0, -1, 'you'], [-1, 0, 'you'], [1, 0, 'you']]}
              before="foe"
              after="you"
            />
            <div className="rule-text">
              <b>Flanking</b>
              <span>an enemy cell outnumbered by two or more defects to you — surround theirs to turn it against them</span>
            </div>
          </div>
          <div className="rule">
            <DuelDiagram
              neighbors={[[0, -1, 'you'], [1, 0, 'you'], [-1, 0, 'foe']]}
              before="foe"
              after={null}
            />
            <div className="rule-text">
              <b>Casualties</b>
              <span>outnumbered by one yet flanked by an ally, a contested enemy dies — chain these for a rout</span>
            </div>
          </div>
        </div>

        <p className="howto-note">
          Clear three escalating rounds to survive the gauntlet. Each finished round pays{' '}
          <span className="ash">ash</span> — spend it in the <b>genome</b> to <i>evolve</i>: rule
          mutations, special cells, and bigger starting <b>seeds</b>. Every run is a fresh, seeded
          universe.
        </p>
        </div>

        <button className="title-btn primary howto-start" onClick={onStart}>
          START
        </button>
      </div>
    </div>
  )
}
