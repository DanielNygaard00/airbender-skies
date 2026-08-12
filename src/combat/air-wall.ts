import { Vector3 } from 'three'
import { inCone } from './cone'
import type { Projectile } from './projectile'

/**
 * Air Wall: a held barrier that turns projectiles around instead of eating them.
 *
 * Section 4.2 gives it one line — "Hold. A short-lived barrier that deflects projectiles
 * rather than eating them. Angle it and you return fire." — and section 4.3 makes it one of
 * the two aerial answers to incoming fire. Section 4.5 lists redirected projectiles as a
 * Focus source, which is what this module unblocks.
 *
 * It is the third defensive tool in the kit and it is deliberately the narrowest of the
 * three. The Slipstream beats anything for 0.11 seconds and moves you 30 m/s; a Vortex
 * takes a whole group off its feet. The wall beats only projectiles, only from the facing it
 * is angled at, and it converts them into damage rather than merely surviving them. Pillar 3
 * is "Redirect, don't absorb", and this is the only move in the game that literally does it.
 *
 * ## The one place this module departs from every other reach in the game
 *
 * Reach here is the usual flat band — a horizontal wedge with a separate vertical extent,
 * the same `inCone` shape the gust and the staff arcs use. The wall's *normal* is not: it is
 * the player's full three-dimensional aim, and that is load-bearing rather than an
 * inconsistency.
 *
 * A mirror preserves whatever component of a velocity lies in its own plane. Every arrow in
 * this game is aimed at `playerPosition`, which is the player's feet, so an arrow arriving
 * on foot is a few centimetres above the ground by the time it gets there — measured, an
 * archer 30 units away firing from `SHOT_HEIGHT` 1.1 puts its arrow at y ≈ 0.15 when it
 * crosses a wall held at `range` 4. Reflect that about a *horizontal* normal and the arrow
 * keeps its downward rate, so it buries itself in the ground almost exactly `range` units
 * past the wall, every time, whatever the range to the shooter. A wall whose normal could
 * only ever be horizontal would therefore have no long return in it at all.
 *
 * So the wedge is flattened, because that is what reach means in this game, and the normal
 * carries the elevation, because that is what "angle it" means. The two are taken from the
 * same vector, so nothing can drift.
 */
export interface AirWallConfig {
  /**
   * How far in front of the player the barrier bites, measured horizontally.
   *
   * Two arguments land on the same number and both matter. The fiction: a wall is held at
   * the staff's length rather than thrown, so this belongs beside the staff arcs' 3.6 and
   * 4.2 and nowhere near the gust's 12 — a gust is a sweep of air leaving the hands, a wall
   * is a panel in front of the body. The mechanic: this is interception *depth*, and a
   * barrier thinner than an arrow's per-frame step is a barrier arrows tunnel through. At
   * the archer's shipped `attack.speed` of 34 an arrow covers 0.57 units a frame at 60 Hz
   * and 1.7 at a bad 20 Hz, so 4 units is seven frames of coverage at the target frame rate
   * and still more than two at a rate nobody should be playing at.
   */
  range: number
  /**
   * Half-angle of the wedge, radians. Narrower than the gust, and for a measured reason.
   *
   * The gust opens `Math.PI / 3` — 120 degrees swept — because it is a crowd tool. A wall is
   * a facing, so it has to be narrower or holding it would cover everything in front and
   * "angle it" would stop being a decision. The floor on how narrow comes from the glider,
   * which is the posture section 4.3 cares about: turn authority there is
   * `FlightConfig.baseTurnRate` 0.9 rad/s, and an arrow crosses the archer's 30-unit firing
   * range in about 0.88 s, so a pilot who reacts to the release can bring the wall about
   * 0.79 rad — 45 degrees — onto the bearing before it arrives. A half-angle under that is a
   * wall that cannot be aimed at a shot already loosed. This value is that number.
   *
   * For scale at the shipped patrol: from the spawn point the two archers sit 27.4 degrees
   * apart, so one wall covers both from there. That stops being true as soon as the player
   * closes on either of them and the bearings spread, which is the intended shape — the move
   * gets more demanding the closer the fight gets.
   */
  halfAngle: number
  /**
   * Half-height of the slab the wedge fills, the same field `ConeShape` means everywhere.
   *
   * Set equal to `range`, which none of the other four moves do, because an arrow's approach
   * here can be arbitrarily steep: the archer measures its ranges in 3D, so it will shoot a
   * player hovering 25 units up from 16 units out. On that line the arrow is 6 units below
   * the player while still 4 units away horizontally, and a band shallower than the wedge is
   * deep would only open once the arrow was nearly on top of the player. Equal means an
   * approach at 45 degrees or shallower spends the wedge's whole depth inside the barrier,
   * which covers every engagement the archer's own 3D range can produce short of directly
   * overhead. `air-wall.test.ts` pins the relationship rather than the literal.
   *
   * Directly overhead is genuinely not covered, and that is a property of the flattened
   * wedge rather than of this number: an arrow rising vertically has no horizontal
   * separation for `inCone` to take a heading from, so it is out. The wall cannot be held
   * over your head. Recorded rather than fixed — every aimed move in this game is flat, and
   * making this one alone spherical would be a bigger change than the case is worth.
   */
  verticalReach: number
  /**
   * How long the barrier lives once raised, even if the key stays down.
   *
   * "Short-lived" is the design document's own word. The number is the archer's arrow: 30
   * units of firing range at `attack.speed` 34 is 0.88 seconds of flight, so a wall raised
   * the instant a bow releases is still up when a shot from maximum range arrives, and one
   * raised any earlier than that is not. That makes the wall an answer to the archer's
   * `windUpSeconds` 0.8 telegraph rather than something to hold pre-emptively.
   */
  maxSeconds: number
  /**
   * Seconds before another wall can be raised, counted from the raise rather than from the
   * drop — the same convention `stepSlipstream` uses, so there is one shape for "a move with
   * a cooldown" in the codebase.
   *
   * Because it runs from the raise, this number is the wall's whole cycle, and it is
   * composed rather than picked: `maxSeconds` 0.9 up plus 1.5 down, where the 1.5 is exactly
   * `SlipstreamConfig.cooldownSeconds`. The gap between walls is the gap between dodges, so
   * neither defensive tool is the cheap answer to the other's cooldown.
   *
   * What that buys against the fight: the wall is available 37% of the time, and two archers
   * alternating on an 0.8 s draw and a 1.1 s recovery put an arrow in the air about every
   * 0.95 s, so most arrows still have to be dodged or out-positioned. A cooldown short
   * enough to wall every shot would delete the altitude pressure section 4.4 gives the
   * archer to apply.
   */
  cooldownSeconds: number
  /**
   * Breath a raise spends, deducted on the frame it goes up.
   *
   * Chosen against the Slipstream's 28, which is the other thing breath buys in a fight.
   * The dodge is the general answer — it beats a spear thrust as readily as an arrow, and it
   * doubles as traversal, which is why its own comment tunes it against thrust. The wall is
   * the specific one: projectiles only, one facing, no displacement at all. The specific
   * tool is the cheaper tool, so this sits under the dodge rather than over it.
   *
   * Two other readings of the same number. On foot, breath regenerates at
   * `breathRegenPerSecond` 12 times the grounded multiplier 2.5, so a wall costs two thirds
   * of a second of standing still — cheap, deliberately, because the ground fight is where
   * archer pressure is meant to be answerable. In the glider it costs 1.67 seconds of
   * gliding recovery, or the 1.1 seconds of thrust the same breath would have bought at
   * `breathDrainPerSecond` 18: roughly a second of climb given up per wall, which is the
   * trade section 4.3 is describing.
   *
   * Deliberately above `FlightConfig.bendFloor` 15, so `canAirWall`'s `breath >= breathCost`
   * gate is strictly stronger than `canBend` and does not have to ask it as well. An
   * exhausted player cannot raise a wall on fumes.
   */
  breathCost: number
}

/**
 * Whether a wall is up, and when the next one may go up.
 *
 * The same two fields in the same shape as `SlipstreamState`, on purpose: `elapsed` is null
 * when there is nothing running, and `cooldown` counts down regardless. Two moves with the
 * same lifecycle should not have two spellings of it.
 *
 * Notably absent: the wall's orientation. It is re-derived from the player's aim every frame
 * rather than fixed at the raise, which is a real design choice. Fixing it would make the
 * move a tap dressed up as a hold — you would have to pre-aim and then commit — and it would
 * also introduce a stored heading that the drawn panel could drift out of step with. Holding
 * the wall and sweeping it onto the bearing is what section 4.2's "angle it" reads as, and it
 * is what makes the glider turn-rate argument on `halfAngle` above mean anything.
 */
export interface AirWallState {
  /** Seconds the wall has been up, or null when there is no wall. */
  elapsed: number | null
  cooldown: number
}

export function idleAirWall(): AirWallState {
  return { elapsed: null, cooldown: 0 }
}

/** Whether a barrier is standing right now. */
export function isAirWallUp(state: AirWallState): boolean {
  return state.elapsed !== null
}

/**
 * Not already up, off cooldown, and able to pay for it.
 *
 * Deliberately the same three clauses in the same order as `canSlipstream`, and exported for
 * the same reason: the action guide asks this rather than restating it, so the panel cannot
 * claim a wall is available while the fight refuses one.
 */
export function canAirWall(state: AirWallState, breath: number, c: AirWallConfig): boolean {
  return state.elapsed === null && state.cooldown <= 0 && breath >= c.breathCost
}

/**
 * Whether a point lies inside the barrier's wedge.
 *
 * Kept as its own name over a bare `inCone` call for exactly the two reasons `inGust` is:
 * `AirWallConfig` satisfies `ConeShape` structurally so the delegation costs nothing, and
 * `src/fx/air-wall.test.ts` uses this function as the independent mechanism it holds the
 * drawn panel against. Inlining it at the call sites would quietly delete that check.
 */
export function inAirWall(
  origin: Vector3, aim: Vector3, target: Vector3, c: AirWallConfig,
): boolean {
  return inCone(origin, aim, target, c)
}

/**
 * The barrier's outward normal, or null when the aim gives no direction to take one from.
 *
 * The aim un-flattened, which is the whole point — see the module comment. Exported because
 * the panel in `src/fx/air-wall.ts` is oriented from it: what is drawn has to be the plane
 * that actually reflects, or the tell would promise a bounce the maths does not deliver.
 */
export function airWallNormal(aim: Vector3): Vector3 | null {
  if (aim.lengthSq() < 1e-8) return null
  return aim.clone().normalize()
}

/**
 * One arrow met by a standing wall, or null when nothing happens to it.
 *
 * Reflection about the normal, `v' = v - 2(v·n)n`, and nothing else: the arrow keeps its
 * speed, its damage and its id. It is not consumed, re-aimed, accelerated or snapped onto a
 * target. A homing return would make the move reliable and would also make it a different
 * move — section 4.2 says "angle it", and an angle you do not have to get right is not an
 * angle.
 *
 * What that costs, measured, because it is worth knowing before anyone plays it: a perfect
 * mirror does return an arrow exactly to the bow it left, and `air-wall.test.ts` proves it
 * against the archer's own shot. But the return travels the whole way back, so the aiming
 * tolerance is `hitRadius` 0.9 over that distance — about two degrees of returned heading at
 * 26 units, and half that on the normal, since a mirror doubles the error. Threading an
 * archer at maximum range is a trick shot. What the move reliably does instead is convert
 * incoming fire into damage on whatever stands close in front of the wall, which is section
 * 4.1's "his damage largely comes from the environment and from enemies hitting each other"
 * happening literally: the arrow that was aimed at you goes into the spear soldier closing
 * on you. In the glider the geometry is far kinder, which is why section 4.3 is written about
 * the glider — an arrow that climbed 25 units to reach you is returned descending at the
 * same rate, so the return has real distance in it before the ground takes it.
 *
 * Three separate gates, each of which is a bug if removed:
 *
 * 1. `arrow.deflected` — one turn per arrow. Without it, a wall held while the aim sweeps
 *    would catch its own return on the way out and rally it, which is a paddle game rather
 *    than a barrier.
 * 2. `inAirWall` — the arrow has to be in the wedge at all.
 * 3. `approach < 0` — the arrow has to be coming *at* the face. A wall that also turned
 *    things already leaving would flip an arrow back into the player on the frame after it
 *    saved them, and combined with (1) gone would ping-pong forever.
 */
export function deflect(
  arrow: Projectile, origin: Vector3, aim: Vector3, c: AirWallConfig,
): Projectile | null {
  if (arrow.deflected) return null
  if (!inAirWall(origin, aim, arrow.position, c)) return null

  const normal = airWallNormal(aim)
  if (!normal) return null

  const approach = arrow.velocity.dot(normal)
  if (approach >= 0) return null

  return {
    ...arrow,
    velocity: arrow.velocity.clone().addScaledVector(normal, -2 * approach),
    deflected: true,
  }
}

/**
 * Advance the barrier one frame.
 *
 * The breath is returned rather than deducted, the contract `stepSlipstream` already has:
 * the fight does not own the player's meters, and the wiring layer is where a spend lands.
 *
 * `held` going false drops the wall immediately, and that is the right behaviour on a window
 * blur as well as on a key release — `InputTracker` clears its held-key set on blur, so the
 * wall falls rather than standing unattended. The Vortex needed a special case there because
 * its charge is *accumulated* state that would have frozen mid-charge and resumed on top of
 * a stale total; a wall has nothing to bank, so the ordinary path is already correct.
 */
export function stepAirWall(
  state: AirWallState,
  held: boolean,
  breath: number,
  dt: number,
  c: AirWallConfig,
): { state: AirWallState; breathSpent: number } {
  if (held && canAirWall(state, breath, c)) {
    return {
      state: { elapsed: 0, cooldown: c.cooldownSeconds },
      breathSpent: c.breathCost,
    }
  }

  const cooldown = Math.max(0, state.cooldown - dt)
  if (state.elapsed === null) {
    return { state: { elapsed: null, cooldown }, breathSpent: 0 }
  }

  // Aged first, then tested, so a wall raised this frame is up for the frame it was raised
  // on. The projectile pass reads the state this function returns, and a wall that only
  // became live on the following frame would miss any arrow already inside the wedge at the
  // moment the player reacted — which is the frame they were reacting to.
  const elapsed = state.elapsed + dt
  const up = held && elapsed < c.maxSeconds
  return { state: { elapsed: up ? elapsed : null, cooldown }, breathSpent: 0 }
}
