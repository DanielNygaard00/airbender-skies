import {
  BufferAttribute, BufferGeometry, DoubleSide, Group, MathUtils, Mesh, MeshBasicMaterial,
  type Object3D,
} from 'three'
import { createSurface } from '../core/surface'

/**
 * The air scooter, as a board.
 *
 * The design doc calls the scooter "a spinning ball of air Aang rides instead of running", and
 * for a long time it was exactly that in the simulation and nothing at all on screen: riding it
 * doubled the player's speed, halved their turn authority, and drew not one pixel. What the
 * player saw was their character sprinting slightly faster, which is the same failure the grey
 * placeholder character was — a mechanic the fiction never shows.
 *
 * So it is a board now: a deck of compressed air under the feet with nothing holding it up. The
 * ball was the other option and it loses on two counts. A rider balanced on top of a sphere has
 * to be animated balancing, continuously, or they read as impaled on it — and this character
 * pack ships no such clip. A board also gives the feet somewhere definite to stand, which is
 * what makes the borrowed standing pose read as deliberate rather than as a bug.
 *
 * Everything here is presentation. `scooter.ts` still owns whether the scooter is up and what it
 * costs; this module is handed the answer and draws it.
 */

/** Length of the deck, nose to tail. */
const DECK_LENGTH = 0.95
/** Width at the widest point, between the two foot positions. */
const DECK_WIDTH = 0.30
/** How far along the deck the nose and tail taper begins, as a fraction of the half-length. */
const TAPER_AT = 0.62
const DECK_THICKNESS = 0.055

/**
 * How high the deck floats the rider above the ground.
 *
 * The whole point of the thing, and it has to be paid for by lifting the *character*: the
 * simulation puts the player's feet on the terrain, so a board drawn under those feet without
 * raising them would sit in the ground rather than above it, and the hover would be invisible.
 * `avatar.setHover` lifts the body by exactly this, the deck occupies the top of it, and what is
 * left underneath is the gap the effect is made of.
 *
 * Sized against the character rather than chosen: 0.18 is a tenth of the 1.8-unit standing
 * height, which is enough to read as clearance at the follow camera's distance and small enough
 * that the rider's legs still visibly belong to the ground they are crossing. Much more and the
 * character reads as flying, which is a different move that this game already has.
 */
export const HOVER_HEIGHT = 0.18

/** Pale and cold, so the deck reads as compressed air rather than as a plank. */
const DECK_COLOUR = 0xbfe9ff
/** The cushion the deck stands on, warmer and fainter than the deck itself. */
const CUSHION_COLOUR = 0xe8f7ff
const CUSHION_PEAK_OPACITY = 0.5
const DECK_OPACITY = 0.72

/**
 * How far the deck banks into a turn, in radians at full authority.
 *
 * A board leans to steer, so this is the one place the ride's own handling shows in the art. Kept
 * under a tenth of a turn: the deck is drawn beneath a rider whose legs do not bank with it —
 * that would need a clip nothing in the pack has — so a steep lean would separate the feet from
 * the deck they are supposed to be standing on.
 */
const BANK_LIMIT = 0.28

/**
 * How fast the hover bob cycles, and how far.
 *
 * Small and quick. The bob exists so a parked scooter is not a static prop, in the same spirit as
 * the rider's own glide sway; at two centimetres it is under a tenth of the hover it rides on, so
 * the deck never looks like it is about to touch down.
 */
const BOB_RATE = 3.4
const BOB_HEIGHT = 0.02

/**
 * The deck outline: a hexagon, pointed at both ends.
 *
 * A hexagon rather than a box because the taper *is* the silhouette — a board is read by its
 * pointed nose and tail, and a plain box reads as a plank or a step. Rather than a box plus two
 * kicktail meshes, which would be three geometries and two more transforms to keep in step, the
 * whole outline is six vertices in one buffer.
 *
 * Built as a flat plate with no rim, drawn `DoubleSide`. A board seen from a follow camera is
 * only ever viewed from above and from the side at a glancing angle, so extruding a
 * five-centimetre edge would add triangles for a surface that is never more than a line on
 * screen. The thickness the deck appears to have comes from the cushion drawn under it.
 */
function createDeckGeometry(): BufferGeometry {
  const halfLength = DECK_LENGTH / 2
  const halfWidth = DECK_WIDTH / 2
  const shoulder = halfLength * TAPER_AT

  // Nose at +Z, tail at -Z: the board points along the avatar's forward axis, because
  // `avatar.object` is aimed with `lookAt` and three aligns local +Z with the target.
  const nose = [0, 0, halfLength]
  const frontRight = [halfWidth, 0, shoulder]
  const rearRight = [halfWidth, 0, -shoulder]
  const tail = [0, 0, -halfLength]
  const rearLeft = [-halfWidth, 0, -shoulder]
  const frontLeft = [-halfWidth, 0, shoulder]

  // A fan from the nose, which triangulates a convex hexagon without an index buffer.
  const positions = [
    ...nose, ...frontRight, ...rearRight,
    ...nose, ...rearRight, ...tail,
    ...nose, ...tail, ...rearLeft,
    ...nose, ...rearLeft, ...frontLeft,
  ]

  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3))
  geometry.computeVertexNormals()
  geometry.computeBoundingBox()
  return geometry
}

/**
 * The cushion of air the deck stands on: the same outline, wider, drawn just off the ground.
 *
 * Scaled rather than given its own outline so the two shapes cannot drift apart, and kept out of
 * the depth buffer like every other soft tell in the game — it lies within a few centimetres of
 * terrain that is rarely flat, and a depth-tested plane that close reads as flickering shards
 * wherever the ground rises under it.
 */
const CUSHION_SPREAD = 1.35

export interface BoardView {
  object: Object3D
  /**
   * Draw one frame of the board.
   *
   * `active` is the scooter's own `active`, `charge` its accumulator and `bank` a signed -1 to 1
   * steering effort. Takes `dt` rather than a clock so the bob is frame-rate independent.
   */
  update(dt: number, active: boolean, charge: number, bank: number): void
  /** Whether the board is currently drawn, for the caller's own hover offset. */
  visible(): boolean
}

export function createBoard(): BoardView {
  const object = new Group()
  object.name = 'air-board'
  object.visible = false

  const deckMaterial = createSurface('glass', {
    color: DECK_COLOUR,
    transparent: true,
    opacity: DECK_OPACITY,
    side: DoubleSide,
  })
  const deck = new Mesh(createDeckGeometry(), deckMaterial)
  deck.name = 'deck'
  // The deck's top surface sits at the hover height, so the rider standing at that height has
  // their soles on it rather than hovering a further half-thickness above it.
  deck.position.y = HOVER_HEIGHT - DECK_THICKNESS
  object.add(deck)

  const cushionMaterial = new MeshBasicMaterial({
    color: CUSHION_COLOUR,
    transparent: true,
    opacity: CUSHION_PEAK_OPACITY,
    side: DoubleSide,
    depthWrite: false,
    depthTest: false,
  })
  const cushion = new Mesh(createDeckGeometry(), cushionMaterial)
  cushion.name = 'cushion'
  cushion.scale.set(CUSHION_SPREAD, 1, CUSHION_SPREAD)
  cushion.position.y = DECK_THICKNESS
  cushion.userData.excludeFromShadows = true
  object.add(cushion)

  let elapsed = 0

  return {
    object,

    update(dt: number, active: boolean, charge: number, bank: number): void {
      object.visible = active
      // Everything below writes transforms and opacities, so skipping it while hidden is free
      // and keeps a stowed board from accumulating bob time it would pop on next deploy.
      if (!active) {
        elapsed = 0
        return
      }

      elapsed += Number.isFinite(dt) && dt > 0 ? dt : 0

      const bob = Math.sin(elapsed * BOB_RATE) * BOB_HEIGHT
      object.position.y = bob
      object.rotation.z = -MathUtils.clamp(bank, -1, 1) * BANK_LIMIT

      // The cushion brightens with the accumulator, which is the only place the hidden speed
      // tier is visible at all. `scooter.ts` keeps it deliberately hidden from the HUD, so this
      // is a hint rather than a readout: a rider holding a clean line sees the air under them
      // pack tighter, without being given a number to optimise.
      const tier = MathUtils.clamp(charge, 0, 1)
      cushionMaterial.opacity = CUSHION_PEAK_OPACITY * (0.55 + 0.45 * tier)
    },

    visible(): boolean {
      return object.visible
    },
  }
}
