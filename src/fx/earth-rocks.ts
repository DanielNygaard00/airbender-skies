import {
  Group, IcosahedronGeometry, MathUtils, Mesh, Vector3, type MeshStandardMaterial,
} from 'three'
import { stoneShape, type EarthConfig } from '../combat/earth'
import { createSurface } from '../core/surface'
import type { Effect } from './effect'

/**
 * The rocks a Stone Throw actually throws.
 *
 * `earth-reach.ts` draws the ground the move covers and argues at length for doing it honestly —
 * a filled sector at the true reach, because a hit landing outside the drawn shape teaches the
 * wrong spacing. That argument still holds and that effect still runs. What it never did was show
 * the *move*: a flat tan wedge on green grass is a statement about area, and the player reads it
 * as a stain rather than as a rock leaving someone's hands. Earth was the one element whose
 * fiction is a solid object, and it was the one element drawing nothing solid.
 *
 * So this is a volley of real geometry: lit, shadow-casting rocks on ballistic arcs, tumbling as
 * they go. It is deliberately *not* a shader tell, and that is the whole point — the other
 * elements are light and fluid and belong in `effect-material.ts`'s world of transparent bodies
 * with collars, while earth is mass. A rock that catches the same sun as the terrain, throws the
 * same shadow and falls under the same gravity is doing something no amount of shader work on a
 * flat sector can.
 *
 * Built from `IcosahedronGeometry` at detail 0, which is what `world/props.ts` builds the
 * terrain's own boulders from. Matching the world's rock rather than inventing a new one is the
 * argument: these are supposed to be pieces of the ground the player is standing on, and a
 * smoother or busier rock would read as debris from somewhere else.
 */

/**
 * How long the volley lives.
 *
 * Longer than `earth-reach.ts`'s 0.26, and the two are not in competition: the sector states the
 * reach and is gone, while the rocks are the event and have to travel far enough to be seen
 * travelling. A rock that vanishes a quarter of a second after leaving the hand has not been
 * thrown, it has been deleted.
 *
 * It does not outlast anything the simulation cares about. The throw's damage resolves on the
 * frame it fires, so every one of these rocks is already after the fact — which is the same
 * licence every impact burst in `impact.ts` takes, and for the same reason: the player reads the
 * consequence, not the frame the number changed on.
 */
const LIFETIME = 0.62

/** How many rocks come out. Enough to read as a volley, few enough to tell apart in flight. */
const COUNT = 7

/** Chest height on a 1.8-unit character: thrown from the hands, not scuffed off the floor. */
const LAUNCH_HEIGHT = 1.15

/**
 * The spread of rock sizes, in world units of radius.
 *
 * A range rather than one size, because a volley of identical rocks reads as a manufactured
 * object rather than as torn-up ground.
 *
 * Sized against the distance they are read from rather than against the caster's hands. The
 * fight happens at twenty to fifty metres — the bench shoots this cone from twenty — and the
 * first pass at a tenth of a metre was physically sensible and visually gravel: a scatter of
 * specks that read as kicked-up dirt rather than as the game's only armour-breaker. Four tenths
 * is still comfortably smaller than the soldier it is aimed at, so it does not raise the question
 * of where it came from, and it is large enough to hold a silhouette at the range that matters.
 */
const MIN_RADIUS = 0.2
const MAX_RADIUS = 0.42

/**
 * How high the volley arcs, as a fraction of the throw's own range.
 *
 * Small. The stone throw has a `verticalReach` and is aimed along a flat cone, so a rock that
 * lobbed like a mortar would land outside the shape `earth-reach.ts` has just promised. This is
 * enough curve to read as thrown under gravity rather than fired from a rail, and no more.
 */
const ARC_FRACTION = 0.14

/** Gravity, matched to the arc rather than to the world: see `velocityFor`. */
const GRAVITY = 26

/**
 * Rock colours, sampled from the same warm-to-cold browns the terrain's cliffs use.
 *
 * Unlike every other effect in `src/fx`, these are *not* chosen to separate from the terrain —
 * they are chosen to belong to it. A magenta rock would certainly be visible; it would also stop
 * being a rock. What makes these read against the grass is that they are lit solids with
 * shadows moving quickly across a flat field, which is a different channel from colour entirely.
 */
const COLOURS = [0x6b5844, 0x7d6a52, 0x5a4a3a, 0x8a7560]

/**
 * A deterministic value in [0, 1) from a rock's index and a channel number.
 *
 * Deliberately not `Math.random()`, and this is load-bearing rather than tidiness: `src/bench`
 * photographs these effects by running a fixed clock to a fixed time and expects the same image
 * every run, and `clock.ts` exists precisely so those shots are comparable. One call to the
 * global random here would make every bench shot of an earth throw differ from the last, which
 * would quietly destroy the tool used to check it. The same reason `encounter.ts` counts ids
 * rather than rolling them.
 *
 * A hash rather than a seeded generator because there is no sequence to keep: each rock wants a
 * few uncorrelated numbers from its own index, and threading a generator through would add state
 * for nothing.
 */
function scatter(index: number, channel: number): number {
  const x = Math.sin(index * 12.9898 + channel * 78.233) * 43758.5453
  return x - Math.floor(x)
}

/**
 * The launch velocity for one rock.
 *
 * Solved rather than tuned. The horizontal speed is whatever carries a rock its share of the
 * range within `LIFETIME`, so the volley fills the cone `earth-reach.ts` drew in the time it has
 * — retune the throw's range in `config.ts` and the rocks still land where the sector says. The
 * vertical component is then whatever lifts it `ARC_FRACTION` of that range at the top of its
 * flight under `GRAVITY`, which is what makes the arc a property of the throw rather than a
 * number somebody liked.
 *
 * `GRAVITY` is local rather than the world's, and that is the one honest cheat here. These rocks
 * are not simulated by anything — nothing collides with them and nothing hits on them — so the
 * only job the constant has is to shape a curve that reads as weight over two thirds of a
 * second. The world's own gravity over that span would drop them barely at all at these speeds.
 */
function velocityFor(
  forward: Vector3, right: Vector3, index: number, range: number, halfAngle: number,
): Vector3 {
  // Spread across the cone, with the ends of the fan slightly short of its edge: a rock exactly
  // on the boundary reads as having escaped the shape rather than as defining it.
  const across = COUNT > 1 ? (index / (COUNT - 1)) * 2 - 1 : 0
  const angle = across * halfAngle * 0.88
  // Each rock takes a different share of the range, so the volley lands as a scatter rather than
  // as a rank. Never under half, or the near rocks read as dropped.
  const reach = range * (0.55 + 0.45 * scatter(index, 0))

  const horizontal = new Vector3()
    .copy(forward).multiplyScalar(Math.cos(angle))
    .addScaledVector(right, Math.sin(angle))
    .multiplyScalar(reach / LIFETIME)

  const peak = range * ARC_FRACTION * (0.7 + 0.6 * scatter(index, 1))
  return horizontal.setY(Math.sqrt(2 * GRAVITY * peak))
}

export function createEarthRocks(
  at: Vector3, forward: Vector3, c: EarthConfig,
): Effect {
  const { range, halfAngle } = stoneShape(c)
  const object = new Group()
  object.name = 'earth-rocks'
  object.position.copy(at)

  // Flattened to the horizon, because the cone the simulation tests is horizontal: a player
  // looking down a slope would otherwise throw their rocks into the ground short of the reach the
  // sector has just drawn.
  const flat = new Vector3(forward.x, 0, forward.z)
  if (flat.lengthSq() < 1e-6) flat.set(0, 0, 1)
  flat.normalize()
  // The cone's own right-hand axis: forward crossed with world up.
  const right = new Vector3(-flat.z, 0, flat.x)

  const rocks: {
    mesh: Mesh
    velocity: Vector3
    spin: Vector3
    material: MeshStandardMaterial
  }[] = []

  for (let i = 0; i < COUNT; i++) {
    const radius = MathUtils.lerp(MIN_RADIUS, MAX_RADIUS, scatter(i, 2))
    const geometry = new IcosahedronGeometry(radius, 0)
    // Squashed on its own axes so no two rocks are the same solid, the way `props.ts` squashes
    // the terrain's boulders rather than shipping spheres.
    geometry.scale(
      1, MathUtils.lerp(0.7, 1.05, scatter(i, 3)), MathUtils.lerp(0.8, 1.25, scatter(i, 4)),
    )

    const material = createSurface('stone', {
      color: COLOURS[i % COLOURS.length],
      transparent: true,
      opacity: 1,
    })
    const mesh = new Mesh(geometry, material)
    mesh.position.y = LAUNCH_HEIGHT
    mesh.castShadow = true
    object.add(mesh)

    rocks.push({
      mesh,
      material,
      velocity: velocityFor(flat, right, i, range, halfAngle),
      // Tumbling, and fast: a rock that drifts round one axis reads as floating. Signed off the
      // scatter so the volley turns in both directions.
      spin: new Vector3(
        (scatter(i, 5) - 0.5) * 22,
        (scatter(i, 6) - 0.5) * 22,
        (scatter(i, 7) - 0.5) * 22,
      ),
    })
  }

  let elapsed = 0

  return {
    object,

    advance(dt: number): boolean {
      const step = Number.isFinite(dt) && dt > 0 ? dt : 0
      elapsed += step
      if (elapsed >= LIFETIME) return false

      for (const rock of rocks) {
        rock.velocity.y -= GRAVITY * step
        rock.mesh.position.addScaledVector(rock.velocity, step)
        rock.mesh.rotation.x += rock.spin.x * step
        rock.mesh.rotation.y += rock.spin.y * step
        rock.mesh.rotation.z += rock.spin.z * step
      }

      // Faded only over the last third, so the volley is solid for the part of its flight the
      // player is reading and gone before it can be seen sinking through the terrain. A rock
      // that fades from the moment it leaves the hand never looks thrown, it looks summoned and
      // then cancelled.
      const life = elapsed / LIFETIME
      const opacity = life < 0.66 ? 1 : 1 - (life - 0.66) / 0.34
      for (const rock of rocks) rock.material.opacity = MathUtils.clamp(opacity, 0, 1)

      return true
    },

    dispose(): void {
      for (const rock of rocks) {
        rock.mesh.geometry.dispose()
        rock.material.dispose()
      }
    },
  }
}
