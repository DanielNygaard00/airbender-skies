import { describe, it, expect } from 'vitest'
import { Mesh, Vector3 } from 'three'
import { createAimTell } from './aim-tell'
import { FILL_OPACITY as GUST_CONE_FILL_OPACITY } from './gust-cone'
import { DEFAULT_AIM_TELL_CONFIG } from './config'
import { DEFAULT_COMBAT_CONFIG } from '../combat/config'
import { inCone } from '../combat/cone'

const GUST = DEFAULT_COMBAT_CONFIG.gust
const ORIGIN = new Vector3(0, 0, 0)
const NORTH = new Vector3(0, 0, -1)

/** The preview sector and the marker, by name, so a test cannot grab the wrong one. */
function parts(tell: { object: { getObjectByName(name: string): unknown } }) {
  const preview = tell.object.getObjectByName('aim-preview') as Mesh
  const marker = tell.object.getObjectByName('aim-marker') as Mesh
  if (!preview || !marker) throw new Error('the aim tell must name its two children')
  return { preview, marker }
}

describe('the marker', () => {
  it('always shows, whether or not anything is in range', () => {
    const tell = createAimTell()
    tell.update(ORIGIN, NORTH, false, true, GUST)
    expect(parts(tell).marker.visible).toBe(true)
    tell.dispose()
  })

  it('sits ahead of the player along the heading', () => {
    const tell = createAimTell()
    tell.update(ORIGIN, NORTH, false, true, GUST)
    const world = parts(tell).marker.getWorldPosition(new Vector3())
    // Along -Z because that is the heading given. A marker that ignored `forward` would
    // sit at the origin and this would catch it.
    expect(world.z).toBeCloseTo(-DEFAULT_AIM_TELL_CONFIG.markerDistance, 2)
    expect(world.x).toBeCloseTo(0, 2)
    tell.dispose()
  })

  it('follows the heading round, not just the position', () => {
    const tell = createAimTell()
    tell.update(ORIGIN, new Vector3(1, 0, 0), false, true, GUST)
    const world = parts(tell).marker.getWorldPosition(new Vector3())
    expect(world.x).toBeCloseTo(DEFAULT_AIM_TELL_CONFIG.markerDistance, 2)
    expect(world.z).toBeCloseTo(0, 2)
    tell.dispose()
  })

  it('ignores the vertical part of the heading', () => {
    // In the glider `forward` climbs and dives, but inGust tests a flattened heading, so a
    // marker that tilted with the nose would point somewhere the gust does not go. Compared
    // against a level heading rather than against a literal 0: the tell sits `HEIGHT` above
    // the player regardless of pitch, and that ground clearance is not what this test is
    // about. What it is about is whether pitch leaks into the marker's height at all — a
    // level and a climbing heading must land the marker at the same world Y.
    const tell = createAimTell()
    tell.update(ORIGIN, NORTH, false, true, GUST)
    const level = parts(tell).marker.getWorldPosition(new Vector3())
    tell.update(ORIGIN, new Vector3(0, 0.9, -0.4).normalize(), false, true, GUST)
    const climbing = parts(tell).marker.getWorldPosition(new Vector3())
    expect(climbing.y).toBeCloseTo(level.y, 2)
    tell.dispose()
  })
})

describe('the cone preview', () => {
  it('hides when nothing live is in the cone', () => {
    const tell = createAimTell()
    tell.update(ORIGIN, NORTH, false, true, GUST)
    expect(parts(tell).preview.visible).toBe(false)
    tell.dispose()
  })

  it('shows when a live soldier is in the cone', () => {
    const tell = createAimTell()
    tell.update(ORIGIN, NORTH, true, true, GUST)
    expect(parts(tell).preview.visible).toBe(true)
    tell.dispose()
  })

  it('stays visible but dimmer while the gust is on cooldown', () => {
    // Dimming rather than hiding, so the shape does not blink off and on every 0.45s.
    const tell = createAimTell()
    tell.update(ORIGIN, NORTH, true, true, GUST)
    const ready = (parts(tell).preview.material as { opacity: number }).opacity
    tell.update(ORIGIN, NORTH, true, false, GUST)
    const cooling = (parts(tell).preview.material as { opacity: number }).opacity
    expect(parts(tell).preview.visible).toBe(true)
    // A margin, not a bare `<`: a dim of a millionth would pass that.
    expect(cooling).toBeLessThan(ready * 0.6)
    expect(cooling).toBeGreaterThan(0)
    tell.dispose()
  })

  it('is quieter than the fired cone it previews', () => {
    // A persistent indicator as loud as the one-shot would swamp it, and the fired cone is the
    // louder statement. Compared against the fired cone's real fill opacity, imported rather
    // than written out: this test previously held the literal 0.34, so retuning the cone's
    // fill would have left the guard passing against a number the game no longer used.
    //
    // Relational rather than a fixed figure on purpose. The claim genuinely is about two
    // opacities standing in a particular relation, not about either one's value, so pinning a
    // literal would be pinning the wrong thing.
    expect(DEFAULT_AIM_TELL_CONFIG.previewOpacity).toBeLessThan(GUST_CONE_FILL_OPACITY * 0.6)
  })

  it('keeps the preview off zero for a shape with no range', () => {
    // The `Math.max(shape.range, 1e-4)` floor on the preview's scale. This effect has no
    // animation to reach it — the scale is whatever range the caller hands over, every frame —
    // so what the floor bounds is the config, and a zero scale is a degenerate matrix. The same
    // reason and the same shape as the floors in `vortex-ring.ts` and `shockwave.ts`.
    const tell = createAimTell()
    tell.update(ORIGIN, NORTH, true, true, { ...GUST, range: 0 })
    expect(parts(tell).preview.scale.x).toBeGreaterThan(0)
    tell.dispose()
  })

  it('draws the cone at the gust the caller hands it, not a fixed one', () => {
    // The preview must draw whatever range it is handed, not a value compiled into this
    // module: main.ts feeds it fightConfig.gust every frame precisely so the drawn reach
    // tracks the config, whatever that config turns out to be. A hard-coded radius would
    // silently stop matching the fired cone the moment the config it reads ever changes.
    //
    // Measured as the farthest transformed vertex from the tell's origin, NOT via
    // computeBoundingSphere: that centres on the bounding-box centroid rather than the
    // wedge's apex and under-reports a wedge by a factor that depends on the half angle.
    // Task 1 hit exactly this. Measuring transformed vertices also covers the radius
    // itself, which lives on the mesh's scale rather than in the geometry.
    const tell = createAimTell()
    tell.update(ORIGIN, NORTH, true, true, { ...GUST, range: 40 })
    tell.object.updateMatrixWorld(true)
    const { preview } = parts(tell)
    const positions = preview.geometry.getAttribute('position')
    let reach = 0
    for (let i = 0; i < positions.count; i++) {
      const world = preview.localToWorld(
        new Vector3(positions.getX(i), positions.getY(i), positions.getZ(i)),
      )
      reach = Math.max(reach, Math.hypot(world.x - ORIGIN.x, world.z - ORIGIN.z))
    }
    expect(reach).toBeCloseTo(40, 1)
    tell.dispose()
  })

  it('covers the horizontal footprint the hit test covers, and deliberately says nothing about its height', () => {
    // The independent cross-check, as with the fired cone: a point the preview's own span
    // contains must also be inside inCone. A preview drawn narrower than the hit volume
    // teaches the wrong spacing, which is the defect this whole cycle exists to fix.
    //
    // **The name used to say "covers the volume the hit test covers", and that was an
    // overclaim.** Every probe below is flattened to `y = 0`, level with `ORIGIN`, so `|dy|`
    // is zero at all of them and `gust.verticalReach` never participates in the `inCone`
    // call. This test cannot tell a band of 5.0 from a band of 0.001, and the hit volume it
    // compares against is a slab while the tell is a flat sector — the cosmetic mismatch
    // recorded in `docs/HANDOFF.md`. The name now names the one dimension it checks, matching
    // `gust-cone.test.ts`, which was renamed for exactly this reason during this cycle. A
    // green run here is not evidence that the tell covers the hit volume.
    const tell = createAimTell()
    tell.update(ORIGIN, NORTH, true, true, GUST)
    // Required before localToWorld: nothing has added this tell to a scene, so no render
    // pass has updated its matrices, and localToWorld would silently use a stale identity.
    tell.object.updateMatrixWorld(true)
    const { preview } = parts(tell)
    const positions = preview.geometry.getAttribute('position')
    for (let i = 0; i < positions.count; i++) {
      const local = new Vector3(positions.getX(i), positions.getY(i), positions.getZ(i))
      const world = preview.localToWorld(local.clone())
      // Skip the apex, which has no direction to compare.
      if (Math.hypot(world.x - ORIGIN.x, world.z - ORIGIN.z) < 1e-3) continue
      // Pulled in a hair off the rim so boundary floating point is not what is under test.
      const inset = new Vector3(world.x, 0, world.z).multiplyScalar(0.98)
      expect(inCone(ORIGIN, NORTH, inset, GUST), `vertex ${i}`).toBe(true)
    }
    tell.dispose()
  })
})

describe('the whole tell', () => {
  it('moves with the player', () => {
    const tell = createAimTell()
    tell.update(new Vector3(10, 5, -20), NORTH, true, true, GUST)
    expect(tell.object.position.x).toBeCloseTo(10)
    expect(tell.object.position.z).toBeCloseTo(-20)
    tell.dispose()
  })

  it('survives a zero heading without producing NaN', () => {
    // A standing player whose forward has not been set yet, or a corrupt state one frame
    // before the controller respawns it. three.js normalises a zero vector to zero rather
    // than to NaN, so the risk here is a lookAt on a degenerate target, not a divide.
    const tell = createAimTell()
    tell.update(ORIGIN, new Vector3(0, 0, 0), true, true, GUST)
    const world = parts(tell).marker.getWorldPosition(new Vector3())
    expect(Number.isFinite(world.x)).toBe(true)
    expect(Number.isFinite(world.z)).toBe(true)
    expect(Number.isFinite(tell.object.quaternion.w)).toBe(true)
    tell.dispose()
  })
})
