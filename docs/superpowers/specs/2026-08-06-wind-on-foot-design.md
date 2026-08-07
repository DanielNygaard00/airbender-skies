# The Air Is Terrain For The Character, Not Just The Wing

## The problem

`src/world/wind.ts` opens by saying wind is level geometry rather than weather: "The design
pillar is that the air is terrain: lift is something the player reads and routes through, the
way they read a ledge."

It is terrain for the glider only. `controllerStep` calls `deps.windAt` inside the glider
branch and nowhere else, so `groundStep` never sees the air. Measured: a player falling in
ground mode through a fabricated updraft of 500 m/s² — twenty-five times gravity — moves from
y 200 to y 189.8 over one second. Exactly the same as still air. Nothing.

The archipelago carries a thermal set plus a ridge, a river, a downdraft and a dead-air
volume, and a character who has not deployed the wing passes through all of them as though
they were empty space. So a thermal cannot lift you before you open the glider, a downdraft
cannot catch you on a jump, and a river cannot push a falling body along it.

## The change

`groundStep` gains a `WindSample` and applies its acceleration while the body is airborne.

```ts
export function groundStep(
  state: PlayerState,
  input: InputState,
  dt: number,
  terrain: TerrainQuery,
  c: GroundConfig,
  collision: CollisionConfig,
  wind: WindSample = stillAir(),
): PlayerState
```

The default is `stillAir()`, which is the honest neutral value and keeps all thirty-three
existing test call sites meaningful rather than forcing a mechanical edit through every one.
The risk a default carries — that production silently forgets to pass the real thing — is
covered by a test asserting that `controllerStep` threads it, which is the only path that
matters.

Three deliberate limits.

**Only while airborne.** Wind is applied when `state.grounded` is false. A player standing on
rock is braced against it; pushing them around would also fight the ground snap, which owns
vertical placement for a grounded body. This is the same division of labour terrain collision
already uses — one system owns the surface, and the others leave it alone.

**Only `wind.accel`, never `wind.liftScale`.** The lift scale multiplies a wing's own lift and
is meaningless without a wing. Dead air therefore does nothing to a body on foot, which is
correct: dead air is defined as a volume where a wing stops working, not one where gravity
changes.

**The heading passed to `windAt` is `state.forward`.** Ridge lift and rivers ask which way
the sampler is pointing — a ridge lifts anyone flying *along* its face, and a river carries
anyone moving *with* it. On foot `forward` is the flattened camera direction, which is where
the character faces, so a falling player who turns to look along a river gets carried by it.
That is the same question the glider answers with its steered heading, asked with the value
this posture has.

The glider branch is **not touched**. It samples wind with its own steered `forward` after
`steerToward` has run, and that ordering is what makes ridge lift respond to trimming. Moving
the sample up to a single shared call before the posture branch would change which heading the
glider asks with, and the glider's flight is the most heavily tested behaviour in the codebase.
Two call sites, each asking with the heading its posture actually has, is the cheaper honesty.

## What this makes possible, and what it does not

A thermal now lifts a falling body, so the intended reading of the archipelago's air changes:
a player who jumps into a thermal column rises. That is the pillar working. It also means the
`climb-north` / `spire` / `beacon` progression has a second route — ride a thermal up on foot
before deploying — and whether that is a shortcut worth closing is a tuning question for play,
not something this cycle should pre-empt.

Not in scope, and each for its own reason:

- **Arrows.** `stepProjectile` would need the sampler threaded into `stepEncounter`, and arrow
  drift interacts with the archer's `aggroRange` and `strikeRange`, tuned two cycles ago
  against still air. That is a combat-balance change wearing a physics change's clothes.
- **Enemies.** `stepEnemy` moves horizontally and is ground-snapped every step, so wind would
  do nothing until a gust or a Pressure Wave put a soldier in the air — at which point it
  needs care not to have knocked-back soldiers drift off island rims, which would quietly
  cheapen section 4.6's scoring the way the patrol-placement fix already had to guard against.
- **Wind on a grounded player**, per the airborne limit above.

## Testing

- A falling player in a strong updraft ends higher than the same player in still air. This is
  the measurement inverted: the fabricated 500 m/s² case moved y 200 to 189.8 before, which is
  indistinguishable from still air, and the test must compare the two rather than assert a
  bound one of them happens to satisfy.
- A **grounded** player in the same updraft does not move, so the airborne limit is real.
- A horizontal river displaces a falling player along its axis.
- `wind.liftScale` of 0 changes nothing on foot, so dead air is wing-only.
- `controllerStep` threads the real sampler into `groundStep` — asserted by giving `windAt` a
  spy or a distinctive value and observing it reach a falling player. This is the test that
  covers the default parameter's risk, and it is the one that must exist.
- The glider's behaviour is byte-identical: a glide with a wind sampler present produces the
  same positions it did before. Worth pinning, because "do not touch the glider" is an
  intention and intentions need tests.

Every number here is measured. The design decisions — airborne only, `accel` only,
`state.forward` as the heading — are argued, not played.
