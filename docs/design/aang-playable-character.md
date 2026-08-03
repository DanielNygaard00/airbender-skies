# Aang — Playable Character Design

**Working title:** Airbender Skies
**Scope of this document:** movement, world/landscape, and combat, described as systems for a playable third-person action-traversal game.

---

## 1. Design Pillars

1. **Momentum is the resource.** Aang is never at his best standing still. Every core system — traversal, evasion, and offense — reads and rewards accumulated speed.
2. **The air is terrain.** Wind currents, thermals, and updrafts are level geometry the player learns to read, not background decoration.
3. **Redirect, don't absorb.** Aang has low health and no blocking. Defense means moving the attack, or moving himself.
4. **Escalation is earned, not granted.** The strongest states (Avatar State) come from sustained good play, not cooldown timers.

---

## 2. Movement

Aang's movement is one continuous system with three layers. The player never switches "modes" through a menu — layers blend based on speed, altitude, and whether the glider is deployed.

### 2.1 Ground Layer — Airbending Locomotion

Baseline movement is deliberately *not* a normal run. Aang skims.

| Move | Input | Behavior |
|---|---|---|
| Air-assisted run | Left stick | Base speed high, acceleration soft. Aang leans into turns and slides on stops. |
| Air Scooter | Tap sprint on ground | Aang forms a spinning ball of air and rides it. Doubles speed, halves turn authority. Can ride up vertical walls while speed holds. |
| Air Blast Dash | Dodge button | Short burst of ground-shed thrust. Cancels most animations. Chains three times before a short recovery. |
| Gust Jump | Jump | Two jumps. The second is a downward air push, so it gains more height the *faster* Aang is already moving upward. |

**Air Scooter details.** The scooter is the connective tissue of ground movement. It has a small hidden speed accumulator: hold a clean line without hard turns or collisions and the ball tightens and accelerates. Clip a wall and you drop a tier. Wall-riding drains the accumulator, so vertical shortcuts cost the speed you built to reach them. This gives corridors and courtyards a rhythm game underneath the platforming.

### 2.2 Air Layer — Glider Flight

The staff snaps open into wings on demand. Flight is a **soaring** model, not a jetpack model.

- **Baseline physics:** Aang trades altitude for speed and speed for altitude, like a real glider. Left alone, he sinks.
- **The bending override:** Holding the thrust input lets Aang bend air into his own wings. This is what separates him from every other flier in the world — he manufactures his own updraft. Thrust drains **Breath**, a fast-refilling meter that only refills when he is *not* thrusting.
- **Consequence:** Long flights are a rhythm of thrust bursts and gliding recovery. Players who mash thrust stall out at low altitude; players who read the map's natural lift barely spend Breath at all.

**Flight controls**

| Input | Result |
|---|---|
| Stick | Pitch and roll. Yaw is coupled to roll, so turns are banked, not flat. |
| Thrust (hold) | Self-made updraft plus forward acceleration. Drains Breath. |
| Tuck (hold) | Fold wings partially. Fast dive, big speed gain, no lift. |
| Flare (tap) | Pop wings wide. Hard brake, converts speed into a short vertical pop. |
| Stow staff | Instant transition back to the ground layer mid-air. Keeps horizontal momentum. |

**Stall and recovery.** Climb too steeply and Aang stalls: control softens, the wings shudder, and he drops until airspeed returns. Stalling is survivable and readable, not a death — but it puts him in the air at low speed, which is his most vulnerable state in combat.

### 2.3 Transition Layer — The Part That Sells It

Transitions are where the character feels *right*, so they carry no cost:

- Deploying the glider mid-jump preserves all momentum and adds a small upward kick.
- Stowing the glider into a dive converts vertical speed into a ground slide that feeds straight into the Air Scooter accumulator.
- Landing at high speed never hard-stops Aang. He rolls, skims, or scoots out of it.

The intended feel: a single unbroken line from a mountain ridge, through a valley, up a temple wall, and off the far side without ever touching a neutral standing pose.

### 2.4 Payload — A Deliberate Weakness

Aang can carry a companion or an objective on the glider, and it visibly degrades flight: lower lift ceiling, sluggish roll, faster Breath drain. Escort and rescue sections use this instead of an artificial speed cap, and it stays consistent with how he flies in the source material — the glider was never built for two.

---

## 3. Landscape and World

### 3.1 Shape of the World

The world is built as **vertically stacked, horizontally open regions** rather than a flat continent. Each region has three usable strata:

1. **Ground** — dense, hand-authored, high in combat and NPC density. Streets, temple interiors, canyon floors, forests.
2. **Mid-air** — the traversal layer. Cliff faces, rooftops, rock spires, ruins, rope bridges, canopy. Contains most collectibles and most of the level's readable landmarks.
3. **High air** — thin on geometry, heavy on wind. Long sightlines, cloud decks, and the fastest travel routes. Reaching it is a small achievement each time.

Regions connect at *altitude* as well as at ground level, so the map is genuinely three-dimensional. A wall that blocks you at ground level is a hallway two hundred meters up.

### 3.2 Wind as Level Geometry

Wind is the world's most important invisible object, so it is made visible:

| Feature | Visual tell | Function |
|---|---|---|
| **Thermal** | Rising dust, spiralling leaves, heat shimmer over stone or desert | Sustained lift. Circle inside it to climb without spending Breath. |
| **Ridge lift** | Grass and banners bending uniformly up a slope | Free lift when flying parallel to a cliff face, not into it. |
| **Wind river** | Long streamers of cloud, drifting seeds, aligned bird flocks | High-speed conveyor between regions. Enter aligned or get spat out. |
| **Downdraft** | Falling mist, flattened treetops, dust pressed outward | Forces descent. Used as a soft boundary and as a hazard over water. |
| **Dead air** | Still smoke, hanging dust, flat water | No lift at all. Breath-only flying. Placed under bosses and inside canyons to make specific fights ground-bound. |

The rule for artists: **never place a wind feature the player cannot see from at least one approach.** Wind is a puzzle, and a puzzle you cannot see is a bug.

### 3.3 Region Archetypes

- **Air Temple Peaks** — the traversal showcase. Extreme verticality, abundant thermals, near-zero flat ground. Teaches flight in a place where flying is safe.
- **Canyon Country** — narrow, twisting, low ceiling. Ridge lift on every wall, dead air at the bottom. Rewards precision over altitude.
- **Flooded Lowlands** — wide, open, dangerous. Downdrafts over water punish altitude greed. Long stretches with no landing surface, so Breath management becomes survival.
- **Industrial City** — dense mid-air layer of pipes, cranes, and airships. Wind is artificial: exhaust vents give lift on a *timer*, so routes have rhythm. Highest ground-combat density.
- **Frozen Coast** — brutal, constant crosswind that pushes on every axis. Flight becomes crabbing and correcting. Teaches the flight model's edges before the final act.
- **Scorched Plain** — huge thermals from burning ground, but heat haze wrecks visibility. Trade: easy altitude, poor information.

### 3.4 Readability Rules

- Landmarks are silhouettes first. Every region has 3–5 shapes identifiable from a kilometer out at any time of day.
- Traversal surfaces are keyed by material, not by paint. Wall-rideable stone reads differently from decorative stone at a glance, and the difference holds in every biome.
- Verticality is legible from below. Standing on the ground, a player should be able to point at where the high route is.

---

## 4. Combat

### 4.1 Combat Identity

Aang is a **crowd-control evasion fighter**. He is fragile, extremely mobile, and his damage largely comes from the environment and from enemies hitting each other. He is not a damage-per-second character, and the systems are tuned so that trying to play him as one fails.

- No block. No parry-into-riposte. No damage sponge.
- Health is small and regenerates slowly out of combat.
- Every defensive option is *positional*: dodge, displace, or redirect.

### 4.2 Core Kit

**Airbending — always available**

| Move | Function |
|---|---|
| Gust | Fast, low damage, high knockback. Interrupts, staggers, opens gaps. |
| Vortex | Charged. Pulls a group inward and lifts them briefly. Setup, not damage. |
| Pressure Wave | Ground slam from a fall. Damage scales with fall height — a direct payoff for the traversal layer. |
| Air Wall | Hold. A short-lived barrier that *deflects* projectiles rather than eating them. Angle it and you return fire. |
| Slipstream | Directional dash with a brief invulnerability window on a tight timing. The dodge, upgraded. |

**Staff — melee and control**

Short, snappy combos with wide horizontal arcs, built for hitting several enemies at once instead of one enemy hard. The staff also gates flight: **you cannot glide while swinging.** Committing to melee means committing to the ground layer, which is the game's central risk decision.

**Borrowed elements — unlocked across the campaign**

Each added element is a small, distinct verb rather than a full duplicate kit:

- **Water** — pull, hold, freeze. The control element. Locks a target in place, extinguishes fire hazards, and turns pooled water into a hazard surface.
- **Earth** — raise, throw, wall. The only source of hard cover and the only reliable armor-breaker. Slow, committed, high payoff.
- **Fire** — burst and propulsion. The only element with real single-target damage. Also the emergency mid-air thrust when Breath is empty, at the cost of a Fire resource.

Elements are switched on a radial, and switching is fast enough to sequence mid-combo: vortex a group, freeze the front rank, drop a pillar under them.

### 4.3 Aerial Combat

Fighting from the glider is a distinct posture, not a reskin.

- Aang keeps one hand on the staff, so his kit narrows to gusts and single-hand redirects.
- Enemy projectiles are the primary threat, and the primary *tool* — a well-angled Air Wall or Slipstream can send a fire blast into the archer who fired it.
- Diving attacks convert airspeed into a shockwave on impact, then bounce Aang back into the air. High-speed dive → Pressure Wave → re-deploy glider is the flagship aerial combo.
- Aerial enemies (airships, mounted fliers, dive-bombers) are designed as *wind features that shoot back*: their engines and wakes create real lift and turbulence Aang can ride.

### 4.4 Enemy Design Contract

Every enemy exists to pressure a specific axis of Aang's movement:

| Enemy type | Pressures |
|---|---|
| Spear infantry | Ground spacing. Punishes standing still. |
| Archers / fire ranged | Altitude. Makes hovering expensive. |
| Heavy armored | Knockback economy. Immune to gusts, must be broken with earth or the environment. |
| Nets and chains | Flight itself. Grounds Aang, forcing a fight in his weaker posture. |
| Earthbender duelists | Terrain stability. Removes his cover and his landing spots. |
| Airship gunners | Long-line flight. Turns open sky into a shooting gallery, forcing hedge-hopping. |

Encounters are built as *combinations* of these, and the intended answer is almost always movement rather than a specific counter-move.

### 4.5 Breath, Focus, and the Avatar State

Three meters, each with a clear job:

- **Breath** — flight and dash fuel. Fast refill, refills only when unspent. Governs moment-to-moment pacing.
- **Focus** — builds from unbroken chains: consecutive hits, clean traversal, redirected projectiles, damage avoided at close range. Drains on taking damage. Spends on elemental heavy moves.
- **Avatar State** — fills only from Focus held at maximum for a sustained period. Not a damage meter, and not on a timer the player can farm.

**In Avatar State:** unlimited Breath, all elements simultaneously available, greatly increased damage, and every wind feature in the arena reacts to Aang. It is short, loud, and drops Focus to zero afterward — a reward for a well-played encounter, not a routine rotation. Story-locked in the early game, always situational later.

### 4.6 The Non-Lethality Constraint

Aang's defining trait is that he wins without killing, and the combat system encodes it rather than mentioning it in cutscenes:

- Every enemy has a **downed** state instead of a death state — disarmed, buried to the waist, frozen, blown off a ledge into water, tangled in their own equipment.
- Enemies removed non-lethally grant more Focus than enemies removed by environmental accident, so the generous play is also the strong play.
- A small number of scripted moments let the player break this. The game does not fail them for it — Focus generation simply degrades for the rest of the encounter, and the character reacts. The mechanic carries the theme; no dialogue box is needed.

---

## 5. Progression Summary

| Act | Movement unlock | Combat unlock | World teaches |
|---|---|---|---|
| 1 | Glider, Air Scooter | Airbending core, staff | Thermals, ridge lift |
| 2 | Wall-riding, Tuck/Flare | Water, Earth | Wind rivers, downdrafts |
| 3 | Extended Breath, dive-shockwave | Fire, Avatar State | Dead air, artificial wind, crosswind |

Each act's world design assumes the previous act's kit is fully internalized, and each new region opens with an unpressured traversal sequence before the first encounter.

---

## 6. Failure States and Tuning Notes

- **Falling is not death.** Aang can always deploy the glider, and hard landings cost health and momentum instead of a reload. Death by falling should be nearly impossible, and that should feel like a character trait rather than a difficulty setting.
- **Drowning is a soft fail.** Water is a boundary; Aang surfaces and loses momentum and Focus.
- **The tuning target for the ground layer:** a player who never flies should still find the game playable but visibly harder, because they are paying full price for every wall.
- **The tuning target for the air layer:** a player who never lands should run out of Breath in any encounter, because altitude alone is not a strategy.

Both extremes are dead ends by design. The character lives in the transition between them.
