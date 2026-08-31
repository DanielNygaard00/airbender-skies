import { describe, it, expect } from 'vitest'
import {
  BackSide, Mesh, ShaderMaterial, Vector3, type Material,
} from 'three'
import { createIceShell } from './ice-shell'
import { DEFAULT_COMBAT_CONFIG } from '../combat/config'

const W = DEFAULT_COMBAT_CONFIG.water
const AT = new Vector3(3, 0, -4)
const ORIGIN = new Vector3(0, 0, 0)

const meshOf = (effect: { object: unknown }): Mesh => {
  if (!(effect.object instanceof Mesh)) throw new Error('expected the shell to be a Mesh')
  return effect.object
}

/** The shell's shader material, built through `createEffectMaterial` for its facets and rim. */
function shellMaterialOf(effect: ReturnType<typeof createIceShell>): ShaderMaterial {
  const { material } = meshOf(effect)
  if (!(material instanceof ShaderMaterial)) throw new Error('expected the shell to carry a shader material')
  return material
}

// The shell's brightness is driven by the shader's own `alpha` uniform rather than by the
// material's base `opacity`, since a `ShaderMaterial`'s body controls `gl_FragColor.a` directly —
// `material.opacity` is never read by `SHELL_BODY` and would be a silent no-op to write.
const opacityOf = (effect: ReturnType<typeof createIceShell>): number =>
  shellMaterialOf(effect).uniforms.alpha!.value as number

/** Run an effect for `seconds` at 60 Hz, reporting whether it was still alive at the end. */
function run(effect: ReturnType<typeof createIceShell>, seconds: number): boolean {
  let alive = true
  for (let t = 0; t < seconds - 1e-9; t += 1 / 60) alive = effect.advance(1 / 60)
  return alive
}

describe('createIceShell', () => {
  it('lives for the whole hold, and not much longer', () => {
    // **The lifetime is the mechanic.** The shell has to be on screen for exactly the window the
    // soldier cannot act — the rule `guard-shell.ts` follows for the Slipstream's invulnerability,
    // and for the same reason: a tell that outlives its mechanic tells the player a soldier is
    // locked when it is already winding up.
    //
    // Both edges, because either alone is unfalsifiable. "Still alive partway through" passes for
    // an effect that never ends; "finished eventually" passes for one that ends immediately.
    const hold = 2
    expect(run(createIceShell(AT, hold), hold * 0.9)).toBe(true)
    // The only slack is the melt, which is time added *after* the lock rather than taken out of it.
    expect(run(createIceShell(AT, hold), hold + 0.5)).toBe(false)
  })

  it('is still at full strength when the hold ends, and fades only after', () => {
    // What "added after" means, measured. The shell must not be fading while the soldier is still
    // frozen, or the tell would read as the ice breaking early.
    const hold = 2
    const effect = createIceShell(AT, hold)
    run(effect, hold * 0.5)
    const midway = opacityOf(effect)
    const atEnd = createIceShell(AT, hold)
    run(atEnd, hold - 1 / 30)
    expect(opacityOf(atEnd)).toBeCloseTo(midway, 3)
    // And then it does go.
    const after = createIceShell(AT, hold)
    run(after, hold + 0.15)
    expect(opacityOf(after)).toBeLessThan(midway)
  })

  it('forms rather than popping in', () => {
    // Zero opacity on the first frame, rising. A shell that arrived at full strength would flash
    // against the pale terrain, which is the defect the gust cone's own tint comment records.
    const effect = createIceShell(AT, 2)
    expect(opacityOf(effect)).toBe(0)
    effect.advance(1 / 60)
    expect(opacityOf(effect)).toBeGreaterThan(0)
  })

  it('lives longer for a freeze than for a grip, at the shipped durations', () => {
    // The two moves share this effect at their own durations, which is what makes a grip and a
    // freeze read as the same condition held for different lengths of time. Held to the config
    // rather than to literals, so a retune moves the visual with the mechanic.
    const gripAlive = run(createIceShell(AT, W.gripHoldSeconds), W.gripHoldSeconds + 0.5)
    const freezeAlive = run(createIceShell(AT, W.freezeHoldSeconds), W.gripHoldSeconds + 0.5)
    expect(gripAlive).toBe(false)
    expect(freezeAlive).toBe(true)
  })

  it('degrades to a brief flash on a non-positive hold rather than never drawing', () => {
    // A mistuned duration should be visible, not invisible. Zero total life would make the effect
    // finish on its first advance and never appear at all, which reads as the move not coming out.
    const effect = createIceShell(AT, 0)
    expect(effect.advance(1 / 120)).toBe(true)
    expect(run(createIceShell(AT, -5), 1)).toBe(false)
  })

  it('sits on the body rather than at its feet', () => {
    // An enemy's origin is at its feet, so an unoffset shell would be half buried in the ground.
    expect(meshOf(createIceShell(AT, 1)).position.y).toBeGreaterThan(AT.y)
  })

  it('does not write the height offset into the caller\'s position', () => {
    // The trap `createImpact` documents in full: the caller hands over an enemy's live position
    // vector, and writing the height into it would teleport the enemy upward.
    const position = new Vector3(3, 0, -4)
    createIceShell(position, 1)
    expect(position.toArray()).toEqual([3, 0, -4])
  })

  it('never scales to exactly zero', () => {
    // A zero scale collapses the matrix.
    const effect = createIceShell(AT, 1)
    for (let i = 0; i < 80; i++) {
      effect.advance(1 / 60)
      expect(meshOf(effect).scale.x).toBeGreaterThan(0)
    }
  })

  it('is drawn from the inside, so the soldier stays visible', () => {
    // Section 4.6's non-lethality is that the body remains in the world. A shell that hid it would
    // undo that at the one moment the player is looking straight at it. `BackSide` is 1 in three.js.
    const material = meshOf(createIceShell(AT, 1)).material as Material
    expect(material.side).toBe(1)
    expect(material.transparent).toBe(true)
  })

  it('carries a shader material for its facets and rim, built through createEffectMaterial', () => {
    // No longer a `MeshBasicMaterial`: an octahedron has no useful UV, so the faceting and the
    // silhouette rim (`SHELL_BODY`) are real per-fragment math a flat-colour material cannot
    // express. `effect-material.ts` is the only module in `src/fx/` allowed to build the
    // `ShaderMaterial` this now needs, and it is what guards against the `..._pars_fragment`
    // trap — a body duplicating those chunks fails to compile nearly silently, and the mesh
    // simply does not draw, which looks like a correctly transparent shell with the enemy
    // showing through.
    expect(meshOf(createIceShell(AT, 1)).material).toBeInstanceOf(ShaderMaterial)
  })
})

describe('the shell reads as faceted ice', () => {
  it('varies brightness per facet from object space, since an octahedron has no useful uv', () => {
    const material = shellMaterialOf(createIceShell(ORIGIN, 1))
    expect(material.fragmentShader).toContain('vLocal')
    expect(material.fragmentShader).not.toContain('vUv.x')
  })

  it('holds still, because ice does not travel', () => {
    // The vocabulary water-reach.ts documents: no travel means holding. A drifting shell would
    // say the freeze is doing something to the soldier, and it is not — it is keeping it still.
    const material = shellMaterialOf(createIceShell(ORIGIN, 1))
    expect(material.uniforms.time).toBeUndefined()
  })

  it('puts its bright edge on the silhouette, where the surface turns away', () => {
    // The collar's actual claim is internal contrast at the effect's *boundary*. On a closed
    // shell the boundary is wherever the surface goes edge-on to the viewer, which is a
    // view-space fact and not an object-space one — so this reads the view normal, not vLocal.
    const material = shellMaterialOf(createIceShell(ORIGIN, 1))
    expect(material.fragmentShader).toContain('vViewNormal')
    expect(material.fragmentShader).toContain('1.0 - abs(n.z)')
    expect(material.fragmentShader).toContain('mix(tint * 0.18, tint, core)')
  })

  it('keeps the shell BackSide, so it does not double its own density', () => {
    expect(shellMaterialOf(createIceShell(ORIGIN, 1)).side).toBe(BackSide)
  })

  it('stays depth-tested, because its lower half is under the ground', () => {
    expect(shellMaterialOf(createIceShell(ORIGIN, 1)).depthTest).toBe(true)
  })
})
