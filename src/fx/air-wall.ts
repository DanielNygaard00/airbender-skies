import {
  Color, CylinderGeometry, DoubleSide, Group, MathUtils, Mesh, Vector3,
  type Object3D,
} from 'three'
import type { AirWallConfig } from '../combat/air-wall'
import { createEffectMaterial } from './effect-material'
import { SECTOR_SEGMENTS } from './sector'
import { safeScale } from './scale'

/**
 * The barrier shown while an Air Wall is up.
 *
 * Persistent rather than an `Effect`, for the reason `createGuardShell` and
 * `createVortexChargeTell` are: it tracks a state the player is holding, which is not a
 * one-shot. It also tracks it exactly, the way the guard shell tracks the invulnerability
 * window — a panel that lingered after the wall dropped would tell the player they were
 * covered when they were not, which is worse than no tell.
 *
 * Parented to the scene rather than to the avatar, like `createAimTell`: the avatar is rotated
 * from the *interpolated* heading, and this shape is a hit volume, so it has to read the same
 * vector the deflection reads.
 */
export interface AirWallPanel {
  object: Object3D
  /**
   * Call every frame. `up` is `isAirWallUp`; `position` and `aim` are the same
   * `playerPosition` and `playerAim` the fight is handed.
   */
  update(dt: number, up: boolean, position: Vector3, aim: Vector3, c: AirWallConfig): void
  dispose(): void
}

/**
 * The gust cone's cyan exactly, and it took a look at the rendered thing to get here.
 *
 * The first pass used the guard shell's near-white 0xd6f6ff, on the argument that the two are
 * the same category of thing — a defence the player is holding. Rendered, that was the gust
 * cone's own documented mistake repeated: a pale blue sits almost on top of both the washed sky
 * and the pale green terrain, so the panel was present in the frame and read as nothing. The
 * guard shell gets away with the pale tint because it is a small sphere hugging a dark
 * silhouette; a panel four units wide against open sky does not.
 *
 * So it takes the cyan the gust cone was retuned to for the same reason, which also puts every
 * effect in the game made of moving air on one colour. `gust-cone.ts` carries the original
 * measurement.
 */
const TINT = 0x7fe4ff
/**
 * Peak alpha before the shader's own falloff and streaks take their bite out of it.
 *
 * Above the gust cone's 0.34 fill because this shape is seen face-on rather than flat on the
 * ground, and because it must read against sky as well as terrain — the glider is the posture
 * section 4.3 cares about. The fragment shader multiplies this down to between 0.55 and 1.0 of
 * itself across the streaks and to nothing at the four edges, so the drawn result sits either
 * side of the gust's fill rather than above it everywhere.
 */
const PEAK_OPACITY = 0.55
/** Short: the wall is a reaction, and a barrier that faded up would arrive after the arrow. */
const FADE_IN_SECONDS = 0.05
/**
 * Bounded well under `maxSeconds` 0.9, for the reason the guard shell's tail is bounded under
 * `invulnerableSeconds`: this must not outlive the protection by long enough for a player to
 * act on a panel that has already stopped deflecting.
 */
const FADE_OUT_SECONDS = 0.09
/** How fast the streaks drift across the panel, in panel-widths per second. */
const DRIFT_RATE = 7

/**
 * What the shader itself is doing: `across` and `up` soften all four edges so the panel reads as a
 * held patch of moving air rather than a cut-out rectangle, and `streak` runs a bright banding up
 * it that drifts sideways with `time`. The drift is what says "air": a still panel of even alpha
 * reads as glass, which is the wrong material for a move whose whole fiction is that it is a
 * cushion of wind.
 *
 * The forbidden `..._pars_fragment` includes are no longer this file's problem to remember:
 * `effect-material.ts` assembles the fragment and refuses a body containing one. This file was the
 * reason that module exists, and migrating it was the test of whether the builder could express
 * the one shader the project already had.
 *
 * The two falloff widths were cut from 0.18 and 0.22 after looking at the rendered panel over the
 * home island. At those values the softening ate 36% of the arc and 44% of the height, so the
 * barrier read visibly narrower and shorter than the volume that actually deflects — which is the
 * failure mode this codebase treats as a bug rather than a style choice, because a hit landing
 * outside the visible shape reads as a bug. 0.10 and 0.12 keep the shape from having hard cut
 * edges while leaving four fifths of it at full strength.
 */
const FRAGMENT_BODY = /* glsl */ `
    float across = smoothstep(0.0, 0.10, vUv.x) * smoothstep(1.0, 0.90, vUv.x);
    float up = smoothstep(0.0, 0.12, vUv.y) * smoothstep(1.0, 0.88, vUv.y);
    float streak = 0.55 + 0.45 * sin(vUv.x * 38.0 + vUv.y * 6.0 - time);
    gl_FragColor = vec4(tint, alpha * across * up * streak);
`

/**
 * The curved shell of the wedge, at unit radius and unit height so a changing config costs a
 * scale rather than a geometry rebuild sixty times a second — the same reason the gust cone's
 * travelling arc is built at unit radius.
 *
 * `thetaStart` is `-halfAngle` with no quarter-turn offset, and that is the one thing in this
 * file a reader coming from `./sector.ts` will expect to be wrong. `RingGeometry` measures
 * theta anticlockwise from +X and is authored in XY, which is why every flat sector in the game
 * carries a `-PI/2`. `CylinderGeometry` is authored around +Y and places its vertices at
 * `x = r·sin(theta)`, `z = r·cos(theta)`, so theta 0 is already local +Z — the axis
 * `Object3D.lookAt` aligns. Centring the span on zero is therefore correct here and would be a
 * quarter turn out in `sector.ts`. `air-wall.test.ts` holds the drawn shell against
 * `inAirWall`, which is the authority on whether that reasoning is right.
 */
function panelGeometry(halfAngle: number): CylinderGeometry {
  return new CylinderGeometry(
    1, 1, 1, SECTOR_SEGMENTS, 1,
    // Open-ended: caps would close the wedge into a solid slice of pie, and the barrier is a
    // surface.
    true,
    -halfAngle, 2 * halfAngle,
  )
}

export function createAirWallPanel(): AirWallPanel {
  const object = new Group()

  let builtHalfAngle = Math.PI / 4
  let geometry = panelGeometry(builtHalfAngle)
  const material = createEffectMaterial({
    body: FRAGMENT_BODY,
    uniforms: { tint: new Color(TINT), alpha: 0, time: 0 },
    side: DoubleSide,
    // `depthTest` left ON (the builder has no `depthTest` option, so its default stands), which
    // is the deliberate departure from every other tell in this directory. They all set it
    // false because a flat shape near the player's feet is buried
    // by terrain sloping up away from them — the defect that made the gust cone invisible in
    // play. This shape is not flat and is not near the ground: it stands `verticalReach` above
    // the player, so nothing buries it, and depth-testing earns something real instead. The
    // band is centred on the player's footing and so extends `verticalReach` *below* it, and
    // the depth test is exactly what keeps that underground half hidden by the ground it is
    // under. In the air there is nothing to occlude it and the whole 8-unit band shows, which
    // is honest: up there the band really does extend that far below the glider.
  })
  const panel = new Mesh(geometry, material)
  panel.name = 'air-wall-panel'
  panel.userData.excludeFromShadows = true
  object.add(panel)
  object.visible = false

  let shown = 0
  let elapsed = 0
  // Reused each frame rather than allocated: this runs every frame for the whole session.
  const flat = new Vector3()
  const target = new Vector3()

  return {
    object,

    update(dt: number, up: boolean, position: Vector3, aim: Vector3, c: AirWallConfig): void {
      const seconds = up ? FADE_IN_SECONDS : FADE_OUT_SECONDS
      const step = seconds > 0 ? dt / seconds : 1
      shown = up ? Math.min(1, shown + step) : Math.max(0, shown - step)
      object.visible = shown > 0.001
      material.uniforms.alpha!.value = PEAK_OPACITY * MathUtils.clamp(shown, 0, 1)
      if (!object.visible) return

      // Advanced only while the panel is drawn, so the streaks start from the same phase on
      // every wall rather than from wherever a session-long clock happened to be.
      elapsed = up ? elapsed + dt : elapsed
      material.uniforms.time!.value = elapsed * DRIFT_RATE

      object.position.copy(position)

      // The group carries the yaw and the panel carries the pitch, which is the split the
      // module's two conventions force. `inAirWall` flattens the heading, so the wedge the
      // group's yaw describes is exactly the volume that bites; the reflection uses the
      // un-flattened aim, so the tilt is the control the player is actually exercising and has
      // to be visible. Baked into one `lookAt` on the group they would be indistinguishable,
      // and the containment test in `air-wall.test.ts` -- which is what pins the theta
      // convention above -- would have nothing flat to measure.
      flat.set(aim.x, 0, aim.z)
      if (flat.lengthSq() > 1e-8) {
        flat.normalize()
        target.copy(object.position).add(flat)
        object.lookAt(target)
      }

      // Negated, and worked out rather than guessed. The group's local +Z is `flat` and its
      // local +Y is world up, and a rotation of theta about local X sends local +Z to
      // `(0, -sin theta, cos theta)` in the group's frame -- so the panel's own +Z, which is the
      // surface's outward normal at the middle of the arc, lands on
      // `cos(theta)·flat - sin(theta)·up`. Matching that against the normalised aim gives
      // `-sin(theta) = aim.y`, hence the minus sign. `air-wall.test.ts` asserts the drawn
      // normal equals `airWallNormal(aim)` instead of restating this, which is the only check
      // that would catch the sign being flipped -- a mirrored tilt still looks like a tilt.
      //
      // Clamped into `asin` because an `aim` a hair over unit length would otherwise produce a
      // NaN rotation, and a NaN in the matrix removes the mesh rather than mis-drawing it.
      const lift = flat.lengthSq() > 1e-8 && aim.lengthSq() > 1e-8
        ? aim.y / aim.length()
        : 0
      panel.rotation.x = -Math.asin(MathUtils.clamp(lift, -1, 1))

      if (Math.abs(c.halfAngle - builtHalfAngle) > 1e-6) {
        geometry.dispose()
        geometry = panelGeometry(c.halfAngle)
        panel.geometry = geometry
        builtHalfAngle = c.halfAngle
      }

      // The shell sits at the wedge's outer radius and spans its whole vertical band, so what
      // is drawn is the face of the true hit volume. The `range` units of wedge *inward* of it
      // are deliberately not drawn: that depth is interception tolerance rather than a
      // mechanic — at 34 m/s an arrow crosses 0.57 units a frame, so a deflection visibly
      // happens at the face and the rest of the band exists so a dropped frame cannot let a
      // shot tunnel through. The same trade `gust-cone.ts` makes in the other axis, where it
      // draws the footprint and leaves the slab's height undrawn.
      panel.scale.set(safeScale(c.range), safeScale(2 * c.verticalReach), safeScale(c.range))
    },

    dispose(): void {
      geometry.dispose()
      material.dispose()
    },
  }
}
