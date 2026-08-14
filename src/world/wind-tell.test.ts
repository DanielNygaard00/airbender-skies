import { describe, it, expect } from 'vitest'
import { Points, PointsMaterial, ShaderLib, Vector3 } from 'three'
import {
  createWindTell, moteCount, POINT_SIZE_ANCHOR, POINT_SIZE_CLAMPED,
} from './wind-tell'
import type { WindDef, WindKind } from './wind'

const def = (kind: WindKind): WindDef => ({
  kind, position: new Vector3(10, 100, -20), radius: 40, height: 200, strength: 10,
  axis: new Vector3(0, 0, 1),
})

const KINDS: WindKind[] = ['thermal', 'ridge', 'river', 'downdraft', 'dead']

function motes(tell: ReturnType<typeof createWindTell>): Float32Array {
  const points = tell.object.children[0]
  if (!(points instanceof Points)) throw new Error('expected a Points cloud')
  return points.geometry.attributes.position!.array as Float32Array
}

describe('moteCount', () => {
  const at = (radius: number, height: number): WindDef => ({ ...def('thermal'), radius, height })

  it('gives the reference feature the count that was tuned by eye', () => {
    // The canyon's dead-air column, which is the one the player stands inside and the one whose
    // density was judged in the running game. Everything else is scaled from it, so if this moves
    // the whole scheme moves with it.
    expect(moteCount(at(22, 34))).toBe(100)
  })

  it('gives a bigger feature more motes, and a smaller one fewer', () => {
    expect(moteCount(at(55, 240))).toBeGreaterThan(moteCount(at(22, 34)))
    expect(moteCount(at(10, 12))).toBeLessThan(moteCount(at(22, 34)))
  })

  it('thins with size rather than holding density, which is the point of the cube root', () => {
    // The claim the exponent exists for. A feature 44 times the volume gets about 3.5 times the
    // motes, not 44 times: enough to read as a body from outside, sparse enough to fly through.
    // Holding density constant instead — a linear scale — would put 4400 motes in the big thermal
    // and make the inside of it opaque.
    const small = at(22, 34)
    const large = at(55, 240)
    const volumeRatio = (55 * 55 * 240) / (22 * 22 * 34)
    const countRatio = moteCount(large) / moteCount(small)
    expect(countRatio).toBeGreaterThan(1)
    expect(countRatio).toBeLessThan(volumeRatio / 10)
    const densityOf = (d: WindDef) => moteCount(d) / (d.radius * d.radius * d.height)
    expect(densityOf(large)).toBeLessThan(densityOf(small))
  })

  it('holds a floor and a ceiling, so no feature vanishes or turns to soup', () => {
    expect(moteCount(at(1, 1))).toBe(60)
    expect(moteCount(at(400, 900))).toBe(600)
  })

  it('survives a degenerate feature rather than asking for a negative buffer', () => {
    // `createWindTell` sizes its typed arrays from this, so a zero or nonsense extent has to come
    // back as a real count. A zero radius is reachable from config, as `vortex-charge.ts` and the
    // scale floors in `src/fx/` both record.
    expect(moteCount(at(0, 34))).toBe(60)
    expect(moteCount(at(22, 0))).toBe(60)
    expect(moteCount(at(Number.NaN, 34))).toBe(60)
  })
})

describe('the near-size clamp', () => {
  const materialOf = (tell: ReturnType<typeof createWindTell>): PointsMaterial => {
    const points = tell.object.children[0]
    if (!(points instanceof Points)) throw new Error('expected a Points cloud')
    const material = points.material
    if (!(material instanceof PointsMaterial)) throw new Error('expected a PointsMaterial')
    return material
  }

  it('still finds the line in three that it rewrites', () => {
    // **The assertion that matters, and the only one here that can catch a three.js upgrade.**
    // The patch is a `String.replace`, and a replace that matches nothing succeeds while doing
    // nothing — so a reworded shader would put the white blocks back with every test still green.
    // Asserted against three's shipped source rather than against our copy of the string.
    expect(ShaderLib.points.vertexShader).toContain(POINT_SIZE_ANCHOR)
  })

  it('floors the distance the size is divided by, rather than capping pixels', () => {
    // A pixel ceiling would mean something different on every display, since `gl_PointSize` is in
    // device pixels; a distance floor is in world units and means the same everywhere.
    expect(POINT_SIZE_CLAMPED).toContain('max( - mvPosition.z,')
    expect(POINT_SIZE_CLAMPED).not.toBe(POINT_SIZE_ANCHOR)
  })

  it('installs the rewrite on the material it builds', () => {
    const material = materialOf(createWindTell(def('dead')))
    expect(material.onBeforeCompile).toBeTypeOf('function')

    // Run three's own vertex shader through the hook the renderer would call, and check the result
    // is the clamped form and no longer the unclamped one.
    const shader = { vertexShader: ShaderLib.points.vertexShader, fragmentShader: '', uniforms: {} }
    material.onBeforeCompile(shader as never, null as never)
    expect(shader.vertexShader).toContain(POINT_SIZE_CLAMPED)
    expect(shader.vertexShader).not.toContain(POINT_SIZE_ANCHOR)
  })

  it('leaves the size attenuation on, because distant motes still have to shrink', () => {
    // The clamp is a floor on the distance, not a switch that turns perspective off: a mote across
    // the canyon must still read as smaller than one an arm's length away.
    expect(materialOf(createWindTell(def('dead'))).sizeAttenuation).toBe(true)
  })
})

describe('createWindTell', () => {
  it('gives every wind kind a visible tell', () => {
    // The doc's rule for artists: a wind feature the player cannot see is a bug.
    for (const kind of KINDS) {
      expect(motes(createWindTell(def(kind))).length).toBeGreaterThan(0)
    }
  })

  it('sits on the feature it describes', () => {
    expect(createWindTell(def('thermal')).object.position.toArray()).toEqual([10, 100, -20])
  })

  it('never casts or catches a shadow', () => {
    // Wind is not a surface. A shadow would make it read as landable geometry.
    expect(createWindTell(def('thermal')).object.userData.excludeFromShadows).toBe(true)
  })

  describe('given an open-air test', () => {
    /**
     * A slot running along world Z through the feature's centre: air within 8 units of x = 10,
     * rock beyond it. Chosen to stand in for Canyon Country's corridor, where the field radius of
     * 40 is deliberately far wider than the gap the player can be in.
     */
    const SLOT_HALF_WIDTH = 8
    const slot = (x: number, _y: number, _z: number): boolean =>
      Math.abs(x - 10) <= SLOT_HALF_WIDTH

    /** Motes as world offsets from the feature centre, which is where the group sits. */
    const offsets = (tell: ReturnType<typeof createWindTell>): [number, number, number][] => {
      const data = motes(tell)
      const out: [number, number, number][] = []
      for (let i = 0; i < data.length; i += 3) out.push([data[i]!, data[i + 1]!, data[i + 2]!])
      return out
    }

    it('keeps the motes in the air instead of scattering them into rock', () => {
      // The defect this exists for: with the field radius of 40 in an 8-unit slot, the unclamped
      // scatter puts most of its motes inside the walls. Stated as a comparison against the
      // unclamped tell rather than as an absolute count, so it is the clamp being measured.
      const loose = offsets(createWindTell(def('ridge'))).filter((m) => Math.abs(m[0]) > SLOT_HALF_WIDTH)
      const hugged = offsets(createWindTell(def('ridge'), slot)).filter(
        (m) => Math.abs(m[0]) > SLOT_HALF_WIDTH,
      )
      expect(loose.length).toBeGreaterThan(50)
      expect(hugged.length).toBeLessThan(loose.length / 4)
    })

    it('still reaches the full length of the slot, and is not pulled toward the axis', () => {
      // Rejection sampling rather than a radial clamp, and this is the difference. Walking each
      // azimuth outward from the centre and stopping at the first rock keeps motes out of the walls
      // and also drags them inward — which is wrong twice over: it cuts a ridge short along the axis
      // its lift runs on, and where the stone is in the *middle* of a feature rather than around it,
      // as under a floating island, it herds the motes straight into it.
      const hugged = offsets(createWindTell(def('ridge'), slot))
      const alongSlot = Math.max(...hugged.map((m) => Math.abs(m[2])))
      expect(alongSlot).toBeGreaterThan(SLOT_HALF_WIDTH * 3)
    })

    it('keeps the whole scatter when the feature has no air in it at all', () => {
      // The fallback: a mote out of attempts stands wherever it last landed, which is exactly where
      // it would have been with no open-air test. So a feature with no air draws as it always did
      // rather than collapsing to a stub or bunching into the rock — both of which were tried and
      // measured worse. A feature with no air is a level-authoring mistake, and the visibility
      // measurement in `canyon-country.test.ts` is what catches it; this is not a signalling device.
      // Stated against the feature's own radius rather than against the unclamped tell's exact
      // draw: the rejection loop consumes a different number of random values, so the two scatters
      // are different samples of the same distribution and their extremes do not match to the digit.
      const radius = def('ridge').radius
      const walled = offsets(createWindTell(def('ridge'), () => false)).map((m) => Math.hypot(m[0], m[2]))
      expect(Math.max(...walled)).toBeGreaterThan(radius * 0.95)
      // And genuinely spread through the volume, not bunched at the rim or in a core: a
      // sqrt-of-uniform radius puts the mean at about two thirds of the way out.
      const mean = walled.reduce((sum, r) => sum + r, 0) / walled.length
      expect(mean).toBeGreaterThan(radius * 0.5)
      expect(mean).toBeLessThan(radius * 0.8)
    })

    it('never lets dead air bob down out of the air it hangs in', () => {
      // Dead air does not wrap — it drifts on a sine — so its floor has to hold against a slow
      // excursion rather than a loop. The bob integrates to well under a unit, so it can only carry
      // a mote out of the air if that mote sits within a unit of the boundary, and the boundary here
      // is placed just under one of the heights the floor scan probes (local -100 + 200/6, which is
      // world 33.33) so that accepted motes land essentially on their own floor. Sited anywhere else
      // the scan's own coarseness leaves the motes metres clear and nothing is being tested.
      const ceilingOfRock = 33.32
      const above = (_x: number, y: number, _z: number): boolean => y > ceilingOfRock
      const tell = createWindTell(def('dead'), above)
      const centreY = def('dead').position.y
      for (let step = 0; step < 3000; step++) {
        tell.advance(1 / 60)
        if (step % 250 !== 0) continue
        for (const [, y] of offsets(tell)) {
          expect(centreY + y, `world height at step ${step}`).toBeGreaterThan(ceilingOfRock)
        }
      }
    })

    it('never turns a thermal mote out of the air and into stone', () => {
      // A thermal is the only kind that moves a mote sideways: it rotates each one as it rises,
      // keeping the radius. So a mote placed in air can orbit into rock, which no amount of care at
      // construction can prevent — the air at the next bearing is a different question from the air
      // at this one. Rock on one side of the feature here, so every mote's orbit crosses the
      // boundary twice per turn and the gate is asked constantly rather than incidentally.
      const rockEastOf = 10
      const westOnly = (x: number, _y: number, _z: number): boolean => x < rockEastOf
      const tell = createWindTell(def('thermal'), westOnly)
      const centre = def('thermal').position
      const inAir = (x: number): boolean => centre.x + x < rockEastOf

      // Stated as "no mote crosses from air into stone" rather than "no mote is ever in stone",
      // because those are different claims and only the first one is this gate's. The feature's
      // centre sits exactly on the boundary here, so half of every position sampled is rock and a
      // handful of motes exhaust their attempts and stand where they landed — the fallback the
      // scatter documents. Those motes start in rock and the gate cannot rescue them; what it must
      // guarantee is that a mote which *was* in air is never turned out of it.
      const startedInAir = offsets(tell).map(([x]) => inAir(x))
      expect(startedInAir.filter(Boolean).length).toBeGreaterThan(startedInAir.length * 0.9)

      for (let step = 0; step < 2400; step++) {
        tell.advance(1 / 60)
        if (step % 200 !== 0) continue
        offsets(tell).forEach(([x], i) => {
          if (!startedInAir[i]) return
          expect(inAir(x), `mote ${i} left the air by step ${step}, at x ${centre.x + x}`).toBe(true)
        })
      }
    })

    it('still spins a thermal that has room to spin, which is the tell', () => {
      // The gate must not have quietly frozen the spiral everywhere. In open air every mote keeps
      // turning, so the cloud's bearings after a few seconds differ from where they started.
      const tell = createWindTell(def('thermal'), () => true)
      const before = offsets(tell).map(([x, , z]) => Math.atan2(z, x))
      for (let step = 0; step < 120; step++) tell.advance(1 / 60)
      const after = offsets(tell).map(([x, , z]) => Math.atan2(z, x))
      const moved = before.filter((angle, i) => Math.abs(angle - after[i]!) > 1e-3).length
      expect(moved).toBeGreaterThan(before.length / 2)
    })

    it('never lets a rising mote wrap back below the air it was lifted into', () => {
      // Dead air's residue, and the reason the floor is a per-mote value the animation respects
      // rather than a clamp applied once. A ridge lifts its motes at 4 units a second and loops them
      // round, so a construction-time clamp would have been undone within a few seconds — the motes
      // would cycle straight back under the floor they had just been lifted off.
      const ceilingOfRock = 30
      const above = (_x: number, y: number, _z: number): boolean => y > ceilingOfRock
      const tell = createWindTell(def('ridge'), above)
      const centreY = def('ridge').position.y
      for (let step = 0; step < 1200; step++) {
        tell.advance(1 / 60)
        if (step % 120 !== 0) continue
        for (const [, y] of offsets(tell)) {
          expect(centreY + y, `world height at step ${step}`).toBeGreaterThan(ceilingOfRock)
        }
      }
    })
  })

  it('keeps its motes inside the feature it marks', () => {
    const tell = createWindTell(def('thermal'))
    for (let i = 0; i < 400; i++) tell.advance(1 / 60)
    const data = motes(tell)
    for (let i = 0; i < data.length; i += 3) {
      expect(Math.abs(data[i + 1]!)).toBeLessThanOrEqual(100.001)
    }
  })

  it('animates thermals upward', () => {
    const tell = createWindTell(def('thermal'))
    const before = motes(tell)[1]!
    tell.advance(0.2)
    expect(motes(tell)[1]!).toBeGreaterThan(before)
  })

  it('animates downdrafts downward', () => {
    const tell = createWindTell(def('downdraft'))
    const before = motes(tell)[1]!
    tell.advance(0.2)
    expect(motes(tell)[1]!).toBeLessThan(before)
  })

  it('barely moves dead air, so it reads as still rather than frozen', () => {
    const dead = createWindTell(def('dead'))
    const thermal = createWindTell(def('thermal'))
    const deadBefore = motes(dead)[1]!
    const thermalBefore = motes(thermal)[1]!
    dead.advance(0.2)
    thermal.advance(0.2)
    const deadMoved = Math.abs(motes(dead)[1]! - deadBefore)
    const thermalMoved = Math.abs(motes(thermal)[1]! - thermalBefore)
    expect(deadMoved).toBeLessThan(thermalMoved)
  })

  it('scatters the same way on every load', () => {
    // Deterministic, like the rest of the world build: Math.random here would make
    // a level look different each time it was opened.
    expect([...motes(createWindTell(def('thermal')))])
      .toEqual([...motes(createWindTell(def('thermal')))])
  })

  it('scatters differently for features in different places', () => {
    const here = createWindTell(def('thermal'))
    const moved = createWindTell({ ...def('thermal'), position: new Vector3(-300, 40, 90) })
    expect([...motes(here)]).not.toEqual([...motes(moved)])
  })
})
