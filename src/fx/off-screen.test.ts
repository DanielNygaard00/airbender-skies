import { describe, it, expect } from 'vitest'
import { OFF_SCREEN_RAMP, offScreenPresence } from './off-screen'

/** Inside the visible depth range, so only the x/y position is under test. */
const IN_FRONT = 0.5

describe('offScreenPresence', () => {
  it('is zero for a point at the centre of the frame', () => {
    expect(offScreenPresence({ x: 0, y: 0, z: IN_FRONT })).toBe(0)
  })

  // Exactly on the edge, not approaching it. The boundary is where an off-by-one
  // comparison lives, and a soldier standing precisely at the frame edge must not
  // have a chevron drawn for it -- it is still visible.
  //
  // Every fixture in this file is asymmetric: x is never equal to y, and never equal
  // to -y either. That is not to catch an axis swap -- see the note on the swap
  // below, which is provably a no-op -- it is so that a one-axis implementation
  // cannot be masked by the other axis reading the same value.
  it('is zero for a point exactly on each of the four edges', () => {
    expect(offScreenPresence({ x: 1, y: -0.37, z: IN_FRONT })).toBe(0)
    expect(offScreenPresence({ x: -1, y: 0.42, z: IN_FRONT })).toBe(0)
    expect(offScreenPresence({ x: 0.31, y: 1, z: IN_FRONT })).toBe(0)
    expect(offScreenPresence({ x: -0.58, y: -1, z: IN_FRONT })).toBe(0)
  })

  // The four cases together are what pin the shape of the measurement. An
  // implementation that reads only x keeps the top and bottom cases at 0; one that
  // reads only y keeps left and right at 0; one that writes `ndc.x - 1` instead of
  // `Math.abs(ndc.x) - 1` keeps the left and bottom cases at 0. Each of those is a
  // real mutant and each reddens here.
  it('reaches half strength half a ramp past each edge', () => {
    const half = OFF_SCREEN_RAMP / 2
    expect(offScreenPresence({ x: 1 + half, y: 0.2, z: IN_FRONT })).toBeCloseTo(0.5)
    expect(offScreenPresence({ x: -1 - half, y: 0.63, z: IN_FRONT })).toBeCloseTo(0.5)
    expect(offScreenPresence({ x: -0.45, y: 1 + half, z: IN_FRONT })).toBeCloseTo(0.5)
    expect(offScreenPresence({ x: 0.28, y: -1 - half, z: IN_FRONT })).toBeCloseTo(0.5)
  })

  it('reaches full strength exactly one ramp past the edge', () => {
    expect(offScreenPresence({ x: 1 + OFF_SCREEN_RAMP, y: 0.13, z: IN_FRONT })).toBeCloseTo(1)
    expect(offScreenPresence({ x: -0.24, y: -1 - OFF_SCREEN_RAMP, z: IN_FRONT })).toBeCloseTo(1)
  })

  it('clamps at full strength well beyond the ramp', () => {
    // Without the clamp this would be 8, and the view writes it straight into an
    // opacity -- which CSS would clamp for us, so the wrongness would be invisible.
    expect(offScreenPresence({ x: 0.11, y: 1 + OFF_SCREEN_RAMP * 8, z: IN_FRONT })).toBe(1)
  })

  it('takes the larger overshoot when the point is past two edges at once', () => {
    // Off the right by a fifth of a ramp and off the top by three fifths. The larger
    // decides: the further out on any axis, the more definitely gone. Deliberately
    // unequal, so an implementation that took the smaller or averaged the two lands
    // on a different number rather than the same one by coincidence.
    const presence = offScreenPresence({
      x: 1 + OFF_SCREEN_RAMP * 0.2, y: 1 + OFF_SCREEN_RAMP * 0.6, z: IN_FRONT,
    })
    expect(presence).toBeCloseTo(0.6)
  })

  it('is full strength for a point behind the camera, however central its x and y', () => {
    // The case this whole feature exists for: a follow cam's blind spot is the space
    // directly behind the player, and `project` reports it with a mirrored x/y that
    // looks perfectly on-screen. Deciding from x and y alone would draw nothing for
    // the soldier standing right behind the player.
    expect(offScreenPresence({ x: 0.2, y: -0.4, z: 1.7 })).toBe(1)
  })

  it('is full strength for a point in front of the near plane', () => {
    expect(offScreenPresence({ x: -0.15, y: 0.36, z: -1.4 })).toBe(1)
  })

  it('is full strength for a projection with a non-finite component', () => {
    // A 0x0 canvas gives a camera a non-finite aspect, which projects to a NaN x
    // while y and z stay finite. Watched happening in the previous cycle.
    //
    // This is the one input where this module deliberately answers the opposite of
    // `reticleModel`, which reports `visible: false` for it. The reticle needs a
    // screen *position* and has none; a marker needs only a bearing, which comes
    // from world space and is unaffected. Asserted so that "making the two
    // consistent" has to argue with a test.
    expect(offScreenPresence({ x: NaN, y: 0.3, z: IN_FRONT })).toBe(1)
    expect(offScreenPresence({ x: 0.3, y: Infinity, z: IN_FRONT })).toBe(1)
    expect(offScreenPresence({ x: 0.3, y: 0.4, z: NaN })).toBe(1)
  })
})
