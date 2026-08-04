import type { Object3D } from 'three'

/**
 * A one-shot visual effect: created for an event, advanced each frame, then gone.
 *
 * `shockwave.ts` already had exactly this shape; naming it makes the pool possible and
 * stops the next effect from inventing a slightly different one. Effects own their
 * geometry and material, which is why `dispose` is part of the contract rather than an
 * afterthought — one is created per event, so a missed release accumulates.
 */
export interface Effect {
  object: Object3D
  /** Advance. Returns false once finished, so the caller can remove and dispose it. */
  advance(dt: number): boolean
  dispose(): void
}
