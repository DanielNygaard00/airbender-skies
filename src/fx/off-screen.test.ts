import { describe, it, expect } from 'vitest'
import { Vector3 } from 'three'
import { horizontalDistance, spawnEnemy, type Enemy, type Stance } from '../combat/enemy'
import { DEFAULT_COMBAT_CONFIG } from '../combat/config'
import { OFF_SCREEN_RAMP, enemyMarker, offScreenPresence } from './off-screen'

/** Inside the visible depth range, so only the x/y position is under test. */
const IN_FRONT = 0.5

describe('offScreenPresence', () => {
  it('is zero for a point at the centre of the frame', () => {
    expect(offScreenPresence({ x: 0, y: 0, z: IN_FRONT })).toBe(0)
  })

  // Exactly on the edge, not approaching it. What these four pin is *where* the edge
  // threshold sits: at |NDC| = 1 and nowhere else, so an implementation that insets it
  // (`Math.abs(ndc.x) - 0.9`, a plausible "add a margin" change) reddens all four, and so
  // does one that widens it. A soldier standing precisely at the frame edge must not have
  // a chevron drawn for it -- it is still visible.
  //
  // What they do **not** catch, despite sitting exactly where one would look for it, is an
  // off-by-one in the guard's own comparison. `if (overshoot <= 0) return 0` mutated to
  // `< 0` produces identical output on all four, because at overshoot exactly 0 the
  // fall-through computes `Math.min(0 / OFF_SCREEN_RAMP, 1)`, which is also 0. That mutant
  // is equivalent by construction and no fixture at any boundary can express it. Deleting
  // the guard entirely is caught -- by the centre test above, not by these.
  //
  // Every fixture in this file is asymmetric: x is never equal to y, and never equal
  // to -y either. That is not to catch an axis swap -- see the note on the swap
  // below, which is provably a no-op -- it is so that a one-axis implementation
  // cannot be masked by the other axis reading the same value.
  it('is zero for a point exactly on each of the four edges', () => {
    expect(offScreenPresence({ x: 1, y: -0.37, z: IN_FRONT })).toBe(0)
    expect(offScreenPresence({ x: -1, y: 0.42, z: IN_FRONT })).toBe(0)
    expect(offScreenPresence({ x: 0.31, y: 1, z: IN_FRONT })).toBe(0)
    expect(offScreenPresence({ x: -0.58, y: -1, z: IN_FRONT })).toBe(0)
  })

  // The four cases together are what pin the shape of the measurement. An
  // implementation that reads only x keeps the top and bottom cases at 0; one that
  // reads only y keeps left and right at 0; one that writes `ndc.x - 1` instead of
  // `Math.abs(ndc.x) - 1` keeps the left and bottom cases at 0. Each of those is a
  // real mutant and each reddens here.
  it('reaches half strength half a ramp past each edge', () => {
    const half = OFF_SCREEN_RAMP / 2
    expect(offScreenPresence({ x: 1 + half, y: 0.2, z: IN_FRONT })).toBeCloseTo(0.5)
    expect(offScreenPresence({ x: -1 - half, y: 0.63, z: IN_FRONT })).toBeCloseTo(0.5)
    expect(offScreenPresence({ x: -0.45, y: 1 + half, z: IN_FRONT })).toBeCloseTo(0.5)
    expect(offScreenPresence({ x: 0.28, y: -1 - half, z: IN_FRONT })).toBeCloseTo(0.5)
  })

  it('reaches full strength exactly one ramp past the edge', () => {
    expect(offScreenPresence({ x: 1 + OFF_SCREEN_RAMP, y: 0.13, z: IN_FRONT })).toBeCloseTo(1)
    expect(offScreenPresence({ x: -0.24, y: -1 - OFF_SCREEN_RAMP, z: IN_FRONT })).toBeCloseTo(1)
  })

  it('clamps at full strength well beyond the ramp', () => {
    // Without the clamp this would be 8, and the view writes it straight into an
    // opacity -- which CSS would clamp for us, so the wrongness would be invisible.
    expect(offScreenPresence({ x: 0.11, y: 1 + OFF_SCREEN_RAMP * 8, z: IN_FRONT })).toBe(1)
  })

  it('takes the larger overshoot when the point is past two edges at once', () => {
    // Off the right by a fifth of a ramp and off the top by three fifths. The larger
    // decides: the further out on any axis, the more definitely gone. Deliberately
    // unequal, so an implementation that took the smaller or averaged the two lands
    // on a different number rather than the same one by coincidence.
    const presence = offScreenPresence({
      x: 1 + OFF_SCREEN_RAMP * 0.2, y: 1 + OFF_SCREEN_RAMP * 0.6, z: IN_FRONT,
    })
    expect(presence).toBeCloseTo(0.6)
  })

  it('is full strength for a point behind the camera, however central its x and y', () => {
    // The case this whole feature exists for: a follow cam's blind spot is the space
    // directly behind the player, and `project` reports it with a mirrored x/y that
    // looks perfectly on-screen. Deciding from x and y alone would draw nothing for
    // the soldier standing right behind the player.
    expect(offScreenPresence({ x: 0.2, y: -0.4, z: 1.7 })).toBe(1)
  })

  it('is full strength for a point in front of the near plane', () => {
    expect(offScreenPresence({ x: -0.15, y: 0.36, z: -1.4 })).toBe(1)
  })

  it('is full strength for a projection with a non-finite component', () => {
    // A 0x0 canvas gives a camera a non-finite aspect, which projects to a NaN x
    // while y and z stay finite. Watched happening in the previous cycle.
    //
    // This is the one input where this module deliberately answers the opposite of
    // `reticleModel`, which reports `visible: false` for it. The reticle needs a
    // screen *position* and has none; a marker needs only a bearing, which comes
    // from world space and is unaffected. Asserted so that "making the two
    // consistent" has to argue with a test.
    expect(offScreenPresence({ x: NaN, y: 0.3, z: IN_FRONT })).toBe(1)
    expect(offScreenPresence({ x: 0.3, y: NaN, z: IN_FRONT })).toBe(1)
    expect(offScreenPresence({ x: 0.3, y: 0.4, z: NaN })).toBe(1)

    // Infinity pins a real input's value rather than covering the finiteness guard:
    // `Math.abs(Infinity) - 1` is `Infinity`, which wins the `Math.max`, and then
    // `Math.min(Infinity / OFF_SCREEN_RAMP, 1)` is 1 regardless of whether
    // `Number.isFinite(ndc.y)` is even checked. Drop that clause from `placeable`
    // entirely and this assertion still passes -- the `y: NaN` case just above is
    // what actually exercises the guard for this component.
    expect(offScreenPresence({ x: 0.3, y: Infinity, z: IN_FRONT })).toBe(1)
  })
})

const SPEAR = DEFAULT_COMBAT_CONFIG.enemies.spear
const ARCHER = DEFAULT_COMBAT_CONFIG.enemies.archer

const PLAYER = new Vector3(0, 0, 0)
/** Well past the frame edge on x, so `offScreenPresence` is 1 and only the other rules vary. */
const OFF_FRAME = { x: 1.6, y: 0.12, z: 0.5 }
/** Comfortably inside the frame. */
const ON_FRAME = { x: 0.2, y: -0.34, z: 0.5 }

/**
 * A spear 20 units away on x — inside its aggroRange of 26 measured either way, so
 * fixtures built on it isolate whatever rule the test is actually about.
 */
function nearSpear(): Enemy {
  return spawnEnemy('spear-1', new Vector3(20, 0, 0), 'spear', SPEAR)
}

/** The same soldier with a stance and a health pool that agree with each other. */
function withStance(enemy: Enemy, stance: Stance): Enemy {
  const down = stance === 'downed' || stance === 'rising'
  return {
    ...enemy,
    stance,
    health: { ...enemy.health, current: down ? 0 : enemy.health.max },
  }
}

describe('enemyMarker', () => {
  it('marks an engaged soldier that is off the frame, passing the bearing through signed', () => {
    // Signed, and asserted at two signs. A marker that returned a magnitude would draw
    // every threat on the same side of the screen, which is worse than drawing none.
    expect(enemyMarker(nearSpear(), PLAYER, OFF_FRAME, 1.234, SPEAR))
      .toEqual({ bearing: 1.234, strength: 1, winding: false })
    expect(enemyMarker(nearSpear(), PLAYER, OFF_FRAME, -0.77, SPEAR))
      .toEqual({ bearing: -0.77, strength: 1, winding: false })
  })

  it('carries the ramp through as the strength rather than a flag', () => {
    const half = { x: 1 + OFF_SCREEN_RAMP / 2, y: -0.19, z: 0.5 }
    expect(enemyMarker(nearSpear(), PLAYER, half, 0, SPEAR)?.strength).toBeCloseTo(0.5)
  })

  it('does not mark a soldier that is on the frame', () => {
    expect(enemyMarker(nearSpear(), PLAYER, ON_FRAME, 0.5, SPEAR)).toBeNull()
  })

  it('does not mark a downed soldier, and does mark a rising one', () => {
    // Both halves matter. A body lying flat is not a threat; a soldier pushing back up
    // is targetable and is about to be one, and `isTargetable`'s second clause is the
    // half a single "downed gives null" test would leave unasserted.
    expect(enemyMarker(withStance(nearSpear(), 'downed'), PLAYER, OFF_FRAME, 0, SPEAR)).toBeNull()
    expect(enemyMarker(withStance(nearSpear(), 'rising'), PLAYER, OFF_FRAME, 0, SPEAR)).not.toBeNull()
  })

  it('measures notice in 3D, but admits a melee soldier on its horizontal reach', () => {
    // The claim the whole range rule rests on, and it has two halves. Notice is measured
    // in 3D, which is deliberately stricter than `stepEnemy`'s horizontal measurement for
    // a spear: a soldier far below a climbing player must not hang a permanent ring of
    // chevrons around someone who has left the fight. But horizontal reach means height
    // is *ignored*, not protective, so a melee soldier directly underfoot is inside its
    // `strikeRange` at any altitude and does hit -- see `enemy.test.ts`'s 'still thrusts
    // at a player almost directly overhead' -- and that case is admitted separately.
    const spear = spawnEnemy('spear-1', new Vector3(0, 0, 0), 'spear', SPEAR)

    // Out of 3D notice range, and out of horizontal strike reach too: nothing. This is
    // the anti-clutter half, and it is what stops the melee clause from admitting the
    // whole patrol.
    const highAbove = new Vector3(10, 30, 0)
    expect(spear.position.distanceTo(highAbove)).toBeGreaterThan(SPEAR.aggroRange)
    expect(enemyMarker(spear, highAbove, OFF_FRAME, 0, SPEAR)).toBeNull()

    // The same soldier, the same drop, but horizontally underfoot: inside `strikeRange`
    // measured horizontally, so this spear can and does damage the hovering player, and
    // the chevron pointing at it is the whole purpose of the feature.
    const directlyAbove = new Vector3(0, 30, 0)
    expect(spear.position.distanceTo(directlyAbove)).toBeGreaterThan(SPEAR.aggroRange)
    expect(horizontalDistance(spear.position, directlyAbove)).toBeLessThan(SPEAR.strikeRange)
    expect(enemyMarker(spear, directlyAbove, OFF_FRAME, 0, SPEAR)).not.toBeNull()

    // The same soldier, level with the player and well beyond its strike reach: marked on
    // the 3D notice clause alone, so the two nulls above cannot be passing for the wrong
    // reason.
    const alongside = new Vector3(20, 0, 0)
    expect(spear.position.distanceTo(alongside)).toBeLessThan(SPEAR.aggroRange)
    expect(horizontalDistance(spear.position, alongside)).toBeGreaterThan(SPEAR.strikeRange)
    expect(enemyMarker(spear, alongside, OFF_FRAME, 0, SPEAR)).not.toBeNull()
  })

  it('does not admit an archer on horizontal reach, only in 3D', () => {
    // The melee clause is gated on `attack.kind`, and this is the fixture that proves it:
    // an archer directly below the player is at horizontal distance 0, inside its
    // `strikeRange` of 30 if anyone measured it that way, and outside its 3D `aggroRange`
    // of 38 at a 45-unit drop. `stepEnemy` measures a projectile attacker's notice *and*
    // commit in 3D, so it cannot shoot this player at all. Drop the `attack.kind` check
    // from `enemyMarker` and this reddens; without it, dropping it passes silently.
    const archer = spawnEnemy('archer-1', new Vector3(0, 0, 0), 'archer', ARCHER)
    const hovering = new Vector3(0, ARCHER.aggroRange + 7, 0)
    expect(archer.position.distanceTo(hovering)).toBeGreaterThan(ARCHER.aggroRange)
    expect(horizontalDistance(archer.position, hovering)).toBeLessThan(ARCHER.strikeRange)
    expect(enemyMarker(archer, hovering, OFF_FRAME, 0, ARCHER)).toBeNull()
  })

  it('admits a melee soldier exactly at its horizontal strike reach, and not past it', () => {
    // The melee clause's own boundary, built from `SPEAR.strikeRange` so retuning the
    // spear moves the test with it. The drop puts the 3D distance outside `aggroRange` in
    // every case, so only the horizontal clause can be deciding. Inclusive at the boundary,
    // matching
    // `stepEnemy`'s own `distance <= c.strikeRange` test for committing to a thrust.
    const spear = spawnEnemy('spear-1', new Vector3(0, 0, 0), 'spear', SPEAR)
    const above = (horizontal: number) => new Vector3(horizontal, SPEAR.aggroRange + 4, 0)
    expect(enemyMarker(spear, above(SPEAR.strikeRange - 0.1), OFF_FRAME, 0, SPEAR)).not.toBeNull()
    expect(enemyMarker(spear, above(SPEAR.strikeRange), OFF_FRAME, 0, SPEAR)).not.toBeNull()
    expect(enemyMarker(spear, above(SPEAR.strikeRange + 0.1), OFF_FRAME, 0, SPEAR)).toBeNull()
  })

  it('marks up to the notice range the config gives, and not past it', () => {
    // Positions built from `aggroRange` rather than written as 37 and 39, so retuning
    // the archer moves the test with it instead of reddening it. The direction is a
    // genuine 3D diagonal of length exactly 7 -- (2, 3, -6) -- so an implementation
    // that measured only one axis, or only the horizontal plane, lands somewhere else.
    const unit = new Vector3(2, 3, -6).divideScalar(7)
    const at = (distance: number) => spawnEnemy(
      'archer-1', unit.clone().multiplyScalar(distance), 'archer', ARCHER,
    )
    expect(enemyMarker(at(ARCHER.aggroRange - 1), PLAYER, OFF_FRAME, 0, ARCHER)).not.toBeNull()
    // Inclusive at the boundary, matching `stepEnemy`'s own `distance > c.aggroRange`
    // test for holding station.
    expect(enemyMarker(at(ARCHER.aggroRange), PLAYER, OFF_FRAME, 0, ARCHER)).not.toBeNull()
    expect(enemyMarker(at(ARCHER.aggroRange + 1), PLAYER, OFF_FRAME, 0, ARCHER)).toBeNull()
  })

  it('warns only in the wind-up, across every stance there is', () => {
    // A Record rather than an array of the five stances that exist today, and that is
    // the point of writing it this way: adding a sixth stance fails to compile until
    // someone decides whether it warns. `WIND_LEGEND` in src/ui/guide/reference.ts uses
    // the same device over `WindKind`, for the same reason.
    //
    // `null` means "no marker at all is expected", which is the honest entry for
    // `downed` -- there is no marker to read a `winding` off.
    const expected: Record<Stance, boolean | null> = {
      advance: false,
      'wind-up': true,
      recover: false,
      rising: false,
      downed: null,
    }
    for (const [stance, warns] of Object.entries(expected) as [Stance, boolean | null][]) {
      const marker = enemyMarker(withStance(nearSpear(), stance), PLAYER, OFF_FRAME, 0, SPEAR)
      if (warns === null) expect(marker, stance).toBeNull()
      else expect(marker?.winding, stance).toBe(warns)
    }
  })
})

describe('the marker rules against the two newest kinds', () => {
  const HEAVY = DEFAULT_COMBAT_CONFIG.enemies.heavy
  const NETS = DEFAULT_COMBAT_CONFIG.enemies.nets

  it('marks every kind in the shipped roster when one is engaged and off the frame', () => {
    // The audit, iterated over the Record rather than written out per kind. `main.ts` builds this
    // ring for every soldier in the fight, so a kind that could never earn a chevron would be a
    // threat the player has no off-screen warning about at all — and a missed branch is the most
    // likely way for a new kind to arrive half-wired.
    for (const [kind, config] of Object.entries(DEFAULT_COMBAT_CONFIG.enemies)) {
      // Just inside the kind's own notice range, whatever that range happens to be.
      const near = spawnEnemy('a', new Vector3(config.aggroRange - 1, 0, 0), kind as never, config)
      expect(enemyMarker(near, PLAYER, OFF_FRAME, 0.5, config), kind)
        .toEqual({ bearing: 0.5, strength: 1, winding: false })
    }
  })

  it('marks a heavy standing underneath a hovering player, because it can still swing at them', () => {
    // The melee clause, and the heavy is the kind that most needs it: it measures `strikeRange`
    // horizontally, so a player hovering directly over one is inside its 3.6 at any altitude and
    // takes 2 damage a swing. Without the clause this overlay would stay silent about the hardest
    // hitter in the game while it connected repeatedly — the exact defect the clause was added for
    // on the spear.
    const under = spawnEnemy('plate', new Vector3(1, -40, 0), 'heavy', HEAVY)
    const hovering = new Vector3(0, 0, 0)
    // Out of range in 3D, so the notice clause cannot be what admits it.
    expect(under.position.distanceTo(hovering)).toBeGreaterThan(HEAVY.aggroRange)
    // In range horizontally, which is what the fight measures for a melee soldier.
    expect(Math.hypot(1, 0)).toBeLessThan(HEAVY.strikeRange)
    expect(enemyMarker(under, hovering, OFF_FRAME, 0.2, HEAVY)).not.toBeNull()
  })

  it('drops a heavy that is out of range on both clauses', () => {
    // The anti-clutter control. Without it the test above passes for a clause that admits every
    // melee soldier on the island.
    const far = spawnEnemy('plate', new Vector3(10, -40, 0), 'heavy', HEAVY)
    expect(enemyMarker(far, PLAYER, OFF_FRAME, 0.2, HEAVY)).toBeNull()
  })

  it('drops a net thrower a hovering player has climbed away from', () => {
    // The other side of the split. A netter is ranged, so both of its clauses are the 3D one and
    // altitude genuinely buys distance from it — which is what makes climbing the answer to a
    // netter, and what makes it wrong to keep drawing a chevron for one after the player has left
    // its reach.
    const below = spawnEnemy('net-1', new Vector3(1, -40, 0), 'nets', NETS)
    const hovering = new Vector3(0, 0, 0)
    expect(below.position.distanceTo(hovering)).toBeGreaterThan(NETS.aggroRange)
    expect(enemyMarker(below, hovering, OFF_FRAME, 0.2, NETS)).toBeNull()
  })

  it('marks the same net thrower once the player comes back within its notice range', () => {
    // The positive control for the drop above: the fixture can earn a marker, and altitude is the
    // only thing that took it away.
    const below = spawnEnemy('net-1', new Vector3(1, -10, 0), 'nets', NETS)
    expect(enemyMarker(below, new Vector3(0, 0, 0), OFF_FRAME, 0.2, NETS)).not.toBeNull()
  })

  it('flares for a netter mid-throw, which is the moment that matters most', () => {
    // Being netted costs the whole air layer, so the wind-up flare is the most valuable one in the
    // ring. It comes free from the shared stance rule, and it is pinned because "comes free" is
    // exactly the reasoning that stops being true after an edit.
    const near = spawnEnemy('net-1', new Vector3(10, 0, 0), 'nets', NETS)
    expect(enemyMarker({ ...near, stance: 'wind-up' }, PLAYER, OFF_FRAME, 0, NETS)?.winding)
      .toBe(true)
    expect(enemyMarker(near, PLAYER, OFF_FRAME, 0, NETS)?.winding).toBe(false)
  })

  it('draws nothing for any kind that is comfortably on screen', () => {
    // The strength rule, across the roster: a soldier the player can see needs no chevron, and
    // this is the assertion that would catch a new kind wired to a strength of 1 unconditionally.
    for (const [kind, config] of Object.entries(DEFAULT_COMBAT_CONFIG.enemies)) {
      const near = spawnEnemy('a', new Vector3(config.aggroRange - 1, 0, 0), kind as never, config)
      expect(enemyMarker(near, PLAYER, ON_FRAME, 0, config), kind).toBeNull()
    }
  })

  it('draws nothing for a downed soldier of any kind', () => {
    // `isTargetable` is the gate, and it is the same predicate the fight's resolvers ask. A chevron
    // pointing at a body would send the player back to a threat that is not there.
    for (const [kind, config] of Object.entries(DEFAULT_COMBAT_CONFIG.enemies)) {
      const near = spawnEnemy('a', new Vector3(config.aggroRange - 1, 0, 0), kind as never, config)
      const flat = { ...near, health: { ...near.health, current: 0 }, stance: 'downed' as const }
      expect(enemyMarker(flat, PLAYER, OFF_FRAME, 0, config), kind).toBeNull()
    }
  })
})
