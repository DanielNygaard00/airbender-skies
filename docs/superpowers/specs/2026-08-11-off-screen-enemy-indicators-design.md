# Off-Screen Enemy Indicators

## The problem

**Nothing tells the player where an enemy they cannot see is.**

The archer fires from `strikeRange` 30 and notices at `aggroRange` 38, both measured in 3D, and
the camera is a follow cam with an ordinary field of view — so an archer that has engaged is
routinely outside the frame, and the one directly behind the player always is. Enemy health bars
are world-space billboards, so they say nothing about anything off screen, and they are
deliberately hidden at full health anyway.

The cycle just shipped covers the moment *after* an attack lands: `src/fx/hit-direction.ts`
freezes a wedge at the bearing a hit came from. What is missing is the information that would
let the player not be hit at all — *something you cannot see is engaged with you, and it is over
there.*

## Three findings that shape the design

**Edge-clamping is the genre standard and is the wrong shape here.** The usual implementation
projects the target and clamps the result to an inset rectangle, so the arrow sits at the edge of
the screen nearest the target. That needs a valid projection — and for anything *behind* the
camera `Vector3.project` returns a mirrored position with `z` outside `[-1, 1]`, which is
precisely the population this feature exists for: a follow cam's blind spot is the space directly
behind the player. An edge-clamped implementation would therefore be projection-driven for the
minority just past the frame edge and bearing-driven for the majority behind the camera — two
rules in one indicator, with a discontinuity where a target crosses between them.

One rule instead: **bearing**, through `bearingFromCamera`, the same function the hit wedges use.
Its sign convention was measured in a browser rather than assumed, and reusing it means the
sign cannot disagree between the two overlays.

**No new reporting is needed from the combat model.** Unlike the hit-direction half of the last
cycle, everything this needs is already in hand inside `syncVisuals`: `encounter.enemies` for
stance and health, each view's interpolated position for where the body is drawn, and a camera
that has just been positioned and oriented. `src/combat/encounter.ts` and `src/combat/enemy.ts`
are not touched by this cycle at all.

**The camera's own forward is available here, and it is the accurate basis.** Hit marks are born
in `update()` and are handed `input.lookDirection`, which the drawn camera trails by a measured
17.78° in a sustained 180°/s turn on foot. A tracking marker is computed in `syncVisuals`, after
`camera.lookAt`, so it can read `camera.getWorldDirection()` instead and lag by nothing.

The two overlays therefore sit on **different bases, deliberately.** A frozen bearing can afford
that error — it is baked in once and the mark is a record of a past moment either way. A bearing
that is recomputed every frame cannot: the lag would show up as the whole ring sliding during
every flick and settling afterwards. Do not "unify" them by moving hit marks onto the camera
basis; `markFor` is called from `update()`, and reading the camera there moves render state into
the simulation half of the frame.

## The change

### `src/fx/off-screen.ts` — new, pure, tested

```ts
/**
 * How far past the frame edge, in NDC units, a soldier travels before its chevron
 * reaches full strength.
 */
export const OFF_SCREEN_RAMP = 0.25

export interface EnemyMarker {
  /** Screen bearing, 0 dead ahead and positive clockwise, from `bearingFromCamera`. */
  bearing: number
  /** 0 at the frame edge, rising to 1 once definitively off screen. */
  strength: number
  /** This soldier is in its wind-up: the release is coming. */
  winding: boolean
}

/** 0 while comfortably on screen, ramping to 1 once definitively gone. */
export function offScreenPresence(ndc: { x: number; y: number; z: number }): number

/** A soldier's marker, or null when it does not earn one. */
export function enemyMarker(
  enemy: Enemy,
  playerPosition: Vector3,
  ndc: { x: number; y: number; z: number },
  bearing: number,
  c: EnemyConfig,
): EnemyMarker | null
```

**A ramp rather than a pop, and it holds no state.** Enemies cross the frame edge constantly as
the player turns, so a chevron that switches on at the boundary would blink on and off through
ordinary camera movement. The obvious fix is a fade timer per enemy id, stepped every frame;
this design does not need one. `offScreenPresence` reads the overshoot straight off the
projection — 0 at the edge, 1 at `OFF_SCREEN_RAMP` past it — which fades in for free, needs no
keyed map, cannot drift out of sync with a soldier that was removed, and is frame-rate
independent without anyone having to think about it.

When both axes are past the edge, the **larger** overshoot decides: the further out on any axis,
the more definitely gone.

Behind the camera, or a projection with a non-finite component, gives **1**. Both mean the
soldier is not on screen at all, and the NDC position in those cases is not a position — a
behind-camera point is mirrored across the screen, and a 0×0 canvas makes `ndc.x` NaN while `y`
and `z` stay finite (watched happening in the last cycle, not imagined). This is the one place
this module deliberately answers differently from `reticleModel`, which hides on exactly these
inputs: the reticle needs a screen *position* and has none, while a marker needs only a bearing,
which comes from world space and is unaffected.

### Who earns a marker

`enemyMarker` returns null unless all three hold:

1. `isTargetable(enemy)` — on its feet or pushing back up. A body lying flat is not a threat, and
   the same predicate already decides what the gust cone will hit.
2. **3D distance to the player ≤ that kind's `aggroRange`**, *or* — for a melee soldier only —
   **horizontal distance to the player ≤ that kind's `strikeRange`.**
3. `offScreenPresence(ndc) > 0`.

**The 3D distance in (2) is the one place this deliberately differs from the fight, and the
difference is the whole reason it is written down.** `stepEnemy` measures a *spear's* notice
horizontally — that is what makes an archer the type that pressures altitude — so a spear 20
units out and 300 units below a hovering player is still inside its horizontal `aggroRange` of
26 and has noticed them. Marking every such soldier would hang a permanent ring of chevrons
around a player who has climbed out of the fight, which is exactly the clutter
`HIT_MARK_SECONDS` was chosen to avoid. Measured in 3D the notice clause is **stricter than the
fight for a spear** and **identical to the fight for an archer**, which already measures in 3D.

**The second clause exists because horizontal reach means height is *ignored*, not protective.**
A melee soldier measures `strikeRange` horizontally as well, so a spear at horizontal distance 0
is inside its 3.2 reach at *any* altitude: it winds up and it deals damage. `enemy.test.ts`'s
'still thrusts at a player almost directly overhead' pins that as shipped behaviour, and
measured with the real config a spear at the origin deals 3 damage over 200 frames to a
5-health player hovering at (0, 30, 0). With only the 3D clause that player took repeated damage
from a soldier this overlay stayed silent about — the exact case it exists for — while the hit
wedge that did appear pointed dead ahead, because `bearingFromCamera` reports 0 for a
near-vertical offset. So a melee soldier earns a marker on its horizontal strike reach too,
gated on `attack.kind === 'melee'` because a projectile attacker measures both notice and commit
in 3D and cannot shoot a target clause one has already rejected.

The anti-clutter property survives both clauses: a spear 10 units out and 30 units below is
outside 3D `aggroRange` and outside horizontal `strikeRange`, and earns nothing. Both numbers
are read from `c` rather than written as literals, so retuning either range moves the markers
with it.

### One state change

`winding` is true exactly when `enemy.stance === 'wind-up'`, and the view brightens the chevron
for it. Nothing else varies — no per-kind chevron, no distance encoding, no health readout. This
follows the reticle's rule of exactly one state change: the wind-up is the dodge window, and it
is the only bit on this ring worth spending the player's attention on.

### `src/ui/off-screen-view.ts` — the DOM half

Built the way `createHitDirection` is: a `STYLE` string appended to `document.head`, a root
element, a never-shrinking element pool, `update(markers, origin)`, `hide()` and `dispose()`.
Untested for the reason all three overlay views are — the test environment is node, so there is
no DOM to build against — with every decision it makes living in the pure module above.

- **Same origin as the hit wedges**: the reticle's position when the aim point is on screen, else
  screen centre. The two rings and the reticle then read as one instrument around one point.
- **The same rotate-a-tall-frame geometry**, `transform-origin: 50% 100%`, rotated by
  `+bearing`. No trigonometry, and therefore no aspect-ratio correction to get wrong — a
  rotation is a rotation whatever shape the window is. `hit-direction-view.ts` records the
  browser measurement that fixed this sign; it applies unchanged here because the bearing
  convention is the same function.
- **Radius 84–104 px**, outside the hit wedges' 54–74 px with a 10 px gap, so a full ring of
  both does not overlap.
- **A hollow chevron, not a solid triangle**, via one `clip-path` polygon. `hit-direction-view.ts`
  prefers a CSS border triangle because it needs no second element and no new units; this file
  departs from that for a reason that outweighs it — these two rings sit around the same point
  and must not be mistaken for each other, and a V is the cheapest shape that cannot be confused
  with a filled wedge.
- **`#e4614a`**, the enemy health bar's fill, against the hit wedges' `#ff8f6b`. The player
  already reads the cooler red as "an enemy is the subject" and the warm orange as "your health
  is the subject", so the pair needs no new vocabulary. Copied rather than imported, like the
  hit wedge's colour: a look, not a contract.
- `opacity` is `strength`, so a chevron fades in as its soldier leaves the frame.
- Never `pointer-events: auto`. A click sink over the canvas would swallow the click that
  requests pointer lock, which is how play resumes.

**And one piece of existing duplication gets closed rather than tripled.** `percent(fraction)` is
already written out identically in `reticle-view.ts` and `hit-direction-view.ts`, and this view
needs it as well — along with `radians` and `alpha`, which `hit-direction-view.ts` holds privately.
A third verbatim copy is the kind of thing this project's own review rubric treats as a defect, so
the three move to `src/ui/overlay-format.ts` and all three views import them. They are pure string
formatting, so unlike the views themselves they are **testable in the node environment**, which is
the second reason to do it: three helpers that decide what precision reaches the DOM currently have
no tests at all.

### Wiring, in `syncVisuals`

After `camera.updateProjectionMatrix()` and beside the reticle's own projection, because it needs
the same fresh matrices. Per enemy: read the interpolated drawn position, `project` it into a
scratch vector, take the bearing from the camera's world direction, call `enemyMarker`, keep what
comes back.

**The drawn position, and the simulation's `Enemy`, on purpose.** The chevron points at the body
the player would see if they turned, so its direction comes from the same interpolated position
the mesh is drawn at — the same mix, for the same reason, as the reticle's drawn origin and
simulation heading. Stance, health and the distance test come from the simulation, which is what
the fight itself decided.

Hidden by `hide()` while the game is paused and through the down beat, exactly like the reticle
and the hit wedges, and for the same two reasons: the pause card and the guide own the screen,
and during the down beat nothing is being recomputed, so anything drawn is a stale claim.

**Not scaled by any reduce-motion scalar**, for the reason the hit indicator is not: it is
information rather than motion, a chevron does not shake, pulse, travel or grow, and
`motionScales` zeroes `hurtFlash`, which makes screen-space information the thing that keeps a
fight playable in that mode.

### The guide gains a legend for both rings

This feature puts a second ring of triangles around the same point as the first, and nothing on
screen says which is which. `src/ui/guide/reference.ts` gains a `SCREEN_MARKS` list of the same
`MeterNote` shape `METERS` already uses, rendered through the existing generic
`notesHtml(title, notes)` — two entries, one per ring, naming each one's colour and what it
means. The hit wedges shipped without an explanation; this is where that gap closes, because it
is this cycle that makes the ambiguity possible.

`docs/HANDOFF.md` gains this cycle's section, as every cycle before it has: what shipped, the
three findings above, the numbers that are guesses, and anything a reviewer found that was
recorded rather than fixed.

## Out of scope

- **A cap on how many markers draw at once.** `HOME_PATROL` is five soldiers, and a cap above the
  whole roster is dead code that reads as a considered limit.
- **Distance encoding** — a scale or an opacity ramp on range. A second tuning surface, and the
  bearing is the information the player acts on.
- **On-screen enemies hidden behind terrain.** They get nothing, deliberately: health bars are
  depth-tested so that terrain hides them, on the stated ground that an effect drawn over a hill
  shows the player something they did while a health bar drawn over a hill reveals an enemy they
  cannot see. An indicator for an occluded on-screen enemy is that same reveal, and the player who
  is being shot from behind a hill still gets a hit wedge.
- **Vertical information.** The bearing is horizontal, like the hit marks'. A soldier almost
  exactly below a hovering player reads as ahead; the fully degenerate case is guarded and the
  near-degenerate one needs a horizontal offset under a few centimetres at 30 units of drop. The
  melee reach clause makes this population the one that *does* get marked — a soldier inside
  `strikeRange` horizontally is by definition a soldier with little horizontal offset — so a spear
  directly underfoot draws a chevron pointing dead ahead. Unavoidable rather than wrong: with no
  horizontal offset there is no horizontal direction to report, and the chevron is then reporting
  presence. At the 2 units of `enemy.test.ts`'s overhead-thrust case the bearing is real.
- **Lock-on or a soft target.** It changes aiming rather than reporting, and was already named as
  separate work.
- **Arrows in flight.** A marker per projectile is a different feature with a different lifetime,
  and an arrow that connects already produces a hit wedge from its own position.

## Testing

- `offScreenPresence` at 0 for a point at the centre and at 0 for a point **exactly on** each of
  the four edges, so the boundary is pinned rather than approached.
- The ramp asserted **off the left, right, top and bottom separately**, at a half ramp and at a
  full ramp, with **asymmetric coordinates in every case** — `x ≠ y` and `|x| ≠ |y|`.

  What that actually catches, stated exactly, because the obvious claim is false here: the
  overshoot is the **larger** of the two axes' excesses, and `Math.max` is commutative, so
  **swapping x and y in this function is provably a no-op and no test can catch it.** Writing
  fixtures "so an axis swap is visible" would be a test that cannot fail. The mutants these
  fixtures do catch are real ones: an implementation that measures only `x` (the top and bottom
  cases redden), only `y` (left and right redden), or that drops the absolute value and uses
  `ndc.x - 1` (both a point off the left and one off the bottom then read as fully on screen).
  Asymmetric coordinates are what keep each of those from being masked by the other axis.
- Both axes past the edge with **different overshoots**, asserting the larger one decides.
- A point behind the camera (`z` above 1) with `x` and `y` **inside** the frame → 1, so the depth
  branch is doing the work rather than the position branch.
- A non-finite `x` with finite `y` and `z` → 1. This is the input that made `reticleModel`
  invisible; here it must produce a marker, and asserting the difference is what keeps the two
  modules from being "made consistent" later.
- `enemyMarker` returns null for a downed soldier and non-null for a **rising** one, so
  `isTargetable`'s second clause is covered rather than assumed.
- The spear's hovering case with real numbers, in three fixtures, because the rule has two
  clauses: a spear at horizontal 10 and 30 below the player → null, which is the anti-clutter
  half; the same spear at horizontal 0 and 30 below → a marker, because its horizontal strike
  reach genuinely reaches a hovering player; the same spear at horizontal 20 and level → a
  marker on the 3D notice clause alone. Nothing else would catch a horizontal notice
  measurement, or the loss of the melee reach clause.
- An archer at horizontal 0 and 45 below the player → null, since the reach clause is gated on
  `attack.kind === 'melee'`. Without this fixture, deleting that gate passes silently.
- The melee clause's own boundary built from `SPEAR.strikeRange`, with the drop putting the 3D
  distance outside `aggroRange` in every case so only the horizontal clause can be deciding:
  inclusive at the boundary, null just past it.
- The archer's boundary asserted against `aggroRange` 38 read from the config: 3D 37 → a marker,
  3D 39 → null, so the marker's rule is pinned to the fight's number rather than to a literal.
- `winding` asserted true in `wind-up` and false in **every** other stance, driven by a
  `Record<Stance, boolean>` of expectations rather than a spot check or an array literal. The
  Record is the part that matters: adding a sixth stance fails to compile until someone decides
  whether it warns, which an array of the five current stances would not. `WIND_LEGEND` uses the
  same device over `WindKind` for the same reason, and says so.
- `bearing` passed through unchanged, asserted as a **signed** value. A test on the magnitude
  would pass an implementation that mirrored left and right, which is the error that makes the
  feature actively harmful.
- `SCREEN_MARKS` has an entry for each of the two rings, and `notesHtml` renders both.

## What will not be verified

Whether any of it reads. `OFF_SCREEN_RAMP` 0.25 is an argued guess about how quickly a chevron
should arrive; whether two concentric rings of small shapes are actually distinguishable at a
glance is a question for eyes on a screen; and whether five soldiers' worth of chevrons is
informative or a fence around the reticle cannot be answered here. The harness never receives OS
focus, so `requestPointerLock` always fails and the game cannot be driven — which lands squarely
on this cycle, whose entire subject is a screen-space overlay that only exists while the player
is turning.
