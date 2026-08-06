import { bowReleaseLevel, COMBAT_LEVELS, swingLevel, swingSeconds } from './mapping'

const NOISE_SECONDS = 1

/**
 * The fight's voices, synthesised.
 *
 * No asset files, for the same reasons `createWindAudio` has none: nothing to load,
 * nothing to license, and nothing that has to be routed through
 * `import.meta.env.BASE_URL` and then 404 only on the deployed site.
 *
 * Untested, like `audio.ts`. There is no AudioContext in the node test environment,
 * and a mock of one would only test the mock. Everything here that could be wrong in
 * a way a test would catch — the relative levels, the finisher's emphasis — lives in
 * `mapping.ts` and is tested there.
 */
export function createCombatAudio() {
  let context: AudioContext | null = null
  let noise: AudioBuffer | null = null
  let master: GainNode | null = null

  /** A short burst of filtered noise: air moving. */
  function burst(level: number, seconds: number, fromHz: number, toHz: number): void {
    if (!context || !noise || !master) return
    const now = context.currentTime
    const source = context.createBufferSource()
    source.buffer = noise
    const filter = context.createBiquadFilter()
    filter.type = 'lowpass'
    filter.frequency.setValueAtTime(fromHz, now)
    filter.frequency.exponentialRampToValueAtTime(Math.max(40, toHz), now + seconds)
    const gain = context.createGain()
    gain.gain.setValueAtTime(level, now)
    gain.gain.exponentialRampToValueAtTime(0.0001, now + seconds)
    source.connect(filter).connect(gain).connect(master)
    source.start(now)
    source.stop(now + seconds)
  }

  /** A pitch dropping under a fast decay: a thud. */
  function thud(level: number, seconds: number, fromHz: number, detune = 0): void {
    if (!context || !master) return
    const now = context.currentTime
    const osc = context.createOscillator()
    osc.type = 'sine'
    osc.frequency.setValueAtTime(fromHz, now)
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, fromHz * 0.3), now + seconds)
    if (detune !== 0) osc.detune.setValueAtTime(detune, now)
    const gain = context.createGain()
    gain.gain.setValueAtTime(level, now)
    gain.gain.exponentialRampToValueAtTime(0.0001, now + seconds)
    osc.connect(gain).connect(master)
    osc.start(now)
    osc.stop(now + seconds)
  }

  return {
    /** Must be called from a user gesture, or the browser blocks audio. */
    start(): void {
      if (context) return
      try {
        context = new AudioContext()
        const buffer = context.createBuffer(
          1, context.sampleRate * NOISE_SECONDS, context.sampleRate,
        )
        const data = buffer.getChannelData(0)
        for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1
        noise = buffer
        master = context.createGain()
        master.gain.value = 1
        master.connect(context.destination)
      } catch (error) {
        console.warn('Combat audio unavailable, continuing without it.', error)
        context = null
      }
    },

    gust(): void {
      burst(COMBAT_LEVELS.gust, 0.35, 1800, 200)
    },

    swing(finisher: boolean): void {
      burst(swingLevel(finisher), swingSeconds(finisher), finisher ? 2600 : 3200, 400)
    },

    impact(): void {
      thud(COMBAT_LEVELS.impact, 0.12, 180)
    },

    down(): void {
      thud(COMBAT_LEVELS.down, 0.3, 120)
      burst(COMBAT_LEVELS.down * 0.5, 0.35, 900, 120)
    },

    /** Two detuned sines, so it beats. Unpleasant on purpose. */
    hurt(): void {
      thud(COMBAT_LEVELS.hurt, 0.22, 220)
      thud(COMBAT_LEVELS.hurt * 0.8, 0.22, 220, 35)
    },

    /**
     * A short bright snap, higher and shorter than a staff swing: a string releasing.
     *
     * One burst for the whole frame, whatever `count` is, like every other voice here.
     * Called once per arrow instead, the identical bursts would start at the same
     * `currentTime` and sum coherently into the master; `bowReleaseLevel` is where that
     * decision lives, and it is tested.
     */
    bowRelease(count: number): void {
      const level = bowReleaseLevel(count)
      if (level <= 0) return
      burst(level, 0.1, 4200, 900)
    },

    dispose(): void {
      void context?.close()
      context = null
      noise = null
      master = null
    },
  }
}
