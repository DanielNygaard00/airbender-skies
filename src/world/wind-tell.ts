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

export function createWindTell(def: WindDef): WindTell {
  const random = seededRandom(
    def.position.x * 73856093 + def.position.y * 19349663 + def.position.z * 83492791 + 7,
  )

  const positions = new Float32Array(MOTE_COUNT * 3)
  // Angles and radii are kept so thermals can spiral rather than rise straight,
  // which is what makes a thermal readable as a thermal from a distance.
  const angles = new Float32Array(MOTE_COUNT)
  const radii = new Float32Array(MOTE_COUNT)
  const heights = new Float32Array(MOTE_COUNT)

  for (let i = 0; i < MOTE_COUNT; i++) {
    angles[i] = random() * Math.PI * 2
    radii[i] = Math.sqrt(random()) * def.radius
    heights[i] = (random() - 0.5) * def.height
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
        switch (def.kind) {
          case 'thermal':
            // Rise and turn: the spiral is the tell.
            heights[i] = wrap(heights[i]! + dt * 9, halfHeight)
            angles[i] = angles[i]! + dt * 0.7
            break
          case 'downdraft':
            heights[i] = wrap(heights[i]! - dt * 11, halfHeight)
            break
          case 'ridge':
            // Drifts up the slope, slower than a thermal and without the turn.
            heights[i] = wrap(heights[i]! + dt * 4, halfHeight)
            break
          case 'river':
            // Reusing height as distance along the current keeps the buffer small.
            heights[i] = wrap(heights[i]! + dt * 26, halfHeight)
            break
          case 'dead':
            // Hangs. A barely-there bob, so it reads as still rather than frozen.
            heights[i] = heights[i]! + Math.sin(elapsed * 0.6 + i) * dt * 0.35
            break
        }
      }
      write()
    },
  }
}

/** Keep a mote inside the column by looping it back to the far end. */
function wrap(value: number, half: number): number {
  if (value > half) return value - half * 2
  if (value < -half) return value + half * 2
  return value
}
