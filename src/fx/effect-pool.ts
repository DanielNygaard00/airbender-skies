import type { Object3D } from 'three'
import type { Effect } from './effect'

/**
 * Owns the lifecycle of the live one-shot effects.
 *
 * This exists because `main.ts` was growing one hand-rolled reverse-iterating cull loop
 * per effect type, and a missed `dispose` in any of them leaks geometry for the session.
 * Taking a plain `Object3D` as the scene also makes the lifecycle testable with fakes,
 * which an inline loop in the frame function never was.
 */
export interface EffectPool {
  /** Add and parent to the scene. Evicts the oldest if the cap is already reached. */
  add(effect: Effect): void
  /** Advance every live effect, removing and disposing the finished ones. */
  advance(dt: number): void
  size(): number
  /** Remove and dispose everything still live. */
  dispose(): void
}

const DEFAULT_MAX_LIVE = 24

export function createEffectPool(scene: Object3D, maxLive = DEFAULT_MAX_LIVE): EffectPool {
  const cap = maxLive
  const live: Effect[] = []

  function retire(effect: Effect): void {
    scene.remove(effect.object)
    effect.dispose()
  }

  return {
    add(effect: Effect): void {
      // Evict from the front, oldest first: the oldest is the most faded, so dropping it
      // is the least visible choice. Dropping the newest would make a burst of hits show
      // nothing at all, which is the opposite of the point.
      //
      // Counted rather than looped on the length: `while (live.length >= cap)` spins
      // forever on a cap of zero, and a synchronous spin cannot be caught by a test
      // timeout — it hangs the worker. Bounding the count by what is actually there makes
      // that impossible by construction rather than guarded against, so a nonsense cap
      // degrades to "keep one" instead of taking the process down.
      const overflow = Math.min(live.length, live.length - cap + 1)
      for (let i = 0; i < overflow; i++) {
        const oldest = live.shift()
        if (!oldest) break
        retire(oldest)
      }
      scene.add(effect.object)
      live.push(effect)
    },

    advance(dt: number): void {
      // Backwards, so splicing cannot skip the entry after a removal.
      for (let i = live.length - 1; i >= 0; i--) {
        const effect = live[i]
        if (!effect) continue
        if (effect.advance(dt)) continue
        retire(effect)
        live.splice(i, 1)
      }
    },

    size(): number {
      return live.length
    },

    dispose(): void {
      for (const effect of live) retire(effect)
      live.length = 0
    },
  }
}
