/**
 * Synthesized SFX — no assets, just WebAudio oscillators and noise.
 * The AudioContext is created lazily on the first user-gesture-driven play,
 * so autoplay policy never bites. Mute persists in localStorage.
 */

const MUTE_KEY = 'god-muted'

let ctx: AudioContext | null = null
let mutedFlag = typeof localStorage !== 'undefined' && localStorage.getItem(MUTE_KEY) === '1'

function ensureCtx(): AudioContext | null {
  if (!ctx) {
    try {
      ctx = new AudioContext()
    } catch {
      return null
    }
  }
  if (ctx.state === 'suspended') void ctx.resume()
  return ctx.state === 'running' || ctx.state === 'suspended' ? ctx : null
}

function tone(
  ac: AudioContext,
  type: OscillatorType,
  f0: number,
  f1: number,
  dur: number,
  peak: number,
  delay = 0,
): void {
  const t = ac.currentTime + delay
  const osc = ac.createOscillator()
  const gain = ac.createGain()
  osc.type = type
  osc.frequency.setValueAtTime(f0, t)
  osc.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur)
  gain.gain.setValueAtTime(0.0001, t)
  gain.gain.exponentialRampToValueAtTime(peak, t + 0.012)
  gain.gain.exponentialRampToValueAtTime(0.0001, t + dur)
  osc.connect(gain).connect(ac.destination)
  osc.start(t)
  osc.stop(t + dur + 0.02)
}

function noise(ac: AudioContext, dur: number, peak: number, cutoff: number, delay = 0): void {
  const t = ac.currentTime + delay
  const n = Math.floor(ac.sampleRate * dur)
  const buf = ac.createBuffer(1, n, ac.sampleRate)
  const data = buf.getChannelData(0)
  for (let i = 0; i < n; i++) data[i] = Math.random() * 2 - 1
  const src = ac.createBufferSource()
  src.buffer = buf
  const filter = ac.createBiquadFilter()
  filter.type = 'lowpass'
  filter.frequency.value = cutoff
  const gain = ac.createGain()
  gain.gain.setValueAtTime(peak, t)
  gain.gain.exponentialRampToValueAtTime(0.0001, t + dur)
  src.connect(filter).connect(gain).connect(ac.destination)
  src.start(t)
}

export type SfxName =
  | 'select'
  | 'place'
  | 'place_hold'
  | 'place_grow'
  | 'place_strike'
  | 'place_guard'
  | 'place_bomb'
  | 'place_dark'
  | 'invalid'
  | 'boom'
  | 'crunch'
  | 'tick'
  | 'storm'
  | 'win'
  | 'lose'
  | 'release'
  | 'thunk'
  | 'newbest'

export const sfx = {
  get muted(): boolean {
    return mutedFlag
  },
  toggle(): boolean {
    mutedFlag = !mutedFlag
    try {
      localStorage.setItem(MUTE_KEY, mutedFlag ? '1' : '0')
    } catch {
      /* private mode */
    }
    return mutedFlag
  },
  play(name: SfxName): void {
    if (mutedFlag) return
    const ac = ensureCtx()
    if (!ac) return
    switch (name) {
      case 'select':
        tone(ac, 'square', 620, 660, 0.05, 0.06)
        break
      case 'place':
        tone(ac, 'sine', 190, 62, 0.13, 0.28)
        noise(ac, 0.06, 0.1, 900)
        break
      case 'place_hold': // a heavy brick set down
        tone(ac, 'sine', 130, 58, 0.18, 0.34)
        noise(ac, 0.07, 0.12, 600)
        break
      case 'place_grow': // two soft buds
        tone(ac, 'triangle', 520, 540, 0.06, 0.14)
        tone(ac, 'triangle', 660, 690, 0.07, 0.14, 0.07)
        break
      case 'place_strike': // a launch whoosh
        noise(ac, 0.2, 0.14, 2400)
        tone(ac, 'sawtooth', 200, 540, 0.18, 0.1)
        break
      case 'place_guard': // metal stake planted
        tone(ac, 'square', 190, 170, 0.08, 0.16)
        tone(ac, 'square', 400, 380, 0.05, 0.1, 0.05)
        break
      case 'place_bomb': // arming: a descending warble
        tone(ac, 'square', 880, 240, 0.28, 0.1)
        break
      case 'place_dark': // dissonant dyad for the vampire
        tone(ac, 'sine', 220, 216, 0.3, 0.14)
        tone(ac, 'sine', 233, 230, 0.3, 0.12)
        break
      case 'invalid':
        tone(ac, 'square', 130, 82, 0.09, 0.1)
        break
      case 'boom': // martyr detonation
        tone(ac, 'sine', 95, 28, 0.5, 0.5)
        noise(ac, 0.4, 0.3, 500)
        break
      case 'crunch': // a front collapsing
        noise(ac, 0.12, 0.18, 900)
        break
      case 'tick': // cash-out line item
        tone(ac, 'square', 740, 760, 0.045, 0.12)
        break
      case 'storm':
        tone(ac, 'sawtooth', 55, 34, 0.9, 0.16)
        noise(ac, 0.7, 0.08, 300)
        break
      case 'win':
        tone(ac, 'triangle', 523, 523, 0.11, 0.16)
        tone(ac, 'triangle', 659, 659, 0.11, 0.16, 0.1)
        tone(ac, 'triangle', 784, 784, 0.2, 0.18, 0.2)
        break
      case 'lose':
        tone(ac, 'triangle', 220, 148, 0.42, 0.18)
        tone(ac, 'sine', 110, 72, 0.6, 0.14, 0.12)
        break
      case 'release': {
        // Time resumes: a lowpass sweep opening up, a soft rising body.
        const t = ac.currentTime
        const n = Math.floor(ac.sampleRate * 0.25)
        const buf = ac.createBuffer(1, n, ac.sampleRate)
        const data = buf.getChannelData(0)
        for (let i = 0; i < n; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / n)
        const src = ac.createBufferSource()
        src.buffer = buf
        const filt = ac.createBiquadFilter()
        filt.type = 'lowpass'
        filt.frequency.setValueAtTime(500, t)
        filt.frequency.exponentialRampToValueAtTime(16000, t + 0.22)
        const g = ac.createGain()
        g.gain.setValueAtTime(0.12, t)
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.25)
        src.connect(filt).connect(g).connect(ac.destination)
        src.start(t)
        tone(ac, 'sine', 180, 300, 0.18, 0.08)
        break
      }
      case 'thunk': // time holds: a short sub drop
        tone(ac, 'sine', 150, 60, 0.14, 0.16)
        break
      case 'newbest': // a rising three-note flourish
        tone(ac, 'triangle', 659, 659, 0.09, 0.14)
        tone(ac, 'triangle', 880, 880, 0.09, 0.15, 0.09)
        tone(ac, 'triangle', 1175, 1175, 0.22, 0.16, 0.18)
        break
    }
  },
  /** A banked chain: a pentatonic note stepping up per tier, plus a sub-boom. */
  chain(tier: number): void {
    if (mutedFlag) return
    const ac = ensureCtx()
    if (!ac) return
    const notes = [523.25, 659.25, 783.99, 987.77, 1318.51] // C E G B E'
    const f = notes[Math.max(0, Math.min(4, tier))]
    tone(ac, 'triangle', f, f, 0.16, 0.16)
    tone(ac, 'sine', f * 1.5, f * 1.5, 0.12, 0.06, 0.02)
    // Sub-boom scales with tier.
    const sub = 90 - tier * 8
    tone(ac, 'sine', sub, sub * 0.4, 0.28 + tier * 0.05, 0.22 + tier * 0.05)
    if (tier >= 3) noise(ac, 0.3, 0.16, 600)
  },
}
