import { describe, it, expect } from 'vitest'
import { WEBGL_MESSAGE } from './renderer'

describe('WEBGL_MESSAGE', () => {
  it('explains the problem in plain language', () => {
    expect(WEBGL_MESSAGE.toLowerCase()).toContain('webgl')
  })

  it('tells the player what to do about it', () => {
    expect(WEBGL_MESSAGE.length).toBeGreaterThan(40)
  })
})
