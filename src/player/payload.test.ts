import { describe, it, expect } from 'vitest'
import { Vector3 } from 'three'
import {
  CARRY_IN_FLIGHT, CARRY_ON_FOOT, carryIntent, carryPose, carryStep, loadedFlight,
  returnCarriedHome,
} from './payload'
import { flightStep } from './flight'
import { steerToward } from './steering'
import { canBend, stepBreath } from './breath'
import { DEFAULT_FLIGHT_CONFIG, validateFlightConfig } from '../core/config'
import { ARCHIPELAGO } from '../world/levels/archipelago'
import type { Payload } from '../world/payload'
import type { FlightConfig, PlayerState } from '../core/types'

const DT = 1 / 60
const EMPTY = DEFAULT_FLIGHT_CONFIG
const LOADED = loadedFlight(DEFAULT_FLIGHT_CONFIG)

const p = (over: Partial<PlayerState> = {}): PlayerState => ({
  mode: 'ground', position: new Vector3(), velocity: new Vector3(),
  forward: new Vector3(0, 0, 1), breath: 100, maxBreath: 100,
  grounded: true, lastGroundIslandId: 'home', airJumpsUsed: 0, chargeTime: 0,
  coyoteTime: 0, jumpBuffer: 0,
  scooterActive: false, scooterCharge: 0, dashesUsed: 0, dashRecovery: 0,
  slipstreamElapsed: null, slipstreamCooldown: 0,
  staffChain: 0, staffElapsed: null, staffRecovery: 0, staffSinceSwing: 0, ...over,
})

const payload = (over: Partial<Payload> = {}): Payload => ({
  id: 'bundle', position: new Vector3(), origin: new Vector3(),
  destinationIslandId: 'climb-north', carried: false, delivered: false, ...over,
})

/**
 * A steady unpowered glide, launched at cruise speed along +Z.
 *
 * The measurement behind "lower lift ceiling": lift does no work, so an unpowered glide can
 * only trade height for distance, and how much height that costs per unit of distance is the
 * one number a lift coefficient owns outright.
 */
function glide(c: FlightConfig, seconds: number) {
  let position = new Vector3(0, 1000, 0)
  let velocity = new Vector3(0, 0, 25)
  const forward = new Vector3(0, 0, 1)
  for (let i = 0; i < Math.round(seconds / DT); i++) {
    const next = flightStep(position, velocity, {
      forward, thrust: false, flare: false, bank: 0, hover: false, tuck: false,
    }, DT, c)
    position = next.position
    velocity = next.velocity
  }
  const lost = 1000 - position.y
  return { lost, distance: position.z, ratio: position.z / lost, sink: -velocity.y }
}

/**
 * The top of a full-breath climb: hold thrust 30 degrees nose-up from a standing launch and
 * fly until the breath is gone and the nose drops.
 *
 * This is what "ceiling" can mean in a model with no altitude term in it: nothing stops the
 * glider climbing except the breath it climbs on, so the reachable height is the product of
 * how long thrust lasts and how much of that thrust is left over after covering the sink.
 */
function ceiling(c: FlightConfig, maxBreath: number) {
  let position = new Vector3()
  let velocity = new Vector3(0, 0, 18)
  const forward = new Vector3(0, Math.sin(0.52), Math.cos(0.52)).normalize()
  let breath = { breath: maxBreath, maxBreath }
  let peak = 0
  for (let i = 0; i < 60 * 60; i++) {
    const thrust = canBend(breath, c)
    const next = flightStep(position, velocity, {
      forward, thrust, flare: false, bank: 0, hover: false, tuck: false,
    }, DT, c)
    position = next.position
    velocity = next.velocity
    breath = stepBreath(breath, thrust ? 'thrust' : 'idle', false, DT, c)
    peak = Math.max(peak, position.y)
    if (!thrust && velocity.y < 0) break
  }
  return peak
}

/** A sustained full weight shift with the mouse held still: yaw rate, and the turn radius. */
function turn(c: FlightConfig, speed: number) {
  let forward = new Vector3(0, 0, 1)
  const start = forward.clone()
  for (let i = 0; i < 60; i++) {
    // The look target is the heading itself, so the chase contributes nothing and what is
    // measured is the roll input alone.
    forward = steerToward(forward, forward.clone(), speed, 1, DT, c)
  }
  const ratePerSecond = start.angleTo(forward)
  return { ratePerSecond, radius: speed / ratePerSecond }
}

/** Seconds of held thrust a bar of this size buys, including the bendFloor's own flicker. */
function thrustSeconds(c: FlightConfig, maxBreath: number): number {
  let breath = { breath: maxBreath, maxBreath }
  let engaged = 0
  for (let i = 0; i < 60 * 60; i++) {
    if (!canBend(breath, c)) break
    engaged += DT
    breath = stepBreath(breath, 'thrust', false, DT, c)
  }
  return engaged
}

describe('loadedFlight', () => {
  it('degrades exactly the three quantities §2.4 names, and nothing else', () => {
    // Asserted as a whole-object comparison rather than field by field, so a fourth field
    // quietly scaled here reddens too. The payload is a weakness with three named parts, and
    // a fourth would be an undocumented one.
    expect(LOADED).toEqual({
      ...EMPTY,
      liftCoeff: EMPTY.liftCoeff * EMPTY.payloadLiftFactor,
      weightShiftTurnRate: EMPTY.weightShiftTurnRate * EMPTY.payloadTurnFactor,
      breathDrainPerSecond: EMPTY.breathDrainPerSecond * EMPTY.payloadBreathMultiplier,
      hoverBreathPerSecond: EMPTY.hoverBreathPerSecond * EMPTY.payloadBreathMultiplier,
    })
  })

  it('leaves the stall speed alone', () => {
    // Deliberate, and the alternative that was rejected: `stallSpeed` is shared with the
    // HUD's warning colour and the wing's shudder (see `stallFactor` in flight.ts), so
    // raising it would teach the player two different stall speeds for the same wing.
    expect(LOADED.stallSpeed).toBe(EMPTY.stallSpeed)
  })

  it('produces a config the game would still accept', () => {
    // Every invariant `validateFlightConfig` guards has to survive the transform, and the
    // hover-above-thrust one is the reason this is not obvious: scaling only one of the two
    // breath costs could invert it.
    expect(() => validateFlightConfig(LOADED)).not.toThrow()
  })

  it('keeps hovering more expensive than thrusting', () => {
    expect(LOADED.hoverBreathPerSecond).toBeGreaterThan(LOADED.breathDrainPerSecond)
  })

  it('is pure', () => {
    const before = { ...DEFAULT_FLIGHT_CONFIG }
    loadedFlight(DEFAULT_FLIGHT_CONFIG)
    expect(DEFAULT_FLIGHT_CONFIG).toEqual(before)
  })
})

describe('the lift degradation', () => {
  it('costs about a quarter of the glide ratio', () => {
    // Measured over 20 s from 25 m/s: 6.09:1 empty against 4.40:1 loaded. The bands are wide
    // enough to survive a small retune of either coefficient and narrow enough that a factor
    // of 0.9 or of 0.5 in place of 0.7 fails.
    const emptyRatio = glide(EMPTY, 20).ratio
    const loadedRatio = glide(LOADED, 20).ratio
    expect(emptyRatio).toBeGreaterThan(5.5)
    expect(emptyRatio).toBeLessThan(6.7)
    expect(loadedRatio).toBeGreaterThan(4.0)
    expect(loadedRatio).toBeLessThan(4.8)
    expect(loadedRatio / emptyRatio).toBeGreaterThan(0.65)
    expect(loadedRatio / emptyRatio).toBeLessThan(0.8)
  })

  it('sinks about half again as fast', () => {
    // The half of the lift loss the player feels directly: 3.85 m/s against 5.61.
    const emptySink = glide(EMPTY, 20).sink
    const loadedSink = glide(LOADED, 20).sink
    expect(loadedSink / emptySink).toBeGreaterThan(1.3)
    expect(loadedSink / emptySink).toBeLessThan(1.6)
  })

  it('keeps the level\'s longest glide-only crossing open', () => {
    // The bound the factor was chosen against. `home` to `ring-east` is the crossing the
    // archipelago's own comment calls "reachable by gliding alone": about 80 m of drop
    // between the two summits over 276 m of ground to the near rim, so it demands 3.46:1.
    // Measured, the loaded wing does 4.40:1 — clear by 1.27 times — and a factor of 0.5 does
    // 3.13:1, which does not clear it at all. That is what fixes the floor under 0.7: a lift
    // factor tuned purely for drama would close a route the level itself teaches.
    //
    // Measured to the near rim rather than to the island centre because arriving anywhere on
    // a 46-radius island counts as arriving. Centre to centre the requirement is 4.03:1 and
    // the loaded margin is only 1.09 times, which is the honest figure for a player who
    // insists on overflying the middle of it.
    const home = ARCHIPELAGO.islands.find((i) => i.id === 'home')!
    const ring = ARCHIPELAGO.islands.find((i) => i.id === 'ring-east')!
    const drop = (home.position.y + home.height) - (ring.position.y + ring.height)
    const distance = Math.hypot(ring.position.x - home.position.x, ring.position.z - home.position.z)
    const required = (distance - ring.radius) / drop
    expect(glide(LOADED, 20).ratio).toBeGreaterThan(required * 1.2)
  })
})

describe('the ceiling', () => {
  it('is roughly halved on a full bar of breath', () => {
    // Measured: 442 m empty, 191 m loaded, from the same standing launch held 30 degrees
    // nose-up until the breath runs out.
    const empty = ceiling(EMPTY, EMPTY.baseMaxBreath)
    const loaded = ceiling(LOADED, EMPTY.baseMaxBreath)
    expect(empty).toBeGreaterThan(380)
    expect(loaded).toBeLessThan(empty * 0.55)
    expect(loaded).toBeGreaterThan(empty * 0.3)
  })

  it('loses most of that to the breath drain rather than to the lift', () => {
    // Worth recording because it is not what the phrase "lower lift ceiling" suggests: with
    // the lift factor alone the climb still reaches 394 m of the empty 442, and it is the
    // 1.5 times drain that takes it to 191. The two degradations are not independent — the
    // lift loss is what makes each second of thrust buy less height, and the drain is what
    // takes the seconds away — so the ceiling is a product of both and mostly the second.
    const liftOnly = ceiling({ ...LOADED, ...{
      breathDrainPerSecond: EMPTY.breathDrainPerSecond,
      hoverBreathPerSecond: EMPTY.hoverBreathPerSecond,
    } }, EMPTY.baseMaxBreath)
    const both = ceiling(LOADED, EMPTY.baseMaxBreath)
    expect(liftOnly).toBeGreaterThan(both * 1.7)
  })

  it('reaches the payload\'s destination on thrust alone with almost nothing to spare', () => {
    // The route's premise, stated as what was measured rather than as what would have been
    // convenient. An earlier version of this test — and of the comment on the level — claimed
    // thrust alone could not make the crossing at all. It can: budget the whole bar as a
    // nose-up climb and then spend the height gliding the 332 m across at the loaded ratio,
    // and the sum closes with about 9 m of slack out of the 106 m of climb the leg needs.
    // Nine metres of ideal-profile margin is not a route, though, and that is the real claim
    // here: empty-handed the same budget closes with roughly 280 m to spare, a margin over
    // three times the requirement, so what the payload actually removes is all the room for
    // error — every turn, every second spent not pointing 30 degrees up, and every metre of
    // the climb flown below the ideal profile comes out of those 9 m. The thermals over
    // `home` and under `climb-north` are what put the room back.
    const home = ARCHIPELAGO.islands.find((i) => i.id === 'home')!
    const target = ARCHIPELAGO.islands.find((i) => i.id === 'climb-north')!
    const climb = (target.position.y + target.height) - (home.position.y + home.height)
    const across = Math.hypot(
      target.position.x - home.position.x, target.position.z - home.position.z,
    )
    const budget = (c: FlightConfig) =>
      ceiling(c, EMPTY.baseMaxBreath) - across / glide(c, 20).ratio
    expect(budget(EMPTY)).toBeGreaterThan(climb * 3)
    expect(budget(LOADED)).toBeGreaterThan(climb)
    expect(budget(LOADED)).toBeLessThan(climb * 1.25)
  })
})

describe('the roll degradation', () => {
  it('halves the rate a weight shift turns at', () => {
    // 1.70 rad/s empty against 0.85 loaded, measured with the mouse held still so the look
    // assist contributes nothing.
    const empty = turn(EMPTY, 25).ratePerSecond
    const loaded = turn(LOADED, 25).ratePerSecond
    expect(empty).toBeCloseTo(EMPTY.weightShiftTurnRate, 1)
    expect(loaded / empty).toBeGreaterThan(0.4)
    expect(loaded / empty).toBeLessThan(0.6)
  })

  it('doubles the turn radius, which is what a thermal actually measures', () => {
    // 14.7 m empty against 29.4 m at 25 m/s. The consequence on the payload's route: the
    // thermal under `climb-north` has a radius of 45, so a loaded glider fits inside it at
    // 25 m/s and does not at 40 — it has to slow down to stay in lift.
    const column = (ARCHIPELAGO.winds ?? [])
      .find((w) => w.kind === 'thermal' && Math.abs(w.position.z + 330) < 1)!
    expect(turn(LOADED, 25).radius).toBeLessThan(column.radius)
    expect(turn(LOADED, 40).radius).toBeGreaterThan(column.radius)
    expect(turn(EMPTY, 40).radius).toBeLessThan(column.radius)
  })

  it('leaves the look assist alone', () => {
    // The rejected alternative. `baseTurnRate` and `bankTurnRate` only govern how fast the
    // nose chases the mouse, so degrading them would read as camera lag rather than weight.
    expect(LOADED.baseTurnRate).toBe(EMPTY.baseTurnRate)
    expect(LOADED.bankTurnRate).toBe(EMPTY.bankTurnRate)
  })
})

describe('the breath degradation', () => {
  it('drains half again as fast under thrust and under hover alike', () => {
    const empty = stepBreath({ breath: 100, maxBreath: 100 }, 'thrust', false, 1, EMPTY).breath
    const loaded = stepBreath({ breath: 100, maxBreath: 100 }, 'thrust', false, 1, LOADED).breath
    expect(100 - loaded).toBeCloseTo((100 - empty) * 1.5, 6)
    const emptyHover = stepBreath({ breath: 100, maxBreath: 100 }, 'hover', false, 1, EMPTY).breath
    const loadedHover = stepBreath({ breath: 100, maxBreath: 100 }, 'hover', false, 1, LOADED).breath
    expect(100 - loadedHover).toBeCloseTo((100 - emptyHover) * 1.5, 6)
  })

  it('does not touch regeneration', () => {
    // A payload makes flying expensive, not recovery slow. Setting it down and standing
    // still has to refill at the ordinary rate, or the weakness would follow the player onto
    // the ground where it has no business being.
    const empty = stepBreath({ breath: 0, maxBreath: 100 }, 'idle', true, 1, EMPTY).breath
    const loaded = stepBreath({ breath: 0, maxBreath: 100 }, 'idle', true, 1, LOADED).breath
    expect(loaded).toBe(empty)
  })

  it('is bought back by five air shrines, to within a few per cent', () => {
    // The anchor, as behaviour rather than as arithmetic. On paper it is exact: five shrines
    // raise the ceiling by 50% (`shrineBreathBonusFraction` 0.1 each), and 1.5 times the drain
    // on 1.5 times the bar is 150/27 against 100/18 — 5.56 s either way.
    //
    // Measured through the real gate it is not quite exact, and the reason is worth writing
    // down because it is invisible in the arithmetic: `bendFloor` is a flat 15 units held back
    // rather than a fraction of the bar, so a bigger bar loses proportionally less of itself to
    // it. A loaded player with five shrines gets 5.00 s of thrust where the empty-handed
    // baseline gets 4.73 s — five shrines land 5.6% *ahead* rather than level. Asserted as a
    // band around parity, with the direction pinned, because that residue is a real (small)
    // reward for exploring and not something to launder into an equality.
    const base = EMPTY.baseMaxBreath
    const withFive = base * (1 + 5 * EMPTY.shrineBreathBonusFraction)
    const ratio = thrustSeconds(LOADED, withFive) / thrustSeconds(EMPTY, base)
    expect(ratio).toBeGreaterThan(1)
    expect(ratio).toBeLessThan(1.1)
  })

  it('costs a third of the thrust a full bar used to buy', () => {
    // The plain consequence, so the equivalence above cannot be the only thing pinning the
    // multiplier: on an uncollected bar, loaded thrust lasts two thirds as long.
    const ratio = thrustSeconds(LOADED, EMPTY.baseMaxBreath)
      / thrustSeconds(EMPTY, EMPTY.baseMaxBreath)
    expect(ratio).toBeGreaterThan(0.6)
    expect(ratio).toBeLessThan(0.72)
  })
})

describe('carryIntent', () => {
  const inReach = [payload({ position: new Vector3(1, 0, 0) })]

  it('offers a pick-up standing next to one', () => {
    expect(carryIntent(p(), inReach, null)).toBe('pick-up')
  })

  it('offers nothing standing away from one', () => {
    expect(carryIntent(p({ position: new Vector3(50, 0, 0) }), inReach, null)).toBeNull()
  })

  it('offers nothing in the air, even directly over one', () => {
    // The rule that keeps the payload out of the sky: no snatching at 25 m/s, and therefore
    // nothing anywhere in this system ever has to simulate a falling bundle.
    expect(carryIntent(p({ grounded: false }), inReach, null)).toBeNull()
  })

  it('offers a set-down while carrying, wherever the player stands', () => {
    expect(carryIntent(p({ position: new Vector3(500, 0, 500) }), inReach, 'bundle'))
      .toBe('set-down')
  })

  it('refuses a set-down in mid-air', () => {
    // The whole reason the drop is a key press and not a landing still has to hold: a press
    // in the air does nothing at all rather than dropping cargo out of the glider.
    expect(carryIntent(p({ grounded: false, mode: 'glider' }), inReach, 'bundle')).toBeNull()
  })
})

describe('carryStep', () => {
  const at = (x: number) => p({ position: new Vector3(x, 0, 0) })
  const beside = [payload({ position: new Vector3(1, 0, 0) })]

  it('does nothing without a press', () => {
    const result = carryStep(at(0), beside, null, false, ARCHIPELAGO)
    expect(result.event).toBeNull()
    expect(result.carriedId).toBeNull()
    expect(result.payloads[0]!.carried).toBe(false)
  })

  it('picks up the payload in reach', () => {
    const result = carryStep(at(0), beside, null, true, ARCHIPELAGO)
    expect(result.event).toBe('picked-up')
    expect(result.carriedId).toBe('bundle')
    expect(result.payloads[0]!.carried).toBe(true)
  })

  it('sets it down at the player\'s feet rather than where it was lifted', () => {
    const carried = [payload({ carried: true, position: new Vector3(1, 0, 0) })]
    const result = carryStep(at(80), carried, 'bundle', true, ARCHIPELAGO)
    expect(result.event).toBe('set-down')
    expect(result.carriedId).toBeNull()
    expect(result.payloads[0]!.carried).toBe(false)
    expect(result.payloads[0]!.position.x).toBe(80)
    expect(result.payloads[0]!.delivered).toBe(false)
  })

  it('marks it delivered when set down on its destination island', () => {
    const target = ARCHIPELAGO.islands.find((i) => i.id === 'climb-north')!
    const carried = [payload({ carried: true })]
    const result = carryStep(
      p({ position: target.position.clone() }), carried, 'bundle', true, ARCHIPELAGO,
    )
    expect(result.event).toBe('delivered')
    expect(result.payloads[0]!.delivered).toBe(true)
  })

  it('refuses to lift a delivered payload again', () => {
    const done = [payload({ delivered: true, position: new Vector3(1, 0, 0) })]
    const result = carryStep(at(0), done, null, true, ARCHIPELAGO)
    expect(result.event).toBeNull()
    expect(result.carriedId).toBeNull()
  })

  it('clears a carriedId that names no payload', () => {
    // A caller bug rather than a game state, but leaving it would make the player
    // permanently loaded by something that does not exist — degraded flight and no bundle.
    const result = carryStep(at(0), beside, 'ghost', true, ARCHIPELAGO)
    expect(result.carriedId).toBeNull()
  })

  it('is pure', () => {
    // A payload built here rather than the shared `beside`, and that is the whole strength of
    // this test. Written against the shared array it snapshotted a record the pick-up test
    // above had already been through, so `before` already read `carried: true` and an
    // in-place mutation inside `carryStep` passed — verified by mutation: assigning
    // `p.carried = true` instead of spreading a copy reddened nothing.
    const fresh = [payload({ position: new Vector3(1, 0, 0) })]
    const before = { ...fresh[0]! }
    carryStep(at(0), fresh, null, true, ARCHIPELAGO)
    expect(fresh[0]).toEqual(before)
    expect(fresh[0]!.carried).toBe(false)
  })
})

describe('returnCarriedHome', () => {
  it('puts a carried payload back at its origin, uncarried', () => {
    const carried = [payload({
      carried: true, position: new Vector3(400, 200, 0), origin: new Vector3(1, 2, 3),
    })]
    const [back] = returnCarriedHome(carried, 'bundle')
    expect(back!.carried).toBe(false)
    expect(back!.position.toArray()).toEqual([1, 2, 3])
  })

  it('leaves everything alone when nothing is carried', () => {
    const resting = [payload({ position: new Vector3(400, 0, 0) })]
    expect(returnCarriedHome(resting, null)[0]!.position.x).toBe(400)
  })

  it('does not resurrect a delivered payload', () => {
    // Delivery clears `carried`, so a delivered payload can never be the carried one — but
    // the guard is asserted because the consequence of getting it wrong is a finished
    // objective silently teleporting back to the start island.
    const done = [payload({ delivered: true, position: new Vector3(400, 0, 0) })]
    const [after] = returnCarriedHome(done, 'bundle')
    expect(after!.delivered).toBe(true)
  })
})

describe('carryPose', () => {
  it('holds it in front on foot and slings it behind in flight', () => {
    // +Z is forward, so the on-foot pose is ahead of the body and the flight pose behind it.
    // Not interchangeable: the follow camera sits behind and above along the flight path, so
    // the flight pose is the one that keeps the bundle out from behind the prone rider.
    expect(carryPose(0, new Vector3())).toEqual(CARRY_ON_FOOT)
    expect(carryPose(1, new Vector3())).toEqual(CARRY_IN_FLIGHT)
    expect(CARRY_ON_FOOT.z).toBeGreaterThan(0)
    expect(CARRY_IN_FLIGHT.z).toBeLessThan(0)
    expect(CARRY_IN_FLIGHT.y).toBeLessThan(CARRY_ON_FOOT.y)
  })

  it('travels monotonically between them', () => {
    let previous = carryPose(0, new Vector3()).z
    for (let i = 1; i <= 10; i++) {
      const z = carryPose(i / 10, new Vector3()).z
      expect(z).toBeLessThanOrEqual(previous)
      previous = z
    }
  })

  it('writes into the vector it is given rather than allocating', () => {
    const out = new Vector3()
    expect(carryPose(0.5, out)).toBe(out)
  })

  it('survives a non-finite openness', () => {
    // The glider guards its own fan angles against exactly this, and for the same reason: a
    // NaN here would land in a transform and take the mesh out of the scene silently.
    expect(carryPose(NaN, new Vector3())).toEqual(CARRY_ON_FOOT)
    expect(carryPose(5, new Vector3())).toEqual(CARRY_IN_FLIGHT)
  })
})
