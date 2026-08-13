import { describe, it, expect } from 'vitest'
import { Vector3 } from 'three'
import {
  airWallNormal, canAirWall, deflect, idleAirWall, inAirWall, isAirWallUp, stepAirWall,
  type AirWallConfig,
} from './air-wall'
import { spawnProjectile, stepProjectile, type Projectile } from './projectile'
import { SHOT_HEIGHT, spawnEnemy, type Enemy } from './enemy'
import { DEFAULT_COMBAT_CONFIG } from './config'
import { DEFAULT_FLIGHT_CONFIG, DEFAULT_SLIPSTREAM_CONFIG } from '../core/config'

/**
 * Deliberately unlike the shipped values on every axis, so an assertion that read the real
 * config instead of this one would be visible: range 5 rather than 4, a 30-degree half-angle
 * rather than 45, a vertical extent that is not equal to the range, and round timings.
 *
 * The shipped numbers get their own describe block at the bottom, which is where every claim
 * about *why* they are what they are is pinned.
 */
const C: AirWallConfig = {
  range: 5,
  halfAngle: Math.PI / 6,
  verticalReach: 6,
  maxSeconds: 1,
  cooldownSeconds: 3,
  breathCost: 20,
}

const DT = 1 / 60
const ORIGIN = new Vector3(0, 0, 0)
/** Toward −Z, the direction the shipped patrol sits in. */
const NORTH = new Vector3(0, 0, -1)

const up = () => stepAirWall(idleAirWall(), true, 100, DT, C).state

/** Hold the wall for `seconds` after the raise, with the key still down. */
function hold(seconds: number) {
  let state = up()
  for (let t = 0; t < seconds; t += DT) {
    state = stepAirWall(state, true, 100, DT, C).state
  }
  return state
}

/** Let go, then wait `seconds` with nothing held. */
function release(from = up(), seconds = 0) {
  let state = stepAirWall(from, false, 100, DT, C).state
  for (let t = 0; t < seconds; t += DT) {
    state = stepAirWall(state, false, 100, DT, C).state
  }
  return state
}

describe('canAirWall', () => {
  it('offers a wall to a rested player', () => {
    expect(canAirWall(idleAirWall(), 100, C)).toBe(true)
  })

  it('refuses below the breath cost, and allows it exactly at the cost', () => {
    // The pair is the point. An implementation using `>` instead of `>=` passes the first
    // line and fails the second, and one that ignored breath entirely passes the second and
    // fails the first, so neither assertion is load-bearing without the other.
    expect(canAirWall(idleAirWall(), C.breathCost - 0.01, C)).toBe(false)
    expect(canAirWall(idleAirWall(), C.breathCost, C)).toBe(true)
  })

  it('refuses while a wall is already standing', () => {
    expect(canAirWall(up(), 100, C)).toBe(false)
  })

  it('refuses on cooldown, and offers one again once it expires', () => {
    // The control beside the refusal: the same state, walked past the cooldown, says yes.
    // Without it this test would pass against a wall that could never be raised twice.
    expect(canAirWall(release(up(), C.cooldownSeconds / 2), 100, C)).toBe(false)
    expect(canAirWall(release(up(), C.cooldownSeconds), 100, C)).toBe(true)
  })
})

describe('stepAirWall', () => {
  it('raises a wall and spends the breath on the frame it goes up', () => {
    const step = stepAirWall(idleAirWall(), true, 100, DT, C)
    expect(isAirWallUp(step.state)).toBe(true)
    expect(step.breathSpent).toBeCloseTo(C.breathCost)
  })

  it('does not raise, and spends nothing, below the cost', () => {
    const step = stepAirWall(idleAirWall(), true, C.breathCost - 1, DT, C)
    expect(isAirWallUp(step.state)).toBe(false)
    expect(step.breathSpent).toBe(0)
    // The control: one more unit of breath and the same press raises one. A "nothing
    // happened" assertion on its own would pass against a wall nobody can ever raise.
    expect(isAirWallUp(stepAirWall(idleAirWall(), true, C.breathCost, DT, C).state)).toBe(true)
  })

  it('charges once per wall, not once per frame it is held', () => {
    // Found by reasoning about `canAirWall`'s first clause rather than by playing, and worth
    // a test because a wall that billed every frame would empty the bar in a fifth of a
    // second and the symptom would look like a breath bug rather than a wall bug.
    let state = up()
    let spentWhileHeld = 0
    for (let t = 0; t < C.maxSeconds / 2; t += DT) {
      const step = stepAirWall(state, true, 100, DT, C)
      state = step.state
      spentWhileHeld += step.breathSpent
    }
    expect(spentWhileHeld).toBe(0)
    expect(isAirWallUp(state)).toBe(true)
  })

  it('drops the wall at maxSeconds even with the key still down', () => {
    // "Short-lived" is the design document's own word, so holding G cannot mean holding a
    // barrier. Both sides asserted: still up just before, gone just after.
    expect(isAirWallUp(hold(C.maxSeconds * 0.9))).toBe(true)
    expect(isAirWallUp(hold(C.maxSeconds + DT))).toBe(false)
  })

  it('drops the wall the moment the key is released', () => {
    expect(isAirWallUp(release())).toBe(false)
    // The control: the same state at the same age with the key still down is up, so this is
    // testing the release and not simply the passage of one frame.
    expect(isAirWallUp(stepAirWall(up(), true, 100, DT, C).state)).toBe(true)
  })

  it('runs the cooldown from the raise, so an early release does not shorten the wait', () => {
    // This is what makes `cooldownSeconds` the whole cycle rather than the gap, which is the
    // premise the shipped number is composed from — 0.9 up plus the Slipstream's own 1.5.
    const droppedEarly = release(up(), C.maxSeconds / 2)
    expect(canAirWall(droppedEarly, 100, C)).toBe(false)
    expect(canAirWall(release(droppedEarly, C.cooldownSeconds), 100, C)).toBe(true)
  })

  it('is up on the very frame it was raised', () => {
    // Load-bearing for the ordering in `stepEncounter`: the projectile pass reads the state
    // this function returns, so a wall that only became live on the next frame would miss
    // the arrow the player was reacting to.
    expect(isAirWallUp(stepAirWall(idleAirWall(), true, 100, DT, C).state)).toBe(true)
  })
})

describe('the wedge', () => {
  const inFront = (x: number, y: number, z: number) =>
    inAirWall(ORIGIN, NORTH, new Vector3(x, y, z), C)

  it('catches something squarely in front and inside the range', () => {
    expect(inFront(0, 0, -C.range / 2)).toBe(true)
  })

  it('lets something past the range through', () => {
    expect(inFront(0, 0, -(C.range + 0.5))).toBe(false)
    // Control at the same bearing, just inside.
    expect(inFront(0, 0, -(C.range - 0.5))).toBe(true)
  })

  it('lets something outside the half-angle through', () => {
    // Just outside and just inside the same cone, at a fixed distance, so the only thing
    // that differs between the two lines is the bearing.
    const r = C.range / 2
    const outside = C.halfAngle + 0.05
    const inside = C.halfAngle - 0.05
    expect(inFront(r * Math.sin(outside), 0, -r * Math.cos(outside))).toBe(false)
    expect(inFront(r * Math.sin(inside), 0, -r * Math.cos(inside))).toBe(true)
  })

  it('lets something above the vertical band through', () => {
    expect(inFront(0, C.verticalReach + 0.5, -C.range / 2)).toBe(false)
    expect(inFront(0, C.verticalReach - 0.5, -C.range / 2)).toBe(true)
  })

  it('cannot be held overhead', () => {
    // A recorded limitation rather than a bug: `inCone` needs a horizontal separation to
    // take a bearing from, so an arrow rising vertically into a hovering player has no
    // heading to compare and is out. The control is the same point nudged sideways, which
    // is in — so this is the degenerate case and not a broken vertical band.
    expect(inFront(0, -2, 0)).toBe(false)
    expect(inFront(0, -2, -1)).toBe(true)
  })
})

describe('airWallNormal', () => {
  it('carries the aim un-flattened', () => {
    const n = airWallNormal(new Vector3(0, 3, -4))
    expect(n?.length()).toBeCloseTo(1)
    // The whole reason this function exists: a flattened normal would report y = 0 here, and
    // a wall whose normal cannot leave the horizontal plane cannot change an arrow's
    // vertical rate at all.
    expect(n?.y).toBeCloseTo(0.6)
  })

  it('reports nothing for an aim with no direction in it', () => {
    expect(airWallNormal(new Vector3())).toBe(null)
  })
})

describe('deflect', () => {
  /** An arrow one unit in front of the player, flying straight at them at 34 units/sec. */
  const incoming = () => spawnProjectile(
    // tangleSeconds 0: an arrow carries no net. The parameter is required rather than
    // defaulted, so every fixture has to say which kind of projectile it is making.
    'a1', new Vector3(0, 0, -C.range / 2), new Vector3(0, 0, 1), 1, 34, 0,
  )

  it('reverses a head-on arrow exactly, keeping its speed and its damage', () => {
    const turned = deflect(incoming(), ORIGIN, NORTH, C)
    expect(turned).not.toBeNull()
    expect(turned?.velocity.z).toBeCloseTo(-34, 5)
    expect(turned?.velocity.length()).toBeCloseTo(34, 5)
    // Not consumed and not re-priced: the arrow is still the archer's arrow.
    expect(turned?.damage).toBeCloseTo(1)
    expect(turned?.id).toBe('a1')
    expect(turned?.deflected).toBe(true)
  })

  it('mirrors an off-axis arrow about the normal rather than simply reversing it', () => {
    // An arrow crossing at 45 degrees. A pure reversal would give (-a, 0, -a); the mirror
    // keeps the component in the wall's own plane and flips only the component along the
    // normal, so x survives with its sign. This is the assertion that distinguishes the two
    // implementations, and the reversal is what a careless reading of "returns fire" builds.
    const a = 34 / Math.SQRT2
    const arrow: Projectile = {
      ...incoming(), velocity: new Vector3(a, 0, a),
    }
    const turned = deflect(arrow, ORIGIN, NORTH, C)
    expect(turned?.velocity.x).toBeCloseTo(a, 4)
    expect(turned?.velocity.z).toBeCloseTo(-a, 4)
  })

  it('leaves an arrow already heading away alone', () => {
    const outgoing: Projectile = { ...incoming(), velocity: new Vector3(0, 0, -34) }
    expect(deflect(outgoing, ORIGIN, NORTH, C)).toBe(null)
    // The control: the identical arrow with its velocity reversed is turned. Without this
    // the test would pass against a `deflect` that never deflects anything at all.
    expect(deflect(incoming(), ORIGIN, NORTH, C)).not.toBeNull()
  })

  it('turns an arrow once and never again', () => {
    const turned = deflect(incoming(), ORIGIN, NORTH, C)
    expect(turned).not.toBeNull()
    // Aimed back at the departing arrow, which would otherwise satisfy both the wedge and
    // the approach test and start a rally.
    const behind = new Vector3(0, 0, 1)
    expect(deflect(turned!, new Vector3(0, 0, -C.range), behind, C)).toBe(null)
    // The control: an untouched arrow in the same place, with the same wall, is turned.
    const fresh: Projectile = { ...turned!, deflected: false }
    expect(deflect(fresh, new Vector3(0, 0, -C.range), behind, C)).not.toBeNull()
  })

  it('leaves an arrow outside the wedge alone', () => {
    const far: Projectile = {
      ...incoming(), position: new Vector3(0, 0, -(C.range + 1)),
    }
    expect(deflect(far, ORIGIN, NORTH, C)).toBe(null)
    expect(deflect(incoming(), ORIGIN, NORTH, C)).not.toBeNull()
  })

  it('leaves an arrow alone when the wall faces the wrong way', () => {
    expect(deflect(incoming(), ORIGIN, new Vector3(0, 0, 1), C)).toBe(null)
    expect(deflect(incoming(), ORIGIN, NORTH, C)).not.toBeNull()
  })
})

/**
 * What actually happens to a redirected arrow once it is flying again.
 *
 * These are the tests the design decisions rest on, and two of them exist to pin claims the
 * comments in `air-wall.ts` make about geometry that is easy to get wrong by reasoning.
 */
describe('where a redirected arrow goes', () => {
  const PC = DEFAULT_COMBAT_CONFIG.projectile
  const ARCHER = DEFAULT_COMBAT_CONFIG.enemies.archer
  const flatGround = { groundHeightAt: () => 0 }
  const noGround = { groundHeightAt: () => null }

  /** An archer standing on flat ground, and the shot it takes at `at`. */
  function shotAt(archerAt: Vector3, at: Vector3) {
    const bow = archerAt.clone().setY(archerAt.y + SHOT_HEIGHT)
    if (ARCHER.attack.kind !== 'projectile') throw new Error('the archer should shoot arrows')
    return spawnProjectile(
      'a1', bow, at.clone().sub(bow), ARCHER.attack.damage, ARCHER.attack.speed, 0,
    )
  }

  /**
   * Fly one arrow with a wall held at `aim`, exactly the way `stepEncounter` does: the
   * barrier is offered the arrow before the arrow advances.
   */
  function flyIntoWall(
    arrow: Projectile,
    origin: Vector3,
    aim: Vector3,
    enemies: readonly Enemy[],
    ground: { groundHeightAt(x: number, z: number): number | null },
    c: AirWallConfig,
  ) {
    let live: Projectile | null = arrow
    let redirected = false
    let hitEnemyId: string | null = null
    let damageToPlayer = 0
    let last = arrow.position.clone()
    for (let frame = 0; frame < 900 && live; frame++) {
      const turned = deflect(live, origin, aim, c)
      if (turned) redirected = true
      const flying: Projectile = turned ?? live
      last = flying.position.clone()
      const step = stepProjectile(flying, origin, enemies, [], ground, DT, PC)
      damageToPlayer += step.damageToPlayer
      if (step.hitEnemyId !== null) hitEnemyId = step.hitEnemyId
      live = step.projectile
    }
    return { redirected, hitEnemyId, damageToPlayer, last }
  }

  const SHIPPED = DEFAULT_COMBAT_CONFIG.airWall

  it('sends a mirrored arrow back into the archer that fired it', () => {
    // The flagship promise of §4.3, and one of the two shots that forced `hitsBody` in
    // `projectile.ts` to be a flat band rather than a sphere: a perfect mirror returns the
    // arrow to the point it left, which is the bow at SHOT_HEIGHT, and a sphere centred on
    // the soldier's feet was a measured 0.2 short of catching it there.
    //
    // The aim is the exact mirror — the negated incoming heading — because that is what the
    // maths is being held to here. How hard that is to hold with a mouse is a separate
    // matter, pinned by the tolerance test below.
    const player = new Vector3(0, 0, 0)
    const archerAt = new Vector3(0, 0, -30)
    const arrow = shotAt(archerAt, player)
    const archer = spawnEnemy('archer-1', archerAt, 'archer', ARCHER)
    const aim = arrow.velocity.clone().negate().normalize()

    const flight = flyIntoWall(arrow, player, aim, [archer], flatGround, SHIPPED)
    expect(flight.redirected).toBe(true)
    expect(flight.hitEnemyId).toBe('archer-1')
    // And it never touched the player on the way past, which is the other half of "deflects
    // rather than eating them".
    expect(flight.damageToPlayer).toBe(0)
  })

  it('needs the whole body height to catch that return, not just the top of it', () => {
    // The control for `hitsBody`'s vertical extent, and the measurement behind it. Same shot,
    // same wall, same mirror — but the soldier is raised until its feet stand where its bow
    // did, so the band that used to span the return's arrival height now starts above it. The
    // arrow passes underneath and nothing happens, which is exactly the miss a sphere centred
    // on the feet produced before the band existed.
    //
    // noGround, so the miss is a miss rather than the terrain quietly ending the flight before
    // the arrow ever got there.
    const player = new Vector3(0, 0, 0)
    const archerAt = new Vector3(0, 0, -30)
    const arrow = shotAt(archerAt, player)
    const raised = spawnEnemy(
      'archer-1', archerAt.clone().setY(archerAt.y + 2 * SHOT_HEIGHT), 'archer', ARCHER,
    )
    const aim = arrow.velocity.clone().negate().normalize()

    const flight = flyIntoWall(arrow, player, aim, [raised], noGround, SHIPPED)
    expect(flight.redirected).toBe(true)
    expect(flight.hitEnemyId).toBe(null)
  })

  it('buries a level shot in the ground a few paces out when the wall is held upright', () => {
    // The measurement the whole "the normal carries the elevation" decision rests on, and it
    // is the reason `EncounterInput.playerAim` exists at all. Held perfectly upright — the
    // only thing a flattened `player.forward` could ever produce — the mirror preserves the
    // arrow's downward rate, so a shot that arrived at the player's ankles leaves at the same
    // slope and grounds itself about `range` units past the wall, nowhere near the shooter.
    const player = new Vector3(0, 0, 0)
    const archerAt = new Vector3(0, 0, -30)
    const archer = spawnEnemy('archer-1', archerAt, 'archer', ARCHER)

    const flight = flyIntoWall(
      shotAt(archerAt, player), player, NORTH, [archer], flatGround, SHIPPED,
    )
    expect(flight.redirected).toBe(true)
    expect(flight.hitEnemyId).toBe(null)
    // It ends within a couple of wall-depths of the player, not thirty units away at the bow.
    expect(Math.hypot(flight.last.x, flight.last.z)).toBeLessThan(3 * SHIPPED.range)
  })

  it('still converts that shot into damage on something standing close in front', () => {
    // Which is the move's reliable payoff, and §4.1's "his damage largely comes from ...
    // enemies hitting each other" arriving literally. Same upright wall, same useless long
    // return — but a spear soldier closing on the player takes the arrow.
    const player = new Vector3(0, 0, 0)
    const archerAt = new Vector3(0, 0, -30)
    const spear = spawnEnemy(
      'spear-1', new Vector3(0, 0, -6), 'spear', DEFAULT_COMBAT_CONFIG.enemies.spear,
    )

    const flight = flyIntoWall(
      shotAt(archerAt, player), player, NORTH, [spear], flatGround, SHIPPED,
    )
    expect(flight.hitEnemyId).toBe('spear-1')
  })

  it('sends an arrow that climbed to a gliding player back down the line it came up', () => {
    // §4.3's case, and the geometry that is genuinely kind rather than a trick shot: the shot
    // climbed 25 units to reach the glider, so the return descends at the same rate and has
    // real distance in it before the ground takes it. Sixteen units of horizontal separation
    // against 25 of height is inside the archer's 3D strikeRange of 30, so this is a shot it
    // would actually take.
    const player = new Vector3(0, 25, 0)
    const archerAt = new Vector3(0, 0, -16)
    const arrow = shotAt(archerAt, player)
    const archer = spawnEnemy('archer-1', archerAt, 'archer', ARCHER)
    const aim = arrow.velocity.clone().negate().normalize()

    const flight = flyIntoWall(arrow, player, aim, [archer], flatGround, SHIPPED)
    expect(flight.redirected).toBe(true)
    expect(flight.hitEnemyId).toBe('archer-1')
  })

  it('misses that archer once the wall is a couple of degrees off', () => {
    // The tolerance, measured rather than asserted in prose: a mirror doubles the aiming
    // error, so two degrees on the normal is four on the return, and over 28 units that is
    // well past a hitRadius of 0.9. This is why the guide entry and the README call the long
    // return a fine shot rather than a reliable one, and it is a real property of reflecting
    // about the normal rather than a bug to fix.
    const player = new Vector3(0, 25, 0)
    const archerAt = new Vector3(0, 0, -16)
    const arrow = shotAt(archerAt, player)
    const archer = spawnEnemy('archer-1', archerAt, 'archer', ARCHER)
    const aim = arrow.velocity.clone().negate().normalize()
      .applyAxisAngle(new Vector3(1, 0, 0), 2 * Math.PI / 180)

    const flight = flyIntoWall(arrow, player, aim, [archer], flatGround, SHIPPED)
    // Still turned — the wedge is generous, it is only the bounce direction that is fussy.
    expect(flight.redirected).toBe(true)
    expect(flight.hitEnemyId).toBe(null)
  })
})

/**
 * The shipped numbers, held to the arguments their comments make for them.
 *
 * Each of these is a relationship rather than a literal, deliberately: the point is that
 * retuning the archer, the Slipstream or the flight model has to move this config with it, and
 * a test pinned to `4.0` would go on passing while the argument for 4.0 quietly stopped being
 * true. This is the same reason `staff-arc.test.ts` asserts its two vertical extents equal to
 * each other rather than to a number.
 */
describe('DEFAULT_COMBAT_CONFIG.airWall', () => {
  const W = DEFAULT_COMBAT_CONFIG.airWall
  const ARCHER = DEFAULT_COMBAT_CONFIG.enemies.archer
  const SHOT = ARCHER.attack
  if (SHOT.kind !== 'projectile') throw new Error('the archer should shoot arrows')
  /** How long an arrow spends in the air crossing the archer's whole firing range. */
  const FLIGHT_SECONDS = ARCHER.strikeRange / SHOT.speed

  it('is deep enough that an arrow cannot cross it between frames', () => {
    // Interception depth against the arrow's per-frame step, at 60 Hz and at a bad 20 Hz.
    // Two frames of coverage at the worse rate is the floor; the shipped value clears it by
    // a wide margin, and dropping `range` to an arrow's own step size would fail this.
    expect(W.range).toBeGreaterThan(2 * SHOT.speed / 20)
  })

  it('reaches about as far as the staff does, and nothing like as far as a gust', () => {
    // The fiction half of the same number: a barrier held at the staff's length, not a sweep
    // of air leaving the hands.
    expect(W.range).toBeGreaterThan(DEFAULT_COMBAT_CONFIG.staffArc.opener.range * 0.8)
    expect(W.range).toBeLessThan(DEFAULT_COMBAT_CONFIG.gust.range / 2)
  })

  it('is narrower than a gust', () => {
    // A facing rather than a crowd sweep. As wide as a gust and holding it would cover
    // everything in front, and "angle it" would stop being a decision.
    expect(W.halfAngle).toBeLessThan(DEFAULT_COMBAT_CONFIG.gust.halfAngle)
  })

  it('is no wider than a glider can turn inside one arrow\'s flight', () => {
    // The floor on how narrow it may be, and the reason it is not narrower. A pilot who
    // reacts to the release has `FLIGHT_SECONDS` at `baseTurnRate` to bring the wall onto the
    // bearing; a half-angle past that is a wall that cannot be aimed at a shot already loosed.
    expect(W.halfAngle).toBeLessThanOrEqual(DEFAULT_FLIGHT_CONFIG.baseTurnRate * FLIGHT_SECONDS)
  })

  it('has a band at least as deep as the wedge, so a steep approach is still covered', () => {
    // The relationship, not the literal 4.0. The archer measures its ranges in 3D and will
    // shoot a hovering player from below, and an approach at 45 degrees or shallower only
    // spends the wedge's whole depth inside the barrier if this holds. It is the one vertical
    // extent in the game chosen against its own move's reach rather than against the other
    // four moves' bands.
    expect(W.verticalReach).toBeGreaterThanOrEqual(W.range)
  })

  it('lasts exactly long enough to catch a shot from the archer\'s maximum range', () => {
    // Which makes it an answer to the archer's telegraph rather than something to hold
    // pre-emptively: raised on the release it is still up when the arrow lands, and raised
    // any earlier it is not.
    expect(W.maxSeconds).toBeGreaterThanOrEqual(FLIGHT_SECONDS)
    expect(W.maxSeconds).toBeLessThan(FLIGHT_SECONDS * 1.2)
  })

  it('leaves a gap exactly as long as the wait between dodges', () => {
    // The cooldown runs from the raise, so it is the whole cycle, and it is composed rather
    // than picked: the wall's own lifetime plus the Slipstream's cooldown. Neither defensive
    // tool is the cheap answer to the other's downtime.
    expect(W.cooldownSeconds - W.maxSeconds)
      .toBeCloseTo(DEFAULT_SLIPSTREAM_CONFIG.cooldownSeconds, 6)
  })

  it('leaves most arrows to be answered with movement', () => {
    // The consequence worth checking rather than trusting: the wall is up for well under half
    // the time, so it cannot be the answer to every shot. A cooldown short enough to wall
    // each one would delete the altitude pressure §4.4 gives the archer to apply.
    expect(W.maxSeconds / W.cooldownSeconds).toBeLessThan(0.5)
  })

  it('costs less breath than a dodge and more than the bending floor', () => {
    // The specific tool is the cheaper tool: the Slipstream beats anything and doubles as
    // traversal, the wall stops projectiles from one facing and moves you nowhere. And above
    // `bendFloor` so an exhausted player cannot raise one on fumes — which is also what makes
    // `canAirWall`'s breath clause strictly stronger than `canBend`, so it need not ask both.
    expect(W.breathCost).toBeLessThan(DEFAULT_SLIPSTREAM_CONFIG.breathCost)
    expect(W.breathCost).toBeGreaterThan(DEFAULT_FLIGHT_CONFIG.bendFloor)
  })
})
