import { describe, it, expect } from 'vitest'
import { Group, Object3D } from 'three'
import { createEffectPool } from './effect-pool'
import type { Effect } from './effect'

/**
 * A stand-in effect with a known lifetime and a disposal counter.
 *
 * Fakes rather than real effects on purpose: the thing under test is the lifecycle —
 * what gets removed, what gets disposed, and how many times — which real geometry would
 * only obscure.
 */
function fake(lifetime: number) {
  const object = new Object3D()
  let age = 0
  let disposals = 0
  const effect: Effect = {
    object,
    advance(dt: number): boolean {
      age += dt
      return age < lifetime
    },
    dispose(): void {
      disposals += 1
    },
  }
  return { effect, object, disposals: () => disposals }
}

describe('createEffectPool', () => {
  it('parents an added effect to the scene', () => {
    const scene = new Group()
    const pool = createEffectPool(scene)
    const a = fake(1)
    pool.add(a.effect)
    expect(scene.children).toContain(a.object)
    expect(pool.size()).toBe(1)
  })

  it('leaves a live effect alone', () => {
    const scene = new Group()
    const pool = createEffectPool(scene)
    const a = fake(1)
    pool.add(a.effect)
    pool.advance(0.1)
    expect(scene.children).toContain(a.object)
    expect(a.disposals()).toBe(0)
    expect(pool.size()).toBe(1)
  })

  it('removes and disposes a finished effect', () => {
    const scene = new Group()
    const pool = createEffectPool(scene)
    const a = fake(0.2)
    pool.add(a.effect)
    pool.advance(0.5)
    expect(scene.children).not.toContain(a.object)
    expect(a.disposals()).toBe(1)
    expect(pool.size()).toBe(0)
  })

  it('disposes a finished effect exactly once, however often it is advanced', () => {
    // A double dispose on a real effect would release geometry twice. Cheap to get
    // wrong by leaving the finished entry in the list.
    const scene = new Group()
    const pool = createEffectPool(scene)
    const a = fake(0.2)
    pool.add(a.effect)
    pool.advance(0.5)
    pool.advance(0.5)
    pool.advance(0.5)
    expect(a.disposals()).toBe(1)
  })

  it('removes every effect that finishes on the same frame', () => {
    // Regression guard on the reverse iteration: a forward loop with a splice skips
    // the entry after each removal, so the middle of three would survive.
    const scene = new Group()
    const pool = createEffectPool(scene)
    const all = [fake(0.1), fake(0.1), fake(0.1)]
    for (const f of all) pool.add(f.effect)
    pool.advance(0.5)
    expect(pool.size()).toBe(0)
    expect(scene.children.length).toBe(0)
    for (const f of all) expect(f.disposals()).toBe(1)
  })

  it('keeps the live ones when only some finish', () => {
    const scene = new Group()
    const pool = createEffectPool(scene)
    const short = fake(0.1)
    const long = fake(5)
    pool.add(short.effect)
    pool.add(long.effect)
    pool.advance(0.2)
    expect(pool.size()).toBe(1)
    expect(scene.children).toContain(long.object)
    expect(scene.children).not.toContain(short.object)
  })

  it('never grows past the cap', () => {
    const scene = new Group()
    const pool = createEffectPool(scene, 3)
    for (let i = 0; i < 10; i++) pool.add(fake(5).effect)
    expect(pool.size()).toBe(3)
    expect(scene.children.length).toBe(3)
  })

  it('evicts the oldest at the cap, not the newest', () => {
    // The oldest is the most faded, so dropping it is the least visible choice.
    // Dropping the newest would make a burst of hits show nothing at all.
    const scene = new Group()
    const pool = createEffectPool(scene, 2)
    const first = fake(5)
    const second = fake(5)
    const third = fake(5)
    pool.add(first.effect)
    pool.add(second.effect)
    pool.add(third.effect)

    expect(first.disposals()).toBe(1)
    expect(scene.children).not.toContain(first.object)
    expect(scene.children).toContain(second.object)
    expect(scene.children).toContain(third.object)
  })

  it('degrades gracefully on a nonsense cap instead of hanging', () => {
    // The eviction count is bounded by what is actually in the list, so a cap of zero or
    // a negative one keeps one effect rather than spinning. Worth pinning because the
    // failure mode of the obvious `while (size >= cap)` is a synchronous infinite loop,
    // which no test timeout can interrupt — it takes the worker down rather than failing.
    // Note this test cannot distinguish a cap of 0 from a cap of 1: both keep one. It
    // guards the boundedness, not the exact cap.
    for (const nonsense of [0, -5]) {
      const scene = new Group()
      const pool = createEffectPool(scene, nonsense)
      pool.add(fake(5).effect)
      pool.add(fake(5).effect)
      expect(pool.size()).toBe(1)
      expect(scene.children.length).toBe(1)
    }
  })

  it('empties the scene and disposes everything on dispose', () => {
    const scene = new Group()
    const pool = createEffectPool(scene)
    const all = [fake(5), fake(5)]
    for (const f of all) pool.add(f.effect)
    pool.dispose()
    expect(pool.size()).toBe(0)
    expect(scene.children.length).toBe(0)
    for (const f of all) expect(f.disposals()).toBe(1)
  })
})
