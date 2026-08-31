import { describe, it, expect } from 'vitest'
import { Mesh, ShaderMaterial, Vector3, type Material } from 'three'
import { createFireThrust, plumeLength } from './fire-thrust'
import { fireThrustImpulse } from '../combat/fire'
import { DEFAULT_COMBAT_CONFIG } from '../combat/config'

const F = DEFAULT_COMBAT_CONFIG.fire
const ORIGIN = new Vector3(0, 0, 0)
const NORTH = new Vector3(0, 0, -1)
/**
 * The impulse the shipped config actually produces, so nothing here invents a vector.
 *
 * Doubles as the brief's `FORWARD`: `createFireThrust` takes an impulse rather than a unit
 * forward, and a zero or non-finite one leaves the group unrotated by design, so this is a real
 * vector the game would actually hand over rather than a placeholder heading.
 */
const IMPULSE = fireThrustImpulse(NORTH, F)

function plumeOf(effect: { object: { children: unknown[] } }): Mesh {
  const plume = effect.object.children[0]
  if (!(plume instanceof Mesh)) throw new Error('expected the plume to be the first child')
  return plume
}

/** The plume's shader material, built through `createEffectMaterial` for its streak and collar. */
function plumeMaterialOf(effect: { object: { children: unknown[] } }): ShaderMaterial {
  const { material } = plumeOf(effect)
  if (!(material instanceof ShaderMaterial)) throw new Error('expected the plume to carry a shader material')
  return material
}

const opacityOf = (mesh: Mesh): number => {
  const { material } = mesh
  if (!(material instanceof ShaderMaterial)) throw new Error('expected a shader material')
  const value = material.uniforms.alpha?.value
  if (typeof value !== 'number') throw new Error('expected a numeric alpha uniform')
  return value
}

describe('createFireThrust', () => {
  it('points the plume against the impulse', () => {
    // **The readability decision, and the one thing this effect must get right.** Fire leaves the wing
    // opposite the acceleration, so a thrust that climbs draws a flame going down and behind — which
    // is also what separates it at a glance from the burst, whose cone goes forward. Asserted by
    // transforming the plume's own local +Z into world space and comparing it against the impulse: a
    // dot of −1 is exactly opposed, and a sign error would give +1 while still looking like a flame.
    const effect = createFireThrust(ORIGIN, IMPULSE)
    effect.object.updateMatrixWorld(true)
    const drawn = new Vector3(0, 0, 1).applyQuaternion(effect.object.quaternion).normalize()
    expect(drawn.dot(IMPULSE.clone().normalize())).toBeCloseTo(-1, 5)
  })

  it('takes its length from the impulse rather than from a constant', () => {
    // So retuning `thrustUpSpeed` or `thrustForwardSpeed` moves the tell with the move. Held to the
    // real config through `fireThrustImpulse` rather than to this file's own formula, which is what
    // makes it a check rather than a restatement.
    const effect = createFireThrust(ORIGIN, IMPULSE)
    expect(plumeOf(effect).scale.z).toBeCloseTo(plumeLength(IMPULSE), 5)
    // Bigger impulse, longer flame, and by the same ratio: this is the property a fixed length would
    // silently lose.
    const doubled = createFireThrust(ORIGIN, IMPULSE.clone().multiplyScalar(2))
    expect(plumeOf(doubled).scale.z).toBeCloseTo(plumeOf(effect).scale.z * 2, 5)
  })

  it('draws a plume on the character\'s scale rather than a beam', () => {
    // The bound that makes the number defensible: at the shipped impulse the flame is a fraction of
    // the 1.8-unit character rather than a searchlight, which is what a plume-seconds figure an order
    // of magnitude larger would produce.
    expect(plumeLength(IMPULSE)).toBeGreaterThan(0.5)
    expect(plumeLength(IMPULSE)).toBeLessThan(1.8)
  })

  it('starts at the wing rather than straddling it', () => {
    // Offset forward by half its own length, the same rule `dash-trail.ts` follows. Without it the
    // plume would begin behind the character and read as fire coming out of the wrong end.
    const effect = createFireThrust(ORIGIN, IMPULSE)
    expect(plumeOf(effect).position.z).toBeCloseTo(plumeOf(effect).scale.z / 2, 5)
  })

  it('stretches and thins as it fades', () => {
    // What an exhaust plume does. All three together, because any one alone would pass for an effect
    // that only did that one thing — and a plume that grew without fading would end its life as the
    // largest, brightest thing on screen.
    const effect = createFireThrust(ORIGIN, IMPULSE)
    const before = {
      length: plumeOf(effect).scale.z,
      width: plumeOf(effect).scale.x,
      opacity: opacityOf(plumeOf(effect)),
    }
    effect.advance(0.07)
    expect(plumeOf(effect).scale.z).toBeGreaterThan(before.length)
    expect(plumeOf(effect).scale.x).toBeLessThan(before.width)
    expect(opacityOf(plumeOf(effect))).toBeLessThan(before.opacity)
  })

  it('never scales any axis to exactly zero, and finishes', () => {
    // A zero scale collapses the matrix. And it has to return false eventually, which is the `Effect`
    // contract the pool relies on to remove and dispose it.
    const effect = createFireThrust(ORIGIN, IMPULSE)
    for (let i = 0; i < 20; i++) {
      effect.advance(0.005)
      const { x, y, z } = plumeOf(effect).scale
      expect(Math.min(x, y, z)).toBeGreaterThan(0)
    }
    expect(effect.advance(10)).toBe(false)
  })

  it('is shorter-lived than the burst\'s cone', () => {
    // One shove, not a sustained burn. Measured as frames survived rather than by importing two
    // constants from two files.
    let frames = 0
    const effect = createFireThrust(ORIGIN, IMPULSE)
    while (effect.advance(1 / 60) && frames < 600) frames++
    expect(frames).toBeGreaterThan(0)
    expect(frames / 60).toBeLessThan(F.burstCooldownSeconds / 4)
  })

  it('survives a zero impulse without a NaN quaternion', () => {
    // Nothing in the game can hand one over — `fireThrustImpulse` always carries `thrustUpSpeed` — but
    // a corrupted matrix stops the mesh drawing silently, where an unrotated plume is a visible wrong
    // answer that says which way to look.
    const effect = createFireThrust(ORIGIN, new Vector3())
    for (const component of effect.object.quaternion.toArray()) {
      expect(Number.isFinite(component)).toBe(true)
    }
    for (const component of plumeOf(effect).scale.toArray()) {
      expect(Number.isFinite(component)).toBe(true)
    }
  })

  it('does not write the height offset into the caller\'s origin or impulse', () => {
    // The trap `createImpact` documents, and the impulse deserves the same guard: `main.ts` adds that
    // very vector to `player.velocity` on the same frame, so a negate-in-place here would reverse the
    // thrust the player just paid for.
    const origin = new Vector3(1, 2, 3)
    const impulse = new Vector3(0, 9, -6)
    createFireThrust(origin, impulse)
    expect(origin.toArray()).toEqual([1, 2, 3])
    expect(impulse.toArray()).toEqual([0, 9, -6])
  })

  it('gives the plume a shader for its streak, built through createEffectMaterial, never a PointsMaterial', () => {
    // The trap that used to keep this file off `ShaderMaterial` — a fragment body that includes
    // the `..._pars_fragment` chunks the renderer already injects fails to compile with
    // redefinition errors that throw nowhere visible, and the mesh then simply does not draw,
    // which reads as a correctly transparent effect — is no longer avoided by staying off
    // `ShaderMaterial` altogether; it is handled instead by building through
    // `createEffectMaterial`, the one place in `src/fx/` allowed to construct one. And no
    // `PointsMaterial` anywhere, whose screen-facing squares are the wrong shape for a plume this
    // close to the camera.
    const effect = createFireThrust(ORIGIN, IMPULSE)
    for (const child of effect.object.children) {
      expect(child).toBeInstanceOf(Mesh)
      const material = (child as Mesh).material as Material
      expect(material).toBeInstanceOf(ShaderMaterial)
      expect(material.type).not.toBe('PointsMaterial')
    }
  })
})

describe('the plume streaks along its own axis', () => {
  it('reads object space, because a box\'s uvs are per face', () => {
    const material = plumeMaterialOf(createFireThrust(ORIGIN, IMPULSE))
    expect(material.fragmentShader).toContain('vLocal.z + 0.5')
    expect(material.fragmentShader).not.toContain('vUv.x')
  })

  it('is brightest at the nozzle and collared away from it', () => {
    const material = plumeMaterialOf(createFireThrust(ORIGIN, IMPULSE))
    expect(material.fragmentShader).toContain('smoothstep(0.45, 0.05, along01)')
    expect(material.fragmentShader).toContain('smoothstep(0.80, 0.45, along01)')
    expect(material.fragmentShader).toContain('mix(tint * 0.18, tint, core)')
  })

  it('advances time', () => {
    const effect = createFireThrust(ORIGIN, IMPULSE)
    const material = plumeMaterialOf(effect)
    const before = material.uniforms.time?.value
    for (let t = 0; t < 0.08; t += 1 / 60) effect.advance(1 / 60)
    expect(material.uniforms.time?.value).not.toBe(before)
  })
})
