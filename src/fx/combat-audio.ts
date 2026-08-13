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
     * A Stone Throw: the grunt of mass leaving, with grit on it.
     *
     * A `thud` where the other two light verbs are pure `burst`s, and that is the whole point of
     * the voice. A gust and a grip are both *air or water moving* and both are filtered noise; a
     * rock has mass, and mass in this synthesis kit is a pitch dropping under a fast decay. So the
     * three moves on one key are told apart by their material rather than by their level, which is
     * the same principle `clang` follows against `impact` — the note there argues at length that
     * timbre, not volume, is what a player actually distinguishes.
     *
     * Pitched between the down's 120 and the freeze's 320. Below the freeze because rock is heavier
     * than ice and above the down because this is a rock being thrown rather than a body landing,
     * and the two must not be confused: a stone that sounded like a down would have the player
     * believing they had put a heavy on the ground every time they missed one.
     *
     * The short bright burst over the top is the grit, and its filter sweeps *down* from a modest
     * start — outward, matching the gust's direction and the direction the drawn arc travels, since
     * this is the one light verb that sends something away and hurts with it.
     */
    stone(): void {
      thud(COMBAT_LEVELS.stone, 0.18, 210)
      burst(COMBAT_LEVELS.stone * 0.55, 0.16, 2400, 500)
    },

    /**
     * A Stone Pillar: a low shove of rock, arriving and settling.
     *
     * The lowest-pitched voice in the game, under the down's 120, and it is the one place a pitch
     * below a knockdown's is right: this is the ground itself moving, which is a bigger and duller
     * event than any body hitting it. Long, too — half a second, past the freeze's 0.35 — because
     * the rock is still arriving while the sound runs, and a six-second object announced by a click
     * would read as something small.
     *
     * The burst under it sweeps down into near-silence rather than up, which is a rumble decaying
     * rather than something drawn in: the grip's upward sweep means water coming toward the
     * listener, and nothing about a pillar comes toward anybody.
     *
     * Deliberately *not* built like the freeze, which is the other Focus-priced move and the
     * obvious template. The freeze is a crack with a detuned beat on it, chosen to be unpleasant
     * because it is the most expensive press in the game. A pillar is not unpleasant; it is
     * reassuring, and it should be, because the player pressed it to be safer. Two moves that cost
     * nearly the same should not therefore sound the same — what they cost is on the meter, and
     * what they *do* is what the ear is for.
     */
    pillar(): void {
      thud(COMBAT_LEVELS.pillar, 0.5, 90)
      burst(COMBAT_LEVELS.pillar * 0.5, 0.55, 700, 60)
    },

    /**
     * An arrow stopped by a pillar: a dry knock, and nothing else.
     *
     * Short, mid-bright, and built from one `burst` alone — no `thud`, so it cannot be mistaken for
     * a hit landing on anybody. That is the whole requirement of this voice: the player must hear
     * that a shot *ended somewhere harmless*. Silence was the alternative and it is worse than any
     * level, for the reason `deflectedThisFrame` exists on the enemy side — a shot that vanishes
     * with no sound is indistinguishable from a shot that was never fired, and cover the player
     * cannot hear working is cover they will not learn to stand behind.
     *
     * The quietest voice in the game bar the element switch, because it happens as often as the
     * archers shoot and the player is not meant to be doing anything about it.
     */
    pillarBlock(): void {
      burst(COMBAT_LEVELS.pillarBlock, 0.07, 1800, 700)
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
