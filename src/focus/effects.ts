import { MathUtils } from 'three'
import type { PlayerState } from '../core/types'
import type { CombatConfig } from '../combat/encounter'
import type { WindSample } from '../world/wind'
import type { AvatarStateConfig } from './avatar-state'

/**
 * What the Avatar State does, as pure transforms.
 *
 * The point of this module is that the flight model, the combat model and the wind
 * model contain no mention of the Avatar State. Each effect is a function from their
 * existing config or samples to different config or samples, applied at the call site
 * for the frames the state is running. Nothing downstream has to know why the numbers
 * changed.
 */

/**
 * Gust with the state's damage and knockback, and no cooldown at all.
 *
 * Returns the input by reference when inactive, so the common path allocates nothing,
 * and copies rather than mutates when active — `DEFAULT_COMBAT_CONFIG` is a module
 * constant, so a mutating boost would permanently buff the gust for the session.
 */
export function boostedCombatConfig(
  c: CombatConfig,
  active: boolean,
  a: AvatarStateConfig,
): CombatConfig {
  if (!active) return c
  return {
    ...c,
    gust: {
      ...c.gust,
      damage: c.gust.damage * a.gustDamageMultiplier,
      knockback: c.gust.knockback * a.gustKnockbackMultiplier,
      cooldownSeconds: 0,
    },
  }
}

/**
 * The air taking Aang's side, at intensity `t` from 0 to 1.
 *
 * This is an interpretation of the document's "every wind feature in the arena reacts
 * to Aang", which it states as an effect rather than as a rule. Helpful features
 * amplify; downdrafts relent toward nothing; dead air comes back to normal lift. For
 * the duration, the wind-as-terrain lesson is suspended — a short, loud state in which
 * the world stops resisting is the point of it.
 *
 * The sign test is on `accel.y` alone rather than on the feature's kind, because a
 * WindSample does not carry its kind. A wind river's push is horizontal, so it falls on
 * the amplify side, which is what we want.
 */
export function surgeWind(sample: WindSample, t: number, a: AvatarStateConfig): WindSample {
  const k = MathUtils.clamp(t, 0, 1)
  if (k === 0) return sample

  const scale = sample.accel.y < 0
    ? MathUtils.lerp(1, a.relentFactor, k)
    : MathUtils.lerp(1, a.surgeAccelMultiplier, k)

  return {
    accel: sample.accel.clone().multiplyScalar(scale),
    // Never reduces the lift it was handed, whatever a future wind kind reports.
    liftScale: Math.max(sample.liftScale, MathUtils.lerp(sample.liftScale, 1, k)),
  }
}

/**
 * Unlimited Breath, expressed as a full meter.
 *
 * Applied once per frame while the state runs, this is indistinguishable from a
 * suspended drain, and it leaves the flight model untouched. Both alternatives were
 * worse: a FlightConfig with a zeroed drain violates validateFlightConfig's own
 * invariant that hovering must cost more than thrust, and threading a flag through
 * PlayerState widens a struct that a dozen movement tests build fixtures for.
 */
export function refillBreath(player: PlayerState): PlayerState {
  if (player.breath >= player.maxBreath) return player
  return { ...player, breath: player.maxBreath }
}
