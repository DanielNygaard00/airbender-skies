import { ShaderChunk } from 'three'
import { SUN_DIRECTION } from './sun'

/**
 * Aerial perspective: the haze that makes distance visible.
 *
 * **What was missing.** The scene's fog is linear from 400 m to 2200 m, and the far end doubles as
 * the camera's far plane, which is why it is linear: it guarantees anything about to be clipped is
 * already fully fogged. But linear-from-400 means everything nearer than 400 m is perfectly clear,
 * and an island 300 m away rendered with the same contrast and saturation as the rock under the
 * player's feet. Real air is never that clean: distant land goes paler and bluer from the first
 * hundred metres, and that gradient is most of how the eye judges how far away something is.
 *
 * **Added under the linear fog, never on top of it.** The haze is an exponential approach to
 * `HAZE_MAX`, and the final fog factor is whichever of the two is larger. Near the player the haze
 * wins and adds a gentle depth cue; past about a kilometre the linear fog overtakes it and does
 * what it always did, so the far-plane guarantee and the landmark islands' visibility -- the
 * reason exponential fog was rejected outright -- are untouched where they mattered. Multiplying
 * the two transmittances instead would have stacked them, and hazed the landmarks by nearly half.
 *
 * **Brighter toward the sun.** Air scatters sunlight forward, so haze looking sunward is lighter
 * and warmer than haze looking away. A varying carries the view direction in world space from the
 * fog vertex chunk, so this works for every material that fogs, instanced grass included.
 *
 * **Done by rewriting three's four fog chunks, once, before anything compiles.** Every built-in
 * material includes all four together, so they stay consistent; no material in this project ships
 * its own fog chunks. Constants rather than uniforms, because the sun's direction is fixed (see
 * `daylight.ts`) and three's fog uniforms already carry the colour and the linear range.
 */

/** The haziest the exponential term ever gets, as a fog factor. */
export const HAZE_MAX = 0.6
/**
 * Metres over which the haze closes about 63% of the way to `HAZE_MAX`.
 *
 * 1200. At 1800 an island 330 m off -- climb-north, seen from home -- took 10% haze and still
 * read as near. 1200 gives it about 15%, and a landmark a kilometre out 34% where the linear fog
 * alone gave 26%: a cue, not a curtain.
 */
export const HAZE_DISTANCE = 1200
/** How much brighter haze is looking straight at the sun than looking away from it. */
const SUNWARD_LIFT = 0.3

/** The haze factor at a distance, mirroring the shader -- for tests and for reading the numbers. */
export function hazeAt(distance: number): number {
  return HAZE_MAX * (1 - Math.exp(-Math.max(distance, 0) / HAZE_DISTANCE))
}

const PARS_VERTEX = /* glsl */ `
#ifdef USE_FOG
	varying float vFogDepth;
	varying vec3 vFogDirection;
#endif
`

// The view-space position rotated back into world space: multiplying on the left of the view
// matrix's rotation is multiplying by its transpose, which for a rotation is its inverse.
const VERTEX = /* glsl */ `
#ifdef USE_FOG
	vFogDepth = - mvPosition.z;
	vFogDirection = ( vec4( mvPosition.xyz, 0.0 ) * viewMatrix ).xyz;
#endif
`

const PARS_FRAGMENT = /* glsl */ `
#ifdef USE_FOG
	uniform vec3 fogColor;
	varying float vFogDepth;
	varying vec3 vFogDirection;
	#ifdef FOG_EXP2
		uniform float fogDensity;
	#else
		uniform float fogNear;
		uniform float fogFar;
	#endif
#endif
`

const FRAGMENT = /* glsl */ `
#ifdef USE_FOG
	#ifdef FOG_EXP2
		float fogFactor = 1.0 - exp( - fogDensity * fogDensity * vFogDepth * vFogDepth );
	#else
		float fogFactor = max(
			smoothstep( fogNear, fogFar, vFogDepth ),
			${HAZE_MAX.toFixed(3)} * ( 1.0 - exp( - vFogDepth / ${HAZE_DISTANCE.toFixed(1)} ) )
		);
	#endif
	float fogSunward = max( dot( normalize( vFogDirection ),
		vec3( ${SUN_DIRECTION.x.toFixed(4)}, ${SUN_DIRECTION.y.toFixed(4)}, ${SUN_DIRECTION.z.toFixed(4)} ) ), 0.0 );
	vec3 fogTint = fogColor * ( 1.0 + ${SUNWARD_LIFT.toFixed(2)} * pow( fogSunward, 6.0 ) );
	gl_FragColor.rgb = mix( gl_FragColor.rgb, fogTint, fogFactor );
#endif
`

let installed = false

/** Rewrite three's fog chunks. Safe to call more than once; only the first call does anything. */
export function installHaze(): void {
  if (installed) return
  installed = true
  ShaderChunk.fog_pars_vertex = PARS_VERTEX
  ShaderChunk.fog_vertex = VERTEX
  ShaderChunk.fog_pars_fragment = PARS_FRAGMENT
  ShaderChunk.fog_fragment = FRAGMENT
}
