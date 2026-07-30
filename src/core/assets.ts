import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js'

const loader = new GLTFLoader()
const cache = new Map<string, Promise<GLTF | null>>()

/**
 * Load a model, resolving null on any failure. Callers substitute a placeholder
 * rather than failing to start, so a missing asset never blanks the screen.
 */
export function loadGLTF(url: string): Promise<GLTF | null> {
  const cached = cache.get(url)
  if (cached) return cached

  const promise = loader.loadAsync(url).catch((error: unknown) => {
    console.warn(`Failed to load "${url}", using a placeholder instead.`, error)
    return null
  })
  cache.set(url, promise)
  return promise
}
