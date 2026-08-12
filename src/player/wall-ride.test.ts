import { describe, it, expect } from 'vitest'
import { Vector3 } from 'three'
import { isRidableWall, stepWallRide, type WallRideInput } from './wall-ride'
import { DEFAULT_COLLISION_CONFIG, DEFAULT_GROUND_CONFIG } from '../core/config'
import type { GroundConfig, TerrainQuery } from '../core/types'

const G = DEFAULT_GROUND_CONFIG
const DT = 1 / 60

/** Where the synthetic wall stands. The rider approaches it from -x. */
const WALL_X = 2
/** How high the synthetic wall goes. Above this the probe finds nothing: the wall ends. */
const WALL_TOP = 40

/**
 * A world with one wall.
 *
 * A plane at x = WALL_X, hittable only from the -x side (front-side culling, the way the
 * real island meshes behave) and only below `wallTop`, plus a floor at y = 0 in front of it.
 * `normalY` tilts the wall so the steepness gate can be exercised in both directions.
 *
 * Synthetic on purpose. Every claim in this file is about the *rule* — what the thresholds
 * do, what the arithmetic produces, when the ride lets go — and a rule is clearest against
 * a surface with no noise in it. The claims about geometry live in
 * `wall-ride-geometry.test.ts` and are made against the real thirteen islands, because how
 * much ridable rock this archipelago actually has is not something a fake can answer.
 */
function walledWorld(opts: { normalY?: number; wallTop?: number } = {}): TerrainQuery {
  const wallTop = opts.wallTop ?? WALL_TOP
  const normal = new Vector3(-1, opts.normalY ?? 0, 0).normalize()
  return {
    groundHeightAt: () => 0,
    raycast(from: Vector3, direction: Vector3, maxDistance: number) {
      const dir = direction.clone()
      if (dir.lengthSq() < 1e-12) return null
      dir.normalize()
      if (dir.x > 1e-6 && from.x < WALL_X) {
        const t = (WALL_X - from.x) / dir.x
        const point = from.clone().addScaledVector(dir, t)
        if (t <= maxDistance && point.y <= wallTop) {
          return { point, normal: normal.clone(), islandId: 'wall' }
        }
      }
      if (dir.y < -1e-6 && from.y > 0) {
        const t = -from.y / dir.y
        const point = from.clone().addScaledVector(dir, t)
        if (t <= maxDistance && point.x < WALL_X) {
          return { point, normal: new Vector3(0, 1, 0), islandId: 'floor' }
        }
      }
      return null
    },
  }
}

const rider = (over: Partial<WallRideInput> = {}): WallRideInput => ({
  scooterActive: true, charge: 1, jumped: false, ...over,
})

/**
 * Where a rider stands to be in reach of the wall: feet on the floor, close enough that the
 * chest-height probe finds rock inside `snapDistance`.
 */
const AT_WALL = new Vector3(WALL_X - 0.6, 0, 0)

/**
 * The velocity `groundStep` hands over on a grounded frame: the horizontal it settled, and a
 * full step of gravity already integrated into the vertical. Reproduced rather than
 * simplified to zero, because the gravity give-back inside the ride is only correct against
 * a caller that has actually applied gravity, and a test that passed `y: 0` would be
 * asserting the arithmetic of a caller that does not exist.
 */
const approach = (speed: number): Vector3 => new Vector3(speed, -G.gravity * DT, 0)

/** Enter a ride and return the step. */
function enter(speed = G.wallRideEntrySpeed, c: GroundConfig = G, over: Partial<WallRideInput> = {}) {
  return stepWallRide(null, rider(over), AT_WALL, approach(speed), DT, walledWorld(), c)
}

describe('what counts as a ridable wall', () => {
  it('accepts a face within wallRideNormalY of vertical', () => {
    expect(isRidableWall(new Vector3(-1, 0, 0), G)).toBe(true)
    expect(isRidableWall(new Vector3(-1, 0.2, 0).normalize(), G)).toBe(true)
  })

  it('rejects a slope the ground snap could already walk up', () => {
    // 0.3 sits between wallRideNormalY 0.25 and CollisionConfig.wallNormalY 0.5, which is
    // the whole reason the two thresholds are different numbers: this face is not a wall to
    // ride, and it is not a wall to bounce off either.
    const slope = new Vector3(-1, 0.3, 0).normalize()
    expect(isRidableWall(slope, G)).toBe(false)
  })

  it('rejects an overhang, because the threshold is two-sided', () => {
    // The undersides of these islands are stretched to 1.9x and face outward and downward,
    // so a one-sided `normal.y < wallRideNormalY` test would call every one of them ridable.
    // Riding up the inside of an overhang cannot work — the climb leaves the surface — so it
    // is refused at the gate rather than entered and dropped.
    expect(isRidableWall(new Vector3(-1, -0.3, 0).normalize(), G)).toBe(false)
    expect(isRidableWall(new Vector3(-1, -0.8, 0).normalize(), G)).toBe(false)
  })

  it('is stricter than the collision threshold it is the sibling of', () => {
    // Load-bearing relationship rather than two independent numbers: a face can be a wall to
    // deflect off without being a wall to ride, and never the other way round.
    expect(G.wallRideNormalY).toBeLessThan(DEFAULT_COLLISION_CONFIG.wallNormalY)
    const between = new Vector3(-1, 0.4, 0).normalize()
    expect(isRidableWall(between, G)).toBe(false)
  })
})

describe('entering a wall ride', () => {
  it('starts when the scooter is up, a wall is in reach and the closing speed clears the bar', () => {
    const step = enter()
    expect(step.normal).not.toBeNull()
    expect(step.velocity).not.toBeNull()
  })

  it('refuses without the scooter, because wall-riding is a property of it', () => {
    expect(enter(G.wallRideEntrySpeed, G, { scooterActive: false }).normal).toBeNull()
  })

  it('refuses below the entry speed, and accepts just above it', () => {
    // Pinned either side of the threshold rather than at one comfortable value, so the number
    // in the config is what the test is about.
    expect(enter(G.wallRideEntrySpeed - 0.01).normal).toBeNull()
    expect(enter(G.wallRideEntrySpeed + 0.01).normal).not.toBeNull()
  })

  it('refuses without a tier of accumulator in hand', () => {
    expect(enter(20, G, { charge: G.wallRideMinCharge - 0.001 }).normal).toBeNull()
    expect(enter(20, G, { charge: G.wallRideMinCharge }).normal).not.toBeNull()
  })

  it('refuses on a face that is merely steep', () => {
    const step = stepWallRide(
      null, rider(), AT_WALL, approach(26), DT, walledWorld({ normalY: 0.3 }), G,
    )
    expect(step.normal).toBeNull()
  })

  it('refuses when there is no wall in reach at all', () => {
    const far = new Vector3(WALL_X - 10, 0, 0)
    expect(stepWallRide(null, rider(), far, approach(26), DT, walledWorld(), G).normal).toBeNull()
  })

  it('refuses when the approach is not aimed at anything', () => {
    // The entry probe is aimed along the horizontal line of travel, so a rider moving
    // straight up or standing still has nothing to aim it with. Returning idle is the honest
    // answer; normalising a zero vector would aim it somewhere arbitrary.
    const straightUp = new Vector3(0, 20, 0)
    expect(
      stepWallRide(null, rider(), AT_WALL, straightUp, DT, walledWorld(), G).normal,
    ).toBeNull()
  })

  it('refuses on a jump frame', () => {
    // The exit, applied at entry too: a press that leaves the ground must not be swallowed by
    // a ride starting on the same frame. It also protects the gravity give-back, since
    // `groundStep` overrides the vertical outright on a jump frame rather than integrating
    // gravity into it.
    expect(enter(26, G, { jumped: true }).normal).toBeNull()
  })
})

describe('the redirect, which is where the climb comes from', () => {
  it('turns the closing speed into climb at wallRideRedirect', () => {
    const step = enter(26)
    // 26 into the wall, 0.7 of it upward, less one step of the ride's own decay. The caller's
    // full step of gravity is given back exactly, so it does not appear here.
    expect(step.velocity!.y).toBeCloseTo(26 * G.wallRideRedirect - G.wallRideClimbDecay * DT, 6)
  })

  it('leaves the slowest legal ride climbing at about a jump', () => {
    // The statement `wallRideRedirect` encodes: entered at the minimum closing speed, the
    // climb is `jumpSpeed`, so the worst wall ride is worth one jump and everything above it
    // is profit. Held to 2%, which is the rounding from 9/13 = 0.6923 to 0.7.
    const climb = enter(G.wallRideEntrySpeed).velocity!.y
    expect(Math.abs(climb - G.jumpSpeed) / G.jumpSpeed).toBeLessThan(0.02)
  })

  it('pays nothing for a glancing approach, so aiming at the wall is the skill', () => {
    // Same speed, hit at 80 degrees off the normal. The closing speed is what buys climb, not
    // the speed, which is what makes "hit it square" a rule a player can learn in one go.
    const angle = (80 * Math.PI) / 180
    const glancing = new Vector3(26 * Math.cos(angle), -G.gravity * DT, 26 * Math.sin(angle))
    const step = stepWallRide(null, rider(), AT_WALL, glancing, DT, walledWorld(), G)
    // 26 * cos(80 deg) = 4.5, below the 13 the entry gate asks for.
    expect(step.normal).toBeNull()
  })

  it('deletes the velocity that went into the wall rather than keeping it', () => {
    const step = enter(26)
    // Pressed against the face, not driving through it. The ride's own arithmetic depends on
    // this: the climb is measured off a velocity already in the plane of the wall.
    expect(step.velocity!.x).toBeCloseTo(0, 6)
  })

  it('keeps the component running along the wall', () => {
    const along = new Vector3(26, -G.gravity * DT, 7)
    const step = stepWallRide(null, rider(), AT_WALL, along, DT, walledWorld(), G)
    expect(step.velocity!.z).toBeCloseTo(7, 6)
  })
})

describe('sustaining a ride', () => {
  const wall = new Vector3(-1, 0, 0)

  /**
   * Ride until it lets go, reporting every frame.
   *
   * Charge is drained by this loop the way `groundStep` drains it, clamped at zero, because
   * the accumulator running out is one of the two things that ends a ride and a loop that
   * left the charge full would only ever measure the other one.
   */
  function ride(from: Vector3, charge = 1, terrain = walledWorld()) {
    const frames: { y: number; charge: number }[] = []
    let normal: Vector3 | null = wall.clone()
    let velocity = from.clone()
    let position = AT_WALL.clone()
    let held = charge
    for (let i = 0; i < 600; i++) {
      // What `groundStep` hands over: last frame's velocity with a full step of gravity in it.
      const candidate = velocity.clone()
      candidate.y -= G.gravity * DT
      const step = stepWallRide(
        normal, rider({ charge: held }), position, candidate, DT, terrain, G,
      )
      if (step.velocity === null) break
      normal = step.normal
      velocity = step.velocity
      held = Math.max(0, held - step.chargeSpent)
      position = position.clone().addScaledVector(velocity, DT)
      frames.push({ y: velocity.y, charge: held })
    }
    return { frames, position, charge: held }
  }

  it('holds the ride while the wall and the accumulator both last', () => {
    const { frames } = ride(new Vector3(0, 20, 0))
    expect(frames.length).toBeGreaterThan(1)
    for (const f of frames) expect(f.y).toBeGreaterThan(G.wallRideHoldSpeed)
  })

  it('spends the climb at wallRideClimbDecay rather than at gravity', () => {
    const { frames } = ride(new Vector3(0, 20, 0))
    const fall = (frames[0]!.y - frames[1]!.y) / DT
    expect(fall).toBeCloseTo(G.wallRideClimbDecay, 6)
    expect(fall).toBeLessThan(G.gravity)
  })

  it('does not re-earn its climb from the stick every frame', () => {
    // The engine this guards against: a rider holding forward into the wall gets a fresh
    // redirect every frame and flies up it forever. Fed exactly that — a velocity still
    // pushing into the wall on every sustain frame — the climb has to fall monotonically.
    const { frames } = ride(new Vector3(26, 20, 0))
    for (let i = 1; i < frames.length; i++) {
      expect(frames[i]!.y).toBeLessThan(frames[i - 1]!.y)
    }
  })

  it('lets go when the climb decays below wallRideHoldSpeed', () => {
    // Started slow enough that the climb is what runs out first, not the accumulator: at
    // 3 m/s it takes 0.31 s to decay to the hold speed, and a full accumulator pays 1.25 s.
    const { frames } = ride(new Vector3(0, 3, 0))
    // Asserted as a duration rather than as a frame count. Both limits on a ride are walked
    // frame by frame in floating point, so the exact count is one either way depending on
    // where the last step lands; the seconds are the claim, and the arithmetic behind them —
    // (3 - 0.9) / 6.7 = 0.31 s — is what a mutation to `wallRideClimbDecay` moves.
    expect(frames.length * DT)
      .toBeCloseTo((3 - G.wallRideHoldSpeed) / G.wallRideClimbDecay, 1)
    expect(frames.at(-1)!.y).toBeGreaterThan(G.wallRideHoldSpeed)
    // And it was the climb that ended it, not the accumulator: 0.31 s of drain is a quarter
    // of what a full one pays for.
    expect(frames.at(-1)!.charge).toBeGreaterThan(0.5)
  })

  it('lets go when the accumulator empties, and that is what limits a fast ride', () => {
    // Fast enough that the climb would outlast the charge: 30 m/s decays for 4.3 s, and a
    // full accumulator pays 1.25 s. So the ride has to end on the charge, with climb to spare
    // — which is the design doc's economy, not the physics.
    const { frames, charge } = ride(new Vector3(0, 30, 0))
    expect(charge).toBe(0)
    expect(frames.at(-1)!.y).toBeGreaterThan(G.wallRideHoldSpeed * 2)
    // 1 / 0.8 = 1.25 s.
    expect(frames.length * DT).toBeCloseTo(1 / G.wallRideChargeDrain, 1)
  })

  it('drains the accumulator at exactly wallRideChargeDrain', () => {
    const step = stepWallRide(
      wall, rider(), AT_WALL, new Vector3(0, 20, 0), DT, walledWorld(), G,
    )
    expect(step.chargeSpent).toBeCloseTo(G.wallRideChargeDrain * DT, 9)
  })

  it('lets go when the wall ends, still climbing', () => {
    // The lip of a cliff. The probe finds nothing, the ride ends, and the player keeps the
    // upward velocity — which is what carries him over the edge instead of stopping dead
    // under it.
    const shortWall = walledWorld({ wallTop: 6 })
    const { frames, position } = ride(new Vector3(0, 20, 0), 1, shortWall)
    // The chest is what feels the wall, so the ride ends when the chest clears the top rather
    // than when the feet do — half of `eyeProbeHeight` below it. Worth pinning rather than
    // rounding off: it is the difference between letting go a metre early and clinging to a
    // lip that is no longer there.
    expect(position.y).toBeGreaterThan(6 - G.eyeProbeHeight / 2)
    expect(position.y).toBeLessThan(6)
    expect(frames.at(-1)!.y).toBeGreaterThan(10)
    // Well short of both other limits, so this test cannot be passing for the wrong reason.
    expect(frames.length).toBeLessThan(Math.ceil(1 / (G.wallRideChargeDrain * DT)))
  })

  it('lets go the moment the scooter is stowed, which is the release', () => {
    const step = stepWallRide(
      wall, rider({ scooterActive: false }), AT_WALL, new Vector3(0, 20, 0), DT, walledWorld(), G,
    )
    expect(step.normal).toBeNull()
    expect(step.chargeSpent).toBe(0)
  })

  it('lets go on a jump, and hands the jump its velocity untouched', () => {
    const step = stepWallRide(
      wall, rider({ jumped: true }), AT_WALL, new Vector3(0, 20, 0), DT, walledWorld(), G,
    )
    expect(step.velocity).toBeNull()
  })

  it('continues on an empty-ish accumulator that entry would have refused', () => {
    // The hysteresis, stated as behaviour. A ride already running needs only that the
    // accumulator is not empty; starting one needs a whole tier. Without the asymmetry a
    // rider at charge 0 would enter and be dropped on the next frame, against every wall.
    const trickle = G.wallRideMinCharge / 10
    expect(
      stepWallRide(wall, rider({ charge: trickle }), AT_WALL, new Vector3(0, 20, 0), DT,
        walledWorld(), G).normal,
    ).not.toBeNull()
    expect(enter(26, G, { charge: trickle }).normal).toBeNull()
  })

  it('probes into the wall it is on rather than along the way it is going', () => {
    // Once riding, the velocity has had its into-the-wall part removed and runs along the
    // face. A probe aimed along travel would look past the wall and drop the ride on its
    // second frame, so this is what keeps a ride longer than one frame possible at all.
    const alongTheFace = new Vector3(0, 20, 12)
    const step = stepWallRide(wall, rider(), AT_WALL, alongTheFace, DT, walledWorld(), G)
    expect(step.normal).not.toBeNull()
  })
})

describe('the ride as a pure function', () => {
  it('does not mutate anything it is given', () => {
    const position = AT_WALL.clone()
    const velocity = approach(26)
    const normal = new Vector3(-1, 0, 0)
    stepWallRide(normal, rider(), position, velocity, DT, walledWorld(), G)
    expect(position.toArray()).toEqual(AT_WALL.toArray())
    expect(velocity.toArray()).toEqual(approach(26).toArray())
    expect(normal.toArray()).toEqual([-1, 0, 0])
  })

  it('hands back a normal the caller cannot alias into the terrain', () => {
    const step = enter(26)
    const before = step.normal!.toArray()
    step.normal!.set(9, 9, 9)
    expect(enter(26).normal!.toArray()).toEqual(before)
  })
})

describe('the numbers, against the ones they were chosen from', () => {
  it('asks for a full on-foot sprint of closing speed', () => {
    expect(G.wallRideEntrySpeed).toBe(G.runSpeed)
  })

  it('costs the accumulator what a hard turn costs it', () => {
    expect(G.wallRideChargeDrain).toBe(G.scooterChargeLoss)
  })

  it('asks for one tier of accumulator to start', () => {
    expect(G.wallRideMinCharge).toBe(G.scooterTierDrop)
  })

  it('redirects at about jumpSpeed over runSpeed', () => {
    // Rounded from 0.6923 rather than derived at runtime, so that a retune of the jump moves
    // this test rather than silently moving the feel of every wall ride.
    const exact = G.jumpSpeed / G.runSpeed
    expect(Math.abs(G.wallRideRedirect - exact) / exact).toBeLessThan(0.02)
  })

  it('flies the ride at a third of gravity', () => {
    expect(G.wallRideClimbDecay).toBeCloseTo(G.gravity / 3, 1)
    expect(G.wallRideClimbDecay).toBeLessThan(G.gravity)
  })

  it('lets go at a tenth of a jump', () => {
    expect(G.wallRideHoldSpeed).toBeCloseTo(G.jumpSpeed / 10, 6)
  })

  it('binds its two limits together instead of one making the other decorative', () => {
    // The reason `wallRideClimbDecay` is what it is. The minimum legal ride runs out of climb
    // at 1.22 s; a full accumulator pays for 1.25 s. Above the minimum, the accumulator is
    // what runs out first, which is the ordering the design document asks for.
    const minimumClimb = G.wallRideEntrySpeed * G.wallRideRedirect
    const climbSeconds = (minimumClimb - G.wallRideHoldSpeed) / G.wallRideClimbDecay
    const chargeSeconds = 1 / G.wallRideChargeDrain
    expect(climbSeconds).toBeCloseTo(1.22, 2)
    expect(chargeSeconds).toBeCloseTo(1.25, 2)
    expect(climbSeconds).toBeLessThan(chargeSeconds)
  })

  it('can feel a wall it is being held off', () => {
    // The lateral probe borrows `snapDistance`, and it has to reach past the radius collision
    // holds the body clear at, or a rider would be pressed against a wall he could no longer
    // find.
    expect(G.snapDistance).toBeGreaterThan(DEFAULT_COLLISION_CONFIG.radius * 2)
  })
})
