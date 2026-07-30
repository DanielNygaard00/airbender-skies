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
    flight.ts            glider aerodynamics and thrust (pure)
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
    thrust.ts            the only ability in the first version
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

Because flight is camera-relative, `InputState` carries the camera's forward direction
alongside the key states:

```ts
interface InputState {
  lookDirection: Vec3    // normalised camera forward
  forward: number        // W = +1, S = -1
  strafe: number         // D = +1, A = -1
  sprint: boolean        // Shift
  actionPressed: boolean // Space, edge-triggered
}
```

`InputState` deliberately describes intent rather than kite-specific forces. Naming the axes
`forward` and `strafe` instead of `thrust` and `bank` is what makes the "both modes share the
same bindings" claim below true in code: one axis means thrust in the air and walk on the
ground, and `actionPressed` means jump, deploy, or stow depending on mode. The mapping from
these axes to flight forces happens in the controller, which is also where the kite's bank
angle is applied.

This keeps `flight.step` pure and independent of the camera implementation: it receives a
direction vector, not a camera object.

**`AbilityRegistry`** maps an ability id to a handler with a breath cost and a cooldown. The
first version registers only `thrust`. Adding attacks later means registering new handlers,
not modifying `controller.ts`.

## The flight model

Flight is **camera-relative**: the mouse aims the camera, and the kite steers toward where
the camera is looking. This matches the convention players already know from the Minecraft
elytra, the Zelda paraglider, and third-person flight in games like Just Cause. It is
deliberately not flight-sim convention, where the mouse would be a raw pitch and roll axis.

Kite mode integrates three forces:

- Gravity, constant downward.
- Lift, proportional to `v² · sin(2 · angleOfAttack)`, perpendicular to velocity and lying in
  the plane that contains the kite's up axis. The `sin(2 · aoa)` shape is what produces the
  stall behaviour described two paragraphs below: lift peaks near 45 degrees of angle of
  attack and then falls away to zero with the kite broadside to the airflow, so a high angle
  of attack collapses lift as a consequence of the geometry rather than through a special
  case. A `cos(angleOfAttack)` term would be largest exactly where the kite should stall and
  could not produce that behaviour. The angle is bounded to a quarter turn, which is where
  the term reaches zero, so lift decays to nothing broadside and never reverses.
- Drag, proportional to `v²`, opposing velocity.

**Angle of attack is derived, not an input.** It is the angle between the kite's forward
vector and its actual velocity vector. Because the kite turns toward the camera, looking
sharply upward makes forward diverge from velocity, which spikes both lift and drag: the
player climbs and bleeds airspeed. Looking down does the reverse. This produces pitch control
without a dedicated pitch axis, and stall falls out of the same geometry — a high angle of
attack at low airspeed collapses lift, and the player falls until airspeed recovers.

Controls in kite mode:

| Input | Effect |
| --- | --- |
| Mouse | Aims the camera. The kite turns toward camera forward at a rate limited by airspeed, so fast flight turns wide and slow flight turns tight. |
| `W` | Airbending thrust along the kite's forward axis. Drains breath while held. This is what "fly toward where you are looking" means mechanically. |
| `S` | Flare: raises the angle of attack past what the camera commands, adding drag to slow down hard. Used for landing and for tightening a turn. |
| `A` / `D` | Bank assist: rolls into the turn for a sharper horizontal turn than camera-following alone gives. |
| `Space` | Deploys or stows the kite. |

Gliding needs no input at all — gravity and lift carry the player forward. `W` is
acceleration on top of that, and it is the only breath cost in flight. There is no separate
boost key: sustained thrust and boost are the same verb.

The integration approximately conserves energy — a prototype measured 4.3% loss over a five
second unpowered glide — which produces the central skill expression: the **zoom climb**. A
dive builds airspeed, and pulling up converts that airspeed into height, carrying the player
roughly thirty metres above the point where the pull-up began.

A zoom climb is net-lossy, and this is deliberate. Measured from the prototype, a dive costs
about 57 metres of altitude and the following climb buys back about 29, so the player ends the
cycle both lower and slower. Gliding is therefore a way to spend height on distance and on
brief bursts of reach, never a way to gain height for free.

**Thrust is the only source of net altitude**, and thrust costs breath. This is what makes air
shrines the real progression gate: raising maximum breath is what extends how far upward the
player can go, while gliding skill determines how efficiently they spend what they have. The
two systems reinforce each other rather than competing.

Landing below a threshold speed stows the kite cleanly. Landing above it causes a stagger
animation with no damage.

### Breath meter

Breath is the single resource behind all airbending, present and future. It drains while
thrusting, regenerates when not thrusting, and regenerates faster while standing on ground.
Maximum breath increases permanently as the player collects air shrines.

## Ground movement

Movement is camera-relative: `W`, `A`, `S`, `D` move the character in the direction the
camera faces, `Shift` sprints, and `Space` jumps. The character is snapped to the ground by a
downward raycast each step. Walking off an edge begins a free fall; pressing `Space` during
the fall deploys the kite. There is no fall damage, because the kite is always available.

The two modes share the same bindings with mode-appropriate meanings — `W` is "go forward" in
both, `Space` is "get airborne" in both — so nothing needs to be relearned when the kite
comes out.

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
3. Two islands that require sustained thrust to reach, introducing breath as a resource.
4. A high spire that needs a dive, a zoom climb, and thrust used together, as the skill test.
   Not reachable by chaining dive-and-climb cycles alone: a cycle is net-lossy, so chaining
   cycles loses height rather than gaining it, and thrust remains the only source of net
   altitude. The spire tests whether the player can convert a dive into a climb efficiently
   enough that the breath they have left covers the remaining gap.
5. A mid-height waypoint island between the low ring and the high islands, where breath
   regenerates part-way through a long crossing. It exists because the crossing to the
   thrust-gated islands is otherwise a single breath budget with no recovery point, which
   makes the gate a wall rather than a challenge.

### Exploration reward

Each island holds one **air shrine**. Touching a shrine permanently raises maximum breath by
ten percent of its starting value, so collecting all eight roughly doubles it. This makes
exploration compound: the islands you reach expand the reach you
have, so the difficult islands unlock the means to attempt the harder ones. Collected
shrines and current maximum breath are persisted in `localStorage`.

## Presentation

The camera is not only presentation — in flight it is the steering device, which raises it to
a gameplay-critical system. The two modes invert the relationship between camera and
character:

- **On ground**, the character leads. The camera trails behind on a spring arm and movement
  is expressed relative to wherever it happens to be pointing.
- **In flight**, the camera leads. The mouse orbits it freely and the kite turns to follow,
  so camera responsiveness directly determines how the flight handles. Camera smoothing must
  stay tight enough here that steering does not feel laggy; the weight of the kite comes from
  the airspeed-limited turn rate, not from a sluggish camera.

Both modes use the same spring arm, with the arm pulled further back and the field of view
widened slightly in flight to sell speed. The arm shortens when it would intersect terrain.

Audio and effects are deliberately minimal but chosen for impact on the sense of speed: a
looping wind sound whose volume and pitch follow airspeed, ribbon trails from the kite tips
above a speed threshold, and a field-of-view kick when airspeed crosses that threshold.

### Waterfalls

Islands carry waterfalls spilling off their rims: a scrolling curtain of water hanging from
the edge and fading out below. They are scenery with no physics and no collision, and they
exist for two reasons. They give the islands a reason to read as torn from a world that had
water in it, and more usefully they mark rim edges, which a player about to walk off one
needs to see. Like the islands themselves they use no binary assets — the texture is
generated procedurally at load time from a seeded random source, so it stays deterministic
and raises no licence question.

Each waterfall is authored in the level file as an island id, an angle around that island's
rim, a width, and a visible length. Placement then has to find the real rim, which is not at
a fixed radius: noise displaces each island's silhouette, so the nominal rim point often has
no ground beneath it. Placement probes inward through a sequence of insets and anchors at the
first one that finds ground, and drops the waterfall with a warning if none does. A dropped
waterfall costs some scenery; one anchored at a guessed radius would hang in mid-air.

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
| Non-finite velocity in flight integration | Respawn the player at the last island they stood on, reset to ground mode, and log. A velocity restore was the original intent, but there is no trustworthy "last known good" state once a non-finite value has appeared: position may already be corrupt, and breath and maximum breath must be re-validated too or a corrupt maximum can be laundered into current breath. A respawn is a teleport, which is a more visible interruption than a velocity reset, and that is the accepted trade for guaranteeing the player lands in a state that is finite by construction. |
| Player falls below the world floor | Respawn at the last island touched. |
| WebGL unavailable | Replace the canvas with an explanatory HTML message. |

The guiding rule is that the game never presents a blank screen without explanation.

## Testing strategy

Tests target the pure logic, where correctness is both meaningful and cheap to verify:

- `flight.step`, driven by feeding it look directions: a downward look increases airspeed; an
  upward look trades airspeed for altitude; the derived angle of attack matches the geometry
  between forward and velocity; lift collapses at a high angle of attack below stall speed;
  the kite's turn toward a new look direction respects the airspeed-limited turn rate; total
  energy stays within expected bounds over an unpowered glide.
- `breath.ts`: drain while thrusting, regeneration rates, clamping at maximum.
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
