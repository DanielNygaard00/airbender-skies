import { describe, it, expect } from 'vitest'
import { Vector3 } from 'three'
import {
  anyLiveWaterGripTarget, canIceLock, canWaterGrip, freezeShape, gripShape, iceLockTargets,
  inIceLock, inWaterGrip, liveWaterGripTargets, waterGripImpulse, waterGripTargets,
} from './water'
import { hitEnemy, horizontalDistance, spawnEnemy, type Enemy } from './enemy'
import { DEFAULT_COMBAT_CONFIG } from './config'
import { DEFAULT_FOCUS_CONFIG, DEFAULT_AVATAR_STATE_CONFIG } from '../focus/config'
import { DEFAULT_SLIPSTREAM_CONFIG } from '../core/config'

const W = DEFAULT_COMBAT_CONFIG.water
const E = DEFAULT_COMBAT_CONFIG.enemies.spear
const ORIGIN = new Vector3(0, 0, 0)
/** Forward is +Z in this project, but the existing combat fixtures aim along −Z; either works. */
const NORTH = new Vector3(0, 0, -1)

const at = (x: number, z: number, y = 0) => new Vector3(x, y, z)
const enemyAt = (id: string, x: number, z: number, y = 0) =>
  spawnEnemy(id, at(x, z, y), 'spear', E)
/** A soldier taken to zero, which is what `isTargetable` refuses. */
const downed = (enemy: Enemy): Enemy => hitEnemy(enemy, enemy.health.max, new Vector3())

describe('the kit shares one vertical band', () => {
  it('gives the grip and the freeze the identical reach in height', () => {
    // Asserted equal to each other rather than to a literal, exactly as `staff-arc.test.ts` does
    // for the two arcs: grip and freeze are one kit, and a grip that could reach a soldier the
    // freeze could not would break "yank them in, then lock them" for reasons the player cannot
    // see. If it ever moves it moves for both.
    expect(gripShape(W).verticalReach).toBe(freezeShape(W).verticalReach)
    expect(gripShape(W).verticalReach).toBe(W.verticalReach)
  })

  it('is the second shortest band in the game, above the staff and below everything else', () => {
    // The argued position rather than the number. A control move that reaches high wins a fight
    // from a hover with no counterplay — a frozen soldier cannot answer at all, where a gusted one
    // is up again in a moment — so denial is paid for with proximity. Above the staff because this
    // is bending rather than a swing with a stick.
    const staff = DEFAULT_COMBAT_CONFIG.staffArc.opener.verticalReach
    const wave = DEFAULT_COMBAT_CONFIG.pressureWave.verticalReach
    const gust = DEFAULT_COMBAT_CONFIG.gust.verticalReach
    const vortex = DEFAULT_COMBAT_CONFIG.vortex.verticalReach
    expect(W.verticalReach).toBeGreaterThan(staff)
    expect(W.verticalReach).toBeLessThan(wave)
    expect(W.verticalReach).toBeLessThan(gust)
    expect(W.verticalReach).toBeLessThan(vortex)
  })

  it('cannot reach a soldier the archer can still shoot back at', () => {
    // The exploit the band exists to close, stated as the arithmetic that matters rather than as a
    // comparison of two config values. Hovering `verticalReach + 1` above a patrol puts every
    // water move out of range while the archer's 3D `strikeRange` of 30 still covers it — so
    // climbing to freeze a patrol in rotation is not available, and the soldier that punishes
    // altitude still does.
    const hover = at(0, -2, W.verticalReach + 1)
    const soldier = enemyAt('spear', 0, -2)
    expect(inWaterGrip(hover, NORTH, soldier.position, W)).toBe(false)
    expect(inIceLock(hover, NORTH, soldier.position, W)).toBe(false)
    // The positive control: from ground level the very same soldier is caught by both, so the
    // negatives above are about height and not about the fixture being aimed wrongly.
    expect(inWaterGrip(at(0, 0), NORTH, soldier.position, W)).toBe(true)
    expect(inIceLock(at(0, 0), NORTH, soldier.position, W)).toBe(true)
    expect(hover.distanceTo(soldier.position))
      .toBeLessThan(DEFAULT_COMBAT_CONFIG.enemies.archer.strikeRange)
  })

  it('catches a target exactly at the band edge and not a hair past it', () => {
    const edge = enemyAt('edge', 0, -2, W.verticalReach)
    const past = enemyAt('past', 0, -2, W.verticalReach + 0.01)
    expect(waterGripTargets(ORIGIN, NORTH, [edge, past], W).map((e) => e.id)).toEqual(['edge'])
    expect(iceLockTargets(ORIGIN, NORTH, [edge, past], W).map((e) => e.id)).toEqual(['edge'])
  })
})

describe('the two cones differ the way the moves do', () => {
  it('makes the grip long and narrow and the freeze short and wide', () => {
    // Both halves of the trade, in one place. A grip is a reach and a freeze is a rank, and
    // asserting only one of the pair would let a retune quietly make the freeze a strictly better
    // grip — longer *and* wider, for a move that also denies for three times as long.
    expect(W.grip.range).toBeGreaterThan(W.freeze.range)
    expect(W.freeze.halfAngle).toBeGreaterThan(W.grip.halfAngle)
  })

  it('keeps the grip narrower than a gust, which is what it pays for holding', () => {
    // The gust sweeps a group; water picks a target. Given the gust's width, the grip would be a
    // strictly better gust — it denies where a gust merely shoves.
    expect(W.grip.halfAngle).toBeLessThan(DEFAULT_COMBAT_CONFIG.gust.halfAngle)
    expect(W.grip.range).toBeLessThan(DEFAULT_COMBAT_CONFIG.gust.range)
  })

  it('leaves a soldier behind the caster alone, unlike a Vortex', () => {
    // Both water moves are cones, so both have a facing. A radial freeze would also lock the
    // soldier you were about to walk away from, and a move this expensive has to go where it is
    // aimed. Paired with the soldier in front, so "caught nobody" cannot be what passes.
    const behind = enemyAt('behind', 0, W.freeze.range - 1)
    const ahead = enemyAt('ahead', 0, -(W.freeze.range - 1))
    expect(iceLockTargets(ORIGIN, NORTH, [behind, ahead], W).map((e) => e.id)).toEqual(['ahead'])
    expect(waterGripTargets(ORIGIN, NORTH, [behind, ahead], W).map((e) => e.id)).toEqual(['ahead'])
  })

  it('catches a group with the freeze that the grip lets through', () => {
    // The reason the two widths exist, measured on one arrangement rather than argued. Three
    // soldiers spread across the front: the freeze takes the flanks, the grip takes only the one
    // it is pointed at.
    const line = [
      enemyAt('left', -4, -4),
      enemyAt('centre', 0, -5),
      enemyAt('right', 4, -4),
    ]
    expect(iceLockTargets(ORIGIN, NORTH, line, W).map((e) => e.id))
      .toEqual(['left', 'centre', 'right'])
    expect(waterGripTargets(ORIGIN, NORTH, line, W).map((e) => e.id)).toEqual(['centre'])
  })
})

describe('waterGripImpulse', () => {
  it('pulls inward, toward the caster', () => {
    // The sign is the whole move, the same assertion `vortex.test.ts` makes for the same reason: a
    // gust pushes away and this gathers, and a flipped sign would still "move something".
    const target = at(0, -6)
    const pull = waterGripImpulse(ORIGIN, target, W)
    expect(pull.z).toBeGreaterThan(0)
    const after = target.clone().addScaledVector(pull, 0.1)
    expect(horizontalDistance(ORIGIN, after)).toBeLessThan(horizontalDistance(ORIGIN, target))
  })

  it('does not lift, unlike a Vortex', () => {
    // Air takes people off their feet; water drags them across the ground. It is also mechanical
    // rather than cosmetic: an airborne enemy is already inert, so lifting would make the hold
    // redundant for as long as the target was in the air, and the hold is the move.
    expect(waterGripImpulse(ORIGIN, at(0, -6), W).y).toBe(0)
  })

  it('drags a spear out of its own reach and into the staff\'s', () => {
    // What the pull speed is actually for, as arithmetic off the config rather than a transcribed
    // number, so it follows a retune of either value. A push of `pullSpeed` against
    // `knockbackDamping` travels `pullSpeed / knockbackDamping` before it stops.
    const travel = W.pullSpeed / E.knockbackDamping
    expect(travel).toBeGreaterThan(E.strikeRange)
    expect(travel).toBeGreaterThan(DEFAULT_COMBAT_CONFIG.staffArc.finisher.range)
  })

  it('pulls less hard than a full Vortex', () => {
    expect(W.pullSpeed).toBeLessThan(DEFAULT_COMBAT_CONFIG.vortex.maxPullSpeed)
  })

  it('is finite for a target standing exactly on the caster', () => {
    // The inward direction is undefined there; it must not produce a NaN that would corrupt the
    // body's position for the rest of the session.
    const pull = waterGripImpulse(ORIGIN, ORIGIN.clone(), W)
    expect(Number.isFinite(pull.x)).toBe(true)
    expect(Number.isFinite(pull.z)).toBe(true)
    expect(pull.length()).toBe(0)
  })
})

describe('the live-target preview', () => {
  it('ignores a downed soldier and lights up for a standing one', () => {
    // The pair, because "the preview stays dark" passes just as well for a preview that never
    // lights up at all — and the same arrangement is used for both halves, so the only difference
    // is the soldier's state.
    const standing = enemyAt('standing', 0, -4)
    expect(liveWaterGripTargets(ORIGIN, NORTH, [standing], W).map((e) => e.id))
      .toEqual(['standing'])
    expect(liveWaterGripTargets(ORIGIN, NORTH, [downed(standing)], W)).toEqual([])
    // And the geometry filter still sees the body, which is what makes this a state test rather
    // than the cone quietly having moved.
    expect(waterGripTargets(ORIGIN, NORTH, [downed(standing)], W).map((e) => e.id))
      .toEqual(['standing'])
  })

  it('answers the same as the list form across a range of arrangements', () => {
    // The cheap boolean held to the expensive list, the way `gust.test.ts` holds
    // `anyLiveGustTarget` to `liveGustTargets`. Both a hit and a miss occur in this sweep, which
    // is what stops it passing against a function that always answers false.
    let hits = 0
    let misses = 0
    for (let x = -8; x <= 8; x += 2) {
      for (let z = -12; z <= 4; z += 2) {
        for (const y of [0, 2, 5]) {
          const enemies = [enemyAt('a', x, z, y), downed(enemyAt('b', 0, -3))]
          const list = liveWaterGripTargets(ORIGIN, NORTH, enemies, W).length > 0
          expect(anyLiveWaterGripTarget(ORIGIN, NORTH, enemies, W), `${x},${z},${y}`).toBe(list)
          if (list) hits++
          else misses++
        }
      }
    }
    expect(hits).toBeGreaterThan(0)
    expect(misses).toBeGreaterThan(0)
  })
})

describe('canWaterGrip', () => {
  it('refuses on cooldown and allows off it', () => {
    expect(canWaterGrip(0, 100, W)).toBe(true)
    expect(canWaterGrip(0.5, 100, W)).toBe(false)
  })

  it('refuses below the breath cost rather than firing into a negative bar', () => {
    // The same contract `canSlipstream` has: a move that cannot be paid for does not fire. Tested
    // one unit either side of the cost, so an implementation using `>` instead of `>=` is caught.
    expect(canWaterGrip(0, W.gripBreathCost, W)).toBe(true)
    expect(canWaterGrip(0, W.gripBreathCost - 1, W)).toBe(false)
  })

  it('costs less breath than a dodge', () => {
    // The grip's real price is its cooldown, so breath is a rate limit on mashing rather than the
    // gate. A dodge is the move that saves the player's life and is priced to be spendable.
    expect(W.gripBreathCost).toBeLessThan(DEFAULT_SLIPSTREAM_CONFIG.breathCost)
  })
})

describe('canIceLock', () => {
  it('refuses below the Focus cost and allows at it', () => {
    expect(canIceLock(W.freezeFocusCost, 100, W)).toBe(true)
    expect(canIceLock(W.freezeFocusCost - 1, 100, W)).toBe(false)
  })

  it('refuses below the breath cost even with a full Focus bar', () => {
    // Both gates, checked independently. Written as one `&&` it is easy to leave a gate out and
    // still pass a test that only ever varies the other.
    expect(canIceLock(DEFAULT_FOCUS_CONFIG.maxFocus, W.freezeBreathCost, W)).toBe(true)
    expect(canIceLock(DEFAULT_FOCUS_CONFIG.maxFocus, W.freezeBreathCost - 1, W)).toBe(false)
  })
})

describe('the freeze is priced against what a full bar is worth', () => {
  const F = DEFAULT_FOCUS_CONFIG

  it('costs a shade more than taking a spear hit', () => {
    // The comparison that decides the number. Spending a freeze has to be felt in the meter the
    // way being hit is felt, or it is not a decision — and it must be the *worse* of the two, so
    // that a player never treats the freeze as cheaper than getting hit.
    expect(W.freezeFocusCost).toBeGreaterThan(F.damageDrain)
  })

  it('costs more than two knockdowns pay', () => {
    expect(W.freezeFocusCost).toBeGreaterThan(F.downGain * 2)
  })

  it('leaves two freezes affordable from a full bar, and not three', () => {
    // The shape the price is meant to produce: a full meter is two freezes, so the move is
    // genuinely usable, and the third is not — which is what stops a full bar being an
    // indefinite lockdown.
    expect(W.freezeFocusCost * 2).toBeLessThanOrEqual(F.maxFocus)
    expect(W.freezeFocusCost * 3).toBeGreaterThan(F.maxFocus)
  })

  it('costs the player the Avatar State, which is the trade it exists to create', () => {
    // The Avatar State arms only from a bar held *at maximum* for `armSeconds`, so any spend at
    // all breaks the pip. What this pins is that the spend is big enough that getting back is a
    // real climb rather than a moment: one freeze from full leaves the meter needing more than
    // `armSeconds` of the best gain rate in the game to refill.
    expect(W.freezeFocusCost).toBeLessThan(F.maxFocus)
    const bestGainPerSecond = F.glideGainPerSecond * F.windGainMultiplier * F.chainRampMax
    const secondsToRefill = W.freezeFocusCost / bestGainPerSecond
    expect(secondsToRefill).toBeGreaterThan(DEFAULT_AVATAR_STATE_CONFIG.armSeconds)
  })
})

describe('the hold durations', () => {
  it('holds a grip past a whole spear exchange', () => {
    // What "removes one soldier from one exchange" means, in the soldier's own numbers rather than
    // as an assertion about the literal 1.2.
    expect(W.gripHoldSeconds).toBeGreaterThan(E.windUpSeconds + E.recoverSeconds)
  })

  it('keeps the grip cooldown just under the hold, so one target can be chain-held', () => {
    // Deliberate rather than overlooked, and pinned because the move's whole feel changes the
    // moment the inequality flips: at a cooldown above the hold, single-target lockdown quietly
    // stops existing. It costs the player their entire light-verb budget and does no damage, so it
    // buys time and not progress.
    expect(W.gripCooldownSeconds).toBeLessThan(W.gripHoldSeconds)
    // And it is slower than a gust, because a grip denies where a gust shoves.
    expect(W.gripCooldownSeconds).toBeGreaterThan(DEFAULT_COMBAT_CONFIG.gust.cooldownSeconds)
  })

  it('freezes for materially longer than a grip holds', () => {
    // A margin rather than a bare `>`: the freeze costs a third of the Focus bar, and a
    // fractionally longer hold for that price would be a bad move rather than a heavy one.
    expect(W.freezeHoldSeconds).toBeGreaterThan(W.gripHoldSeconds * 2)
  })

  it('freezes for far less than a knockdown, and less than the Avatar State runs', () => {
    // The two ceilings. A freeze is a lock and not a down, so it must not approach
    // `downedSeconds`; and it must not be most of an Avatar State for a third of the price.
    expect(W.freezeHoldSeconds).toBeLessThan(E.downedSeconds);
    expect(W.freezeHoldSeconds).toBeLessThan(DEFAULT_AVATAR_STATE_CONFIG.durationSeconds)
  })
})
