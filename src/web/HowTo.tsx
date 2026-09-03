interface HowToProps {
  onClose: () => void
  onStart: () => void
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

        <p className="howto-lede">
          You are a colony of living cells fighting a rival colony across a slide governed by
          Conway's Game of Life. Drive them extinct — or hold the most territory — before the
          entropy storm closes in from the edges.
        </p>

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
              <b>Aim on the slide.</b> Place near your colony; the ghost simulates 24 generations
              ahead and grades the spot. <kbd>R</kbd> rotates. Cells that will settle glow solid.
            </div>
          </div>
          <div className="howto-step">
            <span className="n">3</span>
            <div>
              <b>Release time.</b> <kbd>space</kbd> to run, <kbd>1</kbd>–<kbd>4</kbd> for speed.
              Biomass income accrues per generation, so running hot makes you rich — and exposed.
            </div>
          </div>
          <div className="howto-step">
            <span className="n">4</span>
            <div>
              <b>Read the frame.</b> The board's border is the territory gauge: your color grows
              from the left, the rival's from the right. When it's all yours, you've won.
            </div>
          </div>
        </div>

        <p className="howto-note">
          Clear three escalating rounds to survive the gauntlet. Each finished round pays{' '}
          <span className="ash">ash</span> — spend it in the <b>genome</b> on rule mutations,
          special cells, and bigger starting <b>seeds</b>. Every run is a fresh, seeded universe.
        </p>

        <button className="title-btn primary howto-start" onClick={onStart}>
          START
        </button>
      </div>
    </div>
  )
}
