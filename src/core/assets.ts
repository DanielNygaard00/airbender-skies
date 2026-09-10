import { Mesh, MeshBasicMaterial, MeshLambertMaterial } from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js'

const loader = new GLTFLoader()
const cache = new Map<string, Promise<GLTF | null>>()

/**
 * Re-light a model authored with `KHR_materials_unlit`.
 *
 * The character pack bakes its shading into the texture and marks every material unlit, which
 * three.js honours by building a `MeshBasicMaterial`. Basic materials ignore lights entirely:
 * they do not darken on the shaded side of the island, they do not dim at dusk, and — because
 * `enableShadows` only sets the flags, the material decides whether to act on them — they never
 * receive a shadow. A character lit at a fixed brightness in a world with a moving sun reads as
 * a sticker on the screen, which is the one thing a replacement for the grey placeholder must
 * not do.
 *
 * So the map is carried onto a `MeshLambertMaterial`, which is what every other surface in the
 * game already uses — the terrain, the props, the soldiers. Lambert rather than Standard for the
 * same reason they chose it: there is no metalness or roughness information anywhere in this
 * texture to feed a PBR model, so Standard would cost more per pixel to draw the same thing.
 *
 * The baked shading stays in the texture and is now multiplied by the light, which double-shades
 * slightly on surfaces already painted dark. That is deliberate and it is the cheaper error: the
 * alternative is stripping the pack's own art, and at the scale a soldier occupies on screen the
 * doubling reads as contrast rather than as a mistake.
 *
 * Mutates in place and disposes what it replaces, because the GLTF is cached and handed to every
 * later caller — converting a copy would leave the cache holding the unlit original.
 */
export function relightUnlitMaterials(gltf: GLTF): void {
  gltf.scene.traverse((node) => {
    const mesh = node as Mesh
    if (!mesh.isMesh) return
    // An array means a multi-material mesh; the pack ships none, and converting one element of
    // a group while leaving its siblings unlit would light a character in patches.
    const material = mesh.material
    if (Array.isArray(material) || !(material instanceof MeshBasicMaterial)) return

    mesh.material = new MeshLambertMaterial({
      map: material.map,
      color: material.color,
      transparent: material.transparent,
      opacity: material.opacity,
      alphaMap: material.alphaMap,
      side: material.side,
      vertexColors: material.vertexColors,
    })
    material.dispose()
  })
}

/**
 * Load a model, resolving null on any failure. Callers substitute a placeholder
 * rather than failing to start, so a missing asset never blanks the screen.
 */
export function loadGLTF(url: string): Promise<GLTF | null> {
  const cached = cache.get(url)
  if (cached) return cached

  // Re-lit here rather than at each call site, because this is the single door every model in
  // the game comes through: the player's now, the soldiers' when they get one. A caller that
  // forgot the conversion would not fail — it would quietly draw an unlit character.
  const promise = loader.loadAsync(url).then((gltf) => {
    relightUnlitMaterials(gltf)
    return gltf
  }).catch((error: unknown) => {
    console.warn(`Failed to load "${url}", using a placeholder instead.`, error)
    return null
  })
  cache.set(url, promise)
  return promise
}
