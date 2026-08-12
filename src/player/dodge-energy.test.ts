import { describe, it, expect } from 'vitest'
import { Mesh, Vector3 } from 'three'
import { ARCHIPELAGO } from '../world/levels/archipelago'
import { createIslandGeometry } from '../world/island'
import { createTerrainQuery, type IslandMesh } from '../world/terrain-query'
import {
  DEFAULT_COLLISION_CONFIG, DEFAULT_FLIGHT_CONFIG, DEFAULT_GROUND_CONFIG,
  DEFAULT_SLIPSTREAM_CONFIG, DEFAULT_STAFF_CONFIG,
} from '../core/config'
import { controllerStep, type ControllerDeps } from './controller'
import type { InputState, PlayerState } from '../core/types'

/**
 * The Slipstream is not a way to fly.
 *
 * It used to be the cheapest one. Pressing it on cooldown for forty seconds from y 300
 * climbed to y 434 and reached 76.9 m/s with the breath bar still full, where a plain
 * glide over the same span sank to y 151 and 23.1 m/s. The glide loses half its energy,
 * which is what gliding is; chain-dodging gained 81 percent of it, because the impulse is
 * added in `controllerStep` after `flightStep` has run and so escapes the
 * never-gains-height invariant the integrator is careful to keep. (That "81 percent"
 * figure uses `totalEnergy`, which is valid there because the flight in that run never
 * crosses y 0. It is not used below, for a reason explained there.)
 *
 * After the fix (breath cost 28, perpendicular glider dodge with the handedness corrected
 * so `strafe` dodges the same world side on foot and in the glider, bank threaded through
 * to `gliderRight` so a banked dodge is not flattened): with no strafe held -- the default
 * side, the common case -- the same forty seconds of chain-dodging drifts off its straight
 * line, kicking sideways to the same default side every time rather than forward, and
 * never lands within the forty seconds at all. It free-falls into open water, ending at
 * y -524.4, 24.9 m/s, breath drained to 19.8, 20 dodges. A plain glide over the same span
 * ends at y 150.9, 23.1 m/s. Chain-dodging is not just no-longer-free, it ends up lower and
 * barely different in speed. (`totalEnergy` is not used for this comparison: the run's
 * position goes well below y 0, and `totalEnergy = gravity * y + 0.5 * v^2` goes negative
 * there too, so a ratio against the start would cross zero and "less than 1" would pass for
 * having crossed zero, not for having lost energy in any meaningful sense. Altitude and
 * speed, measured directly, do not have that problem.)
 *
 * The measurement is bounded to glider posture -- `fly`'s loop checks `mode === 'glider'`
 * before each step and stops as soon as that's false, which means a run that lands
 * reports the landing frame's own result (already snapped to the ground by that step),
 * not the last airborne frame before it -- because an earlier version of this test ran
 * the full forty seconds regardless, and the chain-dodge run of that version landed at
 * 19.43s and spent the remaining ~20.6s sliding around on the ground, occasionally
 * ground-dodging (11 glider dodges, 14 ground ones, of 25 total). That compared a landed
 * player's y and speed against a still-gliding control, and let "the test must actually
 * be dodging" pass on ground dodges alone. With the handedness fix, this particular run's
 * default-side dodge points the other way and no longer intersects that island at all, so
 * it never lands within the forty seconds either way here, which is also why the
 * landing-frame distinction above doesn't currently affect either run's figures -- but
 * the bound stays, because which way a future retune happens to send it is exactly the
 * kind of thing that shouldn't be able to silently change what this measures again.
 *
 * Both fixes in this cycle are jointly load-bearing here, and neutralising either one
 * alone does not reproduce the original bug -- this is worth recording because it is not
 * cheap to re-derive:
 *
 * - Setting `breathCost` to 0 alone (the direction fix from the other task still in
 *   place) reddens the breath-bar assertion and the speed assertion, but not the altitude
 *   one. The direction fix by itself already prevents a straight-line climb: an unlimited
 *   dodge chain still never gets near y 434 -- it drifts off the archipelago and
 *   free-falls into open water, ending at y -482.4, still comfortably below "no higher
 *   than a plain glide plus slack". But falling that far for that long picks up real
 *   speed: 40.0 m/s at the end, which *does* clear "not much faster than a plain glide",
 *   so this neutralisation is still caught, just by a different one of the four assertions
 *   than the altitude-only version of this test would have used. Breath staying at a full
 *   100 is the one figure that matches the original description; y and the mechanism
 *   producing the speed do not -- one is a climb, the other a fall.
 * - Reverting the direction fix alone (bank fixed at 0 again, `dodgeHeading`'s glider
 *   branch falling back to the flattened heading; `breathCost` still 28) was not
 *   separately re-measured for this file, since Task 2's own tests already pin that
 *   change in isolation.
 * - Reverting *both* fixes together (checked as a diagnostic while developing this test,
 *   not a committed state) reproduces the original measurement almost exactly: y 434.4,
 *   76.9 m/s, a full 100 breath. That is what pins both fixes as correctly implemented,
 *   even though neither one alone, measured against this exact scenario, looks like the
 *   bug report -- each closes the hole through a different mechanism, and either is
 *   sufficient on its own against this particular 40-second, no-strafe input pattern.
 *
 * Run against the real archipelago rather than a fake, so nothing about the terrain query
 * or the collision resolution can quietly change what this measures.
 */
function deps(): ControllerDeps {
  const islands: IslandMesh[] = ARCHIPELAGO.islands.map((def) => {
    const mesh = new Mesh(createIslandGeometry(def))
    mesh.position.copy(def.position)
    return { id: def.id, mesh }
  })
  const terrain = createTerrainQuery(islands)
  return {
    terrain,
    flight: DEFAULT_FLIGHT_CONFIG,
    ground: DEFAULT_GROUND_CONFIG,
    worldFloorY: ARCHIPELAGO.worldFloorY,
    spawnPointFor: () => new Vector3(0, 40, 0),
    slipstream: DEFAULT_SLIPSTREAM_CONFIG,
    staff: DEFAULT_STAFF_CONFIG,
    collision: DEFAULT_COLLISION_CONFIG,
  }
}

function input(over: Partial<InputState> = {}): InputState {
  return {
    lookDirection: new Vector3(0, 0, -1),
    forward: 0, strafe: 0, sprint: false, tuck: false,
    actionPressed: false, actionHeld: false, actionReleased: false,
    scooterPressed: false, dashPressed: false, gustPressed: false,
    avatarStatePressed: false, vortexHeld: false, vortexReleased: false,
    slipstreamPressed: false, staffPressed: false,
  // The element radial's four fields. Air is the resting selection, the radial is closed,
  // and no pointer movement: none of this reaches movement code, which is the point —
  // `stepElements` is the only consumer, and it is not on the movement path.
  radialHeld: false, radialReleased: false, pointerDelta: { x: 0, y: 0 }, elementIndex: null,
    ...over,
  }
}

function glider(): PlayerState {
  return {
    mode: 'glider',
    position: new Vector3(0, 300, 0),
    velocity: new Vector3(0, 0, -30),
    forward: new Vector3(0, 0, -1),
    breath: 100, maxBreath: 100,
    grounded: false, lastGroundIslandId: 'home',
    airJumpsUsed: 0, chargeTime: 0,
    coyoteTime: 0, jumpBuffer: 0,
    scooterActive: false, scooterCharge: 0,
    dashesUsed: 0, dashRecovery: 0,
    slipstreamElapsed: null, slipstreamCooldown: 0,
    staffChain: 0, staffElapsed: null, staffRecovery: 0, staffSinceSwing: 0,
  }
}

/**
 * Up to forty seconds, dodging on cooldown or never, stopping the loop as soon as the
 * player is no longer in `'glider'` mode. If a run lands, the values returned are that
 * landing frame's own result -- already snapped to the ground by that step -- not the
 * last airborne frame before it; the loop only stops one step later, not one step
 * earlier. Landing flips `mode` to 'ground', where the flight invariants this test is
 * about -- and the dodge's own vertical component -- no longer apply: a landed player
 * sliding around and occasionally ground-dodging is a different question from whether
 * flying and dodging gains height for free. Letting the loop run past that point mixed a
 * landed player's numbers into what was meant to measure a glide, and let the "must
 * actually be dodging" guard pass on ground dodges alone. Bounding to glider posture also
 * means every counted dodge is a glider dodge, so `dodges` needs no separate label.
 */
function fly(dodge: boolean) {
  const d = deps()
  let p = glider()
  let dodges = 0
  let frame = 0
  while (frame < 2400 && p.mode === 'glider') {
    const ready = dodge && p.slipstreamCooldown <= 0 && p.slipstreamElapsed === null
    const before = p.slipstreamCooldown
    p = controllerStep(p, input({ slipstreamPressed: ready }), 1 / 60, d)
    if (p.slipstreamCooldown > before) dodges++
    frame++
  }
  return {
    y: p.position.y,
    speed: p.velocity.length(),
    breath: p.breath,
    dodges,
    landedAtSeconds: p.mode === 'glider' ? null : frame / 60,
  }
}

describe('chain-dodging is no longer a way to gain altitude for free', () => {
  it('ends lower than it started, like a glide, rather than 134 m higher', () => {
    const chained = fly(true)
    expect(chained.dodges, 'the test must actually be dodging').toBeGreaterThan(0)
    expect(chained.y).toBeLessThan(300)
  })

  it('runs the breath bar down instead of leaving it full', () => {
    // The measurement that made this a bug rather than a tuning question: 27 dodges over
    // forty seconds, and the bar never moved.
    expect(fly(true).breath).toBeLessThan(100)
  })

  it('does not end up higher than a plain glide', () => {
    // Altitude, measured directly, rather than an energy ratio: this run ends well below
    // y 0 (see the docblock), and totalEnergy = gravity*y + 0.5*v^2 goes negative there
    // too, so a ratio against the start would cross zero and pass "less than 1" for
    // having crossed zero, not for having lost anything meaningful. Altitude does not
    // have that problem, and is the thing the original bug was actually about.
    //
    // Compared against the control in the same test rather than a remembered constant,
    // so retuning the flight model cannot silently invert the comparison while both
    // numbers drift. The slack is 20, not a round guess: measured, chained.y is -524.4 and
    // plain.y is 150.9, a gap of about 675. 20 is a small fraction of that gap -- room for
    // retuning without the assertion needing attention -- while still failing long before
    // chained could climb anywhere near parity with plain, which is the regression this
    // exists to catch.
    const plain = fly(false)
    const chained = fly(true)
    expect(chained.y).toBeLessThanOrEqual(plain.y + 20)
  })

  it('does not end up much faster than a plain glide', () => {
    // Speed, for the same reason altitude is used above: it stays meaningful however far
    // below y 0 the run goes, where an energy ratio would not.
    //
    // The slack is 15: measured, chained.speed is 24.9 m/s and plain.speed is 23.1 m/s, a
    // gap of only about 1.8 -- close now, not far apart, since the bounded run never lands
    // and free-falls into open water at close to the same terminal-ish speed a glide holds.
    // 15 still leaves comfortable room over that gap while catching a return toward the
    // original exploit's 76.9 m/s, which would blow past plain.speed + 15 well before it
    // got anywhere near 76.9.
    const plain = fly(false)
    const chained = fly(true)
    expect(chained.speed).toBeLessThanOrEqual(plain.speed + 15)
  })

  it('still lets a fight have several dodges in it', () => {
    // The cost must not make the move useless. A full bar buys at least three.
    expect(Math.floor(100 / DEFAULT_SLIPSTREAM_CONFIG.breathCost)).toBeGreaterThanOrEqual(3)
  })
})
