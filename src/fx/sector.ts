import { RingGeometry } from 'three'

/**
 * The shape of a horizontal cone, as geometry.
 *
 * Extracted from `gust-cone.ts` because a second copy of the theta offset below would drift —
 * silently, since a rotated cone still looks like a cone. Every partial sector in the game
 * builds its geometry here: the gust cone, the aim preview and the staff arc. The full rings
 * (`shockwave.ts`, `vortex-ring.ts`, `vortex-charge.ts`) span a whole turn and so have no
 * theta offset to get wrong.
 *
 * `gust-cone.test.ts`'s containment check against `inGust` and `staff-arc-fx.test.ts`'s
 * against `inCone` are two independent authorities on whether the convention here is right.
 */
export const SECTOR_SEGMENTS = 48

/**
 * The rotation that lays a sector flat, exported so no caller has to remember the sign.
 *
 * RingGeometry is authored in the XY plane. A rotation of -PI/2 about X maps (x, y, z) to
 * (x, z, -y), so the authored plane becomes the ground and the authored +Y becomes world -Z.
 */
export const SECTOR_FLAT_ROTATION_X = -Math.PI / 2

/**
 * Theta for a sector centred on local +Z once laid flat.
 *
 * RingGeometry measures theta anticlockwise from +X. Under the mapping above, world +Z
 * corresponds to authored -Y, which is theta = -PI/2 — so the span is centred there rather
 * than at zero. Getting this wrong draws every cone in the game rotated a quarter turn from
 * the volume it claims to show.
 */
export function sectorTheta(halfAngle: number): { thetaStart: number; thetaLength: number } {
  return { thetaStart: -Math.PI / 2 - halfAngle, thetaLength: 2 * halfAngle }
}

/**
 * Whether a wedge of this half-angle has a `vUv.x` that runs monotonically along its arc.
 *
 * `sectorTheta` centres every wedge on local +Z with `thetaStart = -PI/2 - halfAngle`, and
 * `RingGeometry`'s `uv.x` is `(position.x / outerRadius + 1) / 2` — so `uv.x` tracks `cos(theta)`.
 * `cos` is monotone on `[-PI, 0]`, and both wedge edges sit inside that window only while the
 * half-angle stays at or under a quarter turn. Past that the wedge folds back and two different
 * points on the arc share a `uv.x`, which makes any gradient written against it mirror.
 *
 * A predicate rather than a comment, because exactly one config in the game breaks the bound —
 * `staffArc.finisher`'s `Math.PI / 1.9`, about 94.7 degrees — and a comment would not fail a test
 * the day someone widens another arc past it.
 */
export function sectorUvIsMonotone(halfAngle: number): boolean {
  return halfAngle <= Math.PI / 2
}

/** `innerRadius` 0 gives a filled wedge; a positive one gives an arc band. */
export function sectorGeometry(
  halfAngle: number, innerRadius: number, outerRadius: number,
): RingGeometry {
  const { thetaStart, thetaLength } = sectorTheta(halfAngle)
  return new RingGeometry(
    innerRadius, outerRadius, SECTOR_SEGMENTS, 1, thetaStart, thetaLength,
  )
}
