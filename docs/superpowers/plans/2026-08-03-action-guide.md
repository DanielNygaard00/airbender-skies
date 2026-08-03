# In-Game Action Guide Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A panel opened with `H` listing every movement and action, with live availability, for players and testers.

**Architecture:** Three modules under `src/ui/guide/`. `actions.ts` is the catalogue and its availability predicates, which call the game's own exported predicates rather than restating rules. `reference.ts` is static data — combos, meters, wind legend. `panel.ts` splits like `hud.ts` does: a pure `guideModelFor` plus the DOM. The guide owns its own `keydown` listener and never touches `InputState`, and `main.ts` pauses by skipping the stepper.

**Tech Stack:** TypeScript 7, three.js 0.185.1, Vitest 4 in the `node` environment, Vite 8.

**Spec:** `docs/superpowers/specs/2026-08-03-action-guide-design.md`

## Global Constraints

- **Branch:** all work lands on `action-guide`. Do not commit to `main` — pushing `main` triggers the GitHub Pages deploy.
- **Typecheck is two passes:** `npm run typecheck` runs `tsconfig.json` then `tsconfig.test.json`. Both must be clean. App code deliberately cannot see Node globals; only tests can, which is why the README-reading test works.
- **`noUncheckedIndexedAccess` is on.** Indexed access is `T | undefined` and must be narrowed.
- **Do NOT modify `src/core/types.ts` or `src/core/input.ts`.** The guide deliberately does not route through `InputState`. If you find yourself wanting to add a field there, stop and re-read §4 of the spec — doing so reintroduces a real bug.
- **Do NOT modify `src/player/controller.ts`, `ground-move.ts`, `flight.ts`, `dash.ts`, `jump.ts`, or anything under `src/combat/` or `src/focus/`.** This feature only reads.
- **Availability must call the exported predicates** (`canDash`, `canAirJump`), never reimplement them.
- **Comments explain *why*, not what.** Match the surrounding file's density.
- Run tests with `npx vitest run <path>`; the full suite with `npm test`.
- **Commit messages in normal prose**, imperative mood, ending with:
  `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`

---

### Task 1: The action catalogue

**Files:**
- Create: `src/ui/guide/actions.ts`
- Create: `src/ui/guide/actions.test.ts`
- Modify: `README.md` — add an `H` row to the controls table

**Interfaces:**
- Consumes: `canDash` and `DashState` from `src/player/dash.ts`; `canAirJump` from `src/player/jump.ts`; `PlayerState`, `GroundConfig`, `PlayerMode` from `src/core/types.ts`; `PressureWaveConfig` from `src/combat/pressure-wave.ts`. All already exist.
- Produces:
  - `type ActionMode = 'ground' | 'glider' | 'both'`
  - `interface ActionContext { player: PlayerState; ground: GroundConfig; wave: PressureWaveConfig; gustReady: boolean; avatarStateReady: boolean }`
  - `interface GameAction { key: string; press?: string; name: string; detail: string; mode: ActionMode; available(ctx: ActionContext): boolean }`
  - `ACTIONS: readonly GameAction[]`
  - `actionKeys(): string[]` — individual physical keys, deduplicated and sorted

- [ ] **Step 1: Add the `H` row to the README**

The drift test in this task fails until this exists. In `README.md`'s controls table, after the `Space` row:

```markdown
| `H` | Guide — every action, and whether you can use it right now | Guide |
```

- [ ] **Step 2: Write the failing test**

Create `src/ui/guide/actions.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { Vector3 } from 'three'
import { ACTIONS, actionKeys, type ActionContext } from './actions'
import { DEFAULT_GROUND_CONFIG } from '../../core/config'
import { DEFAULT_COMBAT_CONFIG } from '../../combat/config'
import type { PlayerState } from '../../core/types'

const README = fileURLToPath(new URL('../../../README.md', import.meta.url))

const p = (over: Partial<PlayerState> = {}): PlayerState => ({
  mode: 'ground', position: new Vector3(), velocity: new Vector3(),
  forward: new Vector3(0, 0, 1), breath: 100, maxBreath: 100,
  grounded: true, lastGroundIslandId: null, airJumpsUsed: 0, chargeTime: 0,
  scooterActive: false, scooterCharge: 0, dashesUsed: 0, dashRecovery: 0, ...over,
})

const ctx = (over: Partial<ActionContext> = {}): ActionContext => ({
  player: p(),
  ground: DEFAULT_GROUND_CONFIG,
  wave: DEFAULT_COMBAT_CONFIG.pressureWave,
  gustReady: true,
  avatarStateReady: false,
  ...over,
})

/** Look an action up by the name shown to the player. */
function action(name: string) {
  const found = ACTIONS.find((a) => a.name === name)
  if (!found) throw new Error(`no action named "${name}"`)
  return found
}

const can = (name: string, over: Partial<ActionContext> = {}) =>
  action(name).available(ctx(over))

describe('the catalogue covers the game', () => {
  it('lists an action for every key the README documents', () => {
    // Both directions, so neither list can grow without the other. The failure
    // message has to name the offender, or a mismatch is a puzzle rather than a bug
    // report.
    const inCatalogue = actionKeys()
    const inReadme = readmeKeys()
    expect({ missingFromCatalogue: inReadme.filter((k) => !inCatalogue.includes(k)) })
      .toEqual({ missingFromCatalogue: [] })
    expect({ missingFromReadme: inCatalogue.filter((k) => !inReadme.includes(k)) })
      .toEqual({ missingFromReadme: [] })
  })

  it('gives every action a name and a detail', () => {
    for (const a of ACTIONS) {
      expect(a.name.length, `action on ${a.key} has no name`).toBeGreaterThan(0)
      expect(a.detail.length, `${a.name} has no detail`).toBeGreaterThan(0)
    }
  })

  it('answers availability for every action in both modes without throwing', () => {
    // Cheap guard against a predicate reading a field its own mode never has.
    for (const a of ACTIONS) {
      expect(typeof a.available(ctx({ player: p({ mode: 'ground' }) }))).toBe('boolean')
      expect(typeof a.available(ctx({ player: p({ mode: 'glider', grounded: false }) })))
        .toBe('boolean')
    }
  })
})

describe('availability on the ground', () => {
  it('offers the dash while standing', () => {
    expect(can('Air blast dash')).toBe(true)
  })

  it('withholds the dash in mid-air', () => {
    // Found only by playing, during the ground-kit work: the dash used to fire in
    // mid-air. The guide has to agree with the rule that fixed it.
    expect(can('Air blast dash', { player: p({ grounded: false }) })).toBe(false)
  })

  it('withholds the dash once the chain is spent', () => {
    expect(can('Air blast dash', {
      player: p({ dashesUsed: DEFAULT_GROUND_CONFIG.maxDashChain }),
    })).toBe(false)
  })

  it('withholds the dash during recovery', () => {
    expect(can('Air blast dash', { player: p({ dashRecovery: 0.4 }) })).toBe(false)
  })

  it('withholds the air scooter in mid-air', () => {
    expect(can('Air scooter', { player: p({ grounded: false }) })).toBe(false)
  })

  it('offers jumping while standing and not while airborne', () => {
    expect(can('Jump')).toBe(true)
    expect(can('Jump', { player: p({ grounded: false }) })).toBe(false)
  })
})

describe('the double jump and the deploy are mutually exclusive', () => {
  it('offers the double jump with the air jump unspent, and the deploy only once spent', () => {
    // Asserted as a pair on purpose. Tested apart, an implementation where BOTH are
    // always true would pass each test individually — and that is exactly the bug,
    // because the escalation chain is the whole reason the combo takes two presses.
    const unspent = { player: p({ grounded: false, airJumpsUsed: 0 }) }
    const spent = {
      player: p({ grounded: false, airJumpsUsed: DEFAULT_GROUND_CONFIG.maxAirJumps }),
    }
    expect(can('Double jump', unspent)).toBe(true)
    expect(can('Deploy the glider', unspent)).toBe(false)
    expect(can('Double jump', spent)).toBe(false)
    expect(can('Deploy the glider', spent)).toBe(true)
  })
})

describe('availability in the air', () => {
  const gliding = (over: Partial<PlayerState> = {}) =>
    ({ player: p({ mode: 'glider', grounded: false, ...over }) })

  it('offers thrust and hover while there is breath', () => {
    expect(can('Airbending thrust', gliding())).toBe(true)
    expect(can('Hover', gliding())).toBe(true)
  })

  it('withholds thrust and hover at empty breath', () => {
    expect(can('Airbending thrust', gliding({ breath: 0 }))).toBe(false)
    expect(can('Hover', gliding({ breath: 0 }))).toBe(false)
  })

  it('withholds thrust on the ground', () => {
    expect(can('Airbending thrust')).toBe(false)
  })
})

describe('the Pressure Wave', () => {
  const wave = DEFAULT_COMBAT_CONFIG.pressureWave

  it('is unavailable while standing on the ground', () => {
    expect(can('Pressure Wave')).toBe(false)
  })

  it('is unavailable falling slower than the slam threshold', () => {
    expect(can('Pressure Wave', {
      player: p({ grounded: false, velocity: new Vector3(0, -(wave.minImpactSpeed - 2), 0) }),
    })).toBe(false)
  })

  it('is available falling faster than the slam threshold', () => {
    expect(can('Pressure Wave', {
      player: p({ grounded: false, velocity: new Vector3(0, -(wave.minImpactSpeed + 10), 0) }),
    })).toBe(true)
  })

  it('is unavailable while rising, however fast', () => {
    expect(can('Pressure Wave', {
      player: p({ grounded: false, velocity: new Vector3(0, 40, 0) }),
    })).toBe(false)
  })
})

describe('actions owned by other systems', () => {
  it('follows the gust readiness it is handed', () => {
    expect(can('Gust', { gustReady: true })).toBe(true)
    expect(can('Gust', { gustReady: false })).toBe(false)
  })

  it('follows the Avatar State readiness it is handed', () => {
    expect(can('Avatar State', { avatarStateReady: true })).toBe(true)
    expect(can('Avatar State', { avatarStateReady: false })).toBe(false)
  })

  it('always offers this guide', () => {
    expect(can('This guide')).toBe(true)
    expect(can('This guide', { player: p({ mode: 'glider', grounded: false }) })).toBe(true)
  })
})

/**
 * The keys the README's controls table documents.
 *
 * Every key in that table is in backticks except `Mouse`, which is bare, so backticks
 * are stripped when present rather than required — otherwise the test fails on a row
 * that is perfectly correct. Compound cells like "`W` / `S`" split into their parts, so
 * both sides of the comparison are individual physical keys.
 */
function readmeKeys(): string[] {
  const lines = readFileSync(README, 'utf8').split('\n')
  const header = lines.findIndex((line) => line.startsWith('| Input'))
  if (header < 0) throw new Error('no controls table found in README.md')

  const keys: string[] = []
  for (const line of lines.slice(header + 2)) {
    if (!line.startsWith('|')) break
    const cell = line.split('|')[1]
    if (cell === undefined) continue
    for (const part of cell.split('/')) {
      const key = part.trim().replace(/`/g, '')
      if (key.length > 0) keys.push(key)
    }
  }
  return [...new Set(keys)].sort()
}
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run src/ui/guide/actions.test.ts`
Expected: FAIL — cannot resolve `./actions`.

- [ ] **Step 4: Write minimal implementation**

Create `src/ui/guide/actions.ts`:

```ts
import type { GroundConfig, PlayerState } from '../../core/types'
import type { PressureWaveConfig } from '../../combat/pressure-wave'
import { canDash } from '../../player/dash'
import { canAirJump } from '../../player/jump'

/**
 * Every action the player can perform, and whether they can perform it now.
 *
 * The availability predicates call the game's own exported predicates rather than
 * restating their rules. That is the whole point of this module: a guide that
 * reimplements the rules drifts, and a guide that lies to a tester is worse than no
 * guide at all. Where a rule has no importable predicate, the comment names where the
 * original lives so the two can be checked against each other by hand.
 */
export type ActionMode = 'ground' | 'glider' | 'both'

export interface ActionContext {
  player: PlayerState
  /** `canDash` and `canAirJump` both need it. */
  ground: GroundConfig
  /** For the Pressure Wave's fall-speed threshold. */
  wave: PressureWaveConfig
  /**
   * A gust is off cooldown, and the Avatar State is armed and not already running.
   *
   * Passed in rather than computed here: both live on other systems' structs — an
   * Encounter and an AvatarState — which have no business in a UI module. The caller
   * asks `canGust` and `isArmed`, so no rule is restated either way.
   */
  gustReady: boolean
  avatarStateReady: boolean
}

export interface GameAction {
  /**
   * The physical key, spelled as the README's controls table spells it. The drift test
   * compares these against that table in both directions.
   */
  key: string
  /** How it is pressed, when that distinguishes it from another action on the same key. */
  press?: string
  name: string
  detail: string
  mode: ActionMode
  available(ctx: ActionContext): boolean
}

const always = (): boolean => true
const onGround = (ctx: ActionContext): boolean => ctx.player.mode === 'ground'
const inGlider = (ctx: ActionContext): boolean => ctx.player.mode === 'glider'
const standing = (ctx: ActionContext): boolean => onGround(ctx) && ctx.player.grounded
const airborne = (ctx: ActionContext): boolean => onGround(ctx) && !ctx.player.grounded
/** Gliding with breath left: both thrust and hover spend it, and neither works empty. */
const hasBreath = (ctx: ActionContext): boolean => inGlider(ctx) && ctx.player.breath > 0

export const ACTIONS: readonly GameAction[] = [
  {
    key: 'Mouse', name: 'Look / trim', mode: 'both', available: always,
    detail: 'Look around on foot. In the glider it trims — the nose drifts toward where you look.',
  },
  {
    key: 'W / S', name: 'Walk forward / back', mode: 'ground', available: onGround,
    detail: 'The run eases up to speed and slides on stops rather than snapping.',
  },
  {
    key: 'W', name: 'Airbending thrust', mode: 'glider', available: hasBreath,
    detail: 'The only way to gain net altitude. Spends breath.',
  },
  {
    key: 'S', name: 'Flare', mode: 'glider', available: inGlider,
    detail: 'Raise the nose to trade speed for a moment of lift.',
  },
  {
    key: 'A / D', name: 'Strafe', mode: 'ground', available: onGround,
    detail: 'Step sideways without turning.',
  },
  {
    key: 'A / D', name: 'Weight shift', mode: 'glider', available: inGlider,
    detail: 'This is how you steer. The mouse only trims; the turn comes from here.',
  },
  {
    key: 'Shift', press: 'tap', name: 'Air scooter', mode: 'ground', available: standing,
    detail: 'Tap to ride, tap to step off. Doubles your speed and halves your steering; ' +
      'holding a clean line builds a hidden charge that makes it faster still.',
  },
  {
    key: 'Shift', press: 'hold', name: 'Hover', mode: 'glider', available: hasBreath,
    detail: 'Hold station in mid-air. The most expensive thing you can do with breath.',
  },
  {
    key: 'Q', name: 'Air blast dash', mode: 'ground',
    detail: 'Three in a chain, then a short recovery. Ground only.',
    // canDash covers the chain and the recovery; controllerStep separately requires
    // grounded. See src/player/controller.ts for that half of the gate.
    available: (ctx) => standing(ctx)
      && canDash({ used: ctx.player.dashesUsed, recovery: ctx.player.dashRecovery }, ctx.ground),
  },
  {
    key: 'F', name: 'Gust', mode: 'both', available: (ctx) => ctx.gustReady,
    detail: 'A wide sweep of air. Knocks enemies back and interrupts a strike; barely hurts them.',
  },
  {
    key: 'E', name: 'Avatar State', mode: 'both', available: (ctx) => ctx.avatarStateReady,
    detail: 'Once the pip under your Focus bar is full. Eight seconds of free breath, ' +
      'a gust that downs a soldier outright, and every wind feature turning to your side.',
  },
  {
    key: 'Ctrl', press: 'hold', name: 'Tuck', mode: 'glider', available: inGlider,
    detail: 'Fold the wings for a fast dive.',
  },
  {
    key: 'Ctrl', press: 'hold through a landing', name: 'Pressure Wave', mode: 'both',
    detail: 'Turn a fall into a ground slam. The harder the landing, the wider and heavier ' +
      'the blast — a committed dive downs a soldier outright, and it throws you back up.',
    // The fall-speed threshold lives inside detectSlam, which needs a landing to test,
    // so it is restated here. See src/player/slam.ts.
    available: (ctx) => !ctx.player.grounded
      && -ctx.player.velocity.y >= ctx.wave.minImpactSpeed,
  },
  {
    key: 'Space', press: 'tap', name: 'Jump', mode: 'ground', available: standing,
    detail: 'A short hop.',
  },
  {
    key: 'Space', press: 'hold, then release', name: 'Charged jump', mode: 'ground',
    available: standing,
    detail: 'Hold to crouch and charge, release to launch. Roughly five times the height.',
  },
  {
    key: 'Space', press: 'tap, airborne', name: 'Double jump', mode: 'ground',
    detail: 'Gains more height the faster you are already rising.',
    available: (ctx) => airborne(ctx) && canAirJump(ctx.player, ctx.ground),
  },
  {
    key: 'Space', press: 'tap, airborne, jump spent', name: 'Deploy the glider',
    mode: 'ground',
    detail: 'The wings snap open and keep your momentum, plus an upward kick. Space ' +
      'escalates: jump, then double jump, then deploy.',
    available: (ctx) => airborne(ctx) && !canAirJump(ctx.player, ctx.ground),
  },
  {
    key: 'Space', name: 'Stow the glider', mode: 'glider', available: inGlider,
    detail: 'Fold the wings back into a walking stick.',
  },
  {
    key: 'H', name: 'This guide', mode: 'both', available: always,
    detail: 'Opens and closes this panel, and pauses while it is open.',
  },
]

/**
 * Every physical key the catalogue uses, deduplicated and sorted.
 *
 * Compound keys like "W / S" split into their parts, so this can be compared against
 * the README's table key for key.
 */
export function actionKeys(): string[] {
  const keys = ACTIONS.flatMap((action) => action.key.split('/').map((part) => part.trim()))
  return [...new Set(keys)].sort()
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/ui/guide/actions.test.ts`
Expected: PASS.

If the drift test fails, read its message: it names which keys are missing from which side. Either the README row from Step 1 is missing, or a catalogue key is misspelled relative to the table.

- [ ] **Step 6: Prove the tests are not decorative**

One at a time, reverting after each:

1. Remove the `H` row from `README.md`. Expected: the drift test FAILS naming `H` as missing from the README. Revert.
2. Change the deploy's predicate to `airborne(ctx) && canAirJump(...)` — the same as the double jump. Expected: the mutual-exclusion test FAILS. Revert.
3. Change `hasBreath` to drop the `> 0` check (`inGlider(ctx)` only). Expected: the empty-breath test FAILS. Revert.
4. Change the Pressure Wave's predicate to drop `-ctx.player.velocity.y >= ctx.wave.minImpactSpeed`. Expected: the slower-than-threshold and rising tests FAIL. Revert.
5. Change the dash's predicate to drop `standing(ctx)` in favour of `onGround(ctx)`. Expected: the mid-air dash test FAILS. Revert.

- [ ] **Step 7: Typecheck and full suite**

Run: `npm run typecheck && npm test`
Expected: both passes clean, whole suite green.

- [ ] **Step 8: Commit**

```bash
git add src/ui/guide/actions.ts src/ui/guide/actions.test.ts README.md
git commit -m "Catalogue every action, with availability from the game's own predicates

The availability predicates call canDash and canAirJump rather than restating
their rules, because a guide that reimplements the rules drifts, and a guide that
lies to a tester is worse than no guide. The two rules with no importable
predicate — the dash's ground requirement and the slam's fall-speed threshold —
carry comments naming where the original lives.

A test compares the catalogue's keys against the README's controls table in both
directions, so neither list can grow without the other.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: The reference sections

**Files:**
- Create: `src/ui/guide/reference.ts`
- Create: `src/ui/guide/reference.test.ts`

**Interfaces:**
- Consumes: `WindKind` from `src/world/wind.ts`; `actionKeys` from `src/ui/guide/actions.ts` (Task 1) — used by the test only.
- Produces:
  - `interface Combo { name: string; keys: string[]; detail: string }`
  - `COMBOS: readonly Combo[]`
  - `interface MeterNote { name: string; detail: string }`
  - `METERS: readonly MeterNote[]`
  - `WIND_LEGEND: Record<WindKind, string>`

- [ ] **Step 1: Write the failing test**

Create `src/ui/guide/reference.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { COMBOS, METERS, WIND_LEGEND } from './reference'
import { actionKeys } from './actions'
import { ARCHIPELAGO } from '../../world/levels/archipelago'

describe('COMBOS', () => {
  it('only names keys the game actually has', () => {
    // A combo citing a key that does not exist is a lie a tester would chase.
    const known = actionKeys()
    for (const combo of COMBOS) {
      for (const key of combo.keys) {
        expect(known, `combo "${combo.name}" names unknown key "${key}"`).toContain(key)
      }
    }
  })

  it('gives every combo a name, keys and a detail', () => {
    expect(COMBOS.length).toBeGreaterThan(0)
    for (const combo of COMBOS) {
      expect(combo.name.length).toBeGreaterThan(0)
      expect(combo.keys.length).toBeGreaterThan(0)
      expect(combo.detail.length).toBeGreaterThan(0)
    }
  })
})

describe('METERS', () => {
  it('explains all three bars on the HUD', () => {
    // The HUD draws three unlabelled bars; leaving one unexplained is the gap this
    // section exists to close.
    expect(METERS.map((m) => m.name)).toEqual(['Breath', 'Focus', 'Health'])
  })

  it('gives every meter a detail', () => {
    for (const meter of METERS) expect(meter.detail.length).toBeGreaterThan(0)
  })
})

describe('WIND_LEGEND', () => {
  it('labels every wind kind the level actually places', () => {
    // Type-level exhaustiveness already forces an entry per WindKind. This checks the
    // other direction: that the kinds the archipelago really uses are all described.
    for (const def of ARCHIPELAGO.winds ?? []) {
      expect(WIND_LEGEND[def.kind]?.length ?? 0).toBeGreaterThan(0)
    }
  })

  it('describes which way each kind pushes', () => {
    for (const [kind, text] of Object.entries(WIND_LEGEND)) {
      expect(text.length, `${kind} has no description`).toBeGreaterThan(0)
    }
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/ui/guide/reference.test.ts`
Expected: FAIL — cannot resolve `./reference`.

- [ ] **Step 3: Write minimal implementation**

Create `src/ui/guide/reference.ts`:

```ts
import type { WindKind } from '../../world/wind'

/**
 * The parts of the guide that are not a key with a rule: the chains that emerge from
 * combining moves, what the HUD's three bars mean, and what the mote clouds are.
 *
 * All static. Nothing here reads game state.
 */
export interface Combo {
  name: string
  /**
   * The physical keys involved, in order. Structured rather than buried in the prose so
   * a test can check they all exist — a combo citing a key the game does not have is a
   * lie a tester would waste time chasing.
   */
  keys: string[]
  detail: string
}

export const COMBOS: readonly Combo[] = [
  {
    name: 'Dive into a slam, and back into the air',
    keys: ['Ctrl', 'Space', 'Space'],
    detail: 'Tuck into a dive, hold Ctrl through the landing to slam, then Space twice on ' +
      'the way back up — once for the double jump, once to open the wings. The flagship ' +
      'chain: the harder the dive, the heavier the slam and the higher the bounce.',
  },
  {
    name: 'Deploy out of a rising jump',
    keys: ['Space'],
    detail: 'Deploying while you are still rising climbs higher than either the jump or ' +
      'the deploy alone, because the wings keep your momentum and add a kick on top of it.',
  },
  {
    name: 'Three dashes and a recovery',
    keys: ['Q'],
    detail: 'The dash chains three times before it needs a moment back. An unspent chain ' +
      'never expires, so you can hold the third one for when you need it.',
  },
  {
    name: 'Ride the air rather than fight it',
    keys: ['W', 'A', 'D'],
    detail: 'Thrust costs breath; a thermal does not. Steering into a mote cloud and ' +
      'circling inside it climbs for free, and it builds Focus about twice as fast.',
  },
]

export interface MeterNote {
  name: string
  detail: string
}

/**
 * Ordered by how much the player has to think about them, not by how the HUD stacks
 * them — the HUD's order is Focus, health, breath top to bottom, and leading a written
 * explanation with Focus would explain the subtlest meter first. Each entry names its
 * own colour and position instead.
 */
export const METERS: readonly MeterNote[] = [
  {
    name: 'Breath',
    detail: 'Flight fuel, in blue at the bottom. Thrust spends it and hovering spends it ' +
      'fastest, because holding station carries the glider\'s whole weight. Refills when ' +
      'you are not spending it, faster on the ground. Air shrines raise the maximum.',
  },
  {
    name: 'Focus',
    detail: 'The gold bar. Builds while you hold a clean line — gliding above stall, and ' +
      'about twice as fast riding a wind feature — and much faster in a fight. Standing ' +
      'still drains it, and a hit takes nearly a third. The longer you go unbroken the ' +
      'better everything pays. Hold it at full and the thin pip beneath it fills; once ' +
      'that is full, E spends the lot on the Avatar State.',
  },
  {
    name: 'Health',
    detail: 'The orange bar, and it only appears once you have lost some. Small on ' +
      'purpose, and it regenerates slowly once you are out of combat. You are never ' +
      'killed by a fall, and neither is anyone else by you — enemies are downed.',
  },
]

/**
 * What the mote clouds mean.
 *
 * Typed as a Record over WindKind, so adding a sixth kind of wind fails to compile
 * until it is documented here. Cheaper and stronger than a test that could be deleted.
 */
export const WIND_LEGEND: Record<WindKind, string> = {
  thermal: 'Rising column. Circle inside it to climb without spending breath.',
  ridge: 'Lift running along a slope. Follow the edge to stay up.',
  river: 'A horizontal current. Enter it going the same way and it hands you speed.',
  downdraft: 'Pushes down. Cross it fast, or thrust through it.',
  dead: 'Still air that gives the wing nothing. Your lift drops to almost nothing until ' +
    'you are clear of it.',
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/ui/guide/reference.test.ts`
Expected: PASS.

- [ ] **Step 5: Prove the tests are not decorative**

One at a time, reverting after each:

1. In `COMBOS`, change the dive combo's `keys` to `['Ctrl', 'Space', 'Z']`. Expected: the unknown-key test FAILS naming `Z`. Revert.
2. Remove the `Health` entry from `METERS`. Expected: the three-bars test FAILS. Revert.
3. Change `WIND_LEGEND.dead` to an empty string. Expected: the describes-each-kind test FAILS naming `dead`. Revert.
4. Delete the `river` key from `WIND_LEGEND` entirely. Expected: **the typecheck fails**, not a test — run `npm run typecheck` to confirm the `Record<WindKind, string>` is doing its job. Revert.

- [ ] **Step 6: Typecheck and full suite**

Run: `npm run typecheck && npm test`
Expected: clean and green.

- [ ] **Step 7: Commit**

```bash
git add src/ui/guide/reference.ts src/ui/guide/reference.test.ts
git commit -m "Add the guide's reference sections: combos, meters, wind legend

Combos are structured rather than prose so a test can check every key they name
exists, and the wind legend is a Record over WindKind so a sixth kind of wind
fails to compile until it is documented.

The meters section exists because the HUD draws three unlabelled bars, so their
meaning is currently guesswork.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: The view model and the panel

**Files:**
- Create: `src/ui/guide/panel.ts`
- Create: `src/ui/guide/panel.test.ts`

**Interfaces:**
- Consumes: `ACTIONS`, `ActionContext`, `GameAction` from `./actions` (Task 1); `COMBOS`, `METERS`, `WIND_LEGEND`, `Combo`, `MeterNote` from `./reference` (Task 2); `PlayerMode` from `src/core/types.ts`; `WindKind` from `src/world/wind.ts`.
- Produces:
  - `interface GuideRow { key: string; press?: string; name: string; detail: string; available: boolean }`
  - `interface GuideModel { ground: GuideRow[]; glider: GuideRow[]; current: PlayerMode; combos: readonly Combo[]; meters: readonly MeterNote[]; wind: Record<WindKind, string> }`
  - `guideModelFor(ctx: ActionContext): GuideModel`
  - `createGuide(parent: HTMLElement, onToggle: () => void): Guide` where `Guide` is `{ isOpen(): boolean; open(): void; close(): void; toggle(): void; update(model: GuideModel): void; dispose(): void }`

- [ ] **Step 1: Write the failing test**

Create `src/ui/guide/panel.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { Vector3 } from 'three'
import { guideModelFor } from './panel'
import type { ActionContext } from './actions'
import { DEFAULT_GROUND_CONFIG } from '../../core/config'
import { DEFAULT_COMBAT_CONFIG } from '../../combat/config'
import type { PlayerState } from '../../core/types'

const p = (over: Partial<PlayerState> = {}): PlayerState => ({
  mode: 'ground', position: new Vector3(), velocity: new Vector3(),
  forward: new Vector3(0, 0, 1), breath: 100, maxBreath: 100,
  grounded: true, lastGroundIslandId: null, airJumpsUsed: 0, chargeTime: 0,
  scooterActive: false, scooterCharge: 0, dashesUsed: 0, dashRecovery: 0, ...over,
})

const ctx = (over: Partial<ActionContext> = {}): ActionContext => ({
  player: p(),
  ground: DEFAULT_GROUND_CONFIG,
  wave: DEFAULT_COMBAT_CONFIG.pressureWave,
  gustReady: true,
  avatarStateReady: false,
  ...over,
})

const names = (rows: { name: string }[]) => rows.map((r) => r.name)

describe('guideModelFor', () => {
  it('puts a ground-only action in the ground column alone', () => {
    const model = guideModelFor(ctx())
    expect(names(model.ground)).toContain('Air blast dash')
    expect(names(model.glider)).not.toContain('Air blast dash')
  })

  it('puts a glider-only action in the glider column alone', () => {
    const model = guideModelFor(ctx())
    expect(names(model.glider)).toContain('Hover')
    expect(names(model.ground)).not.toContain('Hover')
  })

  it('puts a both-mode action in both columns', () => {
    const model = guideModelFor(ctx())
    expect(names(model.ground)).toContain('Gust')
    expect(names(model.glider)).toContain('Gust')
  })

  it('reports which mode the player is in', () => {
    expect(guideModelFor(ctx()).current).toBe('ground')
    expect(guideModelFor(ctx({ player: p({ mode: 'glider', grounded: false }) })).current)
      .toBe('glider')
  })

  it('keeps an unavailable action in the model rather than dropping it', () => {
    // The panel dims rather than hides. A tester needs to see that the dash exists and
    // is currently impossible — a vanished row reads as a missing feature.
    const airborne = guideModelFor(ctx({ player: p({ grounded: false }) }))
    const dash = airborne.ground.find((r) => r.name === 'Air blast dash')
    expect(dash).toBeDefined()
    expect(dash?.available).toBe(false)
  })

  it('marks an available action available', () => {
    const dash = guideModelFor(ctx()).ground.find((r) => r.name === 'Air blast dash')
    expect(dash?.available).toBe(true)
  })

  it('carries the reference sections through', () => {
    const model = guideModelFor(ctx())
    expect(model.combos.length).toBeGreaterThan(0)
    expect(model.meters.length).toBe(3)
    expect(Object.keys(model.wind).length).toBe(5)
  })

  it('carries the press qualifier through, so two actions on one key are told apart', () => {
    const rows = guideModelFor(ctx()).ground.filter((r) => r.key === 'Space')
    // Jump, charged jump, double jump and deploy all live on Space.
    expect(rows.length).toBeGreaterThan(2)
    for (const row of rows) expect(row.press?.length ?? 0).toBeGreaterThan(0)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/ui/guide/panel.test.ts`
Expected: FAIL — cannot resolve `./panel`.

- [ ] **Step 3: Write minimal implementation**

Create `src/ui/guide/panel.ts`:

```ts
import type { PlayerMode } from '../../core/types'
import type { WindKind } from '../../world/wind'
import { ACTIONS, type ActionContext } from './actions'
import { COMBOS, METERS, WIND_LEGEND, type Combo, type MeterNote } from './reference'

/**
 * The guide panel: a pure model function, then the DOM, split the way hud.ts splits.
 *
 * The panel never reads game state. It is handed a model and draws it, which is what
 * keeps the interesting half testable in a node environment.
 */
export interface GuideRow {
  key: string
  press?: string
  name: string
  detail: string
  available: boolean
}

export interface GuideModel {
  ground: GuideRow[]
  glider: GuideRow[]
  /** So the panel can emphasise the column that applies right now. */
  current: PlayerMode
  combos: readonly Combo[]
  meters: readonly MeterNote[]
  wind: Record<WindKind, string>
}

export function guideModelFor(ctx: ActionContext): GuideModel {
  const rows = (mode: PlayerMode): GuideRow[] => ACTIONS
    .filter((action) => action.mode === mode || action.mode === 'both')
    .map((action) => ({
      key: action.key,
      ...(action.press === undefined ? {} : { press: action.press }),
      name: action.name,
      detail: action.detail,
      available: action.available(ctx),
    }))

  return {
    ground: rows('ground'),
    glider: rows('glider'),
    current: ctx.player.mode,
    combos: COMBOS,
    meters: METERS,
    wind: WIND_LEGEND,
  }
}

const STYLE = `
.guide { position: fixed; inset: 0; display: none; overflow-y: auto;
  background: rgba(8,14,22,.86); color: #f3f6fb; pointer-events: none;
  font: 400 13px/1.5 system-ui, sans-serif; padding: 32px clamp(16px, 5vw, 64px); }
.guide.is-open { display: block; }
.guide h1 { font-size: 20px; font-weight: 600; margin: 0 0 4px; }
.guide .guide-sub { opacity: .6; margin: 0 0 24px; }
.guide h2 { font-size: 14px; font-weight: 600; letter-spacing: .04em;
  text-transform: uppercase; opacity: .75; margin: 24px 0 8px; }
.guide-cols { display: flex; flex-wrap: wrap; gap: 32px; }
.guide-col { flex: 1 1 320px; min-width: 0; transition: opacity .2s; }
.guide-col.is-dim { opacity: .45; }
.guide-row { display: flex; gap: 10px; padding: 4px 0; align-items: baseline; }
.guide-row.is-off { opacity: .38; }
.guide-row.is-off .guide-name { text-decoration: line-through; }
.guide-key { flex: 0 0 132px; font-family: ui-monospace, monospace; font-size: 12px;
  color: #d9f4ff; }
.guide-key .guide-press { opacity: .55; }
.guide-name { font-weight: 600; }
.guide-detail { opacity: .72; }
.guide-note { padding: 6px 0; }
.guide-note-name { font-weight: 600; color: #ffe9a8; }
`

/** Column headings, so the markup does not repeat the strings. */
const HEADINGS: Record<PlayerMode, string> = { ground: 'On foot', glider: 'In the glider' }

export interface Guide {
  isOpen(): boolean
  open(): void
  close(): void
  toggle(): void
  update(model: GuideModel): void
  dispose(): void
}

function escape(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function rowHtml(row: GuideRow): string {
  const press = row.press === undefined ? '' : ` <span class="guide-press">${escape(row.press)}</span>`
  return `<div class="guide-row${row.available ? '' : ' is-off'}">
    <span class="guide-key">${escape(row.key)}${press}</span>
    <span><span class="guide-name">${escape(row.name)}</span>
    <span class="guide-detail">— ${escape(row.detail)}</span></span>
  </div>`
}

function columnHtml(mode: PlayerMode, rows: GuideRow[], current: PlayerMode): string {
  return `<div class="guide-col${mode === current ? '' : ' is-dim'}">
    <h2>${HEADINGS[mode]}</h2>${rows.map(rowHtml).join('')}
  </div>`
}

function notesHtml(title: string, notes: readonly { name: string; detail: string }[]): string {
  return `<h2>${title}</h2>${notes.map((note) => `<div class="guide-note">
    <span class="guide-note-name">${escape(note.name)}</span>
    <span class="guide-detail">— ${escape(note.detail)}</span></div>`).join('')}`
}

/**
 * Build the panel and give it its own keyboard.
 *
 * The guide deliberately does not go through InputState. The stepper runs fixed
 * sub-steps and can call update more than once per rendered frame, so one sampled
 * input shared across those sub-steps would let an edge-triggered action fire twice —
 * a single Space spending two jumps. Handling these two keys directly, the way the
 * canvas already handles its pointer-lock click, avoids that entirely.
 */
export function createGuide(parent: HTMLElement, onToggle: () => void): Guide {
  const style = document.createElement('style')
  style.textContent = STYLE
  document.head.append(style)

  const root = document.createElement('div')
  root.className = 'guide'
  parent.append(root)

  let open = false

  const api: Guide = {
    isOpen: () => open,
    open(): void {
      if (open) return
      open = true
      root.classList.add('is-open')
      onToggle()
    },
    close(): void {
      if (!open) return
      open = false
      root.classList.remove('is-open')
      onToggle()
    },
    toggle(): void {
      if (open) api.close()
      else api.open()
    },
    update(model: GuideModel): void {
      root.innerHTML = `
        <h1>Everything you can do</h1>
        <p class="guide-sub">The game is paused. H or Escape to close. Struck-through
          actions are unavailable right now; the dimmed column is your other stance.</p>
        <div class="guide-cols">
          ${columnHtml('ground', model.ground, model.current)}
          ${columnHtml('glider', model.glider, model.current)}
        </div>
        ${notesHtml('Chains worth trying', model.combos.map((c) => ({
          name: c.name, detail: `${c.keys.join(' → ')} — ${c.detail}`,
        })))}
        ${notesHtml('The meters', model.meters)}
        ${notesHtml('Wind', Object.entries(model.wind).map(([kind, detail]) => ({
          name: kind, detail,
        })))}
      `
    },
    dispose(): void {
      window.removeEventListener('keydown', onKeyDown)
      root.remove()
      style.remove()
    },
  }

  function onKeyDown(e: KeyboardEvent): void {
    if (e.repeat) return
    if (e.code === 'KeyH') {
      e.preventDefault()
      api.toggle()
    } else if (e.code === 'Escape' && open) {
      api.close()
    }
  }

  window.addEventListener('keydown', onKeyDown)
  return api
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/ui/guide/panel.test.ts`
Expected: PASS.

- [ ] **Step 5: Prove the tests are not decorative**

One at a time, reverting after each:

1. In `guideModelFor`, change the filter to `action.mode === mode` (dropping `'both'`). Expected: the both-columns test FAILS. Revert.
2. Change the filter to include everything (`() => true`). Expected: the ground-only and glider-only tests FAIL. Revert.
3. Make `rows` drop unavailable actions (`.filter((r) => r.available)`). Expected: the keeps-an-unavailable-action test FAILS. Revert.
4. Hardcode `available: true`. Expected: the same test FAILS on the `available` assertion. Revert.

- [ ] **Step 6: Typecheck and full suite**

Run: `npm run typecheck && npm test`
Expected: clean and green.

- [ ] **Step 7: Commit**

```bash
git add src/ui/guide/panel.ts src/ui/guide/panel.test.ts
git commit -m "Build the guide panel, model first

Split the way hud.ts splits: guideModelFor is pure and tested, the DOM is not.
The panel never reads game state — it is handed a model and draws it.

An unavailable action is dimmed and struck through rather than hidden, because a
tester needs to see that a move exists and is currently impossible; a vanished row
reads as a missing feature.

The panel owns a keydown listener for H and Escape rather than routing through
InputState, which would let one sampled input apply to several fixed sub-steps.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: Wire it in and pause

**Files:**
- Modify: `src/main.ts`
- Modify: `src/ui/hud.ts` — add the discoverability hint
- Modify: `docs/HANDOFF.md`

**Interfaces:**
- Consumes: `createGuide`, `guideModelFor` from `./ui/guide/panel` (Task 3); `canGust` from `src/combat/encounter.ts`; `isArmed` from `src/focus/avatar-state.ts`. The latter two already exist and are already imported or trivially importable in `main.ts`.
- Produces: nothing further.

- [ ] **Step 1: Add the HUD hint**

In `src/ui/hud.ts`, add to `STYLE`:

```css
.hud-hint { margin-top: 8px; font-size: 12px; opacity: .45; }
```

and one static element at the end of `createHud`'s markup, after the breath bar and before the vignette:

```html
<div class="hud-hint">H — guide</div>
```

No `HudModel` field: the text never changes, and a model field that is always the same
string is a field that exists to be forgotten.

- [ ] **Step 2: Wire the guide into `main.ts`**

Imports, beside the existing UI import:

```ts
import { createGuide, guideModelFor } from './ui/guide/panel'
import { canGust } from './combat/encounter'
import { isArmed } from './focus/avatar-state'
```

After `const hud = createHud(document.body)`, build the guide. The callback runs on every
open and close; refreshing the model on open is all that is needed, because the
simulation is frozen while it is up:

```ts
  // Rebuilt on open rather than per frame: the simulation is paused while the guide is
  // up, so there is nothing to refresh. `canGust` and `isArmed` are asked here rather
  // than inside the guide, so a fight object and an Avatar State never reach the UI.
  const guide = createGuide(document.body, () => {
    if (!guide.isOpen()) return
    guide.update(guideModelFor({
      player,
      ground: DEFAULT_GROUND_CONFIG,
      wave: DEFAULT_COMBAT_CONFIG.pressureWave,
      gustReady: canGust(encounter),
      avatarStateReady: isArmed(avatarState, DEFAULT_AVATAR_STATE_CONFIG),
    }))
  })
```

Note `guide` is referenced inside its own callback. That is fine — the callback only runs
on a keypress, long after `const guide` is initialised.

- [ ] **Step 3: Pause in the frame loop**

Replace the existing frame function:

```ts
  let last = performance.now()
  function frame(now: number): void {
    stepper.advance((now - last) / 1000)
    last = now
    requestAnimationFrame(frame)
  }
  requestAnimationFrame(frame)
```

with:

```ts
  let last = performance.now()
  function frame(now: number): void {
    if (guide.isOpen()) {
      // Drain the input edges so a jump pressed just before opening does not fire on
      // close, and hold `last` at now so no time accumulates to lurch through when it
      // does. The scene still renders, so the world stays visible behind the panel.
      input.sample()
      last = now
      renderer.render(scene, camera)
    } else {
      stepper.advance((now - last) / 1000)
      last = now
    }
    requestAnimationFrame(frame)
  }
  requestAnimationFrame(frame)
```

- [ ] **Step 4: Verify it builds and the suite is green**

Run: `npm test && npm run typecheck && npm run build`
Expected: whole suite green, both typecheck passes clean, build succeeds.

- [ ] **Step 5: Play it**

Start the dev server through the preview tooling (launch configuration `airbender-skies-dev`); never `npm run dev` in a shell.

**Read the "preview pane" section of `docs/HANDOFF.md` first.** The pane reports
`document.visibilityState === 'hidden'`, so `requestAnimationFrame` is suspended and the
game looks frozen. That section documents the synthetic-clock technique for driving the
loop, which is the only way to verify anything needing sustained simulation. Dispatch
`KeyboardEvent`s on `window` for input, and reload afterwards to discard the patch.

Note that the synthetic clock drives `frame` itself, so the pause branch is directly
observable: while the guide is open, driving frames must not advance the game.

Check, in order:

1. The `H — guide` hint is visible on the HUD at spawn.
2. `H` opens the panel; both columns are listed; the ground column is emphasised and the
   glider column dimmed while on foot.
3. Driving frames with the guide open does not advance the game — altitude and airspeed
   hold still.
4. `Escape` closes it, and `H` closes it too.
5. On the ground, `Air blast dash` reads available; in mid-air it is struck through.
6. With breath drained by thrusting, `Airbending thrust` and `Hover` read unavailable.
7. Open the guide while gliding: the glider column is now the emphasised one.
8. Press `Space` immediately before opening the guide, then close it — the character must
   NOT jump on close. That is the drained-edge behaviour.

Record what you observe, not what you expect. If a check fails, report it.

- [ ] **Step 6: Update the handoff**

In `docs/HANDOFF.md`, add to "What has been built", after the Pressure Wave paragraph:

```markdown
**The action guide.** `H` opens a paused panel listing every action, grouped by stance,
with each one dimmed and struck through when it is unavailable right now —
`src/ui/guide/`. Availability calls the game's own predicates (`canDash`, `canAirJump`,
`isArmed`) rather than restating them, and a test binds the catalogue to the README's
controls table in both directions so the two cannot drift. It also carries the combo
list, an explanation of the three HUD meters, and a legend for the five wind clouds.
Spec at
[`docs/superpowers/specs/2026-08-03-action-guide-design.md`](superpowers/specs/2026-08-03-action-guide-design.md).
```

- [ ] **Step 7: Commit**

```bash
git add src/main.ts src/ui/hud.ts docs/HANDOFF.md
git commit -m "Open the action guide on H, and pause while it is up

The frame loop skips the stepper while the guide is open, drains the input edges so
a jump pressed just before opening does not fire on close, and holds the clock at
now so no time accumulates to lurch through afterwards.

canGust and isArmed are asked in main.ts rather than inside the guide, so a fight
object and an Avatar State never reach a UI module.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Done when

- `npm test` green, `npm run typecheck` clean on both passes, `npm run build` clean.
- Every "prove the tests are not decorative" step has been run and reverted, including
  Task 2's step 4, which is a typecheck failure rather than a test failure.
- The eight play checks in Task 4 Step 5 have actually been performed.
- `README.md` has its `H` row and `docs/HANDOFF.md` describes the guide.
- All work is on `action-guide`. `main` is untouched.

## Out of scope

Carried over from the spec:

- Auto-showing the guide on first load (needs a save-schema change to avoid nagging).
- Key rebinding and controller support.
- Teaching the wind *system* rather than labelling the five clouds.
- A pause menu — no resume button, no settings, no quit.
- Animating availability. The game is frozen, so the panel shows the instant it opened.
