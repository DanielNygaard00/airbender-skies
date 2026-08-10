import { SENSITIVITY_MAX, SENSITIVITY_MIN, type Settings } from '../../core/settings'

/**
 * The settings section of the guide, as data.
 *
 * The same split `hud.ts` and `panel.ts` already use: everything that can be wrong in a
 * way a test would catch lives here, and the DOM half in `panel.ts` only walks this list.
 * There is no DOM in the test environment, so anything decided inside the markup — which
 * fields exist, what range a slider offers, how a value reads — would be untestable.
 */
export type SettingsRow =
  | {
    kind: 'slider'
    key: 'sensitivity' | 'volume'
    label: string
    value: number
    min: number
    max: number
    step: number
    /**
     * The value as the player should read it, beside the slider. A raw 0.7 means
     * nothing next to a volume control and a raw 2.5 means nothing next to a
     * sensitivity one; the unit is the part that makes each legible.
     */
    display: string
  }
  | { kind: 'toggle'; key: 'invertY' | 'muted' | 'reduceMotion'; label: string; on: boolean }

/**
 * Fine enough to find a comfortable value, coarse enough that a drag lands on round
 * numbers. Both ranges divide evenly by this, so every grid point is reachable and the
 * defaults (sensitivity 1, volume 0.7) sit exactly on one.
 */
const STEP = 0.05

export function settingsRows(s: Settings): SettingsRow[] {
  return [
    {
      kind: 'slider',
      key: 'sensitivity',
      label: 'Mouse sensitivity',
      value: s.sensitivity,
      // Taken from the constants `readSettings` clamps against rather than copied as
      // literals: a slider with its own bounds could offer a value the model then
      // silently clamps away, so the panel would show a setting that never took effect.
      min: SENSITIVITY_MIN,
      max: SENSITIVITY_MAX,
      step: STEP,
      // Two decimals because the step is 0.05, so one would render 1.05 and 1.10 as the
      // same "1.1" and "1.1" — two grid points the player cannot tell apart.
      display: `${s.sensitivity.toFixed(2)}×`,
    },
    { kind: 'toggle', key: 'invertY', label: 'Invert vertical look', on: s.invertY },
    {
      kind: 'slider',
      key: 'volume',
      label: 'Volume',
      // `s.volume`, deliberately not `effectiveVolume(s)`. The slider shows what unmuting
      // will restore; drawn from the effective value it would sit at 0 while muted, and
      // the player's stored level would be invisible and then lost to the first drag.
      value: s.volume,
      min: 0,
      max: 1,
      step: STEP,
      display: `${Math.round(s.volume * 100)}%`,
    },
    { kind: 'toggle', key: 'muted', label: 'Mute', on: s.muted },
    { kind: 'toggle', key: 'reduceMotion', label: 'Reduce motion', on: s.reduceMotion },
  ]
}
