import { describe, it, expect } from 'vitest'
import { Vector3 } from 'three'
import { collectStep } from './shrine-collect'
import { DEFAULT_FLIGHT_CONFIG as C } from '../core/config'
import type { PlayerState } from '../core/types'
import type { Shrine } from '../world/shrine'

const player = (over: Partial<PlayerState> = {}): PlayerState => ({
  act: 1, mode: 'glider', position: new Vector3(0, 0, 0), velocity: new Vector3(),
  forward: new Vector3(0, 0, -1), breath: 40, maxBreath: 100,
  grounded: false, lastGroundIslandId: null, airJumpsUsed: 0, chargeTime: 0, coyoteTime: 0,
  jumpBuffer: 0, scooterActive: false, scooterCharge: 0, dashesUsed: 0, dashRecovery: 0,
  slipstreamElapsed: null, slipstreamCooldown: 0, staffChain: 0, staffElapsed: null,
  staffRecovery: 0, staffSinceSwing: 0, tangled: 0, wallRideNormal: null, ...over,
})

const shrine = (id: string, at: Vector3, collected = false): Shrine =>
  ({ id, position: at, collected })

/** Well outside COLLECT_RADIUS of 6. */
const faraway = new Vector3(500, 500, 500)

describe('collectStep', () => {
  it('raises the ceiling without refunding spent breath', () => {
    const r = collectStep(player(), [shrine('home', new Vector3(0, 0, 0))], C)
    expect(r.collected).toEqual(['home'])
    expect(r.player.breath).toBe(40)
    expect(r.player.maxBreath).toBeCloseTo(110, 5)
  })

  it('does not refill breath to the new maximum', () => {
    const r = collectStep(player(), [shrine('home', new Vector3(0, 0, 0))], C)
    expect(r.player.breath).not.toBeCloseTo(110, 5)
  })

  it('marks the collected shrine as collected', () => {
    const r = collectStep(player(), [shrine('home', new Vector3(0, 0, 0))], C)
    expect(r.shrines[0]!.collected).toBe(true)
  })

  it('applies the bonus twice when two shrines are in range in one frame', () => {
    const r = collectStep(player(), [
      shrine('home', new Vector3(1, 0, 0)),
      shrine('ring-east', new Vector3(0, 0, 1)),
    ], C)
    expect(r.collected).toHaveLength(2)
    expect(r.player.breath).toBe(40)
    expect(r.player.maxBreath).toBeCloseTo(120, 5)
  })

  it('does not re-collect a shrine that is already collected', () => {
    const r = collectStep(player(), [shrine('home', new Vector3(0, 0, 0), true)], C)
    expect(r.collected).toEqual([])
    expect(r.player.maxBreath).toBe(100)
  })

  it('leaves the player unchanged when nothing is in range', () => {
    const p = player()
    const r = collectStep(p, [shrine('home', faraway)], C)
    expect(r.collected).toEqual([])
    expect(r.player).toBe(p)
  })

  it('leaves an out-of-range shrine uncollected', () => {
    const r = collectStep(player(), [shrine('home', faraway)], C)
    expect(r.shrines[0]!.collected).toBe(false)
  })

  it('does not mutate the player it is given', () => {
    const p = player()
    collectStep(p, [shrine('home', new Vector3(0, 0, 0))], C)
    expect(p.breath).toBe(40)
    expect(p.maxBreath).toBe(100)
    expect(p.position.toArray()).toEqual([0, 0, 0])
  })

  it('does not mutate the shrines it is given', () => {
    const shrines = [shrine('home', new Vector3(0, 0, 0))]
    const out = collectStep(player(), shrines, C)
    expect(shrines[0]!.collected).toBe(false)
    expect(out.shrines).not.toBe(shrines)
  })

  it('does not mutate the shrine array when nothing is collected', () => {
    const shrines = [shrine('home', faraway)]
    const out = collectStep(player(), shrines, C)
    expect(out.shrines).not.toBe(shrines)
    expect(shrines[0]!.collected).toBe(false)
  })

  it('carries the rest of the player state through untouched', () => {
    const p = player({ mode: 'glider', velocity: new Vector3(0, -3, 0) })
    const r = collectStep(p, [shrine('home', new Vector3(0, 0, 0))], C)
    expect(r.player.mode).toBe('glider')
    expect(r.player.velocity.toArray()).toEqual([0, -3, 0])
    expect(r.player.position).toBe(p.position)
  })
})
