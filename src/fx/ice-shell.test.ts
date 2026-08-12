import { describe, it, expect } from 'vitest'
import { Mesh, Vector3, type Material } from 'three'
import { createIceShell } from './ice-shell'
import { DEFAULT_COMBAT_CONFIG } from '../combat/config'

const W = DEFAULT_COMBAT_CONFIG.water
const AT = new Vector3(3, 0, -4)

const meshOf = (effect: { object: unknown }): Mesh => {
  if (!(effect.object instanceof Mesh)) throw new Error('expected the shell to be a Mesh')
  return effect.object
}
const opacityOf = (effect: { object: unknown }): number =>
  (meshOf(effect).material as Material & { opacity: number }).opacity

/** Run an effect for `seconds` at 60 Hz, reporting whether it was still alive at the end. */
function run(effect: ReturnType<typeof createIceShell>, seconds: number): boolean {
  let alive = true
  for (let t = 0; t < seconds - 1e-9; t += 1 / 60) alive = effect.advance(1 / 60)
  return alive
}

describe('createIceShell', () => {
  it('lives for the whole hold, and not much longer', () => {
    // **The lifetime is the mechanic.** The shell has to be on screen for exactly the window the
    // soldier cannot act — the rule `guard-shell.ts` follows for the Slipstream's invulnerability,
    // and for the same reason: a tell that outlives its mechanic tells the player a soldier is
    // locked when it is already winding up.
    //
    // Both edges, because either alone is unfalsifiable. "Still alive partway through" passes for
    // an effect that never ends; "finished eventually" passes for one that ends immediately.
    const hold = 2
    expect(run(createIceShell(AT, hold), hold * 0.9)).toBe(true)
    // The only slack is the melt, which is time added *after* the lock rather than taken out of it.
    expect(run(createIceShell(AT, hold), hold + 0.5)).toBe(false)
  })

  it('is still at full strength when the hold ends, and fades only after', () => {
    // What "added after" means, measured. The shell must not be fading while the soldier is still
    // frozen, or the tell would read as the ice breaking early.
    const hold = 2
    const effect = createIceShell(AT, hold)
    run(effect, hold * 0.5)
    const midway = opacityOf(effect)
    const atEnd = createIceShell(AT, hold)
    run(atEnd, hold - 1 / 30)
    expect(opacityOf(atEnd)).toBeCloseTo(midway, 3)
    // And then it does go.
    const after = createIceShell(AT, hold)
    run(after, hold + 0.15)
    expect(opacityOf(after)).toBeLessThan(midway)
  })

  it('forms rather than popping in', () => {
    // Zero opacity on the first frame, rising. A shell that arrived at full strength would flash
    // against the pale terrain, which is the defect the gust cone's own tint comment records.
    const effect = createIceShell(AT, 2)
    expect(opacityOf(effect)).toBe(0)
    effect.advance(1 / 60)
    expect(opacityOf(effect)).toBeGreaterThan(0)
  })

  it('lives longer for a freeze than for a grip, at the shipped durations', () => {
    // The two moves share this effect at their own durations, which is what makes a grip and a
    // freeze read as the same condition held for different lengths of time. Held to the config
    // rather than to literals, so a retune moves the visual with the mechanic.
    const gripAlive = run(createIceShell(AT, W.gripHoldSeconds), W.gripHoldSeconds + 0.5)
    const freezeAlive = run(createIceShell(AT, W.freezeHoldSeconds), W.gripHoldSeconds + 0.5)
    expect(gripAlive).toBe(false)
    expect(freezeAlive).toBe(true)
  })

  it('degrades to a brief flash on a non-positive hold rather than never drawing', () => {
    // A mistuned duration should be visible, not invisible. Zero total life would make the effect
    // finish on its first advance and never appear at all, which reads as the move not coming out.
    const effect = createIceShell(AT, 0)
    expect(effect.advance(1 / 120)).toBe(true)
    expect(run(createIceShell(AT, -5), 1)).toBe(false)
  })

  it('sits on the body rather than at its feet', () => {
    // An enemy's origin is at its feet, so an unoffset shell would be half buried in the ground.
    expect(meshOf(createIceShell(AT, 1)).position.y).toBeGreaterThan(AT.y)
  })

  it('does not write the height offset into the caller\'s position', () => {
    // The trap `createImpact` documents in full: the caller hands over an enemy's live position
    // vector, and writing the height into it would teleport the enemy upward.
    const position = new Vector3(3, 0, -4)
    createIceShell(position, 1)
    expect(position.toArray()).toEqual([3, 0, -4])
  })

  it('never scales to exactly zero', () => {
    // A zero scale collapses the matrix.
    const effect = createIceShell(AT, 1)
    for (let i = 0; i < 80; i++) {
      effect.advance(1 / 60)
      expect(meshOf(effect).scale.x).toBeGreaterThan(0)
    }
  })

  it('is drawn from the inside, so the soldier stays visible', () => {
    // Section 4.6's non-lethality is that the body remains in the world. A shell that hid it would
    // undo that at the one moment the player is looking straight at it. `BackSide` is 1 in three.js.
    const material = meshOf(createIceShell(AT, 1)).material as Material
    expect(material.side).toBe(1)
    expect(material.transparent).toBe(true)
  })

  it('uses a plain MeshBasicMaterial', () => {
    // Not a ShaderMaterial: one that duplicates the renderer's injected `..._pars_fragment` chunks
    // fails to compile nearly silently and the mesh simply does not draw, which looks like a
    // correctly transparent shell with the enemy showing through — indistinguishable from success
    // for an effect that is *supposed* to show the enemy through it.
    expect((meshOf(createIceShell(AT, 1)).material as Material).type).toBe('MeshBasicMaterial')
  })
})
