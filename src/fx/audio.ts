import { windVolumeForSpeed, windPitchForSpeed } from './mapping'

const NOISE_SECONDS = 2

/** Filtered white noise, pitched and mixed by airspeed. No audio asset needed. */
export function createWindAudio() {
  let context: AudioContext | null = null
  let source: AudioBufferSourceNode | null = null
  let gain: GainNode | null = null
  let filter: BiquadFilterNode | null = null

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

        source = context.createBufferSource()
        source.buffer = buffer
        source.loop = true

        filter = context.createBiquadFilter()
        filter.type = 'lowpass'
        filter.frequency.value = 700

        gain = context.createGain()
        gain.gain.value = 0

        source.connect(filter).connect(gain).connect(context.destination)
        source.start()
      } catch (error) {
        console.warn('Wind audio unavailable, continuing without it.', error)
        context = null
      }
    },

    update(airspeed: number): void {
      if (!context || !gain || !filter) return
      const now = context.currentTime
      // Ramps rather than direct assignment, otherwise the audio clicks.
      gain.gain.setTargetAtTime(windVolumeForSpeed(airspeed) * 0.35, now, 0.1)
      filter.frequency.setTargetAtTime(400 + 900 * windPitchForSpeed(airspeed), now, 0.1)
    },

    dispose(): void {
      source?.stop()
      void context?.close()
      context = null
    },
  }
}
