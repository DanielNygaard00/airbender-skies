import {
  BufferAttribute, BufferGeometry, Color, DoubleSide, Group, InstancedMesh, Matrix4, Quaternion,
  ShaderChunk, Vector3, type Material,
} from 'three'
import { addShaderPatch, createSurface } from '../core/surface'
import { mulberry32 } from '../core/rng'
import { WIND_CLOCK, WIND_DIRECTION } from '../core/weather'
import { isTopFace } from './island-paint'

/**
 * Grass blades on the island tops.
 *
 * **Why.** With the ground painted flat-shaded and the props kept to trees and boulders, the
 * surface the player walks on and lands on was the most obviously synthetic thing in the frame:
 * a smooth green sheet with nothing standing up out of it. Blades give the ground texture at
 * the scale of a footstep, catch the light on their tips, and move in the wind — the three
 * cues that read as "real ground" from a follow camera a few metres away.
 *
 * **Placed on the painted triangles themselves, at build time.** Every top face of an island is
 * sampled in proportion to its area, so the blades sit exactly on the surface with no raycasts,
 * and they take the face's own painted colour — the meadow patches of `island-paint.ts` carry
 * through into the grass that grows on them. Seeded, so an island grows the same field every
 * load and the FX bench stays comparable.
 *
 * **Drawn near the camera only.** The blades are instanced in tufts of three and bucketed into
 * square chunks; a chunk wholly beyond `GRASS_FAR` is hidden outright, and inside it every blade
 * shrinks toward its root between `GRASS_NEAR` and `GRASS_FAR`, so there is no line where grass
 * pops in. That keeps the cost proportional to the ground near the player rather than to the
 * size of the archipelago, and at a distance the painted ground is all the eye can resolve anyway.
 *
 * **Lit like the ground it grows from.** Every blade's normal points straight up. A thin blade
 * with its true normal goes black whenever the sun is edge-on to it and flashes when it is not,
 * which reads as noise; with the ground's normal the field shades as one surface and the blades
 * read through their shape, their darker roots and their brighter tips. The same reason the back
 * faces are not flipped: a blade seen from behind is the same grass.
 *
 * **Receives shadows, casts none.** Trees and characters darken the grass under them, which is
 * what grounds them. Blades casting into the sun's map would cost a second pass over every
 * instance for shadows too small to resolve at the map's texel size, and the depth pass would
 * draw them unbent and unfaded.
 */

/**
 * Distance from the camera at which blades begin to shrink, in metres.
 *
 * 24, from 34: over a fourteen-metre fade the edge of the field read as a line across the
 * ground, because the bright tips stopped there and the bare paint beyond was darker. Twice the
 * span, plus the colour blend in the shader, dissolves it.
 */
export const GRASS_NEAR = 24
/** Distance beyond which blades have shrunk to nothing and their chunk is hidden. */
export const GRASS_FAR = 48
/**
 * Tufts per square metre of island top at full density. Three blades each.
 *
 * 3.5, after 1.6 read on the bench as scattered flecks on a bare floor rather than as a field.
 */
export const TUFTS_PER_SQUARE_METRE = 3.5
/**
 * Edge of one culling chunk, in metres.
 *
 * 24: the archipelago grows about 108,000 tufts, and at 16 that was 169 chunks with up to about
 * three dozen inside `GRASS_FAR` at once, each its own draw call. 24 roughly halves the calls in
 * reach for a little more off-screen vertex work at the edges.
 */
export const CHUNK_SIZE = 24
/** How far a blade's tip travels downwind at the peak of a gust, in metres. */
const BLADE_SWAY = 0.09
/**
 * Blade height range in metres: ankle to low shin on a 1.8 m character.
 *
 * Lowered from 0.32-0.62 after a look from the live follow camera, which sits low enough that
 * the foreground tufts stood as tall spikes and buried the rider's shins -- and the feet are
 * what a player reads a landing by.
 */
const MIN_HEIGHT = 0.26
const MAX_HEIGHT = 0.48

export interface GrassField {
  /** Every chunk, ready to add to the scene. */
  group: Group
  /** Hide chunks beyond reach of the camera. Once a frame. */
  update(camera: Vector3): void
  /** The fraction of tufts drawn, from 0 (none) to 1. From the quality tier; see `QualityProfile.grass`. */
  setDensity(fraction: number): void
}

export interface Tuft {
  position: Vector3
  colour: Color
  height: number
  yaw: number
}

/**
 * One tuft: three blades fanned around a shared root, each a single tapered triangle.
 *
 * Unit height, so an instance's scale is the tuft's height in metres. `position.y` therefore runs
 * 0 at the root to 1 at the tallest tip, which the vertex shader reads directly as how far up the
 * blade a vertex is. The colour attribute darkens the roots and lifts the tips, multiplied in the
 * shader by the instance's ground colour.
 */
export function createTuftGeometry(): BufferGeometry {
  const positions: number[] = []
  const colours: number[] = []
  const BASE_HALF_WIDTH = 0.14
  const blades = [
    { angle: 0, height: 1, lean: 0.16 },
    { angle: (Math.PI * 2) / 3, height: 0.82, lean: 0.22 },
    { angle: (Math.PI * 4) / 3, height: 0.68, lean: 0.12 },
  ]
  for (const { angle, height, lean } of blades) {
    const cos = Math.cos(angle)
    const sin = Math.sin(angle)
    // Root edge across the blade's facing, tip leaned outward from the tuft's centre.
    positions.push(-BASE_HALF_WIDTH * sin, 0, BASE_HALF_WIDTH * cos)
    positions.push(BASE_HALF_WIDTH * sin, 0, -BASE_HALF_WIDTH * cos)
    positions.push(lean * cos, height, lean * sin)
    // Roots a little darker than the ground, tips clearly lighter and a touch warmer: sunlit
    // grass tips are what the eye picks a field out by. Blue held back at the tip so it warms
    // toward yellow-green rather than just whitening.
    colours.push(0.72, 0.72, 0.72, 0.72, 0.72, 0.72, 1.45, 1.45, 1.15)
  }
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3))
  geometry.setAttribute('color', new BufferAttribute(new Float32Array(colours), 3))
  const up = new Float32Array(positions.length)
  for (let i = 1; i < up.length; i += 3) up[i] = 1
  geometry.setAttribute('normal', new BufferAttribute(up, 3))
  return geometry
}

/**
 * Where the tufts grow on one painted island geometry, in world space.
 *
 * Each top face receives its area times the density in tufts, the fractional part settled by a
 * coin toss so small faces are not starved, at uniformly distributed points inside the triangle.
 */
export function scatterTufts(
  geometry: BufferGeometry, origin: Vector3, seed: number,
  density: number = TUFTS_PER_SQUARE_METRE,
): Tuft[] {
  const position = geometry.attributes.position
  const colour = geometry.attributes.color
  if (!position || !colour) return []
  const rng = mulberry32(seed)
  const tufts: Tuft[] = []
  const a = new Vector3()
  const b = new Vector3()
  const c = new Vector3()
  const ab = new Vector3()
  const ac = new Vector3()
  const cross = new Vector3()

  for (let f = 0; f < position.count / 3; f++) {
    a.fromBufferAttribute(position, f * 3)
    b.fromBufferAttribute(position, f * 3 + 1)
    c.fromBufferAttribute(position, f * 3 + 2)
    cross.crossVectors(ab.subVectors(b, a), ac.subVectors(c, a))
    const doubleArea = cross.length()
    if (doubleArea < 1e-9) continue
    if (!isTopFace(cross.y / doubleArea, (a.y + b.y + c.y) / 3)) continue

    const expected = (doubleArea / 2) * density
    const count = Math.floor(expected) + (rng() < expected % 1 ? 1 : 0)
    const ground = new Color(colour.getX(f * 3), colour.getY(f * 3), colour.getZ(f * 3))
    for (let i = 0; i < count; i++) {
      // Uniform over the triangle: the square-root fold keeps points from crowding vertex a.
      const r1 = Math.sqrt(rng())
      const r2 = rng()
      const point = new Vector3()
        .addScaledVector(a, 1 - r1)
        .addScaledVector(b, r1 * (1 - r2))
        .addScaledVector(c, r1 * r2)
        .add(origin)
      tufts.push({
        position: point,
        colour: ground,
        height: MIN_HEIGHT + rng() * (MAX_HEIGHT - MIN_HEIGHT),
        yaw: rng() * Math.PI * 2,
      })
    }
  }
  return tufts
}

const GRASS_PROJECT = /* glsl */ `
  // Root and vertex in world space. The mesh sits at the origin, but going through modelMatrix
  // keeps this correct if a chunk is ever placed instead.
  mat4 grassModel = modelMatrix * instanceMatrix;
  vec3 grassRoot = (grassModel * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
  vec3 grassOffset = (grassModel * vec4(transformed, 1.0)).xyz - grassRoot;

  // Shrink toward the root with distance, so the field thins out instead of ending at a line.
  float grassFade = 1.0 - smoothstep(${GRASS_NEAR.toFixed(1)}, ${GRASS_FAR.toFixed(1)},
    distance(grassRoot, cameraPosition));
  grassOffset *= grassFade;
  // And settle toward the bare ground's own colour as they shrink, so where the field ends the
  // ground beyond is the same tone rather than a darker floor with no tips catching the light.
  #ifdef USE_INSTANCING_COLOR
    vColor.rgb = mix(instanceColor.rgb, vColor.rgb, grassFade);
  #endif

  // The same slow gust as the trees, phased by position so it rolls across the field, plus a
  // quick per-tuft flutter the trees do not have.
  float grassUp = position.y;
  float grassPhase = grassRoot.x * 0.07 + grassRoot.z * 0.05;
  float grassGust = 0.55 + 0.45 * sin(windClock * 1.1 + grassPhase);
  float grassFlutter = 0.3 * sin(windClock * 3.4 + grassRoot.x * 1.7 + grassRoot.z * 2.3);
  float grassBend = grassUp * grassUp * (grassGust + grassFlutter) * ${BLADE_SWAY.toFixed(3)}
    * grassFade;
  grassOffset.x += ${WIND_DIRECTION[0].toFixed(3)} * grassBend;
  grassOffset.z += ${WIND_DIRECTION[1].toFixed(3)} * grassBend;
  grassOffset.y -= grassBend * grassBend * 0.5;

  vec4 mvPosition = viewMatrix * vec4(grassRoot + grassOffset, 1.0);
  gl_Position = projectionMatrix * mvPosition;
`

// A blade seen from behind is the same grass: do not flip its normal to face away.
const GRASS_NORMAL_BEGIN = ShaderChunk.normal_fragment_begin
  .replace('gl_FrontFacing ? 1.0 : - 1.0', '1.0')

/** The one material every chunk shares. */
export function createGrassMaterial(): Material {
  const material = createSurface('foliage', { vertexColors: true, side: DoubleSide })
  // Chained onto the cloud-shadow patch `createSurface` already added, so clouds shade the grass.
  return addShaderPatch(material, 'grass', (shader) => {
    shader.uniforms['windClock'] = WIND_CLOCK
    shader.vertexShader = 'uniform float windClock;\n' + shader.vertexShader
      .replace('#include <project_vertex>', GRASS_PROJECT)
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <normal_fragment_begin>', GRASS_NORMAL_BEGIN)
  })
}

/** Grow the grass for every island in a level, bucketed into chunks. */
export function createGrassField(tufts: readonly Tuft[], seed: number): GrassField {
  const group = new Group()
  group.name = 'grass'
  const geometry = createTuftGeometry()
  const material = createGrassMaterial()

  const buckets = new Map<string, Tuft[]>()
  for (const tuft of tufts) {
    const key = `${Math.floor(tuft.position.x / CHUNK_SIZE)},${Math.floor(tuft.position.z / CHUNK_SIZE)}`
    const bucket = buckets.get(key)
    if (bucket) bucket.push(tuft)
    else buckets.set(key, [tuft])
  }

  const rng = mulberry32(seed)
  const chunks: { mesh: InstancedMesh; full: number }[] = []
  const matrix = new Matrix4()
  const turn = new Quaternion()
  const up = new Vector3(0, 1, 0)
  const scale = new Vector3()
  for (const bucket of buckets.values()) {
    // Shuffled, so a reduced density drawing the first N tufts thins the chunk evenly rather than
    // dropping whichever faces happened to be sampled last.
    for (let i = bucket.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1))
      ;[bucket[i], bucket[j]] = [bucket[j]!, bucket[i]!]
    }
    const mesh = new InstancedMesh(geometry, material, bucket.length)
    bucket.forEach((tuft, i) => {
      turn.setFromAxisAngle(up, tuft.yaw)
      scale.set(tuft.height, tuft.height, tuft.height)
      mesh.setMatrixAt(i, matrix.compose(tuft.position, turn, scale))
      mesh.setColorAt(i, tuft.colour)
    })
    mesh.instanceMatrix.needsUpdate = true
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
    mesh.computeBoundingSphere()
    mesh.receiveShadow = true
    mesh.castShadow = false
    // `enableShadows` would otherwise turn casting on; see the module comment.
    mesh.userData.excludeFromShadows = true
    // N8AO reads a blade as a dense occluder standing in open ground and paints every one of
    // them near-black: on the bench the field became a scatter of black flecks. This flag has
    // the AO pass composite the grass over its result instead of darkening it.
    mesh.userData.cannotReceiveAO = true
    group.add(mesh)
    chunks.push({ mesh, full: bucket.length })
  }

  let density = 1
  return {
    group,
    update(camera: Vector3): void {
      for (const { mesh } of chunks) {
        const sphere = mesh.boundingSphere
        mesh.visible = density > 0 && sphere !== null
          && camera.distanceTo(sphere.center) - sphere.radius < GRASS_FAR
      }
    },
    setDensity(fraction: number): void {
      density = Number.isFinite(fraction) ? Math.min(Math.max(fraction, 0), 1) : 0
      for (const { mesh, full } of chunks) mesh.count = Math.round(full * density)
    },
  }
}
