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

  it('enumerates all eight combinations of the three inputs', () => {
    // Both numbers the comment above ALL_INPUTS quotes, asserted here rather than left as
    // prose: eight rows, and three fields per row, which is what makes eight the whole
    // space. Distinctness too -- a duplicated row would let the table below look
    // exhaustive while silently missing a point.
    expect(ALL_INPUTS).toHaveLength(8)
    expect(new Set(ALL_INPUTS.map(label)).size).toBe(8)
    for (const i of ALL_INPUTS) {
      expect(Object.keys(i).sort(), label(i))
        .toEqual(['documentHidden', 'guideOpen', 'pointerLocked'])
    }
  })

  /**
   * The exact reason for every one of the eight combinations, in one table.
   *
   * This replaces a weaker test that asserted only `pauseReason(i) !== null` per
   * combination. That one could not fail independently of the null test above -- both
   * pinned non-null-ness at the same single no-cause point, so no mutation reddened one
   * without the other -- and worse, its name sounded as though it pinned the reasons when
   * it pinned only their existence.
   *
   * The point it left uncovered was `locked=true hidden=true guide=false`: nothing in the
   * file asserted an exact reason there, so swapping `pauseReason`'s `'hidden'` for
   * `'unlocked'` on the lock-held branch survived the whole suite. That is the point
   * `documentHidden` exists as a separate input for -- a hidden tab that kept its lock is
   * exactly the state this design could not verify a browser never produces -- so it is
   * the last point that should have been left unpinned.
   */
  it('reports the reason this table names for every combination', () => {
    const expected: Record<string, PauseReason | null> = {
      'locked=false hidden=false guide=false': 'unlocked',
      'locked=false hidden=false guide=true': 'guide',
      'locked=false hidden=true guide=false': 'hidden',
      'locked=false hidden=true guide=true': 'guide',
      'locked=true hidden=false guide=false': null,
      'locked=true hidden=false guide=true': 'guide',
      // The lock is held and the tab is still hidden. See the comment above.
      'locked=true hidden=true guide=false': 'hidden',
      'locked=true hidden=true guide=true': 'guide',
    }
    // Compared as whole objects, so a combination missing from either side fails too
    // rather than being skipped.
    const actual = Object.fromEntries(ALL_INPUTS.map((i) => [label(i), pauseReason(i)]))
    expect(actual).toEqual(expected)
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
   *
   * All four fields of the model, not three. The first version of this table stopped one
   * field short of `hint`, and `hint` is only otherwise touched by the loop above, which
   * visits the two visible reasons and never the invisible ones -- so rewriting the empty
   * hint on the invisible path to some non-empty string survived the whole suite. The
   * empty value is load-bearing rather than incidental: `pause-overlay.ts` writes the
   * model's text even while the card is invisible, precisely so the card never fades in
   * carrying the previous state's wording.
   */
  it('covers every (reason, everStarted) point for all four fields of the model', () => {
    const cases: Array<{
      reason: PauseReason | null
      everStarted: boolean
      visible: boolean
      title: string
      action: string
      hint: string
    }> = [
      { reason: null, everStarted: false, visible: false, title: '', action: '', hint: '' },
      { reason: null, everStarted: true, visible: false, title: '', action: '', hint: '' },
      {
        reason: 'guide',
        everStarted: false,
        visible: false,
        title: '',
        action: '',
        hint: '',
      },
      { reason: 'guide', everStarted: true, visible: false, title: '', action: '', hint: '' },
      {
        reason: 'unlocked',
        everStarted: false,
        visible: true,
        title: 'Airbender Skies',
        action: 'Click to play',
        hint: 'H — guide',
      },
      {
        reason: 'unlocked',
        everStarted: true,
        visible: true,
        title: 'Paused',
        action: 'Click to resume',
        hint: 'H — guide',
      },
      {
        reason: 'hidden',
        everStarted: false,
        visible: true,
        title: 'Airbender Skies',
        action: 'Click to play',
        hint: 'H — guide',
      },
      {
        reason: 'hidden',
        everStarted: true,
        visible: true,
        title: 'Paused',
        action: 'Click to resume',
        hint: 'H — guide',
      },
    ]

    for (const { reason, everStarted, ...want } of cases) {
      const point = `reason=${reason} everStarted=${everStarted}`
      // Compared as a whole object, so a field added to OverlayModel and left out of this
      // table fails here instead of going unasserted the way `hint` did.
      expect(pauseOverlayModel(reason, everStarted), point).toEqual(want)
    }
  })
})
