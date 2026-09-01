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

export type SfxName = 'select' | 'place' | 'invalid' | 'storm' | 'win' | 'lose'

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
      case 'invalid':
        tone(ac, 'square', 130, 82, 0.09, 0.1)
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
    }
  },
}
