import { describe, it, expect } from 'vitest'
import { Vector3 } from 'three'
import { influenceAt, sampleWind, stillAir, type WindDef } from './wind'

const CENTRE = new Vector3(0, 100, 0)
const NORTH = new Vector3(0, 0, -1)
const EAST = new Vector3(1, 0, 0)

const thermal = (over: Partial<WindDef> = {}): WindDef => ({
  kind: 'thermal', position: CENTRE.clone(), radius: 40, height: 200, strength: 12, ...over,
})

describe('influenceAt', () => {
  it('is strongest at the core', () => {
    expect(influenceAt(thermal(), CENTRE)).toBeCloseTo(1, 6)
  })

  it('is nothing outside the rim', () => {
    expect(influenceAt(thermal(), new Vector3(41, 100, 0))).toBe(0)
  })

  it('is nothing above or below', () => {
    expect(influenceAt(thermal(), new Vector3(0, 201, 0))).toBe(0)
    expect(influenceAt(thermal(), new Vector3(0, -1, 0))).toBe(0)
  })

  it('fades smoothly rather than switching off at the edge', () => {
    // A hard boundary would flick lift on and off as the player drifted, which
    // reads as a bug instead of as terrain.
    const near = influenceAt(thermal(), new Vector3(10, 100, 0))
    const far = influenceAt(thermal(), new Vector3(30, 100, 0))
    expect(near).toBeGreaterThan(far)
    expect(far).toBeGreaterThan(0)
  })
})

describe('thermals', () => {
  it('lift regardless of which way the glider points', () => {
    // Circling inside one is the intended way to climb, so heading must not matter.
    const north = sampleWind([thermal()], CENTRE, NORTH).accel.y
    const east = sampleWind([thermal()], CENTRE, EAST).accel.y
    expect(north).toBeCloseTo(east, 6)
    expect(north).toBeGreaterThan(0)
  })

  it('let the glider climb without spending breath', () => {
    // The whole point: lift the player did not have to pay for.
    expect(sampleWind([thermal()], CENTRE, NORTH).accel.y).toBeGreaterThan(0)
  })
})

describe('downdrafts', () => {
  it('push the glider down', () => {
    const def = thermal({ kind: 'downdraft' })
    expect(sampleWind([def], CENTRE, NORTH).accel.y).toBeLessThan(0)
  })
})

describe('ridge lift', () => {
  const ridge = thermal({ kind: 'ridge', axis: new Vector3(0, 0, 1) })

  it('rewards flying along the face', () => {
    expect(sampleWind([ridge], CENTRE, NORTH).accel.y).toBeGreaterThan(0)
  })

  it('gives nothing for flying straight at it', () => {
    expect(sampleWind([ridge], CENTRE, EAST).accel.y).toBeCloseTo(0, 6)
  })

  it('works in both directions along the ridge', () => {
    // Ridge lift is a road, not a one-way street.
    const north = sampleWind([ridge], CENTRE, NORTH).accel.y
    const south = sampleWind([ridge], CENTRE, new Vector3(0, 0, 1)).accel.y
    expect(north).toBeCloseTo(south, 6)
  })

  it('ignores climb and dive when judging alignment', () => {
    const diving = sampleWind([ridge], CENTRE, new Vector3(0, -3, -1)).accel.y
    const level = sampleWind([ridge], CENTRE, NORTH).accel.y
    expect(diving).toBeCloseTo(level, 6)
  })
})

describe('wind rivers', () => {
  const river = thermal({ kind: 'river', axis: new Vector3(0, 0, -1), strength: 30 })

  it('carry a glider that enters aligned', () => {
    const carried = sampleWind([river], CENTRE, NORTH).accel
    expect(carried.z).toBeLessThan(0)
    expect(carried.length()).toBeGreaterThan(0)
  })

  it('barely touch a glider crossing it', () => {
    expect(sampleWind([river], CENTRE, EAST).accel.length()).toBeCloseTo(0, 6)
  })

  it('do not shove a glider backwards for flying against the current', () => {
    // Unhelpful, not punishing: a reverse thrust would feel like a bug.
    const against = sampleWind([river], CENTRE, new Vector3(0, 0, 1)).accel
    expect(against.length()).toBeCloseTo(0, 6)
  })

  it('push along their own axis rather than along the heading', () => {
    const angled = sampleWind([river], CENTRE, new Vector3(0.6, 0, -0.8).normalize()).accel
    expect(Math.abs(angled.x)).toBeCloseTo(0, 6)
  })
})

describe('dead air', () => {
  const dead = thermal({ kind: 'dead' })

  it('removes the wing\'s lift entirely at the core', () => {
    // "No lift at all. Breath-only flying."
    expect(sampleWind([dead], CENTRE, NORTH).liftScale).toBeCloseTo(0, 6)
  })

  it('adds no acceleration of its own', () => {
    expect(sampleWind([dead], CENTRE, NORTH).accel.length()).toBeCloseTo(0, 6)
  })

  it('beats an overlapping thermal instead of averaging with it', () => {
    // A region that kills lift is a claim about the whole volume. Averaging would
    // silently turn a dead-air boss arena into a mild updraft.
    const sample = sampleWind([dead, thermal()], CENTRE, NORTH)
    expect(sample.liftScale).toBeCloseTo(0, 6)
  })
})

describe('sampling the whole field', () => {
  it('leaves the glider alone outside every feature', () => {
    const sample = sampleWind([thermal()], new Vector3(500, 100, 500), NORTH)
    expect(sample.accel.length()).toBe(0)
    expect(sample.liftScale).toBe(1)
  })

  it('adds overlapping lift rather than picking a winner', () => {
    const one = sampleWind([thermal()], CENTRE, NORTH).accel.y
    const two = sampleWind([thermal(), thermal()], CENTRE, NORTH).accel.y
    expect(two).toBeCloseTo(one * 2, 6)
  })

  it('reports still air for an empty field', () => {
    expect(sampleWind([], CENTRE, NORTH)).toEqual(stillAir())
  })
})
