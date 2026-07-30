import { createNoise2D } from 'simplex-noise'

/**
 * Small fast deterministic PRNG. Chosen over Math.random because world
 * generation must be reproducible from a seed.
 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** 2D simplex noise seeded deterministically. */
export function seededNoise2D(seed: number): (x: number, y: number) => number {
  return createNoise2D(mulberry32(seed))
}
