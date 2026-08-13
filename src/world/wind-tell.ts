import {
  AdditiveBlending, BufferAttribute, BufferGeometry, Color, Group,
  Points, PointsMaterial, Vector3,
} from 'three'
import type { WindDef, WindKind } from './wind'

/**
 * The visible tell for a wind feature.
 *
 * The design doc's rule for artists is that a wind feature the player cannot see is
 * a bug, not a puzzle — wind is the world's most important invisible object, so it
 * has to be made visible. Each kind gets motes that move the way that wind moves:
 * dust spiralling up a thermal, streamers running down a river, mist falling
 * through a downdraft, and hanging haze that goes nowhere in dead air.
 */
// Enough motes that a column reads as a column from a distance. At 90 a feature
// 55 units across and 240 tall was so sparse it looked like stray specks, which
// fails the rule it exists to satisfy.
const MOTE_COUNT = 180

/** Rough colour language: warm for lift, cold for sink, pale for nothing. */
const TINT: Record<WindKind, number> = {
  thermal: 0xffe2a8,
  ridge: 0xd8f0c0,
  river: 0xcfe6ff,
  downdraft: 0xbfd0dc,
  dead: 0xdcdcd2,
}

/**
 * Mote size in world units. Deliberately small: PointsMaterial draws
 * screen-facing squares, so anything approaching a couple of units reads as a
 * white block the moment the camera gets near it rather than as dust in the air.
 */
const SIZE: Record<WindKind, number> = {
  thermal: 0.55, ridge: 0.5, river: 0.75, downdraft: 0.55, dead: 0.45,
}

export interface WindTell {
  object: Group
  /** Drift the motes. Pure animation: nothing here feeds back into flight. */
  advance(dt: number): void
}

/**
 * Whether a world point is in air rather than inside terrain.
 *
 * Optional, and the reason it exists is Canyon Country. A feature's `radius` is its *field* —
 * how far the lift or the dead air reaches — and in a slot canyon that is deliberately wider
 * than the slot, so the whole corridor lifts and the effect fades at the rim. The motes were
 * scattered across that same radius, which put most of them inside the rock walls: measured on
 * the shipped level, 46 to 73 per cent of every ridge and dead-air feature's motes were
 * underground, wasted, while the level's own comment claimed they "fill the slot where the
 * player can see them instead of hanging inside the rock". Of the motes that *were* in open air,
 * 77 to 96 per cent were already visible from the corridor floor, so nothing was hidden — the
 * tell was simply drawing most of itself where nobody could be.
 *
 * Passing this lets the scatter hug the air. Leaving it out keeps the old behaviour exactly, so
 * a caller with no terrain to consult — every test in this file, and any level whose features
 * stand in the open — is unaffected.
 *
 * Measured on Canyon Country after thirty seconds of animation: motes inside rock fell from 31-77
 * per cent per feature to at most 10, and the fraction visible from the floor of each feature's own
 * room rose from a worst of 0.194 to a worst of 0.628. That worst case is now the amphitheatre lid,
 * which sits partly behind the caps from the floor below and is meant to — so every feature on the
 * level clears the 60 per cent the artist rule asks for. On the archipelago every feature keeps its
 * full reach and none is worse than before: the dead air slung under an island went from 6 per cent
 * of its motes in rock to none.
 *
 * **What it does not fix.** A thermal turns its motes as they rise (`angles[i] += dt`) while keeping
 * each radius, so one can rotate out of air and into stone over time — a mote's floor follows it,
 * its azimuth does not. Neither region has a thermal standing close enough to rock for it to show,
 * and fixing it would mean re-testing positions inside `advance` every frame.
 */
export type OpenAir = (x: number, y: number, z: number) => boolean

/** Heights probed up a mote's own column to find the lowest air in it. */
const OPEN_STEPS = 6
/** Positions tried per mote before one is accepted wherever it landed. */
const OPEN_TRIES = 6

/**
 * Deterministic scatter, so a level looks the same on every load. Seeded from the
 * feature's own position rather than Math.random, which would also break the
 * repeatability the rest of the world build relies on.
 */
function seededRandom(seed: number): () => number {
  let state = Math.abs(Math.floor(seed)) % 2147483647 || 1
  return () => {
    state = (state * 48271) % 2147483647
    return state / 2147483647
  }
}

export function createWindTell(def: WindDef, openAir?: OpenAir): WindTell {
  const random = seededRandom(
    def.position.x * 73856093 + def.position.y * 19349663 + def.position.z * 83492791 + 7,
  )

  const positions = new Float32Array(MOTE_COUNT * 3)
  // Angles and radii are kept so thermals can spiral rather than rise straight,
  // which is what makes a thermal readable as a thermal from a distance.
  const angles = new Float32Array(MOTE_COUNT)
  const radii = new Float32Array(MOTE_COUNT)
  const heights = new Float32Array(MOTE_COUNT)

  /**
   * The lowest local height each mote is allowed to reach, so none of them ends up under the floor.
   *
   * The azimuth clamp above keeps motes out of the *walls*; this keeps them off the ground, and the
   * two are separate problems with separate answers. Dead air is the case that needs it: its field
   * is centred low on purpose — so no live air is left in the pockets along the wall bases — which
   * puts the bottom half of its 34-unit band under the canyon crown. Radial clamping cannot help,
   * because those motes are not beyond a wall, they are beneath the floor.
   *
   * Found per mote rather than per feature, since the canyon floor undulates by 11 metres along the
   * corridor and a single floor for a 22-unit-wide column would be wrong at one end or the other.
   * Each column is walked from the bottom of the band upward until the air opens, which is the same
   * shape as the azimuth walk and costs the same handful of probes.
   */
  const floors = new Float32Array(MOTE_COUNT).fill(-def.height / 2)

  for (let i = 0; i < MOTE_COUNT; i++) {
    let angle = 0
    let radius = 0
    let height = 0
    // Rejection sampling, and the reason it is not a radial clamp is worth keeping. Walking each
    // azimuth outward from the centre and stopping at the first rock assumes the air is near the
    // axis and the stone is beyond it, which is true of a canyon slot and exactly inverted for the
    // archipelago's dead air, which is slung under an island with the spike down its middle. That
    // version dragged those motes inward into the rock and measured worse than no clamp at all.
    // Sampling the whole position and keeping the first one that lands in air assumes nothing about
    // which side the stone is on.
    for (let attempt = 0; attempt <= OPEN_TRIES; attempt++) {
      angle = random() * Math.PI * 2
      radius = Math.sqrt(random()) * def.radius
      height = (random() - 0.5) * def.height
      if (!openAir) break
      if (openAir(
        def.position.x + Math.cos(angle) * radius,
        def.position.y + height,
        def.position.z + Math.sin(angle) * radius,
      )) break
      // Out of attempts: this position stands. It is what the mote would have been without any of
      // this, so a feature with no air in it draws exactly as it used to rather than worse — and a
      // feature with no air in it is a level-authoring mistake for the visibility measurement in
      // `canyon-country.test.ts` to catch, not for this clamp to signal.
    }
    angles[i] = angle
    radii[i] = radius

    if (openAir) {
      // The lowest height this mote may return to, scanned from the bottom of the band up. Rising
      // kinds wrap, so without this a ridge would carry its motes back under the floor within a
      // few seconds of the clamp above having lifted them off it. Scanning from the bottom is
      // topology-agnostic in the way the azimuth walk was not: it finds the lowest air there is,
      // whether the rock is above it, below it, or both.
      const x = def.position.x + Math.cos(angle) * radius
      const z = def.position.z + Math.sin(angle) * radius
      for (let s = 0; s <= OPEN_STEPS; s++) {
        const candidate = -def.height / 2 + (s / OPEN_STEPS) * def.height
        if (openAir(x, def.position.y + candidate, z)) { floors[i] = candidate; break }
      }
    }
    // No clamp against the floor here, deliberately. An accepted position is in open air, and the
    // floor is the *lowest* open height in that same column, so an accepted height cannot be below
    // it — the clamp was there and did nothing, which a mutation check showed by surviving. When
    // sampling ran out of attempts instead, the fallback above says the position stands, and
    // clamping it would contradict that.
    heights[i] = height
  }

  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(positions, 3))

  const material = new PointsMaterial({
    color: new Color(TINT[def.kind]),
    size: SIZE[def.kind],
    sizeAttenuation: true,
    transparent: true,
    opacity: def.kind === 'dead' ? 0.35 : 0.6,
    depthWrite: false,
    // Additive so motes read as light in air rather than as solid specks, and so
    // they never look like geometry the player could land on.
    blending: AdditiveBlending,
  })

  const points = new Points(geometry, material)
  points.frustumCulled = false
  const object = new Group()
  object.add(points)
  object.position.copy(def.position)
  // Wind is not a surface: it must never cast or catch a shadow.
  object.userData.excludeFromShadows = true

  const axis = def.axis ? new Vector3(def.axis.x, 0, def.axis.z).normalize() : new Vector3()
  const halfHeight = def.height / 2
  let elapsed = 0

  function write(): void {
    for (let i = 0; i < MOTE_COUNT; i++) {
      const angle = angles[i]!
      const radius = radii[i]!
      let x = Math.cos(angle) * radius
      let z = Math.sin(angle) * radius
      const y = heights[i]!

      if (def.kind === 'river') {
        // Strung out along the current, so the corridor's direction is legible.
        x += axis.x * y * 1.6
        z += axis.z * y * 1.6
      }
      positions[i * 3] = x
      positions[i * 3 + 1] = y
      positions[i * 3 + 2] = z
    }
    geometry.attributes.position!.needsUpdate = true
  }

  write()

  return {
    object,
    advance(dt: number): void {
      elapsed += dt
      for (let i = 0; i < MOTE_COUNT; i++) {
        // Each mote loops back to its own floor rather than to the bottom of the band, so a kind
        // that rises cannot carry a mote underground on the way round. Clamping only at
        // construction would have fixed the first frame and nothing after it: a ridge lifts its
        // motes at 4 units a second and wraps them, so within a few seconds every one of them
        // would have been back under the floor the clamp had just lifted it off.
        const floor = floors[i]!
        switch (def.kind) {
          case 'thermal':
            // Rise and turn: the spiral is the tell.
            heights[i] = wrap(heights[i]! + dt * 9, halfHeight, floor)
            angles[i] = angles[i]! + dt * 0.7
            break
          case 'downdraft':
            heights[i] = wrap(heights[i]! - dt * 11, halfHeight, floor)
            break
          case 'ridge':
            // Drifts up the slope, slower than a thermal and without the turn.
            heights[i] = wrap(heights[i]! + dt * 4, halfHeight, floor)
            break
          case 'river':
            // Reusing height as distance along the current keeps the buffer small.
            heights[i] = wrap(heights[i]! + dt * 26, halfHeight, floor)
            break
          case 'dead':
            // Hangs. A barely-there bob, so it reads as still rather than frozen. The bob
            // integrates to well under a unit, so the floor only has to catch it, not fight it.
            heights[i] = Math.max(heights[i]! + Math.sin(elapsed * 0.6 + i) * dt * 0.35, floor)
            break
        }
      }
      write()
    },
  }
}

/**
 * Keep a mote inside the column by looping it back to the far end.
 *
 * `floor` is where the bottom of this mote's own column is — the band's bottom when no open-air
 * test was given, and otherwise the lowest height at its position that is not inside rock. A mote
 * leaving the top reappears there rather than at the nominal bottom, which is what keeps a rising
 * kind from cycling its motes back underground.
 */
function wrap(value: number, half: number, floor: number): number {
  if (value > half) return floor
  if (value < floor) return half
  return value
}
