# Airbender Skies — Design

**Date:** 2026-07-30
**Status:** Accepted
**Repository:** `DanielNygaard00/airbender-skies` (public)

## Summary

A third-person browser game in which the player controls an airbender who explores an
archipelago of floating islands while flying on an air kite. Airbending attacks are part of
the long-term vision but are deliberately deferred; the first version establishes the flight
model, the landscape, and the exploration loop, because everything else is built on top of
how flying feels.

## Goals

1. Flying the kite feels good enough to be worth doing for its own sake.
2. The floating landscape rewards exploration, and altitude is a resource worth managing.
3. The game runs in a browser from a public URL with no install step.
4. The ability system is structured so that airbending attacks can be added later without
   reworking the player controller.

## Non-goals for the first version

Combat, enemies, and damage. Multiplayer. Mobile or touch controls. Weather and day/night
cycles. A physics engine. These are excluded to keep the first version finishable, not
because they are unwanted.

## Technology choices

| Area | Choice | Reasoning |
| --- | --- | --- |
| Renderer | Three.js (vanilla) | Largest ecosystem of tutorials and CC0 assets for browser 3D. |
| Language / build | TypeScript + Vite | Matches existing toolchain; fast hot reload during tuning. |
| UI framework | None | The game loop is imperative and fixed-step. A React reconciler works against that, and the HUD is small enough to write directly against the DOM. |
| Physics | None (custom kinematic) | The requirements are velocity integration and downward raycasts, not rigid-body dynamics. A solver would add weight and take control of the feel away from the tuning config. |
| Tests | vitest | Already familiar; sufficient for the pure logic that matters. |
| Hosting | GitHub Actions → GitHub Pages | Free, gives a shareable playable URL on every push to `main`. |

### Alternatives considered

- **react-three-fiber.** Rejected: the reconciler's render model conflicts with a fixed-step
  simulation loop, and the project has no component-tree needs that would repay the friction.
- **Rapier physics.** Rejected: several hundred kilobytes of WASM to solve a problem the
  project does not have, and it makes glider tuning indirect.
- **Babylon.js.** Viable, but Three.js has substantially more community material and
  freely licensed art that matches this project's needs.
- **Godot / Unity / Unreal.** Rejected during scoping: heavier toolchains, binary artifacts
  that fit poorly in a public Git repository, and no browser-native distribution story as
  clean as a static site.

## Architecture

### Module layout

```
src/
  main.ts                bootstrap: renderer, canvas, level load, start loop
  core/
    loop.ts              fixed-step update + render, delta clamping
    input.ts             raw keyboard/mouse → InputState (intent, not key codes)
    assets.ts            GLTF and texture loading with a cache
  world/
    level.ts             parse and validate level data → World
    island.ts            island mesh generation from noise parameters
    terrain-query.ts     ground height and raycast queries
    props.ts             per-island prop scattering
  player/
    state.ts             PlayerState: position, velocity, mode, breath
    ground-move.ts       walk, run, jump, gravity, ground snapping
    flight.ts            glider aerodynamics and boost (pure)
    breath.ts            breath meter drain and regeneration (pure)
    controller.ts        mode switching; orchestrates the modules above
    avatar.ts            character model and animation state machine
  camera/
    follow-cam.ts        third-person spring arm with terrain pull-in
  fx/
    wind.ts              air trails and speed streaks
    audio.ts             wind loop driven by airspeed
  ui/
    hud.ts               breath meter, altitude, airspeed
  abilities/
    registry.ts          ability registration and dispatch
    boost.ts             the only ability in the first version
```

### Load-bearing interfaces

**`TerrainQuery`** is the single channel through which movement code asks about the world.

```ts
interface TerrainQuery {
  groundHeightAt(x: number, z: number): number | null
  raycastDown(from: Vec3, maxDistance: number): TerrainHit | null
}
```

Neither `flight.ts` nor `ground-move.ts` knows how islands are represented. The island
generator can change from noise meshes to imported geometry without touching movement code.

**`flight.step`** is a pure function, which is what makes the flight model tunable and
testable.

```ts
function step(
  state: PlayerState,
  input: InputState,
  dt: number,
  config: FlightConfig,
): PlayerState
```

All tuning constants live in a single `FlightConfig` object. No magic numbers are embedded
in the integration code.

**`AbilityRegistry`** maps an ability id to a handler with a breath cost and a cooldown. The
first version registers only `boost`. Adding attacks later means registering new handlers,
not modifying `controller.ts`.

## The flight model

Kite mode integrates three forces along the kite's forward axis:

- Gravity, constant downward.
- Lift, proportional to `v² · cos(angleOfAttack)`.
- Drag, proportional to `v²`.

Controls:

- **Mouse Y** sets the angle of attack. Pulling up trades speed for altitude and increases
  drag. Below a stall speed threshold, lift collapses and the player falls until airspeed
  recovers. **W and S** are a secondary binding for the same axis, for players who prefer
  not to steer with the mouse; both feed the same input value.
- **Mouse X** banks the kite, with **A and D** as the equivalent secondary binding. Turn rate
  scales with airspeed, so fast turns are wide.
- **Shift** applies an airbending boost: an impulse forward and upward that drains the breath
  meter while held.
- **Space** deploys or stows the kite.

The integration approximately conserves energy, which produces the central skill expression:
dive to build airspeed, then pull up to convert that airspeed back into altitude. Chaining
dive-and-climb cycles lets a skilled player reach islands that a single boost cannot,
without making boost feel useless.

Landing below a threshold speed stows the kite cleanly. Landing above it causes a stagger
animation with no damage.

### Breath meter

Breath is the single resource behind all airbending, present and future. It drains while
boosting, regenerates when not boosting, and regenerates faster while standing on ground.
Maximum breath increases permanently as the player collects air shrines.

## Ground movement

Movement is camera-relative walking and running with jump and gravity, with the character
snapped to the ground by a downward raycast each step. Walking off an edge begins a free
fall; pressing Space during the fall deploys the kite. There is no fall damage, because the
kite is always available.

## The landscape

Island layout is authored by hand in a data file. Island geometry is generated from noise at
load time, but placement is a deliberate design decision.

```ts
type Level = {
  id: string
  spawn: { island: string; offset: Vec3 }
  islands: IslandDef[]
}

type IslandDef = {
  id: string
  position: Vec3
  radius: number
  height: number
  biome: 'grass' | 'rock' | 'temple'
  noiseSeed: number
  props?: PropPlacement[]
}
```

The first version ships eight islands, sequenced to teach the flight model:

1. A starting island large enough to learn walking, jumping, and deploying the kite.
2. A ring of islands reachable by gliding alone, teaching that altitude converts to distance.
3. Two islands that require a single boost, introducing breath as a resource.
4. A high spire reachable only by chaining dive-and-climb cycles, as the skill test.

### Exploration reward

Each island holds one **air shrine**. Touching a shrine permanently raises maximum breath by
ten percent of its starting value, so collecting all eight roughly doubles it. This makes
exploration compound: the islands you reach expand the reach you
have, so the difficult islands unlock the means to attempt the harder ones. Collected
shrines and current maximum breath are persisted in `localStorage`.

## Presentation

A spring-arm follow camera with two profiles: close behind the character on the ground,
pulled further back with a slightly wider field of view in flight. The arm shortens when it
would intersect terrain.

Audio and effects are deliberately minimal but chosen for impact on the sense of speed: a
looping wind sound whose volume and pitch follow airspeed, ribbon trails from the kite tips
above a speed threshold, and a field-of-view kick when airspeed crosses that threshold.

## Art assets

The character is a freely licensed rigged model with idle, run, fall, and glide animations.
Environment props come from CC0 low-poly packs. Every asset is recorded in `ASSETS.md` with
its source and license, and all committed assets are CC0 or equivalently permissive so the
repository stays clean as a public project.

If an asset fails to load, the game substitutes a primitive placeholder and logs a warning
rather than failing to start.

## Error handling

| Failure | Behaviour |
| --- | --- |
| Asset fails to load | Substitute a primitive placeholder, log a warning, keep running. |
| Level data invalid | Throw with a readable message in development; skip the offending island in production. |
| Non-finite velocity in flight integration | Reset velocity to the last known good value and log. |
| Player falls below the world floor | Respawn at the last island touched. |
| WebGL unavailable | Replace the canvas with an explanatory HTML message. |

The guiding rule is that the game never presents a blank screen without explanation.

## Testing strategy

Tests target the pure logic, where correctness is both meaningful and cheap to verify:

- `flight.step`: diving increases airspeed; pulling up trades airspeed for altitude; lift
  collapses below stall speed; total energy stays within expected bounds over a glide.
- `breath.ts`: drain while boosting, regeneration rates, clamping at maximum.
- `level.ts`: valid levels parse; invalid spawn references and malformed islands are rejected.
- `terrain-query.ts`: height queries return expected values for generated islands and `null`
  off the edge of every island.

Rendering is not tested automatically. How the game feels is verified by playing it.

## Delivery

The repository is public at `DanielNygaard00/airbender-skies`. A GitHub Actions workflow
builds on every push to `main` and deploys to GitHub Pages, making the current state of the
game playable at a URL.

## Roadmap beyond the first version

Airbending attacks are the next phase. They are designed for now so the architecture
supports them, and they all draw on the same breath meter:

- **Air Blast** — a directional push that moves objects and, later, enemies.
- **Air Scooter** — a ball of air granting high-speed ground movement.
- **Tornado** — lifts and briefly holds a target.
- **Air Shield** — a deflecting bubble.

Each arrives as a new entry in `AbilityRegistry`. After abilities come targets for them:
simple enemies, and destructible or movable environment elements.
