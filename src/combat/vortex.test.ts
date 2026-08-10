import { describe, it, expect } from 'vitest'
import { Vector3 } from 'three'
import { vortexCharge, vortexRadius, vortexTargets, vortexImpulse } from './vortex'
import { spawnEnemy, horizontalDistance } from './enemy'
import { DEFAULT_COMBAT_CONFIG } from './config'
import { gustImpulse } from './gust'
import { boostedCombatConfig } from '../focus/effects'
import { DEFAULT_AVATAR_STATE_CONFIG } from '../focus/config'

const V = DEFAULT_COMBAT_CONFIG.vortex
const E = DEFAULT_COMBAT_CONFIG.enemies.spear
const ORIGIN = new Vector3(0, 0, 0)
const at = (x: number, z: number) => new Vector3(x, 0, z)
const enemyAt = (id: string, x: number, z: number) => spawnEnemy(id, at(x, z), 'spear', E)

describe('vortexCharge', () => {
  it('is 0 at the start and 1 at the cap', () => {
    expect(vortexCharge(0, V)).toBe(0)
    expect(vortexCharge(V.maxChargeSeconds, V)).toBe(1)
  })

  it('clamps past the cap rather than over-charging', () => {
    expect(vortexCharge(V.maxChargeSeconds * 4, V)).toBe(1)
  })
})

describe('vortexRadius', () => {
  it('grows with charge, from the minimum to the maximum', () => {
    expect(vortexRadius(0, V)).toBeCloseTo(V.minRadius, 6)
    expect(vortexRadius(1, V)).toBeCloseTo(V.maxRadius, 6)
    expect(vortexRadius(0.5, V)).toBeGreaterThan(V.minRadius)
  })
})

describe('vortexTargets', () => {
  it('catches an enemy directly behind the caster', () => {
    // Radial with no facing test: a vortex is a place, not a direction. This is the
    // contrast with a gust, which only catches what is in front.
    const behind = enemyAt('behind', 0, V.minRadius - 1)
    const ahead = enemyAt('ahead', 0, -(V.minRadius - 1))
    const caught = vortexTargets(ORIGIN, [behind, ahead], 0, V).map((e) => e.id)
    expect(caught).toContain('behind')
    expect(caught).toContain('ahead')
  })

  it('leaves an enemy outside the radius alone', () => {
    const far = enemyAt('far', V.maxRadius + 2, 0)
    expect(vortexTargets(ORIGIN, [far], 1, V)).toHaveLength(0)
  })

  it('reaches further on a full charge than on none', () => {
    const mid = enemyAt('mid', (V.minRadius + V.maxRadius) / 2, 0)
    expect(vortexTargets(ORIGIN, [mid], 0, V)).toHaveLength(0)
    expect(vortexTargets(ORIGIN, [mid], 1, V)).toHaveLength(1)
  })

  it('gathers within its vertical reach and no further', () => {
    // Well inside the radius in both cases, so only the height band decides. Both heights
    // come off the config, so the pair keeps straddling the boundary if the value moves.
    const raised = (id: string, y: number) =>
      spawnEnemy(id, new Vector3(V.minRadius - 1, y, 0), 'spear', E)
    expect(vortexTargets(ORIGIN, [raised('edge', V.verticalReach)], 0, V).map((e) => e.id))
      .toEqual(['edge'])
    expect(vortexTargets(ORIGIN, [raised('past', V.verticalReach + 0.01)], 0, V))
      .toHaveLength(0)
  })

  it('reaches taller than any other move but stays wider than it is tall', () => {
    // Two claims about the shipped number rather than a restatement of it. Taller than the
    // gust, because lifting enemies off their feet is the payoff and the gust only shoves
    // them. Still under its own full radius, because a vortex is a place — a band past that
    // would make it a column that happens to have a radius.
    expect(V.verticalReach).toBeGreaterThan(DEFAULT_COMBAT_CONFIG.gust.verticalReach)
    expect(V.verticalReach).toBeLessThan(V.maxRadius)
  })

  it('lifts a target clean out of the staff\'s band, which is a real and untested behaviour change', () => {
    // **The one consequence of giving the moves a vertical extent that nothing else in the
    // suite covers, recorded here as arithmetic so it is at least pinned before anyone plays
    // it.** Every enemy in `reach-geometry.test.ts` is snapped to terrain, so the whole
    // real-geometry battery measures grounded targets only — and three of the four moves
    // launch their targets.
    //
    // The vortex is the interesting case, and the *only* interesting case, because it pulls
    // inward while it lifts: the horizontal distance to the caster shrinks, so nothing but
    // the vertical band can put the target out of a follow-up's reach. A gust and a slam push
    // outward, so their targets leave a staff's horizontal range long before height matters.
    //
    // Whether this is correct is a design question rather than a bug report: `docs/HANDOFF.md`
    // already says the vortex's payoff is that an airborne enemy is inert, and that lift is
    // the vortex's job and not the staff's. So a lifted target being briefly unreachable by
    // the staff may be exactly right. It is measured and pinned here rather than judged.
    const gravity = E.gravity
    const staffBand = DEFAULT_COMBAT_CONFIG.staffArc.opener.verticalReach
    const inside = at(V.minRadius - 1, 0)

    // Ballistic apex from the lift the move actually applies, read off `vortexImpulse` rather
    // than restated from the config, so it follows a retune of either number.
    const lift = vortexImpulse(ORIGIN, inside, 1, V).y
    const apex = (lift * lift) / (2 * gravity)
    expect(apex).toBeGreaterThan(3.02)
    expect(apex).toBeLessThan(3.03)
    // Above the staff's band, which is the finding.
    expect(apex).toBeGreaterThan(staffBand)

    // And for how long. Total flight is 1.10 s; the target is above the staff's 2.0 for 0.640 s
    // of it, 58.2% of its airtime.
    const flight = (2 * lift) / gravity
    expect(flight).toBeGreaterThan(1.09)
    expect(flight).toBeLessThan(1.11)
    const aboveBand = (2 * Math.sqrt(lift * lift - 2 * gravity * staffBand)) / gravity
    expect(aboveBand).toBeGreaterThan(0.640)
    expect(aboveBand).toBeLessThan(0.641)
    expect(aboveBand / flight).toBeGreaterThan(0.581)
    expect(aboveBand / flight).toBeLessThan(0.583)

    // The charge at which it starts happening: about 66%, so it is not an edge case reachable
    // only at a perfect full charge.
    let threshold = 1
    for (let t = 0; t <= 1; t += 0.0005) {
      const y = vortexImpulse(ORIGIN, inside, t, V).y
      if ((y * y) / (2 * gravity) > staffBand) { threshold = t; break }
    }
    expect(threshold).toBeGreaterThan(0.656)
    expect(threshold).toBeLessThan(0.659)

    // Inward, which is what makes the vertical band the binding one here. The target does not
    // leave the horizontal footprint, so height is the only thing that can drop it.
    expect(vortexImpulse(ORIGIN, inside, 1, V).x).toBeLessThan(0)
    expect(horizontalDistance(ORIGIN, inside)).toBeLessThan(V.maxRadius)

    // The contrast, so "only the vortex" is measured rather than assumed. A push of
    // `knockback` against `knockbackDamping` travels `knockback / damping` before it stops,
    // which for the gust's 26 is 10 m and for a full slam's 30 is 11.5 m — both well past the
    // furthest the staff reaches, so those two targets leave horizontal range first.
    const staffReach = DEFAULT_COMBAT_CONFIG.staffArc.finisher.range
    expect(DEFAULT_COMBAT_CONFIG.gust.knockback / E.knockbackDamping).toBeGreaterThan(staffReach)
    expect(DEFAULT_COMBAT_CONFIG.pressureWave.maxKnockback / E.knockbackDamping)
      .toBeGreaterThan(staffReach)

    // A plain gust's own lift does stay inside the staff's band — 1.06 m of apex — so it is
    // not a second case. Avatar State's boosted gust is: at the ×1.5 knockback the apex is
    // 2.377 m, past the staff's 2.0, and it is reached by pressing one key rather than by
    // charging. Derived through `boostedCombatConfig` rather than by multiplying by hand, so
    // it tracks whichever field that function decides to scale.
    const plainGust = gustImpulse(ORIGIN, inside, DEFAULT_COMBAT_CONFIG.gust).y
    expect((plainGust * plainGust) / (2 * gravity)).toBeGreaterThan(1.05)
    expect((plainGust * plainGust) / (2 * gravity)).toBeLessThan(1.06)
    expect((plainGust * plainGust) / (2 * gravity)).toBeLessThan(staffBand)
    const boosted = gustImpulse(
      ORIGIN, inside,
      boostedCombatConfig(DEFAULT_COMBAT_CONFIG, true, DEFAULT_AVATAR_STATE_CONFIG).gust,
    ).y
    expect((boosted * boosted) / (2 * gravity)).toBeGreaterThan(2.376)
    expect((boosted * boosted) / (2 * gravity)).toBeLessThan(2.378)
    expect((boosted * boosted) / (2 * gravity)).toBeGreaterThan(staffBand)
  })
})

describe('vortexImpulse', () => {
  it('pulls inward, toward the caster', () => {
    // The sign is the whole move. A gust pushes away; this gathers. Asserting the
    // direction rather than merely that something moved.
    const target = at(6, 0)
    const pull = vortexImpulse(ORIGIN, target, 1, V)
    expect(pull.x).toBeLessThan(0)
    const after = target.clone().addScaledVector(pull, 0.1)
    expect(horizontalDistance(ORIGIN, after)).toBeLessThan(horizontalDistance(ORIGIN, target))
  })

  it('lifts', () => {
    expect(vortexImpulse(ORIGIN, at(6, 0), 1, V).y).toBeGreaterThan(0)
  })

  it('lifts harder on a full charge', () => {
    expect(vortexImpulse(ORIGIN, at(3, 0), 1, V).y)
      .toBeGreaterThan(vortexImpulse(ORIGIN, at(3, 0), 0, V).y)
  })

  it('still lifts an enemy standing exactly on the caster', () => {
    // The inward direction is undefined there; it must not produce NaN.
    const pull = vortexImpulse(ORIGIN, ORIGIN.clone(), 1, V)
    expect(Number.isFinite(pull.x)).toBe(true)
    expect(pull.y).toBeGreaterThan(0)
  })
})
