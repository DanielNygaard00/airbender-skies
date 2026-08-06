# The Dodge Costs Breath, and Goes Sideways

## The problem

The Slipstream adds 30 m/s to velocity, costs nothing, and comes off a 1.5 second cooldown.
Nothing else in the game gives speed for free: thrust costs 18 breath a second, hovering
costs 30. So the cheapest way to travel is to press the dodge button on cooldown and never
touch the thrust key.

Measured over 40 seconds from y 300 with an initial velocity of 30 m/s, against the shipped
config:

| | end altitude | end speed | breath left | total energy |
|---|---|---|---|---|
| plain glide | 151 m | 23.1 m/s | 100 / 100 | ×0.51 |
| dodge on cooldown | **434 m** | **76.9 m/s** | **100 / 100** | **×1.81** |

The glide loses half its energy, which is what a glide is supposed to do. Chain-dodging
*gains* 81%, climbing 134 metres with its breath bar untouched. It is a perpetual-motion
machine.

`flight.ts` is careful about exactly this. Its lift fallback carries a comment insisting the
direction must stay perpendicular to velocity, because "a component along the flight path
would do work and inject energy, breaking the invariant that gliding never gains height."
That invariant holds inside `flightStep` and is broken one call up, in `controllerStep`,
where the dodge impulse is added after the integrator has run.

What it costs the game: breath stops being the resource that gates flight, and the
`climb-north` / `spire` / `beacon` progression — islands placed above the spawn specifically
to require sustained thrust — becomes reachable by tapping C.

**A second, separate defect in the same move.** `dodgeHeading` in the glider calls
`slipstreamHeading(gliderForward, 0, strafeAxis)`, which flattens its result and falls back
to the flattened heading when no axis is held. Two consequences, both measured:

- With no bank held, the impulse is `[0, 0, -30]` — 30 m/s **straight forward**. That is the
  input a player who is not holding A or D will produce, which is most of them, most of the
  time. The most common press is a forward boost with invulnerability attached.
- Dodging while diving along `(0, -1, -1)` produces an impulse whose `y` is exactly 0. The
  dodge is a shove across the ground plane rather than across the flight path.

## The two changes

### A dodge spends breath

`SlipstreamConfig` gains `breathCost`, and a dodge fires only when that much breath is
available. Firing deducts it.

The number is chosen against thrust, because the two are alternatives for gaining speed and
the dodge must be the worse of them. Thrust buys 22 m/s² of acceleration for 18 breath a
second, which is 1.22 (m/s²) per (breath/s). A dodge buys 30 m/s per 1.5 s of cooldown — an
average 20 m/s² — for `breathCost / 1.5` breath a second, so its ratio is `30 / breathCost`.
The two break even at a cost of 25.

**`breathCost` is 28.** Just past break-even, so thrust is the efficient way to gain speed
and the dodge is what you spend when you need the invulnerability. Three dodges from a full
bar, and a fourth only after waiting.

The gate is hard: below 28 breath, the press does nothing and the cooldown is not spent. A
player can be caught unable to dodge, and that is the point — it makes spending breath on
thrust a decision with a defensive cost, which is the tension the resource is for.

**One rule, and the postures differ for free.** The cost applies in both, but breath
regenerates at 12/s in the air and 30/s on the ground, because `breathRegenGroundedMultiplier`
is 2.5. So on foot a dodge's cost is repaid in 0.93 s, comfortably inside its own 1.5 s
cooldown, and the ground dodge stays as freely available as it is today. In the glider the
same 28 takes 2.33 s to earn back, which is longer than the cooldown, so chaining runs the bar
down. The posture difference emerges from a multiplier that already exists rather than from a
special case.

This does not make a single dodge energy-neutral. One dodge still adds 30 m/s. It makes the
*infinite* version cost something, which is what the measurement above is about.

#### The shape of it

`stepSlipstream` decides whether a dodge fires, so it is what must know the breath available.
It takes it as an argument and reports what it spent, rather than being handed a mutable
player:

```ts
export function canSlipstream(
  state: SlipstreamState, breath: number, c: SlipstreamConfig,
): boolean

export function stepSlipstream(
  state: SlipstreamState,
  pressed: boolean,
  heading: Vector3,
  breath: number,
  dt: number,
  c: SlipstreamConfig,
): { state: SlipstreamState; impulse: Vector3 | null; breathSpent: number }
```

`breathSpent` is `c.breathCost` on the frame a dodge fires and 0 otherwise. Returned rather
than applied, matching the contract `stepDash` and `stepSlipstream` already keep for the
impulse: movement code stays in charge of integration.

`controllerStep` subtracts it from `next.breath` in the same block that adds the impulse to
`next.velocity`, clamped at 0 so a rounding error cannot drive the bar negative. That block
runs after both posture branches, so it reads the breath the branch already settled — the
glider's drain from thrust or hover, or the ground branch's regeneration — rather than a
pre-step value.

### The glider dodge goes perpendicular, in three dimensions

The glider already has a frame: `gliderUp(forward, bank)` in `flight.ts` returns an up axis
perpendicular to `forward`, rolled about `forward` by the bank input, and it already handles
the one degenerate case (a vertical heading).

A new export beside it:

```ts
export function gliderRight(forward: Vector3, bank: number): Vector3
```

returning `cross(gliderUp(forward, bank), forward)` — the third axis of that same frame.
Derived from `gliderUp` rather than recomputed, so there is one definition of the glider's
frame and a change to the roll convention cannot leave the two disagreeing.

`dodgeHeading` in the glider then returns `±gliderRight`, signed by the strafe axis, defaulting
to `+gliderRight` when no axis is held. Three things follow:

- It is perpendicular to the flight path by construction, for any heading, because
  `gliderRight` is an axis of a frame built on `forward`.
- It is never forward, so the no-bank press stops being a boost.
- A banked glider's dodge tilts with the roll, because the bank is baked into the frame. A
  level glider's lateral dodge is horizontal; a rolled one's is not.

`stepSlipstream` must stop flattening the impulse. It currently drops the `y` component of
whatever heading it is handed, which would discard the tilt this change exists to produce.
On foot the heading is horizontal already, so removing the flatten changes nothing there —
`dodgeHeading`'s ground branch composes `slipstreamHeading`, which builds its direction from a
flattened camera vector and a horizontal right vector.

## Out of scope

- **Making the dodge energy-neutral by redirecting momentum.** Considered and rejected: it
  needs a second rule for the standstill case on foot, where there is no momentum to
  redirect, and the breath cost bounds the exploit without splitting the move in two.
- **The dodge's invulnerability window, duration and cooldown.** Untouched at 0.11 s, 0.2 s
  and 1.5 s. This spec changes what a dodge costs and which way it goes, not how it feels to
  time one.
- **The blast dash in `dash.ts`.** A different move, ground-only, chained rather than
  cooldown-gated, and it decays into the ground easing rather than persisting. It gains no
  free altitude because it is horizontal and on the ground.

## Testing

`src/player/slipstream.test.ts`:

- a dodge below `breathCost` does not fire, and does not spend the cooldown
- a dodge at exactly `breathCost` fires
- firing deducts exactly `breathCost`
- a dodge that does not fire deducts nothing
- the impulse keeps its vertical component rather than being flattened

`src/player/flight.test.ts`:

- `gliderRight` is perpendicular to `forward`, and to `gliderUp`, for a spread of headings
  including vertical
- it is unit length
- banking rolls it, so a banked frame's right has a non-zero `y`

`src/player/slipstream.test.ts`, for direction:

- a glider dodge with no axis held is perpendicular to the heading, and is **not** the heading
- a glider dodge while diving has a non-zero vertical component
- a ground dodge is unchanged: still camera-relative, still horizontal, still able to go
  backwards

**The regression test that matters**, in a file of its own because it runs the real controller
for 40 seconds: repeat the measurement from the table above. Assert that chain-dodging from
y 300 no longer ends higher than it started, and that its breath bar is no longer full.
Include the plain-glide control in the same test, so the two numbers are compared rather than
asserted against remembered constants.

Every number in this spec is measured except `breathCost`, which is an argued guess. None of
it has been played.
