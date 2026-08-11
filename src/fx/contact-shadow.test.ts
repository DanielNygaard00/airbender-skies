import { describe, it, expect } from 'vitest'
import { Group, Mesh, Object3D, PerspectiveCamera, Points, Vector3 } from 'three'
import {
  CONTACT_BIAS, CONTACT_FADE_END, CONTACT_FADE_START, CONTACT_RANGE, CONTACT_STEPS,
  CONTACT_STRENGTH, CONTACT_THICKNESS, depthTargetSize, excludedFromDepth, sunDirectionInView,
} from './contact-shadow'

/**
 * A camera looking along world +X, which is deliberately **not** three.js's default
 * heading of -Z.
 *
 * This project has shipped a set of eight tests that all shared a camera basis which
 * happened to be the library's default, so an implementation ignoring the camera
 * entirely passed every one of them. A non-default basis is what makes the assertions
 * below able to fail.
 */
function cameraLookingAlongX(): PerspectiveCamera {
  const camera = new PerspectiveCamera(60, 16 / 9, 0.5, 2200)
  camera.position.set(0, 0, 0)
  camera.lookAt(1, 0, 0)
  camera.updateMatrixWorld()
  return camera
}

describe('sunDirectionInView', () => {
  it('maps the camera\'s own heading onto view -Z', () => {
    // A camera looks along its local -Z, so whatever it is pointed at must come back
    // as (0, 0, -1) whichever way that is in the world.
    const result = sunDirectionInView(new Vector3(1, 0, 0), cameraLookingAlongX(), new Vector3())
    expect(result.x).toBeCloseTo(0)
    expect(result.y).toBeCloseTo(0)
    expect(result.z).toBeCloseTo(-1)
  })

  it('maps world up onto view up, and world +Z onto view +X', () => {
    // Signed components, not magnitudes. A sign error here marches the ray away from
    // the light and darkens the lit side of every object in the game, which is the one
    // failure mode that would look deliberate rather than broken.
    const camera = cameraLookingAlongX()
    const up = sunDirectionInView(new Vector3(0, 1, 0), camera, new Vector3())
    expect(up.y).toBeCloseTo(1)

    // For a camera whose forward is world +X and whose up is world +Y, the camera's
    // own right-hand axis is world +Z. So world +Z must arrive as view +X, positive.
    const right = sunDirectionInView(new Vector3(0, 0, 1), camera, new Vector3())
    expect(right.x).toBeCloseTo(1)
    expect(right.z).toBeCloseTo(0)
  })

  it('does not simply hand back the world direction', () => {
    // The mutant this exists for: `return target.copy(worldDirection)`. It passes any
    // test written against a camera at the default heading, and fails here.
    const result = sunDirectionInView(new Vector3(1, 0, 0), cameraLookingAlongX(), new Vector3())
    expect(result.equals(new Vector3(1, 0, 0))).toBe(false)
  })

  it('normalises, so an unnormalised sun direction is still a unit ray', () => {
    const result = sunDirectionInView(new Vector3(3, 0, 0), cameraLookingAlongX(), new Vector3())
    expect(result.length()).toBeCloseTo(1)
  })

  it('writes into the target it is given rather than allocating', () => {
    // Asserted by identity. This runs once per frame for the whole session, and the
    // rest of the presentation layer holds to the same no-allocation habit.
    const target = new Vector3()
    expect(sunDirectionInView(new Vector3(1, 0, 0), cameraLookingAlongX(), target)).toBe(target)
  })
})

describe('depthTargetSize', () => {
  it('matches the canvas exactly at a normal size', () => {
    // Full resolution, deliberately: the fine detail at a contact is the whole point,
    // and any mismatch against the canvas offsets every sample by a fraction of a
    // pixel, which reads as a soft halo along every edge rather than as a bug.
    expect(depthTargetSize(1280, 720)).toEqual({ width: 1280, height: 720 })
  })

  it('floors fractional sizes, which device pixel ratios produce', () => {
    // A render target cannot have a fractional dimension.
    expect(depthTargetSize(800.6, 450.2)).toEqual({ width: 800, height: 450 })
  })

  it('never returns a zero dimension', () => {
    // `resize` runs before layout in some embeddings, and a zero-dimension render
    // target throws in WebGL rather than degrading — so the floor is 1, not 0.
    expect(depthTargetSize(0, 0)).toEqual({ width: 1, height: 1 })
    expect(depthTargetSize(1, 1)).toEqual({ width: 1, height: 1 })
  })
})

describe('excludedFromDepth', () => {
  it('collects a flagged mesh and leaves an unflagged one alone', () => {
    const root = new Object3D()
    const flagged = new Mesh()
    flagged.userData.excludeFromShadows = true
    const plain = new Mesh()
    root.add(flagged, plain)

    expect(excludedFromDepth(root)).toEqual([flagged])
  })

  it('finds a flagged node nested two levels down', () => {
    const root = new Object3D()
    const middle = new Object3D()
    const deep = new Mesh()
    deep.userData.excludeFromShadows = true
    middle.add(deep)
    root.add(middle)

    expect(excludedFromDepth(root)).toEqual([deep])
  })

  it('collects a flagged Group even though a Group is not a mesh', () => {
    // The deliberate divergence from `enableShadows`, which collects meshes only.
    // `src/world/wind-tell.ts` sets the flag on a Group whose child is a Points, and it
    // is the only non-mesh flag site in the codebase. `enableShadows` can ignore both —
    // a Group has no `castShadow` to set and a Points fails its `isMesh` test — but
    // this pass cannot: under `scene.overrideMaterial` those point sprites render with
    // the depth material and write a screenful of near depth. Hiding the flagged
    // ancestor covers the child through visibility inheritance.
    //
    // This assertion is what stops someone narrowing the rule to match
    // `enableShadows` for consistency and silently putting the wind motes back into
    // the depth buffer.
    const root = new Object3D()
    const group = new Group()
    group.userData.excludeFromShadows = true
    group.add(new Points())
    root.add(group)

    expect(excludedFromDepth(root)).toEqual([group])
  })

  it('includes the root itself when the root is flagged', () => {
    const root = new Mesh()
    root.userData.excludeFromShadows = true
    expect(excludedFromDepth(root)).toEqual([root])
  })
})

describe('the tuning constants', () => {
  it('fades out over a positive range', () => {
    // A backwards fade would not fail loudly; it would silently disable the effect at
    // close range, which is exactly where it is supposed to work.
    expect(CONTACT_FADE_START).toBeLessThan(CONTACT_FADE_END)
  })

  it('keeps the bias below the thickness', () => {
    // The two guards bracket a window: below the bias a hit is the surface finding
    // itself, above the thickness it is something far behind. Crossed over, the window
    // is empty and nothing is ever occluded.
    expect(CONTACT_BIAS).toBeLessThan(CONTACT_THICKNESS)
  })

  it('keeps the strength short of black and the range short of an AO radius', () => {
    expect(CONTACT_STRENGTH).toBeGreaterThan(0)
    expect(CONTACT_STRENGTH).toBeLessThan(1)
    // A contact distance, not an occlusion radius: a third of the 1.8-unit character.
    expect(CONTACT_RANGE).toBeLessThan(1)
  })

  it('uses an integer step count, because it becomes a GLSL loop bound', () => {
    // `CONTACT_STEPS` is injected as a `#define` and used as `i <= CONTACT_STEPS`.
    // GLSL ES 1.0 requires a constant loop bound, and a non-integer would emit
    // `#define CONTACT_STEPS 8.5` and fail the shader compile at runtime — where this
    // suite cannot see it.
    expect(Number.isInteger(CONTACT_STEPS)).toBe(true)
    expect(CONTACT_STEPS).toBeGreaterThan(0)
  })
})
