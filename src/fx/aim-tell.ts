import {
  BufferAttribute, BufferGeometry, Color, Group, Mesh, Vector3,
  type Object3D,
} from 'three'
import type { ConeShape } from '../combat/cone'
import { createEffectMaterial, WEDGE_PREAMBLE } from './effect-material'
import { SECTOR_FLAT_ROTATION_X, sectorGeometry } from './sector'
import { DEFAULT_AIM_TELL_CONFIG, type AimTellConfig } from './config'
import { safeScale } from './scale'

/**
 * Just above the ground.
 *
 * Not for z-fighting — both materials below set `depthTest: false`, so the GPU never compares
 * these fragments against the depth buffer and z-fighting cannot happen regardless of this
 * value. This is about the camera angle instead: at the shallow angle this game mostly plays
 * at, a flat shape sitting exactly at the player's feet is a shape seen edge-on, the same
 * reason `createVortexChargeTell` lifts its ring by 0.5.
 */
const HEIGHT = 0.08
const TINT = 0x7fe4ff
const MARKER_OPACITY = 0.5

/**
 * Where a gust will go, shown before it is thrown.
 *
 * Persistent rather than an `Effect` because it lives as long as the player does, which is
 * not a one-shot — the same reason `createVortexChargeTell` is shaped this way.
 *
 * Aimed from the simulation's `player.forward`, and parented to the scene rather than to the
 * avatar. Parenting would inherit the facing for free, but the avatar is rotated from the
 * *interpolated* heading, and a tell for a hit volume has to read the value the hit reads.
 */
export interface AimTell {
  object: Object3D
  /**
   * Call every frame. `targeted` is whether a live soldier is inside the cone; `ready` is
   * whether the move is off cooldown.
   *
   * Takes a `ConeShape` rather than a `GustConfig`, which is a widening and not a change:
   * `GustConfig` satisfies `ConeShape` structurally, so the original caller is unaffected. The
   * reason for it is that F is no longer one move — the active element decides whether it throws
   * a gust or a Water Grip, and those two cones differ in both range and half angle. Asking for
   * the shape rather than one move's whole config is what lets one tell preview whichever is
   * about to be thrown, and it is why the conditional geometry rebuild below now genuinely
   * fires rather than being purely defensive.
   */
  update(
    position: Vector3, forward: Vector3, targeted: boolean, ready: boolean, c: ConeShape,
  ): void
  dispose(): void
}

/**
 * A flat chevron pointing along local +Z.
 *
 * A chevron rather than a bar or a dot because it carries a direction on its own, so it still
 * reads at the shallow camera angle this game mostly plays at, where a bar foreshortens into
 * a line and a dot says nothing.
 */
function createChevronGeometry(size: number): BufferGeometry {
  const geometry = new BufferGeometry()
  const halfWidth = size * 0.6
  const tailZ = -size * 0.4
  geometry.setAttribute('position', new BufferAttribute(new Float32Array([
    0, 0, size,
    -halfWidth, 0, tailZ,
    halfWidth, 0, tailZ,
  ]), 3))
  geometry.computeVertexNormals()
  return geometry
}

/**
 * The chevron, shaded from object space because its geometry has no texture coordinates.
 *
 * `createChevronGeometry` sets a `position` attribute and nothing else, so `vUv` is zero across
 * every fragment and a gradient written against it renders as a flat fill that looks like a
 * choice. `vLocal.z` is the one axis a direction marker has any business varying along — but it
 * does not run -1..1: the geometry above bakes `size` straight into the vertex positions, with
 * the point at `+size` and the tail at `-size * 0.4`, so `vLocal.z` spans `-size * 0.4` to
 * `+size`. Dividing by the `size` uniform (the same `c.markerSize` the geometry was built with)
 * recovers -0.4..1.0, which is what the bounds below assume. Brightest at the point, so the
 * chevron reads as pointing rather than as a triangle.
 *
 * No clock. A tell that animates is a tell competing with the move it predicts.
 */
const MARKER_BODY = /* glsl */ `
    float toPoint = smoothstep(-0.4, 1.0, vLocal.z / max(size, 1e-4));
    gl_FragColor = vec4(tint, alpha * (0.45 + 0.55 * toPoint));
`

/**
 * The preview, edged rather than filled.
 *
 * A flat 0.14-opacity sector says "somewhere around here". The reach is the fact the player
 * needs, so the edge carries the value and the interior stays nearly empty — which also keeps
 * the tell from competing with the gust that follows it into the same space.
 *
 * **This body draws no collar, unlike the other cases that reach for `radius`.** `radius` is
 * already in scope here via `WEDGE_PREAMBLE` — unlike `mud.ts` and `steam.ts`, whose own
 * exemptions turn on having no radius coordinate to band at all, this preview could carve one out
 * exactly the way `water-reach.ts`'s `ARC_BODY` and `fire-burst.ts`'s own version do, where that
 * pattern is argued in full. It declines anyway, for a reason specific to what a tell is rather
 * than to what geometry it has: this is a preview of a move not yet thrown, not an event that
 * happened, and a dark band inside a fill this faint (0.14) would not read as contrast — it would
 * just be more of the same near-invisible interior. `steam.ts`'s own comment says more about why
 * this directory carries more than one such exemption and why none of them are counted.
 *
 * **Reaches for `WEDGE_PREAMBLE` anyway, even though this body never touches its `across`.**
 * Both previewable cones — the gust's 60 degrees and the Water Grip's 30 — are inside
 * `sectorUvIsMonotone`'s bound, so bare `vUv.x` would work here just as well as `radius` does.
 * The preamble is used regardless so this file and `staff-arc-fx.ts` reach for the same
 * coordinate on the same geometry, and so a future move previewed through this same tell with a
 * wider cone cannot quietly break it the way a bare `vUv.x` would past a quarter turn. The cost
 * of that choice is real and worth naming rather than hiding: it is a `halfAngle` uniform this
 * body does not read, kept in step with a geometry rebuild that already has to happen for
 * `sectorGeometry`'s own reason (see `update` below). That is a small, already-paid-for cost
 * against a coordinate this file would otherwise have to migrate to by hand the day a wider
 * preview cone is added — worth it, on that trade.
 */
const PREVIEW_BODY = /* glsl */ `
    float rim = smoothstep(0.70, 0.96, radius);
    float far = smoothstep(1.0, 0.96, radius);
    gl_FragColor = vec4(tint, alpha * max(rim * far, 0.18));
`

export function createAimTell(c: AimTellConfig = DEFAULT_AIM_TELL_CONFIG): AimTell {
  const object = new Group()

  const markerGeometry = createChevronGeometry(c.markerSize)
  // `side` is left to the builder's default, deliberately: it defaults to DoubleSide, which is
  // exactly what this material set explicitly before, the same note `staff-arc-fx.ts`'s own
  // fill material makes for its own default.
  const markerMaterial = createEffectMaterial({
    body: MARKER_BODY,
    uniforms: { tint: new Color(TINT), alpha: MARKER_OPACITY, size: c.markerSize },
    // Drawn over the world, like every other attack tell in this directory: a flat shape
    // near the ground is otherwise buried by terrain sloping up away from the player, which
    // is the defect that made the gust cone invisible in play.
    depthTest: false,
  })
  const marker = new Mesh(markerGeometry, markerMaterial)
  marker.name = 'aim-marker'
  // Set once. `c` is captured for the lifetime of the tell and nothing else touches this
  // offset, so rewriting it every frame in `update` only dirtied the matrix for no change.
  marker.position.z = c.markerDistance
  marker.userData.excludeFromShadows = true
  object.add(marker)

  // Built at unit radius and scaled, so a changing range costs a scale rather than a geometry
  // rebuild sixty times a second. The conditional rebuild below used to be purely defensive —
  // no Avatar State boost touches `halfAngle`, so nothing ever changed it — and it is now load
  // bearing: switching element between air and water changes the previewed cone from 60 degrees
  // to 30, so the rebuild fires on the frame the player flicks the radial.
  const previewGeometry = sectorGeometry(1, 0, 1)
  // `halfAngle` starts at 1, matching `previewGeometry`'s own initial build above, so the two
  // never disagree even for the first frame before `update` has run once.
  const previewMaterial = createEffectMaterial({
    body: WEDGE_PREAMBLE + PREVIEW_BODY,
    uniforms: { tint: new Color(TINT), alpha: c.previewOpacity, halfAngle: 1 },
    depthTest: false,
  })
  const preview = new Mesh(previewGeometry, previewMaterial)
  preview.name = 'aim-preview'
  preview.rotation.x = SECTOR_FLAT_ROTATION_X
  preview.userData.excludeFromShadows = true
  preview.visible = false
  object.add(preview)

  // Reused each frame rather than allocated: this runs every frame for the whole session.
  const flat = new Vector3()
  const target = new Vector3()
  /** The half angle the geometry was last built for, so it is rebuilt only when it changes. */
  let builtHalfAngle = 1

  return {
    object,

    update(
      position: Vector3, forward: Vector3, targeted: boolean, ready: boolean, shape: ConeShape,
    ): void {
      object.position.set(position.x, position.y + HEIGHT, position.z)

      // Flattened, because inGust tests a flattened heading: a tell tilted with a climbing
      // glider would point somewhere the gust does not reach.
      flat.set(forward.x, 0, forward.z)
      if (flat.lengthSq() > 1e-8) {
        flat.normalize()
        target.copy(object.position).add(flat)
        object.lookAt(target)
      }

      preview.visible = targeted
      if (targeted) {
        // A RingGeometry cannot change its theta after construction, so a changed half angle
        // needs a rebuild. The radius is a scale, which is why only this is conditional.
        if (Math.abs(shape.halfAngle - builtHalfAngle) > 1e-6) {
          preview.geometry.dispose()
          preview.geometry = sectorGeometry(shape.halfAngle, 0, 1)
          builtHalfAngle = shape.halfAngle
          // Rewritten on the same branch that rebuilds the geometry: `WEDGE_PREAMBLE`'s `across`
          // normalises by this uniform, so a rebuild that changed the wedge without also moving
          // this would leave the shader dividing by the old angle — the shape and its own shading
          // would silently disagree.
          previewMaterial.uniforms.halfAngle!.value = shape.halfAngle
        }
        preview.scale.setScalar(safeScale(shape.range))
        previewMaterial.uniforms.alpha!.value = c.previewOpacity * (ready ? 1 : c.dimmedFactor)
      }
    },

    dispose(): void {
      markerGeometry.dispose()
      markerMaterial.dispose()
      preview.geometry.dispose()
      previewMaterial.dispose()
    },
  }
}
