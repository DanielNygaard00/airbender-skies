# Vertical Reach: The Player's Attacks Stop Ignoring Height

## The problem

Every one of the player's four offensive moves ignores height entirely, while every enemy's
ranges are measured in 3D.

`inCone` in `src/combat/cone.ts` drops `y` before it does anything else — its own doc says
"Horizontal: height is ignored entirely" — and both radial moves measure reach with
`horizontalDistance`: `src/combat/pressure-wave.ts:60` and `src/combat/vortex.ts:42`.

Measured:

| Move | Horizontal reach | Target | Inside? |
| --- | --- | --- | --- |
| Gust | 12 | 8 m ahead, 5 m below | yes |
| Gust | 12 | 8 m ahead, 60 m below | yes |
| Gust | 12 | 8 m ahead, **2000 m below** | yes |
| Gust | 12 | 8 m ahead, 60 m **above** | yes |
| Staff opener | 3.6 | 3 m ahead, 50 m below | yes |

So the reach is not a cone. It is an infinite vertical column with a cone-shaped cross-section.

Meanwhile `src/combat/config.ts` says of the archer: "Both its ranges are measured in 3D by
`stepEnemy`, which is what makes climbing work." The archer cycle exists to pressure altitude.
This defect inverts it: a player hovering above a soldier can gust and swing at it while the
soldier's own 3D range cannot reach back.

That asymmetry is the reason this is a correctness defect rather than a tuning question. The
flight model's whole subject is altitude, and altitude currently costs the player nothing
offensively.

## The change

### One shape, one extra field

`ConeShape` gains a vertical half-extent. A target must be inside the flat cone **and** within
that band:

```ts
export interface ConeShape {
  range: number
  halfAngle: number
  /** Half-height of the slab the cone sweeps. A target further above or below is out. */
  verticalReach: number
}
```

`inCone` gains the height test. It stays the single definition — `src/combat/gust.ts`'s `inGust`
already delegates to it, and `src/combat/staff-arc.ts`'s `staffTargets` already calls it.

The two radial moves are not cones and do not share `ConeShape`, so each gains its own field:
`pressureWave.verticalReach` and `vortex.verticalReach` in `src/combat/config.ts`.

**The cone stays horizontal.** Aiming is untouched, and that is deliberate rather than lazy:
`groundStep` sets `forward` to `horizontalForward(input.lookDirection)`, the flattened camera
direction, precisely so that a standing turn moves the blast with the character. A flat cone is
what that aim already means. Tilting the cone would need a second aim vector, and both
`src/fx/gust-cone.ts` and `src/fx/aim-tell.ts` are built on a flat sector.

### The five numbers

| Move | Horizontal | `verticalReach` | Reasoning |
| --- | --- | --- | --- |
| Staff opener | 3.6 | **2.0** | A swing with a physical implement. The character's own height is 1.8 — the reference `CollisionConfig.radius` and `projectile.hitRadius` both take — plus margin so a soldier on a low rise is still reachable. |
| Staff finisher | 4.2 | **2.0** | Same arm, same body. Sharing the value is the point: the finisher sweeps wider and shoves harder, not taller. |
| Gust | 12 | **5.0** | A sweep of air: wide, but not a column. Enough to gust a soldier from a low ledge or a shallow slope. |
| Pressure Wave | 4 to 11 | **4.0** | Meant to be the smallest relative to its reach: the fiction is a shockwave travelling out across the surface, so it must not become a sphere as its radius grows with fall speed. **See the correction below — this argument does not survive the real numbers.** |
| Vortex | 5 to 12 | **8.0** | The tallest, because lifting enemies off their feet is its whole payoff and the doc describes it as pulling inward and lifting. |

**Correction: the Pressure Wave's horizontal reach is 4 to 11, not "up to 26", and that breaks
the argument above.** 26 is `pressureWave.knockback`; I read a knockback out of the config as a
radius. The real values are `minRadius` 4 and `maxRadius` 11.

Two consequences. The "smallest relative to its reach" claim appeals to 4/11 rather than 4/26,
which is far less obviously smallest — the Vortex's 8 against a 5-to-12 radius is comparable.
And worse, `minRadius` is **also 4**, so a minimum-strength slam would be exactly as tall as it
is wide: precisely the sphere the argument forbids, produced by the argument's own number.

The value is left at 4.0 through implementation anyway, deliberately. The cycle already has a
measurement designed to inform it — the real vertical gaps between a landing position and each
home-island soldier — and retuning ahead of that measurement would waste the one piece of
evidence built to decide it. If the measured worst case is comfortably inside 4.0, the number
comes down until a minimum slam is decisively flatter than it is wide. If it is not, 4.0 was
already too tight and the direction reverses.

All five are argued guesses, as every tuning value in this project is. What is not a guess is the
*shape* of the set: the ground-hugging ring is shortest relative to its reach and the lifting
column tallest, so the numbers tell a story instead of being uniform. If play says one is wrong,
the story is what it should be re-argued against.

## What this deliberately does not do

- **No 3D cone.** Considered and rejected: it changes aiming itself, needs a second aim vector
  because `forward` on foot is flattened on purpose, and both the drawn gust cone and the archer
  aim tell assume a flat sector.
- **No 3D distance limit in place of the horizontal one.** That makes reach shrink as height
  differs — a target level with you at 11 m is in, one 3 m below at 11 m is out — which is a
  sphere-shaped falloff nobody asked for.
- **No change to enemy reach.** Their ranges are already 3D, which is the correct side of this
  asymmetry.
- **No crosshair and no hit-direction indicator.** Both were in the same analysis item as this
  defect, and both are HUD readability work with their own design questions — where a reticle
  sits, whether it shows cone width, how a direction indicator reads against the existing hurt
  vignette. Their own cycle.

## A known cosmetic mismatch, named rather than hidden

`src/fx/gust-cone.ts` draws a flat sector, and `src/fx/gust-cone.test.ts` deliberately uses
`inGust` as the independent mechanism it compares the drawn cone against. That check keeps
working, because the drawn sector still matches the cone's horizontal footprint.

But the hit volume is now a slab and the drawn shape is a flat sector, so the effect under-draws
what the move hits by `2 × verticalReach` of height. This cycle does not fix that: giving the
effect a real thickness is a visuals change, and the visuals phase has not started. It is
recorded here and in the handoff so nobody later reads the flat sector as evidence that the hit
volume is flat.

## Testing

**The exploit test is the easy half and proves the least.** Asserting that a target 2000 m below
is now outside a gust would pass any implementation that clamped height at all, including one
clamped far too tightly. So it is present as a regression guard and is not the discriminating
test.

**The discriminating tests fire each move from real player positions against the real
`HOME_PATROL` placements on real archipelago geometry, and assert that every soldier which should
be hittable still is.** Over-tightening is the actual risk this change carries: a fight that used
to work quietly stopping working, with no test to say so. If a soldier that ought to be reachable
is not, the number is wrong and the test is right.

Specifically:

- For each of the four moves, from a player standing on the ground at a realistic engagement
  distance, every patrol soldier inside the horizontal reach is still hit.
- **The Pressure Wave's 4.0 is the value most likely to be too tight**, because the player lands
  wherever the ground allows and the patrol stands on ground of its own. Measure the real
  vertical gaps between a landing position and each soldier on the home island, and assert the
  measured worst case is inside 4.0 — or report that it is not, in which case the number moves.
- Each of the five extents is neutralised in turn by raising it far above its value, and the
  suite must redden. A value nothing pins is a value that can drift.

**Correction to the bullet above about deriving the boundary from the shape.** An earlier draft
of this spec said to place the probe "at a height derived from the shape rather than a literal,
so the boundary moves with the value." That instruction is self-defeating, and the implementation
caught it: a probe derived from the value under test *rises with it*, so raising the extent moves
the probe too and the assertion survives. Three of the five neutralisations would have passed.

The fix is that each move also needs a **relative** claim about its shipped number — that the
staff's band is half its horizontal reach, that the Pressure Wave's sits under its own
`maxRadius`, and so on. Those are what actually redden.

This is worth recording beyond this cycle, because it is a collision between two rules this
project already holds: "derive expectations from data rather than restating literals" and
"neutralise the config and watch it redden." For a boundary test they pull in opposite
directions, and the derived form is the non-discriminating one.
- The exploit regression: a target beyond each extent is out, at a height just past the boundary
  rather than at 2000 m, so the assertion measures the boundary rather than infinity.
- `staffShape`'s two shapes share `verticalReach` 2.0, asserted as equal rather than as two
  literals, so a future change to one is visible as a change to both.

## What will not be verified

How it plays. Nothing in this project has been played — the harness cannot hold a pointer lock.
The five extents are the whole of this cycle's tuning surface and all five need a human who has
tried to gust a soldier from a ledge.
