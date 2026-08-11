import { describe, it, expect } from 'vitest'
import { Vector3 } from 'three'
import {
  profileFor, desiredCameraPosition, smoothTowards, pullInForTerrain,
  GROUND_PROFILE, GLIDER_PROFILE,
  type CamProfile,
} from './follow-cam'
import type { TerrainQuery } from '../core/types'

const noGround: TerrainQuery = { groundHeightAt: () => null, raycast: () => null }

/**
 * A surface `distance` along whatever ray it is given, facing back down it. Written
 * against the ray rather than as world geometry, because what this function cares about
 * is only how far away the first surface along the arm is.
 */
const surfaceAt = (distance: number): TerrainQuery => ({
  groundHeightAt: () => 0,
  raycast: (from, direction, maxDistance) => {
    // Mirrors the degenerate-direction guard `createTerrainQuery` actually enforces
    // (`terrain-query.ts`'s `!(lengthSq > 1e-12)` check): a real TerrainQuery never hands
    // back a hit for a zero-length direction, so this fake shouldn't either. Without this,
    // `surfaceAt(0)` would fall through to `direction.clone().normalize()` on a zero
    // vector and hand back a NaN point instead of the null a real implementation returns.
    if (!(direction.lengthSq() > 1e-12)) return null
    if (distance > maxDistance) return null
    const unit = direction.clone().normalize()
    return {
      point: from.clone().addScaledVector(unit, distance),
      normal: unit.clone().negate(),
      islandId: 'surface',
    }
  },
})

describe('profileFor', () => {
  it('uses the ground profile on foot', () => {
    expect(profileFor('ground')).toBe(GROUND_PROFILE)
  })

  it('uses the glider profile in flight', () => {
    expect(profileFor('glider')).toBe(GLIDER_PROFILE)
  })

  it('pulls further back in flight to sell speed', () => {
    expect(GLIDER_PROFILE.distance).toBeGreaterThan(GROUND_PROFILE.distance)
  })

  it('smooths tighter in flight, because the camera is the steering device', () => {
    expect(GLIDER_PROFILE.smoothing).toBeGreaterThan(GROUND_PROFILE.smoothing)
  })
})

describe('desiredCameraPosition', () => {
  const target = new Vector3(0, 0, 0)

  it('sits behind the look direction', () => {
    expect(desiredCameraPosition(target, new Vector3(0, 0, -1), GROUND_PROFILE).z)
      .toBeCloseTo(GROUND_PROFILE.distance, 5)
  })

  it('sits above the target', () => {
    expect(desiredCameraPosition(target, new Vector3(0, 0, -1), GROUND_PROFILE).y)
      .toBeCloseTo(GROUND_PROFILE.height, 5)
  })

  it('follows the look direction around', () => {
    expect(desiredCameraPosition(target, new Vector3(-1, 0, 0), GROUND_PROFILE).x)
      .toBeCloseTo(GROUND_PROFILE.distance, 5)
  })

  it('does not mutate the target it is given', () => {
    const t = new Vector3(1, 2, 3)
    desiredCameraPosition(t, new Vector3(0, 0, -1), GROUND_PROFILE)
    expect(t.toArray()).toEqual([1, 2, 3])
  })

  it('offsets the camera purely backward and up, so flattened it faces exactly along the look direction', () => {
    // This is the pin behind a substitution `src/main.ts` makes and cannot test itself.
    // `markFor` needs the camera's own forward to measure a screen-space bearing against,
    // and it is handed the player's `lookDirection` instead. That is valid only because
    // the offset this function applies is `-lookDirection * distance` plus a purely
    // vertical lift: the vertical term drops out of a flattened comparison and the
    // backward term is `lookDirection` itself, so the direction from the camera back to
    // the player is, flattened, the look direction exactly.
    //
    // Asserted rather than argued because the day this stops being true is the day
    // someone adds a lateral offset or an orbit to the follow cam, and the symptom would
    // be a hit-direction indicator quietly rotated by a constant with nothing else wrong.
    // A shoulder offset added below fails here, and this comment says where to look.
    //
    // Both profiles, and headings that are steeply pitched as well as level, because it is
    // the vertical lift interacting with a pitched heading that would break the claim if
    // anything did. The cross product of the two flattened vectors is the test: zero means
    // parallel or antiparallel, and the dot being positive rules out antiparallel — so the
    // camera faces along the heading rather than against it.
    const player = new Vector3(12, 34, -56)
    const headings = [
      new Vector3(0, 0, -1),
      new Vector3(1, 0, 0),
      new Vector3(0.6, 0.7, -0.4).normalize(),
      new Vector3(-0.3, -0.9, 0.2).normalize(),
      // As close to vertical as clampPitch allows, where the lift is nearly the whole offset.
      new Vector3(0.0872, 0.9962, 0).normalize(),
    ]
    for (const profile of [GROUND_PROFILE, GLIDER_PROFILE]) {
      for (const heading of headings) {
        const camera = desiredCameraPosition(player, heading, profile)
        const forward = player.clone().sub(camera)
        expect(forward.x * heading.z - forward.z * heading.x).toBeCloseTo(0, 10)
        expect(forward.x * heading.x + forward.z * heading.z).toBeGreaterThan(0)
      }
    }
  })
})

describe('the smoothed camera against the look direction', () => {
  /**
   * How far the drawn camera's flattened forward trails `lookDirection` during a sustained
   * turn, in degrees, after the lag has settled.
   *
   * `main.ts` hands `markFor` the player's `lookDirection` as the camera forward. The test
   * above proves that is exact for the *desired* camera position; `smoothTowards` is what
   * makes it inexact in motion, because the drawn camera is still travelling toward that
   * position while the player keeps turning. A hit mark freezes its bearing at the instant it
   * lands, so a mark struck mid-flick keeps this error for its whole life.
   */
  function lagDegrees(profile: CamProfile, yawRatePerSecond: number): number {
    const dt = 1 / 60
    const player = new Vector3(0, 0, 0)
    const axis = new Vector3(0, 1, 0)
    let yaw = 0
    let look = new Vector3(0, 0, -1)
    let camera = desiredCameraPosition(player, look, profile)
    let lag = 0
    // Ten seconds at 60 Hz, which is far past the settling time of either profile, so what
    // this returns is the steady-state lag and not a transient from the first frame.
    for (let i = 0; i < 600; i += 1) {
      yaw += yawRatePerSecond * dt
      look = new Vector3(0, 0, -1).applyAxisAngle(axis, yaw)
      camera = smoothTowards(
        camera, desiredCameraPosition(player, look, profile), profile.smoothing, dt,
      )
      const forward = player.clone().sub(camera)
      let delta = Math.atan2(forward.x, forward.z) - Math.atan2(look.x, look.z)
      while (delta > Math.PI) delta -= 2 * Math.PI
      while (delta < -Math.PI) delta += 2 * Math.PI
      lag = Math.abs(delta) * 180 / Math.PI
    }
    return lag
  }

  it('trails the look direction by a measured angle during a sustained turn', () => {
    // Measured, not derived. The first-order estimate for an exponential lag is the turn
    // rate over the smoothing constant, which at 180 degrees a second would give 20.0
    // degrees on foot; the real figure is 17.78, because the smoothing acts on the camera's
    // position around a circle rather than on the angle itself. That gap is the reason this
    // is a test and not a sentence in a comment.
    //
    // Pinned because `docs/HANDOFF.md` quotes these numbers as the residual inaccuracy in
    // the hit-direction indicator. Retuning either `smoothing` is *expected* to redden this:
    // re-measure, update the handoff, and check the new figure is still small enough that a
    // wedge points somewhere useful.
    expect(lagDegrees(GROUND_PROFILE, Math.PI)).toBeCloseTo(17.78, 1)
    expect(lagDegrees(GLIDER_PROFILE, Math.PI)).toBeCloseTo(9.68, 1)
  })

  it('trails less the slower the turn, and settles to nothing when the turn stops', () => {
    // The shape of the claim, so the two numbers above are not the only thing holding it:
    // this is a lag and not a fixed offset, so it scales with the turn rate and vanishes at
    // zero. An implementation that had genuinely rotated the camera would keep its error.
    expect(lagDegrees(GROUND_PROFILE, Math.PI / 2))
      .toBeLessThan(lagDegrees(GROUND_PROFILE, Math.PI))
    expect(lagDegrees(GROUND_PROFILE, 0)).toBeCloseTo(0, 6)
    // And the glider's tighter smoothing trails less than the ground's at the same rate.
    expect(lagDegrees(GLIDER_PROFILE, Math.PI)).toBeLessThan(lagDegrees(GROUND_PROFILE, Math.PI))
  })
})

describe('smoothTowards', () => {
  it('moves toward the desired position', () => {
    const out = smoothTowards(new Vector3(0, 0, 0), new Vector3(10, 0, 0), 9, 1 / 60)
    expect(out.x).toBeGreaterThan(0)
    expect(out.x).toBeLessThan(10)
  })

  it('converges over many frames', () => {
    let c = new Vector3(0, 0, 0)
    const d = new Vector3(10, 0, 0)
    for (let i = 0; i < 200; i++) c = smoothTowards(c, d, 9, 1 / 60)
    expect(c.x).toBeCloseTo(10, 3)
  })

  it('is frame-rate independent to within a small tolerance', () => {
    let fast = new Vector3()
    let slow = new Vector3()
    const d = new Vector3(10, 0, 0)
    for (let i = 0; i < 120; i++) fast = smoothTowards(fast, d, 9, 1 / 120)
    for (let i = 0; i < 60; i++) slow = smoothTowards(slow, d, 9, 1 / 60)
    expect(Math.abs(fast.x - slow.x)).toBeLessThan(0.01)
  })

  it('never overshoots the target', () => {
    expect(smoothTowards(new Vector3(), new Vector3(10, 0, 0), 1000, 1).x)
      .toBeLessThanOrEqual(10)
  })

  it('does not mutate the current vector', () => {
    const c = new Vector3(0, 0, 0)
    smoothTowards(c, new Vector3(10, 0, 0), 9, 1 / 60)
    expect(c.toArray()).toEqual([0, 0, 0])
  })

  it('does not mutate the desired vector', () => {
    const d = new Vector3(10, 0, 0)
    smoothTowards(new Vector3(0, 0, 0), d, 9, 1 / 60)
    expect(d.toArray()).toEqual([10, 0, 0])
  })
})

describe('pullInForTerrain', () => {
  const target = new Vector3(0, 20, 0)

  it('leaves the camera where it wants to be when nothing is in the way', () => {
    const desired = new Vector3(0, 20, 10)
    expect(pullInForTerrain(target, desired, noGround).toArray()).toEqual(desired.toArray())
  })

  it('shortens the arm to the surface between camera and player', () => {
    // The behaviour the old height-lift stood in for. A wall 4 m along a 10 m arm should
    // put the camera at 4 m, not lift it over the wall and leave the player behind it.
    const desired = new Vector3(0, 20, 10)
    const out = pullInForTerrain(target, desired, surfaceAt(4))
    expect(target.distanceTo(out)).toBeLessThan(4.01)
    expect(target.distanceTo(out)).toBeGreaterThan(2)
  })

  it('keeps the arm pointing where it was, only nearer', () => {
    const desired = new Vector3(0, 20, 10)
    const out = pullInForTerrain(target, desired, surfaceAt(4))
    expect(out.x).toBeCloseTo(0, 6)
    expect(out.y).toBeCloseTo(20, 6)
    expect(out.z).toBeGreaterThan(0)
  })

  it('stops strictly short of the surface, never on it', () => {
    // Placing the camera exactly on the hit point puts that surface at distance zero from
    // the camera, behind the near clip plane, which is the see-through-the-wall failure
    // this whole function exists to fix. `CAMERA_SKIN` is what pulls it back off the
    // surface; without it `target.distanceTo(out)` would equal the hit distance exactly.
    const desired = new Vector3(0, 20, 10)
    const hitDistance = 4
    const out = pullInForTerrain(target, desired, surfaceAt(hitDistance))
    expect(target.distanceTo(out)).toBeLessThan(hitDistance)
  })

  it('never comes closer than minDistance, even against a surface nearer than that', () => {
    // Deliberate: a camera jammed into the character's head is worse than a camera
    // briefly clipping a wall.
    const out = pullInForTerrain(target, new Vector3(0, 20, 10), surfaceAt(0.5))
    expect(target.distanceTo(out)).toBeGreaterThanOrEqual(2)
  })

  it('ignores a surface further away than the arm is long', () => {
    const desired = new Vector3(0, 20, 10)
    expect(pullInForTerrain(target, desired, surfaceAt(40)).toArray()).toEqual(desired.toArray())
  })

  // This is a contract test, not proof that the zero-length-arm guard in
  // `pullInForTerrain` is load-bearing: `arm` here is exactly (0, 0, 0), and any
  // TerrainQuery honouring the same degenerate-direction contract `createTerrainQuery`
  // enforces (`terrain-query.ts`'s `!(lengthSq > 1e-12)` check, mirrored in `surfaceAt`
  // above) already returns null for that direction, so `pullInForTerrain` falls through to
  // its own `if (!hit) return desired.clone()` and produces the identical result with the
  // guard deleted. Checked directly: removing the guard and running this file still passes
  // all tests. The guard stays anyway -- it fails fast and documents the case by name,
  // rather than depending on every TerrainQuery implementation continuing to reject a
  // zero-length cast the same way.
  it('handles a desired position sitting on the player', () => {
    const out = pullInForTerrain(target, target.clone(), surfaceAt(1))
    expect(Number.isFinite(out.x + out.y + out.z)).toBe(true)
  })

  // Despite the name, this one does not exercise the guard at all: `arm` is
  // (0, -1, 0), length 1, nowhere near the `1e-6` threshold. It is a real test of a real
  // hit landing inside `minDistance` of the player, kept as its own case rather than
  // folded into the guard discussion above.
  it('never returns a non-finite position', () => {
    const out = pullInForTerrain(target, new Vector3(0, 19, 0), surfaceAt(1))
    expect(Number.isFinite(out.x + out.y + out.z)).toBe(true)
  })

  it('does not return a reference-identical copy on early return', () => {
    const desired = new Vector3(0, 20, 10)
    expect(pullInForTerrain(target, desired, noGround)).not.toBe(desired)
  })

  it('does not mutate the target vector', () => {
    const t = new Vector3(0, 20, 0)
    const orig = t.toArray()
    pullInForTerrain(t, new Vector3(0, 20, 10), surfaceAt(4))
    expect(t.toArray()).toEqual(orig)
  })

  it('does not mutate the desired vector', () => {
    const d = new Vector3(0, 20, 10)
    const orig = d.toArray()
    pullInForTerrain(target, d, surfaceAt(4))
    expect(d.toArray()).toEqual(orig)
  })
})
