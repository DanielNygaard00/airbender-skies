import { describe, it, expect } from 'vitest'
import { planClips } from './clip-map'

/** The clip names the committed character.glb actually ships. */
const QUATERNIUS = [
  'Human Armature|ArmatureAction.002',
  'Human Armature|Death',
  'Human Armature|Idle',
  'Human Armature|Jump',
  'Human Armature|Punch',
  'Human Armature|Run',
  'Human Armature|Walk',
  'Human Armature|Working',
]

describe('planClips', () => {
  it('resolves every animation state for the real model', () => {
    const plan = planClips(QUATERNIUS)
    expect([...plan.keys()].sort()).toEqual(['fall', 'glide', 'idle', 'run', 'walk'])
  })

  it('strips the armature prefix when matching', () => {
    // REGRESSION: lowercasing the whole name yields "human armature|idle", which
    // matches no animation state, so every clip lookup fails silently.
    expect(planClips(QUATERNIUS).get('idle')?.source).toBe('Human Armature|Idle')
  })

  it('substitutes the jump clip for falling', () => {
    expect(planClips(QUATERNIUS).get('fall')?.source).toBe('Human Armature|Jump')
  })

  it('borrows the fall clip for gliding and freezes it', () => {
    expect(planClips(QUATERNIUS).get('glide')).toEqual({
      source: 'Human Armature|Jump',
      freeze: true,
    })
  })

  it('does not freeze clips the model really has', () => {
    expect(planClips(QUATERNIUS).get('idle')?.freeze).toBe(false)
  })

  it('prefers a real glide clip over the frozen substitute', () => {
    const plan = planClips(['Idle', 'Walk', 'Run', 'Jump', 'Glide'])
    expect(plan.get('glide')).toEqual({ source: 'Glide', freeze: false })
  })

  it('prefers a real fall clip over a jump', () => {
    expect(planClips(['Falling', 'Jump']).get('fall')?.source).toBe('Falling')
  })

  it('matches regardless of case', () => {
    expect(planClips(['IDLE']).get('idle')?.source).toBe('IDLE')
  })

  it('accepts sprint as a run clip', () => {
    expect(planClips(['Sprint']).get('run')?.source).toBe('Sprint')
  })

  it('omits states the model cannot cover', () => {
    const plan = planClips(['Idle'])
    expect(plan.has('walk')).toBe(false)
    // With no fall clip there is nothing to borrow, so glide stays absent too.
    expect(plan.has('glide')).toBe(false)
  })

  it('returns an empty plan for a model with no clips', () => {
    expect(planClips([]).size).toBe(0)
  })
})
