import { describe, it, expect } from 'vitest'
import { Mesh, ShaderMaterial, Vector3 } from 'three'
import { createImpact, impactShape } from './impact'
import type { Effect } from './effect'

const AT = new Vector3(4, 9, -2)
const ORIGIN = new Vector3(0, 0, 0)

function shell(impact: Effect): Mesh {
  const object = impact.object
  if (!(object instanceof Mesh)) throw new Error('expected a mesh')
  return object
}

/** The burst's shader material, built through `createEffectMaterial` for its rim and shards. */
function burstMaterialOf(impact: Effect): ShaderMaterial {
  const material = shell(impact).material
  if (Array.isArray(material) || !(material instanceof ShaderMaterial)) {
    throw new Error('expected the burst to carry a shader material')
  }
  return material
}

/** Run to completion, returning how many frames it took. */
function framesToFinish(impact: Effect, dt = 1 / 60): number {
  let frames = 0
  while (impact.advance(dt) && frames < 1000) frames += 1
  return frames
}

const finalRadius = (impact: Effect) => {
  impact.advance(10)
  return shell(impact).scale.x
}

describe('createImpact', () => {
  it('lands on the body rather than at its feet', () => {
    expect(shell(createImpact(AT, 'hit')).position.y).toBeGreaterThan(AT.y)
  })

  it('keeps the horizontal position it was given', () => {
    const mesh = shell(createImpact(AT, 'hit'))
    expect(mesh.position.x).toBeCloseTo(AT.x)
    expect(mesh.position.z).toBeCloseTo(AT.z)
  })

  it('does not alias the position it was handed', () => {
    // The caller passes an enemy's live position vector; writing the height offset into
    // it would teleport the enemy upward.
    const at = AT.clone()
    createImpact(at, 'hit')
    expect(at.y).toBeCloseTo(AT.y)
  })

  it('makes a down materially bigger than a hit', () => {
    // A down is the louder statement — it has to be distinguishable at a glance, not
    // just fractionally larger.
    expect(finalRadius(createImpact(AT, 'down')))
      .toBeGreaterThan(finalRadius(createImpact(AT, 'hit')) * 1.5)
  })

  it('makes a down last materially longer than a hit', () => {
    expect(framesToFinish(createImpact(AT, 'down')))
      .toBeGreaterThan(framesToFinish(createImpact(AT, 'hit')) * 1.5)
  })

  it('grows from small to full', () => {
    const impact = createImpact(AT, 'hit')
    const start = shell(impact).scale.x
    impact.advance(0.05)
    const mid = shell(impact).scale.x
    expect(start).toBeLessThan(mid)
  })

  it('fades out', () => {
    // The burst's brightness is driven by the shader's own `alpha` uniform rather than by the
    // material's base `opacity`, since a `ShaderMaterial`'s body controls `gl_FragColor.a`
    // directly — `material.opacity` is never read by `BURST_BODY` and would be a silent no-op
    // to write. `ice-shell.test.ts`'s `opacityOf` makes the same call for the same reason.
    const impact = createImpact(AT, 'hit')
    const material = burstMaterialOf(impact)
    const start = material.uniforms.alpha?.value as number
    expect(start).toBeGreaterThan(0)
    impact.advance(0.12)
    expect(material.uniforms.alpha?.value as number).toBeLessThan(start)
  })

  it('runs and then finishes, for both kinds', () => {
    for (const kind of ['hit', 'down'] as const) {
      const impact = createImpact(AT, kind)
      expect(impact.advance(0.01)).toBe(true)
      expect(impact.advance(5)).toBe(false)
    }
  })

  it('casts no shadow', () => {
    for (const kind of ['hit', 'down'] as const) {
      expect(shell(createImpact(AT, kind)).userData.excludeFromShadows).toBe(true)
    }
  })

  it('disposes without throwing', () => {
    expect(() => createImpact(AT, 'down').dispose()).not.toThrow()
  })
})

describe('the deflect reads as a spark off metal', () => {
  it('breaks its surface into shards where the other two are smooth', () => {
    // impact.ts's own words: the deflect "must not read as a weaker version of a connect".
    // A different size and tint says weaker; a different surface says different material.
    expect(impactShape('deflect').shards).toBeGreaterThan(0)
    expect(impactShape('hit').shards).toBe(0)
    expect(impactShape('down').shards).toBe(0)
  })

  it('wears the hardest rim of the three, because a spark has an edge and a puff does not', () => {
    expect(impactShape('deflect').rim).toBeLessThan(impactShape('hit').rim)
    expect(impactShape('deflect').rim).toBeLessThan(impactShape('down').rim)
  })

  it('shards a whole number of lobes, so the screen-space seam closes', () => {
    // `spokeAngle` is `atan(n.y, n.x)` -- already in radians over its own natural (-pi, pi]
    // domain, not a 0..1 turn fraction the way `POLAR_PREAMBLE`'s `angle` is -- so the seam-free
    // condition is that `shards` itself is a whole number, not the `6.2832 * n` form used
    // elsewhere: multiplying an already-radian coordinate by a further full turn would rescale
    // the frequency rather than fix a seam. `BURST_BODY`'s own doc comment carries the argument
    // in full, including why a reader should not "fix" this into the `6.2832` form on the
    // general instinct that a sin around a loop always needs one.
    expect(Number.isInteger(impactShape('deflect').shards)).toBe(true)
    const material = burstMaterialOf(createImpact(ORIGIN, 'deflect'))
    expect(material.fragmentShader).toContain('atan(n.y, n.x)')
    expect(material.fragmentShader).not.toContain('6.2832')
  })

  it('finds its silhouette from the view, not from object space', () => {
    // A sphere's visible boundary is where it turns edge-on to the camera, which is a fact
    // about the view. ice-shell.ts carries this argument in full.
    const material = burstMaterialOf(createImpact(ORIGIN, 'deflect'))
    expect(material.fragmentShader).toContain('vViewNormal')
  })

  it('keeps every shipped number', () => {
    expect(impactShape('deflect').radius).toBeCloseTo(0.7, 5)
    expect(impactShape('deflect').lifetime).toBeCloseTo(0.12, 5)
    expect(impactShape('deflect').opacity).toBeCloseTo(0.7, 5)
    expect(impactShape('deflect').tint).toBe(0xbcc4d2)
  })

  it('advances time, so the shards are not a still pattern', () => {
    const effect = createImpact(ORIGIN, 'deflect')
    const material = burstMaterialOf(effect)
    const before = material.uniforms.time?.value
    for (let t = 0; t < 0.06; t += 1 / 60) effect.advance(1 / 60)
    expect(material.uniforms.time?.value).not.toBe(before)
  })
})

describe('the gate round: shards cover the surface rather than a sliver of it', () => {
  // The first gate shot showed a nearly featureless disc: `lumps` was folded into `edge`'s own
  // band, which is a sliver at `deflect`'s tight `rim`, so the shard wave had almost no area to
  // modulate. `BURST_BODY`'s own doc comment carries the fix in full; these pin the two
  // expressions that fix depends on so a future edit cannot silently narrow the modulation back
  // down to `edge` or flatten the wave back into a shading wobble.
  it('multiplies the whole alpha shape by the shard wave, not just the rim band', () => {
    const material = burstMaterialOf(createImpact(ORIGIN, 'deflect'))
    expect(material.fragmentShader).toContain('max(edge, fill) * lumps')
  })

  it('gates the wave with mix on a step, not a ternary, at a midpoint threshold', () => {
    const material = burstMaterialOf(createImpact(ORIGIN, 'deflect'))
    expect(material.fragmentShader).toContain('step(0.5, shards)')
    expect(material.fragmentShader).toContain('mix(1.0, shardWave, isShard)')
  })

  it('runs the deep wave from a near-dark trough to full brightness, not a shading wobble', () => {
    const material = burstMaterialOf(createImpact(ORIGIN, 'deflect'))
    expect(material.fragmentShader).toContain('0.20 + 0.80 * wave')
  })

  it('keeps a smooth kind at a constant 1.0 regardless of the wave, since shards is 0', () => {
    // `hit` and `down` must come out exactly as they did before this gate round: `step(0.5, 0)`
    // is 0.0, so `mix(1.0, shardWave, 0.0)` is the constant `1.0` no matter what `shardWave`
    // computes to, including its own `time`-driven term.
    const material = burstMaterialOf(createImpact(ORIGIN, 'hit'))
    expect(material.fragmentShader).toContain('mix(1.0, shardWave, isShard)')
    expect(impactShape('hit').shards).toBe(0)
  })
})

describe('the second gate round: the burst carries the collar\'s own darkening', () => {
  // The first two gate rounds only ever varied brightness (`alpha`, via `lumps`/`fill`/`edge`),
  // never colour, so a kind whose `tint` sits close in luminance to what is behind it -- the
  // deflect's cold grey against pale grass -- had no darker value anywhere to separate it from
  // its background. `BURST_BODY`'s own doc comment carries the argument in full: `colour`
  // now darkens toward `tint * dark` as `edge` (playing the collar's `core` role here) falls
  // from the silhouette toward face-on, the same mechanism every arc body that survived B2's
  // gate already uses.
  it('darkens the colour toward tint * dark as edge falls, the same shape the collar uses', () => {
    const material = burstMaterialOf(createImpact(ORIGIN, 'deflect'))
    expect(material.fragmentShader).toContain('mix(tint * dark, tint, edge)')
  })

  it('wires dark as its own uniform, read from the shape rather than hardcoded', () => {
    const material = burstMaterialOf(createImpact(ORIGIN, 'deflect'))
    expect(material.uniforms.dark?.value).toBeCloseTo(impactShape('deflect').dark, 5)
  })

  const worstChannel = (tint: number): number => Math.min(
    (tint >> 16) & 0xff,
    (tint >> 8) & 0xff,
    tint & 0xff,
  )

  it('darkens deflect to near-black, arguing a hard spark rather than copying a constant', () => {
    // `0xbcc4d2`'s own darkest channel is 188 (of 255); at `dark: 0.18` -- the fraction every
    // collar-bearing arc body already shares -- that lands under 34, comfortably "nearly black".
    expect(worstChannel(impactShape('deflect').tint) * impactShape('deflect').dark).toBeLessThan(40)
  })

  it('keeps hit and down\'s holding puff pale rather than over-darkening an undesigned shape', () => {
    // The same 0.18 fraction on either of these tints would also land under 40 (checked in
    // BURST_BODY's own doc comment) -- both would go nearly black, which is not the light-touch
    // contrast a holding value should carry. `dark: 0.6` keeps their darkest channel above 100.
    expect(worstChannel(impactShape('hit').tint) * impactShape('hit').dark).toBeGreaterThan(100)
    expect(worstChannel(impactShape('down').tint) * impactShape('down').dark).toBeGreaterThan(100)
  })

  it('gives deflect a harder (darker) core than hit or down, matching its harder rim', () => {
    expect(impactShape('deflect').dark).toBeLessThan(impactShape('hit').dark)
    expect(impactShape('deflect').dark).toBeLessThan(impactShape('down').dark)
  })

  it('keeps every shipped number, including through the second gate round', () => {
    expect(impactShape('deflect').radius).toBeCloseTo(0.7, 5)
    expect(impactShape('deflect').lifetime).toBeCloseTo(0.12, 5)
    expect(impactShape('deflect').opacity).toBeCloseTo(0.7, 5)
    expect(impactShape('deflect').tint).toBe(0xbcc4d2)
  })
})
