import { describe, it, expect } from 'vitest'
import { pauseReason, pauseOverlayModel, type PauseInputs, type PauseReason } from './pause'

/**
 * All eight combinations of the three inputs, built rather than hand-listed so no
 * combination can be quietly omitted.
 *
 * The exhaustive table is the point. A test that fixes `documentHidden` at false and
 * varies only the other two passes an implementation that ignores `documentHidden`
 * entirely -- which is precisely the input this design added on purpose, because the
 * browser behaviour that would have made it redundant could not be verified.
 */
const ALL_INPUTS: PauseInputs[] = [false, true].flatMap((pointerLocked) =>
  [false, true].flatMap((documentHidden) =>
    [false, true].map((guideOpen) => ({ pointerLocked, documentHidden, guideOpen })),
  ),
)

const label = (i: PauseInputs) =>
  `locked=${i.pointerLocked} hidden=${i.documentHidden} guide=${i.guideOpen}`

describe('pauseReason', () => {
  it('yields null for exactly one of the eight combinations, and it is the right one', () => {
    const playing = ALL_INPUTS.filter((i) => pauseReason(i) === null)
    // Asserted as which combination rather than as a count: a bare toHaveLength(1) would
    // pass an implementation where the wrong single combination is the playing one.
    expect(playing.map(label)).toEqual(['locked=true hidden=false guide=false'])
  })

  it('names a reason for every combination with any pausing cause', () => {
    for (const i of ALL_INPUTS) {
      const anyCause = !i.pointerLocked || i.documentHidden || i.guideOpen
      expect(pauseReason(i) !== null, label(i)).toBe(anyCause)
    }
  })

  it('prefers the guide over every other cause', () => {
    // The guide is the only cause the player chose on purpose, so telling someone who
    // opened it that the game is paused for some other reason would be wrong.
    expect(pauseReason({ pointerLocked: false, documentHidden: true, guideOpen: true }))
      .toBe('guide')
    expect(pauseReason({ pointerLocked: true, documentHidden: true, guideOpen: true }))
      .toBe('guide')
  })

  it('prefers hidden over unlocked', () => {
    // A hidden tab has almost certainly also lost the lock, and the more specific cause
    // is the more useful one to report.
    expect(pauseReason({ pointerLocked: false, documentHidden: true, guideOpen: false }))
      .toBe('hidden')
  })

  it('reports unlocked when that is the only cause', () => {
    expect(pauseReason({ pointerLocked: false, documentHidden: false, guideOpen: false }))
      .toBe('unlocked')
  })

  it('covers every reason across the table, so none is unreachable', () => {
    // A branch nothing can reach is dead code wearing a feature's clothes.
    const reasons = new Set(ALL_INPUTS.map(pauseReason))
    expect(reasons).toEqual(new Set<PauseReason | null>(['guide', 'hidden', 'unlocked', null]))
  })
})

describe('pauseOverlayModel', () => {
  it('is invisible while playing', () => {
    expect(pauseOverlayModel(null, false).visible).toBe(false)
    expect(pauseOverlayModel(null, true).visible).toBe(false)
  })

  it('is invisible for the guide, which is its own full-screen panel', () => {
    // Two stacked panels both saying the game is paused is a defect. The guide's own
    // subtitle already says it.
    expect(pauseOverlayModel('guide', true).visible).toBe(false)
  })

  it('names the game before the first play and says Paused after', () => {
    // Asserted as the exact strings a player reads, not as "the two differ": asserting
    // only difference would pass an implementation that swapped them.
    const first = pauseOverlayModel('unlocked', false)
    expect(first.visible).toBe(true)
    expect(first.title).toBe('Airbender Skies')
    expect(first.action).toBe('Click to play')

    const later = pauseOverlayModel('unlocked', true)
    expect(later.visible).toBe(true)
    expect(later.title).toBe('Paused')
    expect(later.action).toBe('Click to resume')
  })

  it('shows the resume wording when the tab comes back, whatever the reason was', () => {
    // Nobody reads a hidden tab, so this copy only matters on the way back -- at which
    // point it is a resume, not a first play.
    const back = pauseOverlayModel('hidden', true)
    expect(back.title).toBe('Paused')
    expect(back.action).toBe('Click to resume')
  })

  it('offers the guide key whenever the card is visible', () => {
    for (const reason of ['unlocked', 'hidden'] as const) {
      for (const everStarted of [false, true]) {
        expect(pauseOverlayModel(reason, everStarted).hint).toBe('H — guide')
      }
    }
  })

  /**
   * The parameter space is 4 reasons (including null) x 2 everStarted states = 8 points.
   * The cases above assert title/action at only 6 of those -- ('guide', false) was never
   * called at all, and ('hidden', false) was only ever checked through .hint -- so a
   * mutation confined to either point had nothing to catch it. Table-driven so every point
   * is visible at a glance rather than requiring a reader to reconstruct which 6 of 8 the
   * scattered cases above actually cover.
   */
  it('covers every (reason, everStarted) point for visible, title, and action', () => {
    const cases: Array<{
      reason: PauseReason | null
      everStarted: boolean
      visible: boolean
      title: string
      action: string
    }> = [
      { reason: null, everStarted: false, visible: false, title: '', action: '' },
      { reason: null, everStarted: true, visible: false, title: '', action: '' },
      { reason: 'guide', everStarted: false, visible: false, title: '', action: '' },
      { reason: 'guide', everStarted: true, visible: false, title: '', action: '' },
      {
        reason: 'unlocked',
        everStarted: false,
        visible: true,
        title: 'Airbender Skies',
        action: 'Click to play',
      },
      {
        reason: 'unlocked',
        everStarted: true,
        visible: true,
        title: 'Paused',
        action: 'Click to resume',
      },
      {
        reason: 'hidden',
        everStarted: false,
        visible: true,
        title: 'Airbender Skies',
        action: 'Click to play',
      },
      {
        reason: 'hidden',
        everStarted: true,
        visible: true,
        title: 'Paused',
        action: 'Click to resume',
      },
    ]

    for (const { reason, everStarted, visible, title, action } of cases) {
      const model = pauseOverlayModel(reason, everStarted)
      const point = `reason=${reason} everStarted=${everStarted}`
      expect(model.visible, point).toBe(visible)
      expect(model.title, point).toBe(title)
      expect(model.action, point).toBe(action)
    }
  })
})
