import { Vector3 } from 'three'
import { DEFAULT_COMBAT_CONFIG } from '../combat/config'
import { DEFAULT_GROUND_CONFIG, DEFAULT_SLIPSTREAM_CONFIG } from '../core/config'
import { fireThrustImpulse } from '../combat/fire'
import { createAirWallPanel } from '../fx/air-wall'
import { createDashTrail } from '../fx/dash-trail'
import type { Effect } from '../fx/effect'
import { createEarthReach } from '../fx/earth-reach'
import { createFireBurst } from '../fx/fire-burst'
import { createFireThrust } from '../fx/fire-thrust'
import { createGustCone } from '../fx/gust-cone'
import { createIceShell } from '../fx/ice-shell'
import { createImpact } from '../fx/impact'
import { createMud } from '../fx/mud'
import { createShockwave } from '../fx/shockwave'
import { createSlipstreamTrail } from '../fx/slipstream-trail'
import { createSteam } from '../fx/steam'
import { createVortexChargeTell } from '../fx/vortex-charge'
import { createVortexRing } from '../fx/vortex-ring'
import { createWaterReach } from '../fx/water-reach'
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
 * Sized like the reaction ring `main.ts` drew for every reaction before Task 7 and Task 8 gave
 * Steam and Mud each their own shape (`1.4` and `0.85` — the values `REACTION_RING_RADIUS` and
 * `REACTION_RING_STRENGTH` held before both were deleted along with the ring reactions used).
 * Copied rather than exported and reused, because exporting gameplay tuning for a bench
 * placeholder to read would be a bigger change than the placeholder itself, and `finisher` is
 * going away the moment its own task gives it a real effect.
 *
 * Neither `steam` nor `mud` uses this any more: Task 7 gave `steam` `createSteam` and Task 8 gave
 * `mud` `createMud`, so this pair now sizes only `finisher`'s placeholder shot.
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
 * `finisher` does not have a factory yet — deferred, per §2 of
 * `docs/superpowers/specs/2026-08-27-air-vfx-design.md` — so it points at `ringAt` with the
 * placeholder size `createShockwave` once gave every reaction. That keeps this `Record` total in
 * the meantime, which is the property that turns a forgotten registration into a compile error.
 * Neither `steam` nor `mud` shares that placeholder any more: Task 7 gave `steam` `createSteam`
 * and Task 8 gave `mud` `createMud`.
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
  // The grip, not the freeze: `water` and `water-canyon` exist to shoot the collar on the arc
  // that travels, per Task 2's `ARC_BODY` comment in `water-reach.ts` — a still freeze arc would
  // pin the collar at one radius forever rather than showing it survive the travel.
  'water-grip': (origin, forward) => (
    createWaterReach(origin, forward, 'grip', DEFAULT_COMBAT_CONFIG.water)
  ),
  // `createIceShell` also takes a `holdSeconds`, not just a position — the shell's own doc
  // comment in `ice-shell.ts` explains why the lifetime *is* the mechanic: it is on screen for
  // exactly as long as the hold that made it lasts. `forward` goes unused here for the same
  // reason it does on `vortex` above: a shell around a body has no direction of its own.
  // `gripHoldSeconds` (1.4s) rather than `freezeHoldSeconds` (3.2s) because it is the shorter of
  // the two holds the game applies, so the bench's own `MAX_SANE_STEPS`-guarded clock (see
  // `clock.ts`) has less life to run past `duration` on a scene mistuned to outlive it.
  'ice-shell': (origin) => createIceShell(origin, DEFAULT_COMBAT_CONFIG.water.gripHoldSeconds),
  'earth-reach': (origin, forward) => createEarthReach(origin, forward, DEFAULT_COMBAT_CONFIG.earth),
  'fire-burst': (origin, forward) => createFireBurst(origin, forward, DEFAULT_COMBAT_CONFIG.fire),
  // `createFireThrust` takes an impulse, not a unit forward — its own doc comment says the
  // plume's length comes from the impulse it is drawn for rather than from a constant, so the
  // bench has to hand it a real one rather than inventing a magnitude. `fireThrustImpulse` is the
  // one function that turns a heading into that impulse, and it needs nothing the bench cannot
  // supply: the bench's own `forward` and the shipped `DEFAULT_COMBAT_CONFIG.fire`, the same two
  // arguments `main.ts` passes at the real call site. No wrapper needed — the shapes already
  // line up.
  'fire-thrust': (origin, forward) => (
    createFireThrust(origin, fireThrustImpulse(forward, DEFAULT_COMBAT_CONFIG.fire))
  ),
  steam: (origin) => createSteam(origin),
  mud: (origin) => createMud(origin),
  finisher: (origin) => ringAt(origin, PLACEHOLDER_RADIUS, PLACEHOLDER_STRENGTH),
  // `createImpact` takes `(position, kind)`, not `(origin, forward)` — a burst where a blow
  // lands has no direction of its own, the same reason `vortex` and `ice-shell` above leave
  // `forward` unused — so all three kinds are registered against this file's own
  // `(origin, forward) => Effect` shape and simply ignore the second argument.
  'impact-hit': (origin) => createImpact(origin, 'hit'),
  'impact-down': (origin) => createImpact(origin, 'down'),
  'impact-deflect': (origin) => createImpact(origin, 'deflect'),
}

export function benchEffect(id: BenchEffectId, origin: Vector3, forward: Vector3): Effect {
  return BENCH_EFFECTS[id](origin, forward)
}
