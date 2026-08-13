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
  let volume = 1

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
        // Applies whatever `setVolume` already stored. Settings load at startup, before the
        // first user gesture that permits audio, so `setVolume` routinely runs before this
        // node exists -- reading the stored value here instead of hardcoding 1 is what keeps
        // that call from being silently lost the moment `start()` finally creates `master`.
        master.gain.value = volume
        master.connect(context.destination)
      } catch (error) {
        console.warn('Combat audio unavailable, continuing without it.', error)
        context = null
      }
    },

    /**
     * Stored whether or not `master` exists yet, and written straight to it when it does.
     * `start()` waits for the first user gesture but settings load at startup, so this is
     * routinely called first; storing the value is what lets `start()` pick it up instead
     * of overwriting it with the unmuted default.
     */
    setVolume(v: number): void {
      volume = v
      if (master) master.gain.value = v
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

    /**
     * A blow bouncing off plate: bright, short and metallic.
     *
     * The same level as `impact` and nothing else in common with it — see the note on
     * `COMBAT_LEVELS.clang`. The high thud is the ring, the tight noise snap over the top is
     * the strike itself, and both are far shorter than the 0.12 seconds `impact` runs for, so
     * the two are separable by ear at the same loudness.
     */
    clang(): void {
      thud(COMBAT_LEVELS.clang, 0.07, 1400)
      burst(COMBAT_LEVELS.clang * 0.6, 0.05, 6000, 2200)
    },

    down(): void {
      thud(COMBAT_LEVELS.down, 0.3, 120)
      burst(COMBAT_LEVELS.down * 0.5, 0.35, 900, 120)
    },

    /**
     * A Water Grip: a filter sweep running *upward*, which is the opposite of the gust's.
     *
     * `burst` ramps its lowpass from `fromHz` to `toHz`, so passing a higher second value opens
     * the filter instead of closing it — no new synthesis primitive is needed, and the two moves
     * on the same key become audibly different by reversing one argument pair. Opening reads as
     * something being drawn toward the listener, the same way the drawn arc closes inward.
     *
     * Longer than the gust's 0.35, because the move is a drag rather than a shove and the pull
     * has a duration a player can see the soldier travel across.
     */
    grip(): void {
      burst(COMBAT_LEVELS.grip, 0.45, 260, 2200)
    },

    /**
     * An Ice Lock: a hard crack, then the ring of it.
     *
     * Built like `down()` — a thud plus a burst — rather than like a swing, because this is an
     * arrival and not a movement. The thud is pitched well above the down's 120 so the two are
     * not confused, and the burst's filter sweeps *down* from a bright start, which is what a
     * crack decaying into a hiss is. The second detuned thud is borrowed from `hurt()` for its
     * beating, which is the closest this synthesis kit gets to a sound that is unpleasant on
     * purpose — appropriate for the most expensive press in the game.
     */
    freeze(): void {
      thud(COMBAT_LEVELS.freeze, 0.35, 320)
      thud(COMBAT_LEVELS.freeze * 0.7, 0.35, 320, 28)
      burst(COMBAT_LEVELS.freeze * 0.6, 0.5, 5200, 400)
    },

    /**
     * A Fire Burst: an ignition, then the crack of it.
     *
     * A burst plus a thud rather than the reverse, because the order is the sound: the noise comes
     * first and sweeps *down* hard and fast from a bright start, which is a body of air catching, and
     * the low thud under it is the blast arriving. The Ice Lock is built from the same two
     * primitives in the opposite order and at four times the duration, which is what keeps the
     * game's two most expensive presses from sounding like each other.
     *
     * Shorter than every other voice on this list at 0.09 and 0.14 seconds. A burst is instantaneous
     * where a gust is a sweep and a grip is a drag, and the duration is doing the same work here that
     * `LIFETIME` does in `fire-burst.ts` — the ear separates the three moves on the light key by
     * length before it separates them by anything else.
     */
    fireBurst(): void {
      burst(COMBAT_LEVELS.fireBurst, 0.09, 7000, 500)
      thud(COMBAT_LEVELS.fireBurst * 0.8, 0.14, 260)
    },

    /**
     * A Fire Thrust: a roar that opens rather than closes.
     *
     * The filter sweeps *upward*, like the grip's and unlike the burst's, and here it is describing
     * something the player feels rather than something they see: the glider accelerating away from
     * the plume. Longer than the burst at 0.3 seconds, because a shove has a duration where a blast
     * does not, and because it has to be heard through the wind — see `COMBAT_LEVELS.fireThrust`.
     *
     * No thud at all, which is the deliberate difference from the burst. Nothing was struck.
     */
    fireThrust(): void {
      burst(COMBAT_LEVELS.fireThrust, 0.3, 300, 2600)
    },

    /**
     * The element switch: one very short, very quiet tick.
     *
     * Short enough that it cannot overlap itself even on consecutive frames of flicking, so a
     * player mashing the number row gets a stutter of ticks rather than a growing tone — the
     * coherent-summing problem `bowReleaseLevel` exists to solve, avoided here by the duration
     * rather than by a level cap, since a switch has no count to scale by.
     */
    elementSwitch(): void {
      burst(COMBAT_LEVELS.elementSwitch, 0.05, 3200, 1400)
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

    /**
     * Stop the audio clock, for the same reason `audio.ts` does: a paused or hidden tab
     * must not keep making noise. Any burst already scheduled resumes where it left off
     * rather than being cut, which is what suspending a context means.
     *
     * A no-op with no context, matching every other method here.
     */
    suspend(): void {
      void context?.suspend()
    },

    resume(): void {
      void context?.resume()
    },

    dispose(): void {
      void context?.close()
      context = null
      noise = null
      master = null
    },
  }
}
