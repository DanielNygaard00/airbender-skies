import { describe, it, expect } from 'vitest'
import {
  Group, Mesh, RingGeometry, ShaderMaterial, Vector3,
} from 'three'
import { createStaffArc } from './staff-arc-fx'
import { inCone } from '../combat/cone'
import { staffShape } from '../combat/staff-arc'
import { DEFAULT_COMBAT_CONFIG } from '../combat/config'
import type { Effect } from './effect'

const A = DEFAULT_COMBAT_CONFIG.staffArc
const ORIGIN = new Vector3(0, 0, 0)
const NORTH = new Vector3(0, 0, -1)

// Taken from `staffShape` against the shipped config rather than hand-written half-angles, so
// these move with the game the moment `DEFAULT_COMBAT_CONFIG.staffArc` is retuned.
const OPENER_SHAPE = staffShape(false, A)
const FINISHER_SHAPE = staffShape(true, A)

function meshes(effect: Effect): Mesh[] {
  const object = effect.object
  if (!(object instanceof Group)) throw new Error('expected a group')
  return object.children.filter((c): c is Mesh => c instanceof Mesh)
}

/** The single fill mesh a staff arc carries — its only child. */
function fillMeshOf(effect: Effect): Mesh {
  const fill = meshes(effect)[0]
  if (!fill) throw new Error('expected a fill mesh')
  return fill
}

/** The fill's shader material, built through `createEffectMaterial`. */
function fillMaterialOf(effect: Effect): ShaderMaterial {
  const { material } = fillMeshOf(effect)
  if (!(material instanceof ShaderMaterial)) throw new Error('expected a shader material')
  return material
}

/**
 * Whether a point lies inside the sector as actually drawn — read off the mesh's own
 * RingGeometry parameters and its real world transform.
 *
 * The brief's own version of this check re-derives the boundary from `shape.halfAngle`
 * directly, independent of the mesh. That comparison passes even when the geometry's real
 * `thetaStart`/`thetaLength` are built wrong (verified: widening the drawn sector by 20
 * degrees in the implementation left that version green), because it never inspects what
 * was actually rendered. Reading `geometry.parameters`, as `gust-cone.test.ts` does, closes
 * that gap while keeping the assertion a comparison against `inCone` rather than against
 * this test's own maths.
 */
function drawnContains(fill: Mesh, point: Vector3): boolean {
  const geometry = fill.geometry
  if (!(geometry instanceof RingGeometry)) throw new Error('expected a RingGeometry')
  const p = geometry.parameters
  const local = fill.worldToLocal(point.clone())
  const radius = Math.hypot(local.x, local.y)
  if (radius > p.outerRadius) return false
  // Mirrors inCone's own degenerate-distance guard, so a point sitting exactly on the
  // caster does not depend on where the sector's theta happens to start.
  if (radius < 1e-6) return false

  let relative = Math.atan2(local.y, local.x) - p.thetaStart
  const turn = Math.PI * 2
  relative = ((relative % turn) + turn) % turn
  // `relative` (atan2 plus a modulo) and `p.thetaLength` (the config angle through the
  // geometry constructor) are two different float paths to the same boundary; a sample
  // landing exactly on the sector edge can disagree by an ulp. The epsilon resolves that
  // tie toward inclusion, matching inCone's own `>=`, and at 1e-9 radians sits ~10 orders
  // of magnitude below the ~20-degree error this assertion exists to catch.
  return relative <= p.thetaLength + 1e-9
}

describe('createStaffArc', () => {
  it('draws the shape it was handed, not a fixed one', () => {
    const opener = createStaffArc(ORIGIN, NORTH, staffShape(false, A))
    const finisher = createStaffArc(ORIGIN, NORTH, staffShape(true, A))
    const radius = (e: Effect) => Math.max(...meshes(e).map((m) => m.scale.x || 1))
    expect(radius(finisher)).toBeGreaterThan(radius(opener))
  })

  it('agrees with inCone about the horizontal footprint of the sweep, and says nothing about its height', () => {
    // The honesty rule this repo holds attack effects to: a hit landing outside the drawn
    // arc reads as a bug. Checked against inCone, a different mechanism from the geometry.
    // Necessary but not sufficient — the gust cone passed a check like this while being
    // invisible on screen, so the in-game pass is what confirms it can be seen.
    //
    // **And not sufficient in a second way, which the old name "agrees with inCone about what
    // is inside the sweep" hid.** Every probe below is built at `y = 0`, level with `ORIGIN`,
    // so `staffShape`'s `verticalReach` never participates in the `inCone` call and this test
    // passes for any band at all. The drawn arc is a flat sector while the swing's hit volume
    // is a slab 2.0 m above and below the player, so the effect under-draws the swing's height
    // by 4 m — the same cosmetic mismatch `docs/HANDOFF.md` records for the gust cone and the
    // aim tell. Renamed to say which dimension it covers, following `gust-cone.test.ts`.
    const shape = staffShape(false, A)
    const arc = createStaffArc(ORIGIN, NORTH, shape)
    const fill = meshes(arc)[0]
    if (!fill) throw new Error('expected a fill mesh')
    arc.object.updateMatrixWorld(true)

    for (let angle = -Math.PI; angle < Math.PI; angle += Math.PI / 24) {
      for (const r of [shape.range * 0.5, shape.range * 1.4]) {
        const point = new Vector3(Math.sin(angle) * r, 0, -Math.cos(angle) * r)
        const expected = inCone(ORIGIN, NORTH, point, shape)
        const inSector = drawnContains(fill, point)
        expect({ angle, r, inSector }).toEqual({ angle, r, inSector: expected })
      }
    }
  })

  it('runs and then finishes', () => {
    const arc = createStaffArc(ORIGIN, NORTH, staffShape(false, A))
    expect(arc.advance(0.01)).toBe(true)
    expect(arc.advance(5)).toBe(false)
  })

  it('fades out', () => {
    // The fade now lives in the shader's own `alpha` uniform rather than the material's
    // built-in `opacity` — `createEffectMaterial` never touches that property, so checking
    // it here would pass vacuously at its constant default of 1.
    const arc = createStaffArc(ORIGIN, NORTH, staffShape(false, A))
    const material = fillMaterialOf(arc)
    const start = material.uniforms.alpha?.value
    arc.advance(0.1)
    expect(material.uniforms.alpha?.value).toBeLessThan(start)
  })

  it('does not alias the position it was handed', () => {
    const at = ORIGIN.clone()
    createStaffArc(at, NORTH, staffShape(false, A))
    expect(at.toArray()).toEqual([0, 0, 0])
  })

  it('casts no shadow', () => {
    for (const m of meshes(createStaffArc(ORIGIN, NORTH, staffShape(false, A)))) {
      expect(m.userData.excludeFromShadows).toBe(true)
    }
  })

  it('disposes without throwing', () => {
    expect(() => createStaffArc(ORIGIN, NORTH, staffShape(false, A)).dispose()).not.toThrow()
  })
})

describe('the swing reads along its own sweep', () => {
  it('measures across the wedge from its centre, so the finisher does not seam', () => {
    // staffArc.finisher is 94.7 degrees, and sectorTheta puts its start edge at -184.7 —
    // outside atan's range. POLAR_PREAMBLE's angle returns two clusters there; vUv.x
    // saturates. WEDGE_PREAMBLE's `across` is the only coordinate that runs.
    const material = fillMaterialOf(createStaffArc(ORIGIN, NORTH, FINISHER_SHAPE))
    expect(material.fragmentShader).toContain('across')
    expect(material.fragmentShader).not.toContain('vUv.x')
    expect(material.fragmentShader).not.toContain('atan(p.y, p.x)')
  })

  it('carries the half-angle it was built for, so `across` normalises', () => {
    const material = fillMaterialOf(createStaffArc(ORIGIN, NORTH, FINISHER_SHAPE))
    expect(material.uniforms.halfAngle?.value).toBeCloseTo(FINISHER_SHAPE.halfAngle, 6)
  })

  it('rims its leading edge, where a swing is felt', () => {
    const material = fillMaterialOf(createStaffArc(ORIGIN, NORTH, OPENER_SHAPE))
    expect(material.fragmentShader).toContain('smoothstep(0.62, 0.88, radius)')
    expect(material.fragmentShader).toContain('mix(tint * 0.18, tint, core)')
  })

  it('is brightest at the middle of the sweep and thinnest at its edges', () => {
    // A swing lands with its middle. A term flat across `across` would read as a shape being
    // displayed rather than a blow being struck.
    const material = fillMaterialOf(createStaffArc(ORIGIN, NORTH, OPENER_SHAPE))
    expect(material.fragmentShader).toContain('1.0 - across * across')
  })

  it('keeps the drawn shape identical to the shape it was handed', () => {
    // The honesty argument this file exists on: the drawn arc and the hit arc cannot diverge.
    // staff-arc-fx.test.ts's containment check against inCone remains the authority.
    const fill = fillMeshOf(createStaffArc(ORIGIN, NORTH, FINISHER_SHAPE))
    expect(fill.scale.x).toBeCloseTo(FINISHER_SHAPE.range, 5)
  })

  it('advances time', () => {
    const effect = createStaffArc(ORIGIN, NORTH, OPENER_SHAPE)
    const material = fillMaterialOf(effect)
    const before = material.uniforms.time?.value
    for (let t = 0; t < 0.08; t += 1 / 60) effect.advance(1 / 60)
    expect(material.uniforms.time?.value).not.toBe(before)
  })
})
