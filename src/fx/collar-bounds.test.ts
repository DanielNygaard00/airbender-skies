import { describe, it, expect } from 'vitest'
import { Mesh, RingGeometry, ShaderMaterial, Vector3 } from 'three'
import { createWaterReach } from './water-reach'
import { createEarthReach } from './earth-reach'
import { createFireBurst } from './fire-burst'
import { DEFAULT_COMBAT_CONFIG } from '../combat/config'

const ORIGIN = new Vector3(0, 0, 0)
const NORTH = new Vector3(0, 0, -1)
const W = DEFAULT_COMBAT_CONFIG.water

/**
 * One collar-carrying arc: a name for failure messages, and a thunk that builds a fresh instance
 * and returns the mesh whose `RingGeometry` is the band the shader's `radius` is normalised
 * against.
 */
interface CollarCase {
  name: string
  arc: () => Mesh
}

/**
 * Every effect that carries a `core`/`collar` pair checked against `radius` — `POLAR_PREAMBLE`
 * feeding a body with a bright `core` and a dark `collar`, each a `smoothstep(_, _, radius)` —
 * registers itself here. Task 2 (`water-reach.ts`) is the first; Tasks 4 and 5 (`earth-reach.ts`,
 * `fire-burst.ts`) registered theirs once they landed, each with its own arc's own thickness.
 *
 * **The real membership rule is that `core`/`collar` pair against `radius`, not a shape rule —
 * and the suite's absences prove it, for two different reasons.** Task 3's ice shell and Task 6's
 * fire thrust are absent because they have nothing here to check at all: this suite's whole
 * method is reading a `RingGeometry`'s `innerRadius`/`outerRadius` and comparing it against the
 * shader's `radius`-driven `smoothstep` bounds, and neither term exists for a shape with no ring
 * geometry and no `POLAR_PREAMBLE` — the ice shell shades a silhouette rim off `vViewNormal`, and
 * the fire thrust's plume shades `along01` off `vLocal.z` on a `BoxGeometry`, so both carry the
 * same bright-core-and-collar idea expressed against a coordinate this suite has no geometry to
 * check it against. `mud.ts` is absent for the opposite reason: it has both a `RingGeometry` and
 * `POLAR_PREAMBLE` — exactly the shape and the preamble this suite knows how to read — but writes
 * no `core`/`collar` pair at all, being the collar rule's second and last exemption (see its own
 * comment). A shape rule ("no ring, no preamble") would have called mud's absence the same kind of
 * absence as the shell's and the plume's; it is not the same kind, which is why the rule this
 * suite actually enforces is the pair against `radius`, not the shape underneath it.
 *
 * **What this catches that the literal-pinning tests in each effect's own `*.test.ts` cannot.**
 * Those tests (`toContain('smoothstep(0.90, 0.96, radius)')` and similar) prove a gradient was
 * not accidentally reversed or retuned — they compare the shader source against a string. They
 * cannot catch the bounds being wrong *relative to the geometry they shade*, because they never
 * look at the geometry at all: `water-reach.test.ts`'s own bounds are valid only because
 * `ARC_THICKNESS` happens to be 0.16, and nothing ties the two together. Change the thickness
 * without touching the shader body — plausible, since they live in different constants a
 * screen-width apart — and every `smoothstep` bound can end up below the band's true inner edge.
 * When that happens `core` saturates at 1 and `collar` goes to 0 across the whole band: a collar
 * that compiles, draws nothing, and looks exactly like the flat, thresholded arc it replaced —
 * silently, because every literal-pinning test still passes; they only ever checked the string.
 * This suite reads each mesh's own `geometry.parameters.innerRadius` / `.outerRadius` and its
 * material's actual `fragmentShader`, so it fails the moment a bound and its geometry disagree,
 * regardless of which of the two was the one that moved.
 */
const COLLAR_CASES: CollarCase[] = [
  {
    name: 'water-reach grip arc',
    arc: () => arcMeshOf(createWaterReach(ORIGIN, NORTH, 'grip', W)),
  },
  {
    name: 'water-reach freeze arc',
    arc: () => arcMeshOf(createWaterReach(ORIGIN, NORTH, 'freeze', W)),
  },
  {
    name: 'earth-reach stone arc',
    arc: () => arcMeshOf(createEarthReach(ORIGIN, NORTH, DEFAULT_COMBAT_CONFIG.earth)),
  },
  {
    name: 'fire-burst arc',
    arc: () => arcMeshOf(createFireBurst(ORIGIN, NORTH, DEFAULT_COMBAT_CONFIG.fire)),
  },
]

function arcMeshOf(effect: ReturnType<typeof createWaterReach>): Mesh {
  const arc = effect.object.children[1]
  if (!(arc instanceof Mesh)) throw new Error('expected the arc as children[1]')
  return arc
}

/**
 * Every `smoothstep(a, b, radius)` pair in a fragment shader source, in the order they appear.
 *
 * Matched against `radius` specifically, not any `smoothstep` call — `ARC_BODY`-shaped bodies
 * also call it against other things (angle-driven drift, for instance), and those have no
 * geometric bound to check against.
 */
function smoothstepRadiusBounds(fragmentShader: string): Array<{ a: number; b: number }> {
  const pattern = /smoothstep\(\s*(-?\d*\.?\d+)\s*,\s*(-?\d*\.?\d+)\s*,\s*radius\s*\)/g
  const bounds: Array<{ a: number; b: number }> = []
  for (const match of fragmentShader.matchAll(pattern)) {
    const [, a, b] = match
    if (a === undefined || b === undefined) continue
    bounds.push({ a: Number(a), b: Number(b) })
  }
  return bounds
}

describe('every collar bound sits inside the geometry it shades', () => {
  for (const { name, arc } of COLLAR_CASES) {
    it(`${name}: every smoothstep(_, _, radius) bound lies strictly inside the band's own radius range`, () => {
      const mesh = arc()
      const { geometry, material } = mesh
      if (!(geometry instanceof RingGeometry)) throw new Error(`${name}: expected a RingGeometry`)
      if (!(material instanceof ShaderMaterial)) throw new Error(`${name}: expected a ShaderMaterial`)

      // The band's own normalised inner edge — derived from the mesh actually built, not from
      // a copy of ARC_THICKNESS (or whatever constant a later task's thickness is named) pasted
      // into this file, which would just be the same drift risk moved one file over.
      const { innerRadius, outerRadius } = geometry.parameters
      const innerNormalised = innerRadius / outerRadius

      const bounds = smoothstepRadiusBounds(material.fragmentShader)
      // A collar with no radius-bound smoothstep at all would vacuously pass every assertion
      // below, which would make this suite worthless for exactly the effect it needs to guard.
      expect(bounds.length).toBeGreaterThan(0)
      for (const { a, b } of bounds) {
        expect(a).toBeGreaterThan(innerNormalised)
        expect(a).toBeLessThanOrEqual(1)
        expect(b).toBeGreaterThan(innerNormalised)
        expect(b).toBeLessThanOrEqual(1)
      }
    })
  }
})
