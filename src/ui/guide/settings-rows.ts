import { SENSITIVITY_MAX, SENSITIVITY_MIN, type Settings } from '../../core/settings'
import { QUALITIES, isQuality, type Quality } from '../../core/quality'

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
  | {
    /**
     * A pick-one row. Neither a slider nor a toggle: the tiers are named, ordered and
     * few, and a slider over three named things would show the player a continuum that
     * does not exist.
     */
    kind: 'choice'
    key: 'quality'
    label: string
    value: Quality
    options: readonly { value: Quality; label: string }[]
  }

/**
 * What each tier is called in the panel.
 *
 * A `Record<Quality, string>`, so a fourth tier fails to compile until it has a label — the
 * same reason `LOOKS` is a Record over `Element`. The labels say what the player gets rather
 * than what the renderer does: "Everything on" is checkable against the screen in a way
 * "SMAA + bloom" is not.
 */
const QUALITY_LABELS: Record<Quality, string> = {
  high: 'High — everything on',
  medium: 'Medium — softer shadows',
  low: 'Low — effects off',
}

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
    {
      kind: 'choice',
      key: 'quality',
      label: 'Graphics',
      value: s.quality,
      // Highest first, so the list reads as a descent from the default rather than as a
      // ladder the player has to climb to reach what they already had.
      options: [...QUALITIES].reverse().map((q) => ({ value: q, label: QUALITY_LABELS[q] })),
    },
  ]
}

/**
 * What an edited control reads as.
 *
 * Structurally a subset of `HTMLInputElement`, so the DOM half passes the element straight
 * in and the tests pass plain objects — there is no DOM in the node environment.
 *
 * Both fields always, rather than a union of a slider reading and a toggle reading. An
 * `input` element carries both whatever its type is, so a union would only move the choice
 * of which one to trust out to the caller, which is the half that cannot be tested.
 */
export interface RowInput {
  value: string
  checked: boolean
}

/**
 * The `Settings` patch one edited row produces, or `null` for an edit to discard.
 *
 * Extracted from `createGuide`'s delegated listener for the reason `lookDelta` was
 * extracted from `InputTracker`: a five-branch key-to-field mapping is precisely where two
 * fields end up swapped, and inside the DOM half nothing could test it. Written out per key
 * rather than built from a computed property, so each patch is typed as the field it sets
 * and a renamed `Settings` field fails here — but a *swap* type-checks, since every branch
 * returns the same `Partial<Settings>`, so being testable is the part that catches it.
 */
export function patchForRow(row: SettingsRow, input: RowInput): Partial<Settings> | null {
  if (row.kind === 'slider') {
    const value = Number(input.value)
    // An unparseable range value would otherwise store NaN, which readSettings would then
    // throw away on the next load — silently, and only for that one field.
    //
    // "Unparseable", not "empty": `Number('')` is 0, not NaN, so an empty value falls
    // through this guard as a legitimate 0 — which is silence for volume and clamps to
    // SENSITIVITY_MIN for sensitivity. That is the right outcome and it is not what this
    // guard does; the comment this replaced claimed both cases and only one is true.
    if (!Number.isFinite(value)) return null
    return row.key === 'sensitivity' ? { sensitivity: value } : { volume: value }
  }
  if (row.kind === 'choice') {
    // Guarded rather than cast: the DOM half hands over whatever string the select carries,
    // and a stale option value would otherwise be stored and then thrown away on load.
    return isQuality(input.value) ? { quality: input.value } : null
  }
  switch (row.key) {
    case 'invertY': return { invertY: input.checked }
    case 'muted': return { muted: input.checked }
    case 'reduceMotion': return { reduceMotion: input.checked }
  }
}
