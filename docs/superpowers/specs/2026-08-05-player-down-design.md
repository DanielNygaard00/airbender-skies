# Going down

Written 2026-08-05.

What happens when Aang's health reaches zero. Until now: nothing.

## Why

Found in the running game, not in a test. `encounter.playerHealth` reached zero from ordinary
spear hits and stayed there for the rest of the session — no consequence, no recovery, health
pinned at the floor well past `outOfCombatSeconds`. The player keeps playing a character who
cannot be hurt any further and cannot be healed either.

This is not a bug in `src/combat/health.ts`. `stepHealth` refuses to regenerate off the floor
on purpose, and says so:

> A downed combatant does not get back up on their own. Standing them up is a decision for a
> system above this one, not a side effect of time passing.

The module was right to refuse. The system above it was never built, so combat has a lose
condition with nothing attached to it. This spec builds that system and leaves `health.ts`
alone.

Three things in the design document shape the answer.

**§6 sets the failure philosophy.** Falling is not death: "hard landings cost health and
momentum instead of a reload," and death by falling "should feel like a character trait rather
than a difficulty setting." Drowning is a soft fail — Aang surfaces and loses momentum and
Focus. Every failure in the document costs resources and position, and none of them reload.
Going down had no entry, which is the gap that made this a design question rather than a patch.

**§4.6 gives the vocabulary.** Every enemy has a downed state instead of a death state. Aang
going down and a soldier going down should read as the same kind of event, because in this game
they are.

**The recovery mechanism already exists.** `respawn` / `safeRespawn` in
`src/player/controller.ts` place the player at `lastGroundIslandId` and reset the movement
state. Falling out of the world already uses it. Going down is a second trigger for one
mechanism, not a second mechanism.

## Decisions, all settled

**Respawn at the last island, at full health.** Not a downed-and-recover window in place, and
not a fight reset. The cost is position, tempo, and the Focus bar — the same currency §6 charges
for drowning, paid at a higher rate.

**The fight persists.** Enemies keep their damage, positions and stances. The player respawns at
the island centre, roughly 30 units from `HOME_PATROL`, which is outside the 26-unit
`aggroRange` — so the patrol drops its aggro on its own and the player walks back in. This does
mean respawning is a free full heal and attrition-by-dying is a slow but viable strategy.
Accepted: it is consistent with a game whose every other failure is soft, and closing it would
mean resetting a fight, which nothing else in the codebase does.

**Focus is wiped to zero and the Avatar State is cleared.** Not the existing `crashDrain` of 50
and not a new tuned constant. Going down should never leave the player holding most of a bar,
and an Avatar State surviving the event would hand unlimited Breath to someone who just lost.

**A held beat, not an instant teleport.** The simulation freezes for 1.5 seconds while the
screen fades to black, the respawn lands behind the black, and the screen fades back in. An
instant teleport is legible but reads as a teleport; the beat is what makes it read as a defeat.

**The world freezes completely during the beat**, exactly as it already does while the guide
panel is open — no `controllerStep`, no `stepEncounter`, no Focus. Only the timer, the fade and
the live effects advance. This avoids inventing an inert-player path through the controller and
the encounter, and avoids the question of what a soldier standing over a body it cannot hit is
supposed to do.

**Falling out of the world is untouched.** No beat, no Focus wipe, keeps its own `crashDrain`.
§6 is explicit that falling is not death, so the two failures keep different prices.

## Architecture

### `src/player/down.ts` (new) — the beat

Player-side and pure, like `slipstream.ts` and `staff.ts`: a state machine over time that knows
nothing about a scene, a `PlayerState`, or an enemy.

```ts
export interface DownConfig {
  /** Blackout ramp. The respawn lands at full black, so it is never seen. */
  fadeOutSeconds: number
  /** Ramp back in afterwards. */
  fadeInSeconds: number
}

export interface Down {
  /** Seconds since the player went down. */
  elapsed: number
}

export function startDown(): Down

export function stepDown(
  down: Down, dt: number, c: DownConfig,
): { down: Down | null; respawnNow: boolean }

/** 0 to 1: how black the screen is. 0 when not down. */
export function fadeOpacity(down: Down | null, c: DownConfig): number

/** Vertical scale for the avatar as he sinks. 1 when not down, and 1 again after the respawn. */
export function collapseSquash(down: Down | null, c: DownConfig): number

/** How far he sinks. Exported so the test asserts against the constant, not a copy of it. */
export const COLLAPSE_SCALE = 0.35
```

`stepDown` advances `elapsed` and reports `respawnNow` on exactly the frame the timer crosses
`fadeOutSeconds`, computed from the before and after values. There is deliberately no
`respawned` flag on `Down`: a second field recording something the timer already implies is a
second thing that can drift out of step with it. `down` goes null once `elapsed` passes
`fadeOutSeconds + fadeInSeconds`.

A single step long enough to cross both boundaries fires `respawnNow` **and** clears `down`. The
respawn still applies; a frame that long has bigger problems than a skipped fade.

A non-finite `elapsed` exits the state — `respawnNow: true`, `down: null` — rather than being
clamped. Clamping traps the player in a permanently frozen world with no input, which is
strictly worse than an unexplained recovery. This is the same fail-open reasoning
`healthFraction` uses in the opposite direction, and for the same reason: pick the failure the
player can recover from.

`fadeOpacity` ramps 0 to 1 across the fade-out and 1 to 0 across the fade-in. Splitting the beat
in two rather than holding one flat colour is the entire point — the teleport happens at full
black, so the player never sees it.

`collapseSquash` returns 1 before the beat, ramps 1 down to `COLLAPSE_SCALE` across the
fade-out, and returns to **1** past `fadeOutSeconds`. That last part is load-bearing: the
respawn has already happened by then, and a squashed Aang revealed by the lifting black would
undo the whole effect.

### `src/core/config.ts` (changed)

`DEFAULT_DOWN_CONFIG` joins the other defaults:

```ts
export const DEFAULT_DOWN_CONFIG: DownConfig = {
  // Long enough to register as an event, short enough not to be a loading screen.
  fadeOutSeconds: 0.6,
  // Longer than the fade out: coming back should feel slower than going down.
  fadeInSeconds: 0.9,
}
```

1.5 seconds total. Like every other tuning constant in this repo, an argued guess that has not
been played.

### `src/player/controller.ts` (changed)

One change: `safeRespawn` becomes exported. It is already the guarded version of `respawn` — it
verifies the result and falls back to the origin when an injected `spawnPointFor` returns
something non-finite — and going down should get that guard for the same reason falling does.
Its doc comment is updated to note it now has two callers. No behaviour change.

### `src/main.ts` (changed)

State beside `focus` and `avatarState`:

```ts
let down: Down | null = null
```

**Entering the state.** At the end of `update()`, after Focus and the HUD have run:

```ts
if (!down && isDowned(encounter.playerHealth)) {
  down = startDown()
  effects.add(createImpact(player.position, 'down'))
}
```

Detected last so the killing hit still pays its ordinary `damageDrain` and impact effect on that
frame — one normal step, then the beat. The `'down'` impact is the same burst an enemy gets when
it goes down, so §4.6's symmetry costs nothing to express.

**The frozen branch.** Immediately after `const state = input.sample()` at the top of
`update()`:

```ts
if (down) {
  const step = stepDown(down, dt, DEFAULT_DOWN_CONFIG)
  down = step.down
  if (step.respawnNow) recover()
  avatar.setSquash(collapseSquash(down, DEFAULT_DOWN_CONFIG))
  effects.advance(dt)
  hud.update(hudModelFor(player, encounter.playerHealth, {
    focus: focus.max > 0 ? focus.value / focus.max : 0,
    avatarCharge: armFraction(avatarState, DEFAULT_AVATAR_STATE_CONFIG),
    avatarActive,
  }, fadeOpacity(down, DEFAULT_DOWN_CONFIG)))
  return
}
```

The HUD model is built the same way the normal path builds it — every value in it is frozen, so
only the fade actually changes, and duplicating the three-line readout beats introducing a
shared mutable one. The normal path's own `hud.update` call is unchanged: the new fourth
parameter defaults to 0.

`state` is sampled and discarded, which drains the input edges exactly the way the guide-panel
branch in `frame()` already drains them: a jump held through the blackout does not fire on the
other side.

`avatar.update`, `glider.update`, the aura, the charge tell and the guard shell are all skipped,
so the pose freezes mid-stride. The one exception is `effects.advance(dt)`, so the `'down'`
burst plays out — that burst is the punctuation of the event, not the world carrying on.

**`recover()`** — five things, in this order:

```ts
function recover(): void {
  player = safeRespawn(player, deps)
  encounter = { ...encounter, playerHealth: fullHealth(DEFAULT_COMBAT_CONFIG.player) }
  focus = emptyFocus(DEFAULT_FOCUS_CONFIG)
  avatarState = restingAvatarState()
  avatarActive = false
  cameraPosition = pullInForTerrain(
    player.position,
    desiredCameraPosition(player.position, lookDirection, profileFor(player.mode)),
    world.terrain,
  )
}
```

The camera snap composes the same two functions `syncVisuals` composes, in the same order, so
the snapped position is a position the smoothing would have been allowed to reach. Calling
`desiredCameraPosition` alone would be shorter and could seat the camera inside a hillside.

Health is restored with the existing `fullHealth`, not a new `revive` in `health.ts`.
`fullHealth` already returns exactly the right pool, including a `sinceHit` at
`outOfCombatSeconds`, and adding a function that calls it would put a second name on one
behaviour. `health.ts` stays untouched, and the system it was waiting for now has a file of its
own.

The camera is snapped rather than left to smooth at all. `smoothTowards` would converge across
the fade-in at `GROUND_PROFILE.smoothing` of 9, but "converges in time" is a property that
depends on two tuning constants in different files agreeing, and a snap behind full black is
free.

Position interpolation must be re-primed. The frozen branch returns before `update()`'s own
`record()` calls, and `syncVisuals` is not gated on the beat — `createStepper` renders every
frame regardless. Left alone, the fade-in reveals the avatar still standing at the death spot
while `smoothTowards` drags the camera off the snap, then everything pops when the beat ends.
`recover()` therefore calls `record()` and then `reset()` on both the position and forward
buffers. `reset()` rather than relying on `record()`'s own `DEFAULT_SNAP_DISTANCE` collapse,
because a respawn near the island centre would not clear that distance.

### `src/ui/hud.ts` (changed)

`HudModel` gains `fade: number`, and `hudModelFor` gains a fourth optional parameter defaulting
to 0, run through the existing `fraction()` helper so a non-finite value cannot reach the DOM.
One new element, appended last so it sits over the vignette:

```css
.hud-fade { position: fixed; inset: 0; background: #000;
  pointer-events: none; opacity: 0; }
```

No CSS transition on it. `fadeOpacity` owns the curve, and a transition would fight it.

### No new animation clip

`AnimationName` has no `'downed'`, and adding one means teaching `planClips` a source clip the
character asset may not ship — the same problem the staff spec hit with a swing animation. The
collapse instead drives the squash channel that already exists for jump charging, which needs no
asset and no new plumbing. A real collapse clip would be better and is separate work.

## Edge cases

**Downed during the Avatar State.** Reachable — only Slipstream grants invulnerability, the
state does not. `recover()` clears `avatarState` and `avatarActive`, so the surged wind and
`boostedCombatConfig` drop on the same frame. The next normal step runs `stepAvatarState` from
rest against zero Focus, so it cannot re-arm and `justEnded` never fires a spurious Focus reset.

**Downed while gliding.** Reachable — spear infantry can clip a low pass. `safeRespawn` already
returns `mode: 'ground', grounded: true` at the island, so the existing path covers it with no
extra branch.

**Downed and falling out of the world on the same frame.** Effectively unreachable:
`controllerStep` resolves the fall before `stepEncounter` runs, and enemies resolve their strike
against the post-step position, which is now an island away. If it ever did fire, both apply —
the beat starts and `recover()` respawns a second time. Harmless, so it is not guarded.

**The guide panel opened mid-beat.** `frame()` already skips the stepper while the guide is up,
so the beat pauses with it and resumes on close. Nothing to do.

**Deliberately not handled: a non-positive `maxHealth`.** That config makes `fullHealth` return
a still-downed pool and the beat would loop forever. Not guarded, because such a value already
breaks the HUD, the health bars and the encounter itself — it is a config error with no sane
local recovery, and catching it here would hide it somewhere quieter than where it belongs.

## Testing

Red-proof everything: write the test, watch it fail for the stated reason, then implement.

**`src/player/down.test.ts`** — the whole timer is pure, so this is where the confidence lives:

- `respawnNow` fires on exactly the frame `elapsed` crosses `fadeOutSeconds`, and is false both
  before it and on every frame after. Three assertions, because a flag that fires early or fires
  repeatedly would respawn the player mid-fade or in a loop.
- One step long enough to cross both boundaries fires `respawnNow` **and** clears `down`.
- `down` goes null past `fadeOutSeconds + fadeInSeconds`.
- A non-finite `dt` exits the state rather than hanging. This is the test that proves the frozen
  world is always escapable.
- `fadeOpacity`: 0 at the start, 1 at the boundary, 0 at the end, clamped in between, and 0 for a
  null `down`.
- `collapseSquash`: 1 at the start, `COLLAPSE_SCALE` at the boundary, and **back to 1 past it**.
  That last assertion is the one that catches a squashed statue appearing as the black lifts.

**`src/ui/hud.test.ts`** gains three cases: `fade` defaults to 0, clamps to 0..1, and a
non-finite fade lands at 0.

**`src/combat/health.test.ts` is untouched**, because `health.ts` is untouched. If an assertion
there needs editing, this spec has been implemented wrongly.

**The `main.ts` wiring is not unit-tested.** `recover()` is five assignments over module-level
bindings, there is no `main.test.ts`, and every other wiring in that file is in the same
position. Extracting it purely to test it would produce a parameter bag that proves nothing
about the thing that actually broke. It is verified in the running game instead, which is how
the gap was found in the first place:

1. Take five spear hits. The screen blacks out over roughly 0.6s and the world holds mid-stride.
2. Come back at the island spawn, at full health, with the Focus bar empty.
3. Enemies still carry their damage and are still where they were.
4. Do it twice. No stuck state on the second run.
5. Hold `Space` through the blackout. No jump fires on recovery.

## Documentation

- **`docs/design/aang-playable-character.md` §6** gains a "Going down" bullet beside falling and
  drowning. Its absence is what made this a design question, so the decision belongs there.
- **`README.md`** gains one sentence in the combat paragraph.
- **`docs/HANDOFF.md`** gains an entry, as the recap a new session reads first.

## Out of scope

- **A downed-and-recover window in place**, with a Focus cost to stand back up. A richer
  mechanic, and a different spec — this one establishes that going down means something at all.
- **A real collapse animation clip.** Asset work, and the squash channel carries the beat until
  then.
- **Resetting or restarting the encounter**, and with it any answer to attrition-by-dying.
- **A death or defeat screen, a retry prompt, or lives.** §6 rules out the reload.
- **Saving anything about the down.** Health is not persisted today and this does not change
  that.
- **Enemies recovering from their own downed state.** The same missing system, on the other side
  of the fight, and a much larger question.
