import { describe, it, expect } from 'vitest'
import {
  Mesh, MeshBasicMaterial, ShaderMaterial, Vector3, type Material,
} from 'three'
import { createEarthReach } from './earth-reach'
import { inStoneThrow, stoneShape } from '../combat/earth'
import { DEFAULT_COMBAT_CONFIG } from '../combat/config'

const R = DEFAULT_COMBAT_CONFIG.earth
const ORIGIN = new Vector3(0, 0, 0)
const NORTH = new Vector3(0, 0, -1)

/** The filled sector, which is the mesh that carries the true reach. */
function fillOf(effect: { object: { children: unknown[] } }): Mesh {
  const fill = effect.object.children[0]
  if (!(fill instanceof Mesh)) throw new Error('expected the fill to be the first child')
  return fill
}

function arcOf(effect: { object: { children: unknown[] } }): Mesh {
  const arc = effect.object.children[1]
  if (!(arc instanceof Mesh)) throw new Error('expected the arc to be the second child')
  return arc
}

const opacityOf = (mesh: Mesh): number => (mesh.material as Material & { opacity: number }).opacity

/** The arc's shader material, built through `createEffectMaterial` for its collar. */
function arcMaterialOf(effect: ReturnType<typeof createEarthReach>): ShaderMaterial {
  const { material } = arcOf(effect)
  if (!(material instanceof ShaderMaterial)) throw new Error('expected the arc to carry a shader material')
  return material
}

describe('createEarthReach', () => {
  it('draws the sector at the volume that actually bites', () => {
    // **The honesty check, and it is the whole point of the file.** The drawn footprint is compared
    // against `inStoneThrow` — the same predicate `stepEncounter` resolves the move with — rather
    // than against the config the effect was built from, so the two cannot agree by both being
    // wrong. It matters more for this move than for any other: the cone is the narrowest in the
    // game, so a drawn shape a few degrees wider than the real one would promise hits at the edges
    // that never land, and the player would read a working move as broken.
    const effect = createEarthReach(ORIGIN, NORTH, R)
    const group = effect.object
    group.updateMatrixWorld(true)
    const shape = stoneShape(R)

    let inside = 0
    let outside = 0
    for (let x = -14; x <= 14; x += 1) {
      for (let z = -14; z <= 14; z += 1) {
        const target = new Vector3(x, 0, z)
        const bites = inStoneThrow(ORIGIN, NORTH, target, R)
        // The same point expressed in the group's local frame, which is what the sector geometry is
        // authored in: local +Z along the heading.
        const local = group.worldToLocal(target.clone())
        const radius = Math.hypot(local.x, local.z)
        const drawn = radius <= shape.range + 1e-6
          && radius > 1e-6
          && Math.atan2(Math.abs(local.x), local.z) <= shape.halfAngle + 1e-6
        expect(drawn, `(${x}, ${z})`).toBe(bites)
        if (bites) inside++
        else outside++
      }
    }
    // Both populations are non-empty, so the sweep is not passing by finding nothing either way.
    expect(inside).toBeGreaterThan(0)
    expect(outside).toBeGreaterThan(0)
  })

  it('draws the cone at the stone\'s own reach, not at a literal', () => {
    // The furthest vertex from the sector's apex, not the geometry's bounding sphere. A bounding
    // sphere is centred on the shape's centroid rather than on the apex, so for a narrow sector it
    // reports roughly half the reach — the mistake `water-reach.test.ts` records measuring, and this
    // cone is narrower still, so it would be wrong by more.
    const position = fillOf(createEarthReach(ORIGIN, NORTH, R)).geometry.getAttribute('position')
    let furthest = 0
    for (let i = 0; i < position.count; i++) {
      furthest = Math.max(furthest, Math.hypot(position.getX(i), position.getY(i)))
    }
    expect(furthest).toBeCloseTo(stoneShape(R).range, 5)
  })

  it('sweeps a narrower wedge than the water reach does', () => {
    // Measured off the drawn geometry rather than read back off the config, so the drawing carries
    // the contrast the player is meant to see: a stone has to be aimed where a grip is pointed.
    // Measured against authored −Y, not +Y: `sectorTheta` centres the span on theta = −π/2 so that
    // the wedge lands on local +Z once `SECTOR_FLAT_ROTATION_X` lays it flat. Measuring against +Y
    // instead reports π for every sector — which is what the first attempt at this did, and it read
    // as a cone spanning the whole circle.
    const widthOf = (mesh: Mesh): number => {
      const position = mesh.geometry.getAttribute('position')
      let widest = 0
      for (let i = 0; i < position.count; i++) {
        const radius = Math.hypot(position.getX(i), position.getY(i))
        if (radius < 1e-6) continue
        widest = Math.max(widest, Math.atan2(Math.abs(position.getX(i)), -position.getY(i)))
      }
      return widest
    }
    expect(widthOf(fillOf(createEarthReach(ORIGIN, NORTH, R))))
      .toBeLessThan(DEFAULT_COMBAT_CONFIG.water.grip.halfAngle)
  })

  it('travels outward rather than inward', () => {
    // The direction of travel is how the elements read apart, and this one shares the gust's
    // direction on purpose — both send something away from the player. Asserted as an increase over
    // a step rather than as "it moves", because "the arc moved" passes for the grip's inward close,
    // which is the one thing this must not look like.
    const effect = createEarthReach(ORIGIN, NORTH, R)
    const arc = arcOf(effect)
    const start = arc.scale.x
    effect.advance(0.1)
    expect(arc.scale.x).toBeGreaterThan(start)
    // And it reaches the true range by the end rather than stopping short, which is the honesty rule
    // applied to the travelling edge as well as to the fill.
    effect.advance(10)
    expect(arc.scale.x).toBeCloseTo(stoneShape(R).range, 4)
  })

  it('starts its arc clear of the thrower rather than at their feet', () => {
    // An arc that began at zero radius would spend its first frames as a bright disc under the
    // player, which reads as something landing on them rather than leaving.
    const arc = arcOf(createEarthReach(ORIGIN, NORTH, R))
    expect(arc.scale.x).toBeGreaterThan(stoneShape(R).range * 0.1)
    expect(arc.scale.x).toBeLessThan(stoneShape(R).range)
  })

  it('never scales the arc to exactly zero', () => {
    // A zero scale collapses the matrix. Walked across the whole lifetime rather than checked at the
    // ends, since the interior is where a lerp would produce one.
    const effect = createEarthReach(ORIGIN, NORTH, R)
    const arc = arcOf(effect)
    for (let i = 0; i < 40; i++) {
      expect(arc.scale.x).toBeGreaterThan(0)
      effect.advance(0.01)
    }
  })

  it('fades out and then finishes, so the pool can dispose it', () => {
    // Both halves. The fade alone would pass for an effect that never returned false, and the
    // `Effect` contract is what the pool relies on to remove and dispose it.
    const effect = createEarthReach(ORIGIN, NORTH, R)
    const fill = fillOf(effect)
    const opening = opacityOf(fill)
    expect(effect.advance(0.1)).toBe(true)
    expect(opacityOf(fill)).toBeLessThan(opening)
    expect(effect.advance(10)).toBe(false)
  })

  it('flattens a climbing heading, so the drawn cone matches the flat one that bites', () => {
    // `inCone` tests a flattened heading, so a cone tilted with a climbing glider would
    // misrepresent the hit volume.
    const climbing = new Vector3(0, 6, -1).normalize()
    const flat = createEarthReach(ORIGIN, NORTH, R)
    const tilted = createEarthReach(ORIGIN, climbing, R)
    expect(tilted.object.quaternion.angleTo(flat.object.quaternion)).toBeCloseTo(0, 6)
  })

  it('survives a purely vertical heading without a NaN quaternion', () => {
    const straightUp = createEarthReach(ORIGIN, new Vector3(0, 1, 0), R)
    for (const component of straightUp.object.quaternion.toArray()) {
      expect(Number.isFinite(component)).toBe(true)
    }
  })

  it('does not mutate the origin it was handed', () => {
    const origin = new Vector3(1, 2, 3)
    createEarthReach(origin, NORTH, R)
    expect(origin.toArray()).toEqual([1, 2, 3])
  })

  it('sits above the player\'s feet, where a flat sector is not buried', () => {
    const effect = createEarthReach(new Vector3(0, 5, 0), NORTH, R)
    expect(effect.object.position.y).toBeGreaterThan(5)
  })

  it('keeps the fill flat-coloured and gives the arc a shader for its collar, never a PointsMaterial', () => {
    // **The structural assertion, and it guards a failure mode that looks like success.** A
    // `ShaderMaterial` including the `..._pars_fragment` chunks the renderer already injects fails
    // to compile almost silently and the mesh then does not draw — which reads as a correctly
    // transparent effect with the world showing through. That trap is no longer avoided by staying
    // off `ShaderMaterial` altogether — the arc's collar needs one — it is handled instead by
    // building through `createEffectMaterial`, which is the one place in `src/fx/` allowed to
    // construct one. And no `PointsMaterial` anywhere, whose screen-facing squares read as blocks
    // at melee range. Asserted the same way `water-reach.test.ts` asserts them.
    const effect = createEarthReach(ORIGIN, NORTH, R)
    expect(effect.object.children.length).toBeGreaterThan(0)
    expect(fillOf(effect).material).toBeInstanceOf(MeshBasicMaterial)
    expect(arcOf(effect).material).toBeInstanceOf(ShaderMaterial)
    for (const child of effect.object.children) {
      expect(child).toBeInstanceOf(Mesh)
      const material = (child as Mesh).material as Material
      expect(material.transparent).toBe(true)
      expect(material.type).not.toBe('PointsMaterial')
    }
  })

  it('excludes itself from the shadow pass, like every other attack tell', () => {
    for (const child of createEarthReach(ORIGIN, NORTH, R).object.children) {
      expect(child.userData.excludeFromShadows).toBe(true)
    }
  })

  it('disposes everything it made', () => {
    // One effect is created per event, so a missed release accumulates. Counted rather than
    // inspected, since three.js gives no public "is disposed" flag.
    const effect = createEarthReach(ORIGIN, NORTH, R)
    let disposals = 0
    for (const child of effect.object.children) {
      const mesh = child as Mesh
      mesh.geometry.dispose = () => { disposals++ }
      ;(mesh.material as Material).dispose = () => { disposals++ }
    }
    effect.dispose()
    expect(disposals).toBe(effect.object.children.length * 2)
  })
})

describe('the stone\'s arc reads as mass', () => {
  it('draws the hardest collar of the five, because earth is the heavy element', () => {
    // §4.2 makes earth "slow, committed, high payoff" and the only armour-breaker. A soft edge
    // would read as air, so earth's core ramps over 3/16 of the band where water's takes 6/16,
    // and its dark band is the thicker of the two: the collar plateau runs right up to the core.
    const material = arcMaterialOf(createEarthReach(ORIGIN, NORTH, R))
    expect(material.fragmentShader).toContain('smoothstep(0.94, 0.97, radius)')
    expect(material.fragmentShader).toContain('smoothstep(0.85, 0.94, radius)')
    expect(material.fragmentShader).toContain('mix(tint * 0.18, tint, core)')
  })

  it('grains along the arc rather than drifting, because rock does not flow', () => {
    const material = arcMaterialOf(createEarthReach(ORIGIN, NORTH, R))
    expect(material.fragmentShader).toContain('vUv.x')
  })

  it('advances time', () => {
    const effect = createEarthReach(ORIGIN, NORTH, R)
    const material = arcMaterialOf(effect)
    const before = material.uniforms.time?.value
    for (let t = 0; t < 0.1; t += 1 / 60) effect.advance(1 / 60)
    expect(material.uniforms.time?.value).not.toBe(before)
  })
})
