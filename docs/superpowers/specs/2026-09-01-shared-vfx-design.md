# Step B3 — the shared layer, the mark, and the finisher

Design note. Written 2026-09-01, after step B2 merged at `81a475b`.

## 1. Where B3 starts

B1 painted the four air effects. B2 painted the six borrowed ones and gave steam and mud
shapes of their own. What is left in `src/fx/` on a flat single-colour `MeshBasicMaterial` is
the layer that is not any one element's: the shells around the character, the burst where a
blow lands, the staff's swing, and the tell that shows where a gust will go.

Two signals in the simulation are also still unread. `Enemy.mark` records which element last
marked a soldier and how long the mark has left, and nothing draws it. `finisherThisFrame`
is raised by `stepEncounter` on the frame a chain finisher actually lands, and its own
comment says twice that it exists so "a later step will draw a flourish from" it. B3 is that
step.

### Inventory, measured rather than assumed

Every module in `src/fx/` that still constructs a flat material:

| Module | Materials | Geometry | Verdict |
| --- | --- | --- | --- |
| `guard-shell.ts` | one `MeshBasicMaterial`, `BackSide` | `SphereGeometry(1.15, 20, 14)` | paint |
| `avatar-aura.ts` | one `MeshBasicMaterial`, `BackSide` | `SphereGeometry(1.35, 20, 14)` | paint |
| `impact.ts` | one `MeshBasicMaterial`, `DoubleSide` | `SphereGeometry(1, 18, 12)`, scaled | paint |
| `staff-arc-fx.ts` | one `MeshBasicMaterial`, `DoubleSide` | `sectorGeometry(halfAngle, 0, 1)`, scaled | paint |
| `aim-tell.ts` | **two** `MeshBasicMaterial`, `DoubleSide` | a hand-built chevron **with no `uv` attribute**, and `sectorGeometry(halfAngle, 0, 1)` | paint, with care |
| `arrow.ts` | one `MeshLambertMaterial` | `CylinderGeometry` | **excluded** |
| `pillar-view.ts` | `MeshLambertMaterial` | — | **excluded**, already a named non-goal in B2 |

`arrow.ts` is excluded for exactly the reason `pillar-view.ts` was. It is opaque, lit, and
depth-tested **on purpose** — `SHAFT_MATERIAL_OPTIONS`' own comment says "an arrow visible
through a hill is information the player should not have". `createEffectMaterial` produces an
unlit material with `depthWrite: false`; running the arrow through it would strip its lighting
and make the most dangerous object in the game see-through. The exclusion is not an oversight
and the file already argues it.

`earth-reach.ts`, `fire-burst.ts` and `water-reach.ts` still name `PointsMaterial` — those are
comment mentions explaining why points were rejected, not constructions. Nothing to do.

## 2. The geometry finding that gates the staff arc

B2's step A added `sectorUvIsMonotone(halfAngle)`, a predicate saying `vUv.x` runs
monotonically along a bounded wedge's arc only while the half-angle stays at or under a
quarter turn. It exists because `staffArc.finisher.halfAngle` is `Math.PI / 1.9` — about
94.7° — and fails that bound.

**That predicate understates the problem.** `POLAR_PREAMBLE`'s `angle` also fails on the same
wedge, and for a second, independent reason: the wedge crosses `atan`'s branch cut.

`sectorTheta` centres every wedge on local +Z with `thetaStart = -π/2 - halfAngle`. For the
finisher that is −184.7°, which is outside the two-argument arctangent's (−π, π] range, so
the vertices near that edge come back as *positive* angles near +π. Measured over the real
geometry:

| Wedge | half-angle | `POLAR_PREAMBLE` `angle` range | largest gap in the sorted values |
| --- | --- | --- | --- |
| `gust` | 60.0° | 0.0833 .. 0.4167 | 0.0069 — contiguous |
| `staffArc.opener` | 81.8° | 0.0227 .. 0.4773 | 0.0095 — contiguous |
| `staffArc.finisher` | **94.7°** | 0.0088 .. 0.9978 | **0.4737 — two clusters** |

The finisher's fragments occupy two disjoint clusters at opposite ends of the 0..1 range. Any
term written against `angle` would draw a hard seam straight down the middle of the swing and
run its gradient backwards on one side of it. `vUv.x` is no better: it saturates to the full
0.0000 .. 1.0000 on that wedge, where the 60° gust only spans 0.0670 .. 0.9330.

**The fix is a coordinate measured from the wedge's own centre, not from the authored axis.**
Since every wedge is centred on local +Z, which is authored −Y, the signed offset from that
centre is `atan(p.x, -p.y)`. GLSL spells the two-argument form `atan(y, x)` and has no
`atan2`, so the numerator is `p.x` and the denominator `-p.y`. Measured over the same three
geometries it returns exactly −halfAngle .. +halfAngle, continuously, in all three cases
including the 94.7° one:

| Wedge | `atan(p.x, -p.y)` |
| --- | --- |
| `gust` | −60.0° .. +60.0° |
| `staffArc.opener` | −81.8° .. +81.8° |
| `staffArc.finisher` | −94.7° .. +94.7° |

So B3 adds a wedge preamble beside `POLAR_PREAMBLE`, and that preamble — not the ≤90° bound —
becomes the thing every bounded wedge reaches for. `sectorUvIsMonotone` stays, because a body
that genuinely wants `vUv.x` still needs the bound, and because its test pins the finisher as
the one shipped config that fails it. But the geometry table should stop recommending `vUv.x`
for a wedge and start recommending the centred angle, with the branch-cut reason recorded
beside the monotonicity one.

This is the fifth time in this arc that a coordinate assumption has been wrong, and the third
that was caught by measuring rather than by shipping. The pattern is stable enough to name: on
any geometry whose fragments do not span a coordinate's full authored range, read the range
before writing a gradient against it.

## 3. The collar, and where it stops applying

B2 established the collar — a band of contrast drawn immediately **inside** an effect's visible
boundary, so the eye has an edge to catch regardless of what is behind it — and photographed
it separating on pale grass, on dark rock, and at the low tier where nothing blooms. Five
effects carry it. Steam and mud are exemptions, and both say so in their own comments.

B3's modules split three ways.

**The two shells take the ice shell's rim, unchanged in kind.** `guard-shell` and
`avatar-aura` are both `BackSide` `SphereGeometry` held-state objects around the character —
structurally the same problem `ice-shell.ts` already solved with a view-space term. On a closed
shell the visible boundary is a fact about the *view*, not about the mesh, so the contrast has
to come from `vViewNormal`. Reusing that argument is the point: three shells, one idea, and the
next author finds it three times instead of inventing a fourth.

These two also exercise `SphereGeometry`, which is the geometry table's one remaining row with
no caller and therefore the one row still unverified against live code.

**The staff arc takes a rim collar at its radius edge.** It is a *disc* sector — inner radius 0
— so `radius` genuinely spans 0..1 and a band near the rim is a band near the rim. This is the
first wedge in the arc that is not a thin annulus, so its bounds are the first that can sit
where a reader would guess.

**The impact burst needs something the collar does not provide, and this is the interesting
one.** Its three kinds — `hit`, `down`, `deflect` — already differ in radius, lifetime, opacity
and tint, and `impact.ts`'s comment insists they "are deliberately different in kind, not just
in size". Today they are the same smooth expanding sphere at three sizes. The deflect is
supposed to read as "a spark off metal instead of a puff of air"; nothing in the shader makes
it one. So the burst wants a *per-kind surface*, not one collar with three tints: a tight
crackle for the deflect, a soft broad billow for the down, a quick clean flash for the hit.
That is the one place in B3 where the right answer is three bodies, or one body with a shape
uniform, rather than one body with three colours.

**The aim tell takes restraint, not paint.** It is a tell, not an attack — it is on screen
continuously while the player holds a direction, and the thing it must never do is compete with
the effect it predicts. Its `dimmedFactor` already encodes ready-versus-cooling. A rim on the
preview sector is defensible; anything that pulses, travels or flickers is not, because a
continuously-animated shape at the player's feet is the one element here that would be
*worse* for being more interesting. The chevron additionally has **no `uv` attribute at all** —
`createChevronGeometry` sets only `position` — so `vUv` reads as zero across it and only
`vLocal` means anything. That is a new entry for the geometry table.

## 4. The two unread signals

### The mark pip

`Enemy.mark` is `{ element, secondsLeft } | null`, written by `markEnemy` and aged at the top
of `stepEnemy`. The reaction table then reads it: water on a fire-marked soldier makes steam,
water on an earth-marked one makes mud. **The player cannot currently see any of it.** A
reaction system whose input is invisible is a system the player triggers by accident.

The plumbing already exists and needs nothing added. `EnemyView.sync(enemy, cameraQuaternion,
rising)` is handed the whole `Enemy` every frame, so it already has `enemy.mark` in scope, and
it already receives the camera quaternion because the health bar billboards. The pip belongs in
`src/combat/enemy-mesh.ts` beside that health bar.

Two constraints the design has to respect. It must read at fight distance and at the shallow
camera angle this game plays at, which is the argument `aim-tell.ts` already makes for a
chevron over a bar or a dot. And it must say *which* element marked the soldier, because that
is the only fact the reaction table cares about — so the element's identity has to be carried
by something more robust than hue alone, given the mark's whole purpose is to be read in a
fight.

`enemy-mesh.ts` lives under `src/combat/`, which the B2 tasks were barred from touching. That
bar was about the simulation. `enemy-mesh.ts` is a view module that happens to live there, it
imports nothing from the fight beyond types, and no gameplay number moves for this. The bar
holds for everything else in that directory.

### The finisher flourish

`finisherThisFrame` is a **boolean**, not a list of soldiers, and it is raised only on a frame
where a finisher actually behaved like one. `stepEncounter`'s `land` helper raises it; the
freeze deliberately routes through `advanceChain` instead, so a frame where a freeze completed
a string does not raise it — that comment's words are "a flourish drawn over it would be
feedback for nothing".

Being frame-level rather than per-enemy decides where it draws: at the player, not at a
soldier. The finisher is the player's act, and the fact worth telling them is that the string
completed and went through armour it would otherwise have bounced off.

There is a distinction here worth encoding, because the two halves are easy to conflate:

- **Thrown** is known at swing time from `swing.finisher`, and the caller already passes
  `staffShape(swing.finisher, ...)` into `createStaffArc`. The arc's shape is therefore already
  different for a finisher — a 94.7° wedge against the opener's 81.8°.
- **Landed** is `finisherThisFrame`, and it is only known after the fight resolves.

So a finisher gets two cues, and they are not the same cue. The swing may be flagged so the arc
paints differently — which does not threaten the honesty argument in `staff-arc-fx.ts`, because
that argument is about the *shape* matching the hit volume and a paint difference leaves the
shape alone. The landing is the flourish.

**The flourish must not be a ring.** B2's whole argument for giving steam and mud their own
shapes was that one shape cannot mean Pressure Wave, vortex, finisher, steam and mud at once,
and the ring already means the first two. The bench's `finisher` scene id still points at
`createShockwave` as a placeholder, which is exactly the borrowing this arc has been undoing.

## 5. Non-goals

- **No tint moves and no gameplay number moves.** Same as B1 and B2. Every radius, lifetime,
  opacity, half-angle, range and cooldown in the touched modules stays. Where a shot argues for
  a different number, that is the owner's play-test decision, not this step's.
- **Nothing in the simulation.** `src/focus/`, cooldowns, and the fight logic in `src/combat/`
  are untouched. `src/combat/enemy-mesh.ts` is the single exception and it is a view.
- **`src/core/post.ts` is untouched.** The bloom threshold is not the mechanism any more and
  nothing here should re-open it.
- **`arrow.ts` and `pillar-view.ts` are excluded**, per §1.
- **No new dependency.**

## 6. Verification

The same instrument B2 built, now trustworthy: `bench.html?scene=<id>&quality=<tier>` runs its
simulation to completion synchronously before the first render, so a hidden pane can no longer
photograph an empty world.

Every module B3 paints needs a bench scene, and most do not have one. B2's final task found
four painted effects with no `BenchEffectId` at all and had to add them; B3 should not repeat
that discovery at the end. The scenes are part of each task, not a cleanup step after them.

Two shells, a burst with three kinds, a swing with two shapes, a tell with two states, a pip
with four elements and a flourish is a lot of distinct frames. Where one scene can show a
difference that matters — the three impact kinds side by side, the opener against the finisher —
one scene showing the contrast is worth more than three showing the parts.

What the bench cannot answer stays unanswered and should be said so: it proves an effect drew
something at one frozen instant from one fixed camera. It does not prove the deflect reads as
metal at combat speed, that the mark pip is findable in a four-soldier fight, or that the
flourish lands on the beat the hit does.

## 7. Risks

**The impact burst's three surfaces are three guesses at once.** Unlike the collar, which was
gated on one effect before six copied it, "differ in kind" has no single testable claim behind
it. It should be gated the same way: build one kind's surface, shoot all three together, and
decide whether the difference reads before the other two commit.

**The mark pip is the only thing in this arc that adds a persistent object to every soldier.**
Four soldiers each carrying a billboarded pip that updates every frame is a cost the effects
have not had, since every effect so far has been either one-shot or one-per-player. It should
cost nothing when `mark` is null, the way `avatar-aura` and `guard-shell` skip themselves
entirely when invisible.

**The aim tell is the one module where doing less is the correct answer**, and the pull of a
plan that says "paint eight things" is to paint it anyway. If the tell ends up more interesting
than the gust it predicts, that is a regression with green tests.

**None of B1, C, B2 or B3 has been played.** Four merged steps of visual work now rest on
frozen bench frames and argued reasoning. The collar survived its gate, which is real evidence,
but every judgement about motion — whether a flicker reads as flicker, whether travel reads as
travel, whether three impact surfaces read as three materials — is still standing on arithmetic
against a lifetime rather than on anyone's eye.
