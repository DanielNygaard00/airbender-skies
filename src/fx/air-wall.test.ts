import { describe, it, expect } from 'vitest'
import { BufferAttribute, Color, Mesh, ShaderMaterial, Vector3 } from 'three'
import { createAirWallPanel, FRAGMENT_BODY } from './air-wall'
import { effectFragmentSource, type EffectUniforms } from './effect-material'
import { airWallNormal, inAirWall } from '../combat/air-wall'
import { DEFAULT_COMBAT_CONFIG } from '../combat/config'

const C = DEFAULT_COMBAT_CONFIG.airWall
/** Off the origin in all three axes, so a forgotten translation shows up. */
const AT = new Vector3(3, 12, -7)
const DT = 1 / 60

/** A freshly built wall, not yet raised. */
function aWall(): ReturnType<typeof createAirWallPanel> {
  return createAirWallPanel()
}

/** The panel mesh. children[0] by construction. */
function panelOf(fx: { object: { children: unknown[] } }): Mesh {
  const first = fx.object.children[0]
  if (!(first instanceof Mesh)) throw new Error('expected the panel mesh as children[0]')
  return first
}

/** The panel's material, typed for shader-source assertions. */
function panelMaterialOf(fx: { object: { children: unknown[] } }): ShaderMaterial {
  const material = panelOf(fx).material
  if (Array.isArray(material) || !(material instanceof ShaderMaterial)) {
    throw new Error('expected a shader material')
  }
  return material
}

/** A panel raised at `AT`, aimed along `aim`, with the fade run to full. */
function raised(aim: Vector3) {
  const fx = createAirWallPanel()
  // Several frames, so the fade-in has finished and the panel is at full opacity rather than
  // partway up it.
  for (let i = 0; i < 20; i++) fx.update(DT, true, AT, aim, C)
  fx.object.updateWorldMatrix(true, true)
  return fx
}

/** Every vertex of the drawn shell, in world space. */
function worldVertices(mesh: Mesh): Vector3[] {
  const attribute = mesh.geometry.getAttribute('position')
  if (!(attribute instanceof BufferAttribute)) throw new Error('expected a position attribute')
  const out: Vector3[] = []
  for (let i = 0; i < attribute.count; i++) {
    out.push(new Vector3().fromBufferAttribute(attribute, i).applyMatrix4(mesh.matrixWorld))
  }
  return out
}

describe('the drawn barrier agrees with the volume that deflects', () => {
  /**
   * The containment check, and the only thing that pins the theta convention.
   *
   * `CylinderGeometry` places its vertices at `x = r·sin(theta)`, `z = r·cos(theta)`, so theta 0
   * is already local +Z and the span is centred on zero — where every flat sector in the game
   * carries a `-PI/2` because `RingGeometry` is authored in XY and measures theta from +X. If
   * that reasoning were wrong the whole panel would be a quarter turn out of the wedge, which
   * still looks exactly like a barrier, and this test is what would say so.
   *
   * The comparison is made against a wedge fattened by a thousandth on all three extents,
   * because the shell is drawn exactly *on* all three boundaries: its radius is `range`, its
   * rim is `verticalReach` above and below, and its two side edges are at precisely
   * ±`halfAngle`, where `inCone`'s `>=` against `cos(halfAngle)` comes down to the last bit of a
   * float — measured, two of the seam's vertices fall the wrong side of it. A thousandth of
   * slack removes that and leaves every error this test exists for intact: a quarter-turn
   * rotation, a doubled height, or a panel drawn at the wrong radius are all off by far more.
   */
  const GENEROUS = {
    ...C,
    range: C.range * 1.001,
    halfAngle: C.halfAngle * 1.001,
    verticalReach: C.verticalReach * 1.001,
  }

  function disagreements(aim: Vector3): string[] {
    const fx = raised(aim)
    const bad: string[] = []
    for (const vertex of worldVertices(panelOf(fx))) {
      if (!inAirWall(AT, aim, vertex, GENEROUS)) {
        bad.push(`${vertex.x}, ${vertex.y}, ${vertex.z}`)
      }
    }
    fx.dispose()
    return bad
  }

  it('draws nothing outside the wedge, for any heading', () => {
    // A handful of headings including the axes, so a convention that happened to be right for
    // one of them does not pass. Flat aims only: the wedge is flattened, so a pitched aim tilts
    // the panel out of the band on purpose, which the next test is about.
    for (const aim of [
      new Vector3(0, 0, -1), new Vector3(0, 0, 1), new Vector3(1, 0, 0), new Vector3(-1, 0, 0),
      new Vector3(0.6, 0, -0.8), new Vector3(-0.3, 0, 0.95),
    ]) {
      expect(disagreements(aim.normalize()), `heading ${aim.x}, ${aim.z}`).toEqual([])
    }
  })

  it('would disagree if the sector were rotated', () => {
    // The vacuity guard. The check above is only worth anything if a wrong orientation fails
    // it, so here the panel is drawn for one heading and asked about a wedge a quarter turn
    // away — which is precisely the bug a `RingGeometry`-style theta offset would introduce.
    const fx = raised(new Vector3(0, 0, -1))
    const wrong = new Vector3(1, 0, 0)
    const missed = worldVertices(panelOf(fx)).filter((v) => !inAirWall(AT, wrong, v, C))
    expect(missed.length).toBeGreaterThan(0)
    fx.dispose()
  })
})

describe('the panel states the true reach', () => {
  it('stands at the wedge\'s outer radius', () => {
    const fx = raised(new Vector3(0, 0, -1))
    const radii = worldVertices(panelOf(fx))
      .map((v) => Math.hypot(v.x - AT.x, v.z - AT.z))
    // Every vertex on the shell, and the shell on the boundary: a panel drawn short would
    // teach a closer barrier than the one that bites.
    for (const r of radii) expect(r).toBeCloseTo(C.range, 4)
    fx.dispose()
  })

  it('spans the whole vertical band, centred on the player\'s footing', () => {
    const fx = raised(new Vector3(0, 0, -1))
    const ys = worldVertices(panelOf(fx)).map((v) => v.y)
    expect(Math.max(...ys)).toBeCloseTo(AT.y + C.verticalReach, 4)
    expect(Math.min(...ys)).toBeCloseTo(AT.y - C.verticalReach, 4)
    fx.dispose()
  })
})

describe('the tilt is the aim', () => {
  it('faces exactly along the wall normal the deflection uses', () => {
    // The one assertion that catches the pitch sign being flipped, which is the mistake the
    // rotation in `air-wall.ts` is most likely to carry: a mirrored tilt still looks like a
    // tilt, and it would send every arrow the wrong side of level.
    for (const aim of [
      new Vector3(0, 3, -4), new Vector3(0, -3, -4), new Vector3(2, 5, 3), new Vector3(0, 0, -1),
    ]) {
      const fx = raised(aim)
      const drawn = panelOf(fx).getWorldDirection(new Vector3())
      const normal = airWallNormal(aim)!
      expect(drawn.x, `aim ${aim.x},${aim.y},${aim.z}`).toBeCloseTo(normal.x, 5)
      expect(drawn.y, `aim ${aim.x},${aim.y},${aim.z}`).toBeCloseTo(normal.y, 5)
      expect(drawn.z, `aim ${aim.x},${aim.y},${aim.z}`).toBeCloseTo(normal.z, 5)
      fx.dispose()
    }
  })
})

describe('the panel tracks the wall and not the key', () => {
  it('is hidden before a wall goes up', () => {
    const fx = createAirWallPanel()
    expect(fx.object.visible).toBe(false)
    fx.dispose()
  })

  it('is showing while the wall stands', () => {
    const fx = raised(new Vector3(0, 0, -1))
    expect(fx.object.visible).toBe(true)
    fx.dispose()
  })

  it('is gone shortly after the wall drops, and does not linger', () => {
    // The guard-shell rule: a barrier still drawn after it stopped deflecting tells the player
    // they are covered when they are not, which is worse than no tell. The bound is the wall's
    // own lifetime, so the fade cannot be a meaningful fraction of the protection.
    const fx = raised(new Vector3(0, 0, -1))
    let held = 0
    for (let t = 0; t < C.maxSeconds && fx.object.visible; t += DT) {
      fx.update(DT, false, AT, new Vector3(0, 0, -1), C)
      held = t
    }
    expect(fx.object.visible).toBe(false)
    expect(held).toBeLessThan(C.maxSeconds / 4)
    fx.dispose()
  })

  it('fades in rather than snapping to full', () => {
    // And the control beside it: one frame in it is dim, twenty frames in it is not. A tell
    // that snapped would read as a flash rather than as air gathering.
    const fx = createAirWallPanel()
    fx.update(DT, true, AT, new Vector3(0, 0, -1), C)
    const first = fx.object.visible
    const opacity = () => {
      const material = panelOf(fx).material
      if (Array.isArray(material) || !(material instanceof ShaderMaterial)) {
        throw new Error('expected a shader material')
      }
      return material.uniforms.alpha!.value as number
    }
    const early = opacity()
    for (let i = 0; i < 20; i++) fx.update(DT, true, AT, new Vector3(0, 0, -1), C)
    expect(first).toBe(true)
    expect(early).toBeGreaterThan(0)
    expect(early).toBeLessThan(opacity())
    fx.dispose()
  })
})

describe('the shader avoids the chunk trap', () => {
  it('includes the two output chunks and neither of their pars declarations', () => {
    // The trap is silent: a `ShaderMaterial` that also includes `tonemapping_pars_fragment` or
    // `colorspace_pars_fragment` fails to compile with redefinition errors, and the only symptom
    // is a mesh that never draws. Nothing in a node test environment compiles GLSL, so the
    // source is inspected instead — a weak check that nonetheless catches the exact edit that
    // has cost this codebase a sky once already.
    const fx = createAirWallPanel()
    const material = panelOf(fx).material
    if (Array.isArray(material) || !('fragmentShader' in material)) {
      throw new Error('expected a shader material')
    }
    const source = material.fragmentShader
    expect(source).toContain('<tonemapping_fragment>')
    expect(source).toContain('<colorspace_fragment>')
    expect(source).not.toContain('_pars_fragment')
    fx.dispose()
  })
})

describe('the panel material', () => {
  it('is built through the shared builder, so the include trap cannot reach it', () => {
    // Asserted against the builder's own output rather than against substrings a hand-rolled
    // `ShaderMaterial` could coincidentally also contain (the pre-migration shader did): the
    // fragment source must be byte-identical to what `effectFragmentSource` produces for this
    // body and uniform set, which only a material actually built through the shared builder can
    // be.
    const fx = aWall()
    const material = panelMaterialOf(fx)
    const uniforms: EffectUniforms = {
      tint: material.uniforms.tint!.value as Color,
      alpha: material.uniforms.alpha!.value as number,
      time: material.uniforms.time!.value as number,
    }
    expect(material.fragmentShader).toBe(effectFragmentSource(FRAGMENT_BODY, uniforms))
    fx.dispose()
  })

  it('keeps the drifting streak that makes the panel read as air rather than glass', () => {
    // air-wall.ts's own comment: "a still panel of even alpha reads as glass, which is the wrong
    // material for a move whose whole fiction is that it is a cushion of wind."
    const fx = aWall()
    const material = panelMaterialOf(fx)
    expect(material.fragmentShader).toContain('streak')
    expect(material.uniforms.time).toBeDefined()
    fx.dispose()
  })
})
