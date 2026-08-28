import { Vector3 } from 'three'
import { DEFAULT_COMBAT_CONFIG } from '../combat/config'
import { DEFAULT_GROUND_CONFIG, DEFAULT_SLIPSTREAM_CONFIG } from '../core/config'
import { createAirWallPanel } from '../fx/air-wall'
import { createDashTrail } from '../fx/dash-trail'
import type { Effect } from '../fx/effect'
import { createGustCone } from '../fx/gust-cone'
import { createShockwave } from '../fx/shockwave'
import { createSlipstreamTrail } from '../fx/slipstream-trail'
import { createVortexChargeTell } from '../fx/vortex-charge'
import { createVortexRing } from '../fx/vortex-ring'
import type { BenchEffectId } from './scenes'

/**
 * Air Wall is a held state, not a one-shot `Effect` — `createAirWallPanel`'s own doc comment
 * says why: it tracks a button the player is holding, and it is driven every frame by an `up`
 * boolean rather than being created once and left to run down. That is the one factory in this
 * file that does not fit `(origin, forward) => Effect` at all, not even loosely, so this wraps
 * it: hold the panel up for the shipped `maxSeconds` and then let go, which reuses the panel's
 * own fade-out rather than inventing a second one. `object.visible` — the panel's own signal
 * that the fade-out has finished — is what ends the wrapper, so nothing here restates the fade
 * timing `air-wall.ts` already owns.
 */
function benchAirWall(origin: Vector3, forward: Vector3): Effect {
  const panel = createAirWallPanel()
  const c = DEFAULT_COMBAT_CONFIG.airWall
  let age = 0
  return {
    object: panel.object,
    advance(dt: number): boolean {
      age += dt
      const up = age < c.maxSeconds
      panel.update(dt, up, origin, forward, c)
      return up || panel.object.visible
    },
    dispose: panel.dispose,
  }
}

/**
 * The Vortex's charge tell, wrapped for the same reason as `benchAirWall`: `createVortexChargeTell`
 * is a held state advanced with a reported `heldSeconds` rather than a one-shot `Effect`, and it is
 * the one factory here that does not even take a position — in the shipped game it is parented to
 * the avatar and inherits one. So this both supplies the origin the bench needs, added onto the
 * `HEIGHT` offset the factory already bakes into `object.position.y` rather than overwriting it,
 * and drives `heldSeconds` up to the config's own `maxChargeSeconds` before finishing, since a
 * charge tell reporting past that would be showing a hold the move can never actually reach.
 */
function benchVortexCharge(origin: Vector3): Effect {
  const tell = createVortexChargeTell()
  tell.object.position.x += origin.x
  tell.object.position.y += origin.y
  tell.object.position.z += origin.z
  const c = DEFAULT_COMBAT_CONFIG.vortex
  let held = 0
  return {
    object: tell.object,
    advance(dt: number): boolean {
      held += dt
      tell.update(dt, held, c)
      return held < c.maxChargeSeconds
    },
    dispose: tell.dispose,
  }
}

/**
 * `createShockwave` takes no position of its own — every real caller (`main.ts`'s slam ring and
 * its reaction ring) sets `effect.object.position` right after construction, because the ring's
 * radius and strength are what the caller has to hand and its place in the world is a separate
 * fact. This does the same thing for the bench rather than widening `createShockwave` itself,
 * which would be a change to an effect module's own signature for a caller that is not gameplay.
 */
function ringAt(origin: Vector3, radius: number, strength: number): Effect {
  const effect = createShockwave(radius, strength)
  effect.object.position.copy(origin)
  return effect
}

/**
 * Sized like the reaction rings `main.ts` draws for Steam and Mud today (`REACTION_RING_RADIUS`
 * 1.4, `REACTION_RING_STRENGTH` 0.85), not imported because those two constants are private to
 * that file. Copied rather than exported and reused, because exporting gameplay tuning for a
 * bench placeholder to read would be a bigger change than the placeholder itself, and `steam`,
 * `mud` and `finisher` are going away the moment Tasks 8 and 9 give them real effects.
 */
const PLACEHOLDER_RADIUS = 1.4
const PLACEHOLDER_STRENGTH = 0.85

/**
 * Every effect the bench can fire, as a total `Record` over the ids the scenes may name.
 *
 * Two mistakes this shape makes impossible. An effect added to `BenchEffectId` without a factory
 * fails to compile, so a scene can never name something nothing fires. And because the scenes
 * sweep this registry in `effects.test.ts`, an effect with a factory and no scene fails a test —
 * which is the one that matters, because an effect nobody shoots is an effect whose silent
 * compile failure ships.
 *
 * The alternative was the `if (scene.effect === 'gust')` chain this replaces in `bench/main.ts`.
 * It worked for one effect and would have been nine unreachable branches at ten.
 *
 * `steam`, `mud` and `finisher` do not have factories yet — Tasks 8 and 9 build them — so all
 * three point at `ringAt` with the same placeholder size `createShockwave` gives Steam and Mud
 * in the shipped game today. That keeps this `Record` total at every commit between here and
 * those tasks, which is the property that turns a forgotten registration into a compile error.
 */
export const BENCH_EFFECTS: Record<BenchEffectId, (origin: Vector3, forward: Vector3) => Effect> = {
  gust: (origin, forward) => createGustCone(origin, forward, DEFAULT_COMBAT_CONFIG.gust),
  'air-wall': benchAirWall,
  // `createVortexRing` takes a radius rather than a forward — a vortex is a place, not a
  // direction, per its own doc comment in `vortex.ts` — so `forward` goes unused here rather
  // than being contorted into a second meaning it does not have. The radius passed is the
  // config's own full-charge `maxRadius`, since the bench has no held charge to read one from.
  vortex: (origin) => createVortexRing(origin, DEFAULT_COMBAT_CONFIG.vortex.maxRadius),
  'vortex-charge': (origin) => benchVortexCharge(origin),
  // The Pressure Wave's own ring, at its full-charge `maxRadius` and full strength, since the
  // bench has no slam speed to derive either from.
  shockwave: (origin) => ringAt(origin, DEFAULT_COMBAT_CONFIG.pressureWave.maxRadius, 1),
  // `chain: 1` — the first dash of a chain, since the bench fires one dash rather than a real
  // three-dash sequence to read a chain index from.
  'dash-trail': (origin, forward) => createDashTrail(origin, forward, 1, DEFAULT_GROUND_CONFIG),
  slipstream: (origin, forward) => (
    createSlipstreamTrail(origin, forward, DEFAULT_SLIPSTREAM_CONFIG)
  ),
  steam: (origin) => ringAt(origin, PLACEHOLDER_RADIUS, PLACEHOLDER_STRENGTH),
  mud: (origin) => ringAt(origin, PLACEHOLDER_RADIUS, PLACEHOLDER_STRENGTH),
  finisher: (origin) => ringAt(origin, PLACEHOLDER_RADIUS, PLACEHOLDER_STRENGTH),
}

export function benchEffect(id: BenchEffectId, origin: Vector3, forward: Vector3): Effect {
  return BENCH_EFFECTS[id](origin, forward)
}
