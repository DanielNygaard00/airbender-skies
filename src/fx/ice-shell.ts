import {
  BackSide, MathUtils, Mesh, MeshBasicMaterial, OctahedronGeometry, Vector3,
} from 'three'
import type { Effect } from './effect'

/**
 * The ice on a held soldier, for exactly as long as the hold lasts.
 *
 * **The lifetime is the mechanic.** One is created per soldier caught, with the hold duration the
 * fight actually applied, so the shell is on screen for precisely the window in which that soldier
 * cannot act — the same rule `guard-shell.ts` follows for the Slipstream's 0.11-second
 * invulnerability, and for the same reason: a tell that outlives its mechanic tells the player
 * they are safe when they are not, and here it would tell them a soldier is locked when it is
 * already winding up. Both water moves use this, at their own durations, which is what makes a
 * grip and a freeze read as the same condition held for different lengths of time rather than as
 * two effects.
 *
 * An octahedron rather than a sphere, so it reads as faceted ice rather than as a bubble — the
 * `BackSide` sphere in `guard-shell.ts` is the shape that already means "protected", and the two
 * must not be confused when one is on the player and one is on a soldier a few metres away. Drawn
 * from the inside, like that shell, so the enemy inside it stays visible: the point of §4.6's
 * non-lethality is that the body remains in the world, and a shell that hid it would undo that at
 * the one moment the player is looking straight at it.
 *
 * **Placed once, at the freeze point, and it does not follow the body.** The `Effect` contract is
 * an `Object3D` and an `advance(dt)`, with no hook for tracking a target, and the alternative —
 * parenting a shell to the per-enemy view in `combat/enemy-mesh.ts` — would put the fx layer
 * inside the module that owns enemy rigs. That is the wrong direction architecturally and it is
 * also the module a parallel branch is adding two enemy kinds to. The visible cost is bounded and
 * known: `holdEnemy` deliberately leaves knockback alone, so a soldier frozen while still sliding
 * from an earlier gust drifts out of its shell over roughly `knockback / knockbackDamping`
 * seconds — about 0.4 at the shipped damping — before settling. Freezing a stationary soldier,
 * which is the ordinary case, drifts not at all.
 */

/** Centred on the body, since an enemy's origin is at its feet. Matches the guard shell's. */
const CENTRE_Y = 0.95
/** Comfortably around a 1.8-unit character without swallowing the ground under it. */
const RADIUS = 1.3
/** Nearly white with a blue cast, matching the freeze arc in `water-reach.ts`. */
const TINT = 0xcfeeff
const PEAK_OPACITY = 0.42
/**
 * How long the shell takes to form and to melt, in seconds.
 *
 * Both are a small fraction of the shortest hold the game applies — the grip's 1.2 seconds — so
 * the shell is at full strength for nearly all of even the briefest hold. The melt is what
 * matters for honesty: it starts at the *end* of the hold rather than before it, so the shell is
 * never fading while the soldier is still locked.
 */
const FORM_SECONDS = 0.12
const MELT_SECONDS = 0.25

export function createIceShell(position: Vector3, holdSeconds: number): Effect {
  // A unit octahedron scaled at runtime, so forming costs a scale rather than a rebuild. Detail 1
  // rather than 0: a bare octahedron is eight flat faces and reads as a crystal, but at this size
  // one subdivision is what stops it looking like a die.
  const geometry = new OctahedronGeometry(1, 1)
  const material = new MeshBasicMaterial({
    color: TINT, transparent: true, side: BackSide, depthWrite: false, opacity: 0,
  })

  const mesh = new Mesh(geometry, material)
  // Copied before the offset is applied: the caller hands us an enemy's live position vector, and
  // writing the height into it would teleport the enemy upward. The same trap `createImpact`
  // documents, and the same answer.
  mesh.position.copy(position)
  mesh.position.y += CENTRE_Y
  mesh.userData.excludeFromShadows = true

  // The total life is the hold plus the melt, so the melt is time *added* after the lock ends
  // rather than time taken out of it. A non-positive hold still gets a melt, so a mistuned
  // duration degrades to a brief flash rather than to an effect that never draws.
  const total = Math.max(0, holdSeconds) + MELT_SECONDS
  let age = 0

  function apply(): void {
    const remaining = total - age
    const forming = FORM_SECONDS > 0 ? MathUtils.clamp(age / FORM_SECONDS, 0, 1) : 1
    const melting = MELT_SECONDS > 0 ? MathUtils.clamp(remaining / MELT_SECONDS, 0, 1) : 1
    // The smaller of the two ramps, so a hold shorter than the two ramps together produces a
    // single rise and fall rather than a shell that pops to full and then jumps down.
    const shown = Math.min(forming, melting)
    mesh.scale.setScalar(Math.max(RADIUS * MathUtils.lerp(0.6, 1, forming), 1e-4))
    material.opacity = PEAK_OPACITY * shown
  }

  apply()

  return {
    object: mesh,
    advance(dt: number): boolean {
      age += dt
      apply()
      return age < total
    },
    dispose(): void {
      geometry.dispose()
      material.dispose()
    },
  }
}
