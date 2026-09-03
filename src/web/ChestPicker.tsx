import { useEffect, useRef } from 'react'
import type { ChestOption } from '../sim'
import { useModal } from './useModal'

/** Rarity = distance from Conway; colour tracks the warp band. */
const RARITY: Record<ChestOption['rarity'], { c: string; label: string }> = {
  common: { c: '#9db2d0', label: 'COMMON' },
  uncommon: { c: '#8affc4', label: 'UNCOMMON' },
  rare: { c: '#6ea8ff', label: 'RARE' },
  epic: { c: '#c46bff', label: 'EPIC' },
  legendary: { c: '#ffd84a', label: 'LEGENDARY' },
}

interface ChestPickerProps {
  options: ChestOption[]
  /** Chests still queued (this one included). */
  remaining: number
  onPick: (opt: ChestOption) => void
  onClose: () => void
}

/**
 * The in-run chest draft: crack a plasmid and splice one mutagen into your
 * strain for the rest of the run. Pick 1 of N — number keys (1–N), Tab+Enter,
 * or click; Esc saves it for later.
 */
export function ChestPicker({ options, remaining, onPick, onClose }: ChestPickerProps) {
  const rootRef = useRef<HTMLDivElement>(null)
  useModal(rootRef) // focus in, trap Tab, restore on close (Esc handled below)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopImmediatePropagation() // don't leak to the game's global hotkeys
        onClose()
      } else if (e.key >= '1' && e.key <= String(options.length)) {
        e.preventDefault()
        e.stopImmediatePropagation()
        onPick(options[Number(e.key) - 1])
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [options, onPick, onClose])

  return (
    <div className="chest-backdrop" role="dialog" aria-modal="true" aria-label="Plasmid chest — choose a mutagen">
      <div className="chest" ref={rootRef}>
        <div className="chest-head">
          <span className="chest-title">PLASMID RECOVERED</span>
          {remaining > 1 && <span className="chest-remaining">+{remaining - 1} more waiting</span>}
        </div>
        <p className="chest-sub">
          Splice one mutagen into your strain — it holds for the rest of the run.
        </p>
        <div className="chest-options">
          {options.map((o, i) => (
            <button
              key={o.key}
              className={`chest-opt ${o.activeNow ? '' : 'dormant'}`}
              style={{ ['--r' as string]: RARITY[o.rarity].c }}
              onClick={() => onPick(o)}
              aria-label={`${o.name}. ${RARITY[o.rarity].label}. ${o.desc} ${
                o.activeNow ? 'Active now.' : 'Dormant — activates a later round.'
              }`}
            >
              <span className="opt-key" aria-hidden="true">
                {i + 1}
              </span>
              <span className="opt-rarity">{RARITY[o.rarity].label}</span>
              <span className="opt-name">{o.name}</span>
              <span className="opt-desc">{o.desc}</span>
              <span className={`opt-tag ${o.activeNow ? 'live' : 'dormant'}`}>
                {o.activeNow
                  ? o.warp > 0
                    ? `⌁ warp +${o.warp} · active now`
                    : 'active now'
                  : 'dormant · activates a warpier round'}
              </span>
            </button>
          ))}
        </div>
        <button className="chest-defer" onClick={onClose}>
          save for later · <kbd>Esc</kbd>
        </button>
      </div>
    </div>
  )
}
