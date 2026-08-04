import {
  Group, Mesh, MeshBasicMaterial, PlaneGeometry, type Object3D, type Quaternion,
} from 'three'
import { healthFraction, isDowned, type Health } from './health'

/**
 * A health bar above a combatant's head.
 *
 * Takes a `Health` and a camera rotation, and knows nothing about enemies — which is what
 * keeps it testable without one, and what would let the same bar sit over anything else
 * with health.
 *
 * It owns its geometry and materials, so `dispose` is part of the contract for the same
 * reason it is on `Effect` in `src/fx/effect.ts`: one exists per combatant.
 */
export interface HealthBar {
  object: Object3D
  /**
   * Camera rotation is copied as a LOCAL rotation. The bar must be parented to something
   * unrotated; a rotating parent composes with it and the bar stops facing the camera.
   */
  update(health: Health, cameraQuaternion: Quaternion): void
  dispose(): void
}

const WIDTH = 0.9
const HEIGHT = 0.11
/** Clears the body capsule, whose top is at 1.7, without floating free of the head. */
const HEIGHT_ABOVE_FEET = 2
const TRACK_COLOR = 0x1b1f24
const TRACK_OPACITY = 0.55
/**
 * A cooler red than the player's own bar, which runs #ff8f6b to #ffd0a8, so a glance
 * never reads an enemy's health as the player's.
 */
const FILL_COLOR = 0xe4614a
/** In front of the track, so the two do not z-fight. */
const FILL_OFFSET = 0.001
/** A zero scale is a degenerate matrix, so the fill keeps a sliver. */
const MIN_SCALE = 1e-4

/**
 * Shown once damaged, hidden when downed.
 *
 * Hidden at full health for the same reason `hudModelFor` hides the player's bar there:
 * a meter with nothing to say is clutter. Hidden when downed because a body lying flat
 * already says it is out of the fight, and a bar over every past fight would never leave.
 *
 * Calls `isDowned` rather than restating `current <= 0`, so there is one definition of
 * downed in the codebase.
 */
export function healthBarVisible(h: Health): boolean {
  return !isDowned(h) && h.current < h.max
}

export function createHealthBar(): HealthBar {
  const object = new Group()
  object.name = 'health-bar'
  object.position.y = HEIGHT_ABOVE_FEET

  const trackGeometry = new PlaneGeometry(WIDTH, HEIGHT)
  // Terrain hides a bar drawn over a hill, preventing the player from finding an enemy
  // by its health bar alone. Unlike src/fx/, where every effect hides behind terrain.
  const trackMaterial = new MeshBasicMaterial({
    color: TRACK_COLOR, transparent: true, opacity: TRACK_OPACITY, depthWrite: false, depthTest: true,
  })
  const track = new Mesh(trackGeometry, trackMaterial)
  track.name = 'track'
  track.userData.excludeFromShadows = true

  // The fill's origin is moved to its left edge, so scaling x empties it from the right
  // rather than shrinking it toward its middle from both sides.
  const fillGeometry = new PlaneGeometry(WIDTH, HEIGHT).translate(WIDTH / 2, 0, 0)
  const fillMaterial = new MeshBasicMaterial({ color: FILL_COLOR, depthTest: true })
  const fill = new Mesh(fillGeometry, fillMaterial)
  fill.name = 'fill'
  fill.position.set(-WIDTH / 2, 0, FILL_OFFSET)
  fill.userData.excludeFromShadows = true

  object.add(track)
  object.add(fill)

  return {
    object,
    update(health: Health, cameraQuaternion: Quaternion): void {
      object.visible = healthBarVisible(health)
      fill.scale.x = Math.max(healthFraction(health), MIN_SCALE)
      // Copied whole rather than yaw-only: the camera looks down at the player, and a
      // yaw-only bar would lean away from it.
      object.quaternion.copy(cameraQuaternion)
    },
    dispose(): void {
      trackGeometry.dispose()
      trackMaterial.dispose()
      fillGeometry.dispose()
      fillMaterial.dispose()
    },
  }
}
