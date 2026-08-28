import { describe, it, expect } from 'vitest'
import { Color, Mesh, ShaderMaterial, Vector3 } from 'three'
import { createVortexRing, OPACITY } from './vortex-ring'
import type { Effect } from './effect'

const AT = new Vector3(3, 10, -4)

function mesh(effect: Effect): Mesh {
  if (!(effect.object instanceof Mesh)) throw new Error('expected a mesh')
  return effect.object
}

/** The ring's own shader material. */
function materialOf(effect: Effect): ShaderMaterial {
  const { material } = mesh(effect)
  if (!(material instanceof ShaderMaterial)) throw new Error('expected the ring to carry a shader material')
  return material
}

describe('createVortexRing', () => {
  it('starts at the radius it was given', () => {
    // The honesty rule this repo follows for the gust cone: the drawn size is the
    // size that was actually caught, so a pull outside the ring reads as a bug.
    expect(mesh(createVortexRing(AT, 9)).scale.x).toBeCloseTo(9, 3)
  })

  it('sweeps inward rather than outward', () => {
    // A vortex gathers. An expanding ring would read as a blast.
    const ring = createVortexRing(AT, 9)
    const start = mesh(ring).scale.x
    ring.advance(0.1)
    expect(mesh(ring).scale.x).toBeLessThan(start)
  })

  it('closes to a legible fraction of where it started, not to nothing', () => {
    // What `END_FRACTION` is for: the ring stays readable as it shuts. Asserted as the
    // fraction rather than as "greater than zero", because greater-than-zero cannot fail
    // while `apply`'s `Math.max(..., 1e-4)` floor is in place — the floor makes any scale
    // positive for every input, so that form of the assertion tested nothing about this
    // sweep and would have passed with END_FRACTION set to 0, a ring collapsing to a point.
    const ring = createVortexRing(AT, 9)
    const start = mesh(ring).scale.x
    ring.advance(10)
    const end = mesh(ring).scale.x
    // Bounded on both sides rather than pinned to END_FRACTION's exact value, so a retune
    // stays free while both degenerate ends redden: a collapse to the floor fails the lower
    // bound, and a ring that never really closes fails the upper one.
    expect(end).toBeGreaterThan(start * 0.05)
    expect(end).toBeLessThan(start * 0.5)
  })

  it('keeps a positive scale for a zero radius, which only a caller can hand it', () => {
    // The `Math.max(..., 1e-4)` floor, which the sweep itself never reaches: END_FRACTION
    // 0.15 against the shipped minRadius of 5 bottoms out at 0.75. The floor is a bound on
    // the radius the caller passes in — `vortexRadius` lerps from `minRadius`, so a config
    // with a zero minimum, or a direct call like this one, is what reaches it. A zero scale
    // is a degenerate matrix, which is the thing being prevented.
    const ring = createVortexRing(AT, 0)
    expect(mesh(ring).scale.x).toBeGreaterThan(0)
    ring.advance(10)
    expect(mesh(ring).scale.x).toBeGreaterThan(0)
  })

  it('runs and then finishes', () => {
    const ring = createVortexRing(AT, 9)
    expect(ring.advance(0.01)).toBe(true)
    expect(ring.advance(5)).toBe(false)
  })

  it('casts no shadow', () => {
    expect(mesh(createVortexRing(AT, 9)).userData.excludeFromShadows).toBe(true)
  })

  it('disposes without throwing', () => {
    expect(() => createVortexRing(AT, 9).dispose()).not.toThrow()
  })
})

describe('the ring reads as air pulling in, not just a hoop shrinking', () => {
  it('carries a time uniform, so the streaks move rather than the ring fading as a flat gradient', () => {
    const material = materialOf(createVortexRing(AT, 9))
    expect(material.uniforms.time).toBeDefined()
  })

  it('advances that uniform as the effect advances', () => {
    // A time uniform nothing writes is a still gradient, which is the failure this test exists
    // to catch: it looks like a shader effect and animates nothing.
    const ring = createVortexRing(AT, 9)
    const material = materialOf(ring)
    const before = material.uniforms.time?.value
    for (let t = 0; t < 0.1; t += 1 / 60) ring.advance(1 / 60)
    expect(material.uniforms.time?.value).not.toBe(before)
  })

  it('keeps a bright element above the bloom threshold', () => {
    // post.ts sets luminanceThreshold 0.82, measured on new Color(hex).r/g/b — the linear
    // values bloom actually thresholds against, not hex-divided-by-255.
    const material = materialOf(createVortexRing(AT, 9))
    const tint = material.uniforms.tint?.value
    expect(tint).toBeInstanceOf(Color)
    if (tint instanceof Color) {
      const luminance = 0.2126 * tint.r + 0.7152 * tint.g + 0.0722 * tint.b
      expect(luminance).toBeGreaterThan(0.82)
    }
  })

  it('keeps its peak alpha at the value it shipped with', () => {
    // Task 4's mirrored guard pins a quiet companion element (a separate fill mesh) under 0.5.
    // This ring has no such second element — OPACITY is its only brightness knob, and it was
    // already 0.75 before this task. Gameplay says no opacity constant moves, so this pins the
    // literal shipped value rather than a threshold that was never true for it.
    expect(OPACITY).toBe(0.75)
  })

  it('derives an angle from the recentred UV, rather than treating vUv.x as one', () => {
    // No node test can confirm the streak reads as rotation on screen — only a rendered frame
    // can, and this suite has none. What this pins instead is the derivation: RingGeometry's
    // own UVs are a Cartesian projection (`uv = (position / outerRadius + 1) / 2`), not polar,
    // so a body that scans `vUv.x` directly produces a band sweeping left-to-right across the
    // ring like a shade being drawn, not a rotation — the exact defect this file's own doc
    // comment records an earlier draft shipping. `atan` on a recentred UV is the one
    // construction that wraps continuously around a full turn; this checks for its presence
    // and the absence of a bare `vUv.x` term standing in for it.
    const { fragmentShader } = materialOf(createVortexRing(AT, 9))
    expect(fragmentShader).toContain('atan(')
    expect(fragmentShader).not.toContain('vUv.x')
  })

  it('keeps the streak threshold and the radial lean at their tuned bounds', () => {
    // These bands were the subject of a fix round: the first draft of this shader scanned `vUv.x`
    // and had to be re-derived in polar, and the retune is what that fix bought — so the two
    // `toContain` calls pin the bounds literally. `streak`'s 0.35–1.0 sets how much of each of
    // the three per-turn cycles is lit. `lean`'s 1.05–0.8 runs DOWNWARD on purpose: it is bright
    // at the inner rim, the direction this ring travels, and falls to 0.104 at the outer one.
    // Reversed to `smoothstep(0.8, 1.05, radius)` the ring leans outward instead — a closing ring
    // lit like an expanding one, which is precisely the confusion with `shockwave.ts`'s outward
    // front this file exists to avoid, and which every other test here passes through unnoticed.
    // The third call pins that both factors reach `gl_FragColor`, so computing one and discarding
    // it fails too.
    //
    // Not claimed: this cannot catch a commutative rename, since `(0.35 + 0.65 * streak) * lean`
    // is a product and swapping the two names changes nothing rendered — the same limit
    // `shockwave.test.ts` records for its own front/trail pair. Nor can it say whether the
    // gradient reads as a pull on screen; no node test renders a frame, so that is the bench
    // shot's job.
    const { fragmentShader } = materialOf(createVortexRing(AT, 9))
    expect(fragmentShader).toContain('smoothstep(0.35, 1.0, fract(angle * 3.0 - time * 1.1))')
    expect(fragmentShader).toContain('smoothstep(1.05, 0.8, radius)')
    expect(fragmentShader).toContain('alpha * (0.35 + 0.65 * streak) * lean')
  })

  it('carries no radial factor that is flat across the whole visible annulus', () => {
    // `RingGeometry`'s Cartesian UVs make `radius` the true radius against an outer radius of 1,
    // so with THICKNESS 0.3 the drawn band spans 0.700 to 1.000. An earlier draft multiplied in
    // `smoothstep(0.35, 0.7, radius)`, which is 1.0 at every radius in that span — dead
    // arithmetic that read as an inner feather and invited a later reader to widen it into a real
    // one, softening the leading edge. Pinned by absence, because the value it contributed was
    // exactly 1 and so nothing observable would have flagged its return.
    const { fragmentShader } = materialOf(createVortexRing(AT, 9))
    expect(fragmentShader).not.toContain('smoothstep(0.35, 0.7, radius)')
  })
})
