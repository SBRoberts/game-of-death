import { PALETTE_LIST, SCHEMES, type PaletteMode } from './render'

interface SettingsProps {
  scheme: PaletteMode
  muted: boolean
  onScheme: (s: PaletteMode) => void
  onMute: () => void
  onClose: () => void
}

/**
 * Settings — chiefly the vision-accessible palette schemes. Each option shows
 * its three faction swatches and the placement-grade ramp, so the viewer can
 * pick by what they can actually distinguish.
 */
export function Settings({ scheme, muted, onScheme, onMute, onClose }: SettingsProps) {
  return (
    <div
      className="settings-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label="Settings"
      onClick={onClose}
    >
      <div className="settings" onClick={(e) => e.stopPropagation()}>
        <div className="settings-head">
          <span className="gtitle">SETTINGS</span>
          <button className="close" aria-label="close settings" onClick={onClose}>
            ✕
          </button>
        </div>

        <div className="settings-section">
          <span className="lbl-sm">FILTER SET — VISION</span>
          <span className="settings-note">
            The dyes carry meaning, so the right filter set matters. Pick the one you can tell apart.
          </span>
          <div className="scheme-list" role="radiogroup" aria-label="color scheme">
            {PALETTE_LIST.map((id) => {
              const s = SCHEMES[id]
              const rgb = (c: number[]) => `rgb(${c[0]},${c[1]},${c[2]})`
              return (
                <button
                  key={id}
                  role="radio"
                  aria-checked={scheme === id}
                  className={`scheme ${scheme === id ? 'on' : ''}`}
                  onClick={() => onScheme(id)}
                >
                  <span className="scheme-swatches" aria-hidden="true">
                    <i style={{ background: rgb(s.you) }} />
                    <i style={{ background: rgb(s.rival) }} />
                    <i style={{ background: rgb(s.radicals) }} />
                  </span>
                  <span className="scheme-text">
                    <span className="scheme-name">{s.name}</span>
                    <span className="scheme-for">{s.forWhom}</span>
                  </span>
                  <span className="scheme-grades" aria-hidden="true" title="placement grades">
                    {(['poor', 'fair', 'good', 'great'] as const).map((k) => (
                      <i key={k} style={{ background: s.grades[k] }} />
                    ))}
                  </span>
                  {scheme === id && <span className="scheme-check">✓</span>}
                </button>
              )
            })}
          </div>
        </div>

        <div className="settings-section">
          <span className="lbl-sm">SOUND</span>
          <button className={`settings-toggle ${muted ? '' : 'on'}`} aria-pressed={!muted} onClick={onMute}>
            <span>{muted ? '🔇 muted' : '♪ sound on'}</span>
            <span className="toggle-hint">click to {muted ? 'unmute' : 'mute'}</span>
          </button>
        </div>

        <div className="settings-foot">
          Motion respects your system's reduced-motion setting automatically.
        </div>
      </div>
    </div>
  )
}
