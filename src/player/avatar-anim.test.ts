import { describe, it, expect } from 'vitest'
import { Object3D, Vector3 } from 'three'
import { animationFor, chargeSquashScale, wallRideLean } from './avatar-anim'
import type { PlayerState } from '../core/types'
import { DEFAULT_GROUND_CONFIG as G } from '../core/config'

const p = (over: Partial<PlayerState> = {}): PlayerState => ({
  act: 1, mode: 'ground', position: new Vector3(), velocity: new Vector3(),
  forward: new Vector3(0, 0, -1), breath: 100, maxBreath: 100,
  grounded: true, lastGroundIslandId: null, airJumpsUsed: 0, chargeTime: 0, coyoteTime: 0,
  jumpBuffer: 0, scooterActive: false, scooterCharge: 0, dashesUsed: 0, dashRecovery: 0,
  slipstreamElapsed: null, slipstreamCooldown: 0, staffChain: 0, staffElapsed: null,
  staffRecovery: 0, staffSinceSwing: 0, tangled: 0, wallRideNormal: null, ...over,
})

describe('animationFor', () => {
  it('glides whenever the glider is out', () => {
    expect(animationFor(p({ mode: 'glider', grounded: false }))).toBe('glide')
  })

  it('glides even when the glider is barely moving', () => {
    expect(animationFor(p({ mode: 'glider', grounded: false, velocity: new Vector3() })))
      .toBe('glide')
  })

  it('falls when airborne without the glider', () => {
    expect(animationFor(p({ grounded: false }))).toBe('fall')
  })

  it('runs while riding a wall, rather than borrowing the fall pose', () => {
    // A wall ride is airborne by every other measure — `grounded` is false, deliberately,
    // because a wall is not footing — so without this rule it would take `fall`, which is the
    // model's `Jump` clip: limbs out, knees up, exactly what a rider driving up a face is not
    // doing. `run` is the honest pick of the five clips `clip-map.ts` says the model has.
    const state = p({ grounded: false, wallRideNormal: new Vector3(-1, 0, 0) })
    expect(animationFor(state)).toBe('run')
  })

  it('rides at a run even with no horizontal speed left to speak of', () => {
    // The wall check has to come before the speed thresholds as well as before `grounded`: at
    // the top of a ride nearly all the velocity is vertical, and the horizontal that is left
    // would otherwise pick `idle`.
    const state = p({
      grounded: false, velocity: new Vector3(0, 15, 0), wallRideNormal: new Vector3(-1, 0, 0),
    })
    expect(animationFor(state)).toBe('run')
  })

  it('still glides if the glider is somehow out during a ride', () => {
    // Ordering, stated. Nothing can currently reach this state — the deploy clears the normal
    // — but if it ever could, the glider is the stronger claim about what the body is doing.
    const state = p({
      mode: 'glider', grounded: false, wallRideNormal: new Vector3(-1, 0, 0),
    })
    expect(animationFor(state)).toBe('glide')
  })

  it('idles when standing still', () => {
    expect(animationFor(p())).toBe('idle')
  })

  it('walks at a walking pace', () => {
    expect(animationFor(p({ velocity: new Vector3(0, 0, -7) }))).toBe('walk')
  })

  it('runs at a running pace', () => {
    expect(animationFor(p({ velocity: new Vector3(0, 0, -13) }))).toBe('run')
  })

  it('ignores vertical speed when picking a ground clip', () => {
    expect(animationFor(p({ velocity: new Vector3(0, -30, 0) }))).toBe('idle')
  })
})

describe('chargeSquashScale', () => {
  it('stands at full height when not charging', () => {
    expect(chargeSquashScale(p(), G)).toBe(1)
  })

  it('is below the threshold not squashed at all', () => {
    expect(chargeSquashScale(p({ chargeTime: G.chargeThresholdSeconds / 2 }), G)).toBe(1)
  })

  it('squashes to 0.7 at full charge', () => {
    expect(chargeSquashScale(p({ chargeTime: G.chargeMaxSeconds }), G)).toBeCloseTo(0.7, 6)
  })

  it('squashes partially mid-charge', () => {
    const s = chargeSquashScale(p({ chargeTime: G.chargeMaxSeconds / 2 }), G)
    expect(s).toBeLessThan(1)
    expect(s).toBeGreaterThan(0.7)
  })

  it('never squashes in the air', () => {
    expect(chargeSquashScale(p({ grounded: false, chargeTime: 1 }), G)).toBe(1)
  })
})

/**
 * The wall-ride lean.
 *
 * Every claim here is checked through the transform `main.ts` actually applies — an
 * `Object3D`, `lookAt` along the heading, then `rotateZ(lean)` — rather than against the
 * paragraph in `wallRideLean`'s doc comment. That matters because the sign depends on three
 * separate conventions agreeing (which axis `lookAt` aligns, which way `forward × up` points,
 * and which way a positive rotation about +Z carries local up), and a test that restated the
 * arithmetic would be confirming my derivation rather than three.js's behaviour.
 */
describe('wallRideLean', () => {
  /** Where the character's head points in world space once posed and rolled. */
  function headingAfterRoll(forward: Vector3, lean: number): Vector3 {
    const object = new Object3D()
    object.lookAt(forward.x, forward.y, forward.z)
    object.rotateZ(lean)
    return new Vector3(0, 1, 0).applyQuaternion(object.quaternion)
  }

  /** How far the head tipped toward the wall. Positive is toward it. */
  function tipTowardWall(forward: Vector3, normal: Vector3): number {
    const lean = wallRideLean(p({ forward, wallRideNormal: normal }))
    // The wall lies along -normal from the body.
    return headingAfterRoll(forward, lean).dot(normal.clone().negate())
  }

  it('is flat when there is no ride', () => {
    expect(wallRideLean(p())).toBe(0)
  })

  it('tips the head toward a wall on the rider\'s right', () => {
    // Facing +Z, the character's right is `forward × up` = (-1, 0, 0), so a wall on that side
    // has an outward normal of (1, 0, 0).
    expect(tipTowardWall(new Vector3(0, 0, 1), new Vector3(1, 0, 0))).toBeGreaterThan(0.4)
  })

  it('tips the head toward a wall on the rider\'s left', () => {
    // The other sign, and it has to be the other sign rather than merely non-zero: a lean that
    // went the same way on both sides would look like a permanent list.
    expect(tipTowardWall(new Vector3(0, 0, 1), new Vector3(-1, 0, 0))).toBeGreaterThan(0.4)
  })

  it('gives the two sides opposite signs', () => {
    const right = wallRideLean(p({
      forward: new Vector3(0, 0, 1), wallRideNormal: new Vector3(1, 0, 0),
    }))
    const left = wallRideLean(p({
      forward: new Vector3(0, 0, 1), wallRideNormal: new Vector3(-1, 0, 0),
    }))
    expect(right).toBeCloseTo(-left, 9)
    expect(right * left).toBeLessThan(0)
  })

  it('does not roll at all for a wall dead ahead', () => {
    // The square hit — the one that buys the most climb — gets no roll, because the body wants
    // to pitch into that one and a roll would tip it off a face it is driving straight at.
    const lean = wallRideLean(p({
      forward: new Vector3(0, 0, 1), wallRideNormal: new Vector3(0, 0, -1),
    }))
    expect(lean).toBeCloseTo(0, 9)
  })

  it('scales continuously between the two, rather than snapping', () => {
    // A wall 45 degrees off the heading gets sin(45) of the full lean, so sliding around a
    // curved face rolls the body through it instead of popping between poses.
    const forward = new Vector3(0, 0, 1)
    const diagonal = new Vector3(1, 0, -1).normalize()
    const full = Math.abs(wallRideLean(p({ forward, wallRideNormal: new Vector3(1, 0, 0) })))
    const half = Math.abs(wallRideLean(p({ forward, wallRideNormal: diagonal })))
    expect(half).toBeCloseTo(full * Math.SQRT1_2, 6)
    expect(half).toBeGreaterThan(0)
    expect(half).toBeLessThan(full)
  })

  it('leans the same way whichever way the rider is facing', () => {
    // The side is read in the character's own frame, not the world's, so the rule cannot depend
    // on which compass bearing the wall happens to be on.
    for (const angle of [0, 1, 2, 3, 4, 5]) {
      const forward = new Vector3(Math.sin(angle), 0, Math.cos(angle))
      // The character's right, and therefore the outward normal of a wall standing on it.
      const normal = new Vector3(-forward.z, 0, forward.x).negate()
      expect(tipTowardWall(forward, normal), `bearing ${angle}`).toBeGreaterThan(0.4)
    }
  })

  it('stays inside a third of a quarter turn', () => {
    // The cap. A full quarter turn would lay the body flat against the rock, which is what a
    // purpose-made wall-run clip does; this borrows `run`, whose legs drive downward, so laying
    // it flat would put the feet out sideways with nothing under them.
    const forward = new Vector3(0, 0, 1)
    for (const angle of [0, 0.5, 1, 1.5, 2, 2.5, 3]) {
      const normal = new Vector3(Math.cos(angle), 0.2, Math.sin(angle)).normalize()
      expect(Math.abs(wallRideLean(p({ forward, wallRideNormal: normal }))))
        .toBeLessThanOrEqual(Math.PI / 6 + 1e-9)
    }
  })

  it('rolls about the heading and nothing else, so the aim survives the lean', () => {
    // A roll, not a turn. `rotateZ` post-multiplies in the object's own space and local +Z is
    // the heading `lookAt` just set, so the heading has to come through untouched — otherwise a
    // wall ride would quietly re-aim every gust thrown from one.
    const forward = new Vector3(0, 0, 1)
    const lean = wallRideLean(p({ forward, wallRideNormal: new Vector3(1, 0, 0) }))
    const object = new Object3D()
    object.lookAt(forward.x, forward.y, forward.z)
    object.rotateZ(lean)
    const heading = new Vector3(0, 0, 1).applyQuaternion(object.quaternion)
    expect(heading.x).toBeCloseTo(0, 9)
    expect(heading.y).toBeCloseTo(0, 9)
    expect(heading.z).toBeCloseTo(1, 9)
  })
})
