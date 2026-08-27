import { Vector3 } from 'three'
import {
  applyDamage, fullHealth, isDowned, stepHealth, type Health, type HealthConfig,
} from './health'
import {
  clearMark, deflects, hitEnemy, holdEnemy, isTargetable, markEnemy, spawnEnemy, stepEnemy,
  throughArmour,
  type BendingSource, type Enemy, type EnemyConfig, type EnemyKind, type GroundHeightQuery,
} from './enemy'
import {
  canIceLock, canWaterGrip, iceLockTargets, waterGripImpulse, waterGripTargets,
  type WaterConfig,
} from './water'
import {
  addPillar, canRaisePillar, canStoneThrow, pillarShoveImpulse, pillarShoveTargets, pillarSite,
  spawnPillar, stepPillars, stoneImpulse, stoneThrowTargets, type EarthConfig, type Pillar,
} from './earth'
import {
  canFireBurst, fireBurstImpulse, fireBurstTargets, type FireConfig,
} from './fire'
import {
  freshChain, isFinisher, landChain, stepChain, type ChainConfig, type ChainState,
} from './chain'
import {
  applyReaction, elementOf, reactionFor,
  type ReactionConfig, type ReactionKind,
} from './reactions'
import type { Element } from '../elements/element'
import { gustImpulse, gustTargets, type GustConfig } from './gust'
import {
  waveDamage, waveImpulse, waveTargets, type PressureWaveConfig,
} from './pressure-wave'
import { vortexCharge, vortexImpulse, vortexTargets, type VortexConfig } from './vortex'
import { staffDamage, staffImpulse, staffTargets, type StaffArcConfig } from './staff-arc'
import { shouldRestorePatrol, type PatrolConfig } from './patrol'
import { spawnProjectile, stepProjectile, type Projectile, type ProjectileConfig } from './projectile'
import {
  deflect, idleAirWall, isAirWallUp, stepAirWall, type AirWallConfig, type AirWallState,
} from './air-wall'
import type { StaffSwing } from '../player/staff'

/**
 * One fight: the enemies, the player's health, and the cooldown on their bending.
 *
 * Kept out of PlayerState on purpose. Movement is a pure function of a player
 * struct that a dozen tests build fixtures for, and combat has no business widening
 * that struct — a fight is a thing happening in the world, not a property of the
 * character's kinematics.
 */
export interface Encounter {
  enemies: Enemy[]
  /** Arrows in flight. Owned by the fight, like the enemies that loosed them. */
  projectiles: Projectile[]
  /**
   * The next arrow's id.
   *
   * A counter rather than `Math.random()`, so ids are unique and deterministic — the
   * effects layer keys a view off them, and this project's tests cannot tolerate
   * unrepeatable values.
   */
  nextProjectileId: number
  playerHealth: Health
  /** Seconds until the next gust is available. */
  gustCooldown: number
  /** Seconds the player has held a charge, or 0. Not the 0-to-1 fraction. */
  vortexHeldSeconds: number
  vortexCooldown: number
  /**
   * The Air Wall's lifetime and cooldown.
   *
   * Nested rather than flattened into two more fields beside `gustCooldown`, unlike the way
   * `PlayerState` carries the Slipstream's two. That flattening exists because a dozen
   * movement tests build `PlayerState` fixtures by hand and widening the struct costs every
   * one of them; nothing builds an `Encounter` by hand — `startEncounter` is the only
   * constructor — so the module that owns the rule gets to own the struct.
   */
  airWall: AirWallState
  /**
   * Seconds until the next Water Grip is available.
   *
   * Its own field rather than one shared "light verb cooldown", because the three moves on that
   * key have deliberately different cooldowns — 0.45 for a gust, 1.1 for a grip, 1.8 for a stone
   * — and a shared timer would let switching element launder one move's cooldown into the
   * other's. Earth added its own for that reason and fire will too.
   */
  waterGripCooldown: number
  /** Seconds until the next Stone Throw is available. Its own field, per the rule above. */
  stoneThrowCooldown: number
  /**
   * The columns of rock standing in this fight, oldest first.
   *
   * Owned here beside the arrows because both are objects this fight put into the world with
   * lifetimes of their own — and, like the arrows, they are stepped every frame whatever the
   * player is doing. Order is raise order, which is what `addPillar`'s cap relies on.
   *
   * On `Encounter` rather than on the level or the world, even though a pillar is a physical
   * object in the scene: it exists because of a move made in a fight, it expires on the fight's
   * clock, and nothing outside a fight can produce one. The world is built once from a `Level`
   * and has no mechanism for anything to arrive in it later.
   */
  pillars: Pillar[]
  /**
   * The next pillar's id.
   *
   * A counter rather than `Math.random()`, for the reason `nextProjectileId` is one: the view
   * layer keys a mesh off it and this project's tests cannot tolerate unrepeatable values.
   */
  nextPillarId: number
  /**
   * Seconds until the next Fire Burst is available.
   *
   * The third light-verb cooldown, its own field for the reason above: at 1.2 seconds it is the
   * longest of the three, so any sharing would let an element switch convert it into the gust's
   * 0.45. It is decremented every frame whatever element is selected, alongside the other two.
   *
   * Fire's *charges* are deliberately not here. A cooldown is fight state — it is the recovery of
   * one move inside one fight — but the charges are a resource the player carries between fights,
   * refilled by a landing that the fight cannot see and spent by a movement move the fight has no
   * part in. They live beside Focus in `main.ts`, and the fight reads them through
   * `EncounterInput.fireCharges` and bills them through `EncounterStep.chargesSpent`, which is the
   * same contract Focus and breath already have here.
   */
  fireBurstCooldown: number
  /**
   * The current string. See `chain.ts` — it carries no element, so a swap cannot reset it.
   *
   * On the encounter rather than on the player for the reason `Focus` is not on `PlayerState`:
   * movement is a pure function of a struct a dozen tests build fixtures for, and how many blows
   * have landed in a row is not a property of the character's kinematics.
   */
  chain: ChainState
}

export interface CombatConfig {
  player: HealthConfig
  /**
   * One config per kind of soldier, rather than one config full stop.
   *
   * A Record keyed by `EnemyKind` rather than an array, so a missing kind is a
   * typecheck error at the point the config is written rather than an undefined at the
   * point a soldier spawns.
   */
  enemies: Record<EnemyKind, EnemyConfig>
  projectile: ProjectileConfig
  gust: GustConfig
  pressureWave: PressureWaveConfig
  vortex: VortexConfig
  staffArc: StaffArcConfig
  airWall: AirWallConfig
  water: WaterConfig
  earth: EarthConfig
  fire: FireConfig
  chain: ChainConfig
  reactions: ReactionConfig
}

export interface EnemySpawn {
  id: string
  position: Vector3
  kind: EnemyKind
}

/**
 * What the fight needs from the world, separate from the per-frame input.
 *
 * Mirrors how `ControllerDeps` sits beside `InputState` in the player controller:
 * a terrain query is a dependency, not something the player did this frame.
 */
export interface EncounterDeps {
  ground: GroundHeightQuery
  worldFloorY: number
  /**
   * Where this fight's soldiers stand when fresh.
   *
   * On the deps rather than on `Encounter`: a running fight is not a level
   * definition, and this interface already means "what the fight needs from the
   * world" as opposed to "what the player did this frame".
   */
  spawns: readonly EnemySpawn[]
  patrol: PatrolConfig
}

export function startEncounter(spawns: readonly EnemySpawn[], c: CombatConfig): Encounter {
  return {
    enemies: spawns.map((spawn) => spawnEnemy(
      spawn.id, spawn.position, spawn.kind, c.enemies[spawn.kind],
    )),
    projectiles: [],
    nextProjectileId: 0,
    playerHealth: fullHealth(c.player),
    gustCooldown: 0,
    vortexHeldSeconds: 0,
    vortexCooldown: 0,
    airWall: idleAirWall(),
    waterGripCooldown: 0,
    stoneThrowCooldown: 0,
    pillars: [],
    nextPillarId: 0,
    fireBurstCooldown: 0,
    chain: freshChain(),
  }
}

export interface EncounterInput {
  playerPosition: Vector3
  playerForward: Vector3
  /**
   * The player's full three-dimensional aim, which the Air Wall alone reads.
   *
   * Distinct from `playerForward` on purpose, and the only place in the fight where the
   * distinction matters. `playerForward` is flattened by construction on foot and is the
   * glider's flight path in the air, so it can never point up or down at will in either
   * posture — and the wall's normal has to, or a reflection cannot change an arrow's vertical
   * rate. See the module comment on `air-wall.ts` for the measurement that forced this.
   *
   * The wiring layer passes the look direction in both postures, so the wall is angled by
   * where the player looks whether they are on foot or gliding. That is deliberately not what
   * the gust does — the gust reads `playerForward`, the nose, in the glider. The gust has no
   * elevation to get right, so it does not need the distinction; this one does, and one rule
   * across both postures beats matching a move that does not have the problem.
   */
  playerAim: Vector3
  /** Breath in hand, so `stepAirWall` can refuse a raise it cannot pay for. */
  playerBreath: number
  /**
   * Which element is selected, and therefore which move each bending key resolves to.
   *
   * F is the light verb and R is the heavy one, and the element decides what those are: air
   * gives Gust and Vortex, water gives Water Grip and Ice Lock, fire gives Fire Burst and — on
   * the player's side rather than here — the Fire Thrust. So this field is what makes the
   * two keys mean six moves, and it is the single place a new element plugs into the fight.
   *
   * Fire's heavy verb is the one that does not resolve in this function, and the omission is
   * deliberate: a thrust adds velocity to the glider and touches nobody in the fight, so putting
   * it here would mean handing `EncounterInput` the player's posture and `EncounterStep` a
   * velocity impulse — the fight steering the wing. `main.ts` resolves it through `canFireThrust`
   * and `fireThrustImpulse`, which own the rule, and it does so *after* deducting `chargesSpent`
   * below, so a burst and a thrust pressed on the same frame with one charge left cannot both
   * fire. See the module comment on `src/combat/fire.ts`.
   *
   * On the input rather than on `Encounter`, because the selection is not fight state: it
   * survives a respawn and it survives leaving the fight entirely, the way the direction the
   * player is facing does.
   */
  element: Element
  /** Edge-triggered: the player pressed the light bending key this frame. */
  gustPressed: boolean
  /** A Pressure Wave landed at the player's feet this frame, or null. */
  slam: { strength: number } | null
  /** R held: a vortex is charging. Only air charges; see the dispatch in `stepEncounter`. */
  vortexHeld: boolean
  /** R released this frame: fire the active element's heavy verb. */
  vortexReleased: boolean
  /** The player is inside a slipstream's invulnerable window. */
  playerInvulnerable: boolean
  /** The swing the player's staff started this frame, or null. */
  staffSwing: StaffSwing | null
  /** G held: raise or keep an Air Wall up. A hold rather than an edge, per section 4.2. */
  airWallHeld: boolean
  /**
   * Focus the player has right now, so a move priced in Focus can refuse itself.
   *
   * Passed in rather than the fight owning a meter: `Focus` belongs to `src/focus`, and the
   * alternative — `main.ts` deciding whether the player can afford a freeze and passing a
   * pre-filtered edge — would put the rule in the one module with no tests. The fight decides,
   * and reports the bill as `focusSpent`.
   */
  focusAvailable: number
  /** Breath the player has right now, for the same reason. */
  breathAvailable: number
  /**
   * Fire charges the player holds right now, so the burst can refuse itself.
   *
   * Passed in for the reason `focusAvailable` is: the resource lives outside the fight, and having
   * `main.ts` pre-filter the press would put the rule in the one module with no tests. The fight
   * decides and reports the bill as `chargesSpent`.
   */
  fireCharges: number
}

/** One hit aimed at the player this frame, and where it came from. */
export interface PlayerHit {
  from: Vector3
  damage: number
}

/** One projectile a pillar stopped this frame, and where it struck the rock. */
export interface PillarBlock {
  pillarId: string
  /**
   * Where the shot met the rock, in world space.
   *
   * The projectile's position as it entered the step, not the pillar's centre: dust on the face
   * the arrow hit is the tell, and a burst at the axis of the column would appear inside it.
   */
  at: Vector3
}

export interface EncounterStep {
  encounter: Encounter
  /** Enemies knocked down this frame, for feedback and for scoring later. */
  downedThisFrame: string[]
  /**
   * Of `downedThisFrame`, the soldiers going down for the first time.
   *
   * The Focus list. `downedThisFrame` is the feedback list and stays wider.
   */
  firstDownsThisFrame: string[]
  /**
   * Enemies that went down by falling out of the world this frame, kept apart from
   * downedThisFrame.
   *
   * Section 4.6 pays a non-lethal removal more Focus than an environmental accident, so
   * the two have to be reported as disjoint sets rather than one flag folded into the
   * other -- an enemy that falls out of the world is also newly downed, and without the
   * split it would land in both lists and get paid for both.
   */
  lostThisFrame: string[]
  /**
   * Ids of the soldiers spawned back in this frame, because the whole patrol was
   * down and the player had left.
   *
   * `main.ts` needs this to reset the position interpolators for those ids — without
   * it a restored soldier's view would tween from wherever its body was left to its
   * fresh spawn point instead of popping in there.
   */
  restoredThisFrame: string[]
  /**
   * The enemies as this frame's simulation left them, before any restore replaced them.
   *
   * The only array that agrees with `downedThisFrame`, `lostThisFrame` and the three
   * connect lists about where a soldier was. Those lists are all computed before the
   * restore -- they have to be, because `wasDowned` is diffed at the top of the step --
   * so on a frame that both reports a down and restores the patrol, `encounter.enemies`
   * holds fresh soldiers standing at their spawn points and has no record of where the
   * body fell. A caller drawing a down burst from `encounter.enemies` puts it on the
   * patrol ground while the player is 45 units away watching nothing happen.
   *
   * Identical to `encounter.enemies` on every frame that does not restore, which is
   * almost all of them; it exists for the frame where the two differ.
   */
  enemiesBeforeRestore: readonly Enemy[]
  /** Enemies a gust connected with this frame, for feedback and for Focus. */
  hitThisFrame: string[]
  /** Enemies a Pressure Wave connected with this frame. Kept apart from hitThisFrame:
   *  that one feeds a per-enemy Focus grant, and a slam is already paid for by its
   *  own strength, so folding them together would pay twice for one slam. */
  slamHitThisFrame: string[]
  /** Enemies a staff swing connected with. Kept apart from hitThisFrame and
   *  slamHitThisFrame because each feeds a differently tuned Focus grant. */
  staffHitThisFrame: string[]
  /**
   * Enemies whose armour turned a whole blow away this frame.
   *
   * Disjoint from the three connect lists, and it pays no Focus: nothing happened to the
   * soldier, so paying for it would make plate armour a Focus battery. It exists so the
   * effects layer can say something — a move that produces no damage, no push, no sound and
   * no burst reads as a bug, and the heavy armoured soldier's whole design depends on the
   * player learning quickly that the gust is the wrong tool rather than that the gust is
   * broken.
   */
  deflectedThisFrame: string[]
  /** Whether the player was hit this frame, for feedback. */
  playerHit: boolean
  /**
   * Damage was incoming and was discarded. NOT "the player is invulnerable" — a flag
   * meaning that would let a player farm Focus by dodging nothing.
   */
  damageAvoided: boolean
  /** The charge a vortex fired at, or null. For the effect that draws it. */
  vortexFired: number | null
  /**
   * Live soldiers a Water Grip caught this frame.
   *
   * Kept out of `hitThisFrame` and its three siblings, all of which feed a Focus grant. Neither
   * water move pays Focus, for the reason the Vortex pays none: a control move that also earned
   * meter would be a Focus engine, and the freeze *spends* the same meter — a move that paid
   * part of its own price back would be priced twice and would not read as a cost at all.
   */
  grippedThisFrame: string[]
  /** Live soldiers an Ice Lock froze this frame. Out of the Focus lists, for the same reason. */
  frozenThisFrame: string[]
  /**
   * Whether the grip fired at all, even catching nobody.
   *
   * Reported separately from `grippedThisFrame` because the effect and the voice fire on the
   * *attempt* — the same way `main.ts` draws a gust cone from the press rather than from a
   * connect. A move that is silent when it misses reads as a move that did not come out.
   */
  gripFired: boolean
  /** Whether the freeze fired at all. Same reason. */
  freezeFired: boolean
  /**
   * Live soldiers a Stone Throw hit this frame.
   *
   * Its own list beside the four connect lists, and — unlike them — **it feeds no Focus grant.**
   * The stone does real damage, so the instinct is to pay it the way `hitThisFrame` pays a gust,
   * and it is deliberately not paid. Earth's heavy verb spends 30 Focus, so a light verb that
   * earned Focus per connect would let earth fund its own cover: six stones and the pillar is
   * paid for, which prices the pair twice and is the exact mistake the water design note names
   * when it explains why neither water move pays. Earth is still paid for what it actually
   * achieves — `firstDownsThisFrame` pays for putting a soldier down, and putting a *heavy* down
   * is the thing earth exists to do.
   *
   * It exists for the same reason `redirectHitsThisFrame` does: the effects layer needs to know a
   * body took something.
   */
  stoneHitThisFrame: string[]
  /** Whether a stone was thrown at all, even catching nobody. Same reason as `gripFired`. */
  stoneFired: boolean
  /**
   * The pillar raised this frame, or null.
   *
   * The object rather than a flag, because the one thing a caller wants on this frame — a voice,
   * and the dust at its base — needs to know *where*. The pillar is also already in
   * `encounter.pillars`, so this is a report of which one is new rather than a second copy of
   * the state.
   *
   * Null on the frames a raise was refused, and refused says nothing about why: no Focus, no
   * breath and no ground all produce the same null, and all three cost the player nothing.
   */
  pillarRaised: Pillar | null
  /**
   * Projectiles a pillar stopped this frame, with where each one struck.
   *
   * A list of objects rather than parallel arrays, the shape `playerHitsThisFrame` already uses,
   * because the feedback needs the position and the position is only in hand inside the arrow
   * loop.
   *
   * **It pays no Focus, and that is a decision.** `redirectedThisFrame` pays for an Air Wall
   * turning a shot around, and the grant's own doc comment says why: the redirect is a skilled
   * act, a barrier angled onto a bearing inside the arrow's flight time. Standing behind a rock
   * raised five seconds ago is not that act. Paying it would also make a pillar a Focus battery
   * aimed at an archer — raise cover, let two archers shoot it, and the pillar has paid for the
   * next pillar, which is the same self-funding loop `stoneHitThisFrame` refuses.
   */
  blockedThisFrame: PillarBlock[]
   /**
   * Live soldiers a Fire Burst connected with this frame.
   *
   * Its own list rather than folded into `hitThisFrame`, and unlike the water lists the reason is
   * not that it pays a different Focus grant — it pays **none**. `hitThisFrame` feeds
   * `gustConnectGain`, so folding a burst into it would hand the damage element a per-hit Focus
   * income that funds the Ice Lock and the Avatar State, and fire is already the element that pays
   * best through `firstDownsThisFrame` because it is the element that puts soldiers down. The list
   * exists for the impact bursts and the voice, which is what `redirectHitsThisFrame` is for too.
   */
  burstHitThisFrame: string[]
  /**
   * Whether the burst fired at all, even catching nobody.
   *
   * The same contract `gripFired` has, and it is what `main.ts` draws the cone and plays the voice
   * from: a burst can be refused for want of a charge or for a cooldown, and neither refusal is
   * something the wiring layer can see without restating `canFireBurst`.
   */
  burstFired: boolean
  /**
   * Fire charges this frame's moves spent. Zero on almost every frame, and never more than one.
   *
   * Reported rather than applied, exactly as `focusSpent` and `breathSpent` are: the charges belong
   * to the player and the fight only reads them. A count rather than a boolean so the field says
   * the same thing the other two bills do, and so a future fire move that spent two would need no
   * new field.
   */
  chargesSpent: number
  /**
   * Focus this frame's moves spent. Zero on almost every frame.
   *
   * Reported rather than applied, the same contract `stepEnemy` uses for `damageToPlayer`: this
   * function advances a fight and has no business holding the player's meters.
   */
  focusSpent: number
  /** Breath this frame's moves spent. Zero on almost every frame. */
  breathSpent: number
  /** Projectile ids loosed this frame, so a bow release can be made audible. */
  firedThisFrame: string[]
  /**
   * Projectile ids an Air Wall turned around this frame. The Focus list for section 4.5's
   * "redirected projectiles".
   *
   * Paid at the moment of the redirect rather than when the returned arrow lands, because the
   * redirect is the skilled act — angling a barrier onto a bearing inside the arrow's flight
   * time. Whether it then finds a body is partly the fight's arrangement, and a grant that
   * waited for the landing would pay nothing for a well-walled arrow that happened to have
   * open ground behind it.
   */
  redirectedThisFrame: string[]
  /**
   * Enemies a returned arrow struck this frame.
   *
   * Kept apart from `hitThisFrame` and reported for feedback only — it feeds no Focus grant.
   * The redirect has already been paid for by `redirectedThisFrame`, and if the arrow puts a
   * soldier down, `firstDownsThisFrame` pays for that as well. Folding this into the gust's
   * connect list would be a third payment for one act, which is the exact mistake
   * `slamHitThisFrame` and `staffHitThisFrame` exist as separate lists to avoid.
   */
  redirectHitsThisFrame: string[]
  /**
   * Breath the Air Wall spent this frame, for the caller to deduct.
   *
   * Reported rather than applied, the contract `stepSlipstream` already has: a fight has no
   * business writing to the player's meters, and `Encounter` deliberately holds none of them
   * except the health pool the fight itself damages.
   */
  airWallBreathSpent: number
  /**
   * Seconds of glider refusal a net just landed on the player, or 0.
   *
   * Reported rather than applied, like every other effect on the player in this struct: the
   * fight owns enemies and arrows, and the glider is the player controller's business.
   * Already zeroed by a Slipstream, so a caller can add it unconditionally.
   */
  tangleSeconds: number
  /**
   * Where each hit on the player came from this frame, in world space, with its damage.
   *
   * A list rather than one aggregated direction: two spears and an arrow can land on the
   * same frame, and averaging their bearings would point at empty space between them.
   *
   * Reports what was *aimed*, not what landed. `damageAvoided` zeroes the damage applied
   * to the player without erasing the attack that provoked it, so an entry lands here even
   * when a Slipstream discards it — a dodge should still tell the player where the attack
   * came from, which is the information that makes the next dodge possible. Filtering this
   * list down to only what `applied` kept would read as the more obvious rule and is the
   * wrong one.
   */
  playerHitsThisFrame: PlayerHit[]
  /**
   * Reactions that fired this frame, for feedback, in the order they resolved.
   *
   * Which is move order first and enemy order within one move — `stepEncounter` resolves the moves
   * in a fixed order and each one walks the enemy list, so the sequence is deterministic without
   * being sorted. Not "enemy order" outright, which an earlier draft of this comment claimed: two
   * moves on one frame can each reach the same soldier.
   *
   * A list rather than a single reaction, because one burst can steam several wet soldiers at
   * once and a feedback layer that could only draw the first would silently under-report the
   * best press in the game.
   */
  reactionsThisFrame: { enemyId: string; kind: ReactionKind }[]
  /**
   * Whether the blow this frame landed as a finisher, for feedback.
   *
   * Nothing reads it yet: it is here for a later step to hang a flourish on, and step B of the
   * visual arc is where that gets drawn. Reported rather than deferred until there is a consumer,
   * because the fight is the only place that knows, and the knowledge does not survive the frame.
   */
  finisherThisFrame: boolean
}

/** What one of the player's moves did to everyone it caught. */
interface Blow {
  enemies: Enemy[]
  /** Live soldiers that took something. Feeds a Focus grant and an impact burst. */
  connected: string[]
  /**
   * Live soldiers whose armour turned the whole blow away.
   *
   * Disjoint from `connected` by construction, so a caller cannot pay Focus for a move that
   * did nothing. Kept as its own list rather than folded into `connected` with a flag,
   * because the feedback for the two is different in kind: one is a hit and one is a clang.
   *
   * **Still populated when the blow was a finisher**, because the armour's verdict is a fact about
   * what the blow did rather than about whether the string paid off — see `Reach.deflected`, which
   * owns that rule for all three of the resolvers that apply it, and `Reach.landing` for the one
   * thing the finisher does widen.
   */
  deflected: string[]
  /** Reactions this blow set off, in enemy order. Empty on almost every blow. */
  reactions: { enemyId: string; kind: ReactionKind }[]
}

/**
 * The mark-and-reaction half of one landing on one soldier, wrapped around the landing itself.
 *
 * **The order is the system, and it is not negotiable:** read the *old* mark and look the pairing
 * up first, then land the blow, then resolve the reaction, then write this blow's own mark.
 * Writing the mark first would put the element that just landed on both sides of the lookup —
 * `reactionFor`'s diagonal, which is `'none'` for all four elements — so no cross-element
 * reaction could ever fire, and the whole table would be dead code that still typechecked.
 *
 * The landing arrives as a callback rather than as a damage-and-impulse pair because three of the
 * nine sources are not blows: water's grip pulls and then holds, its freeze only holds, and
 * earth's pillar shoves from the rock rather than from the player. All three still mark, so all
 * three come through here. One helper with a callback rather than the four steps restated at each
 * source, because an order this easy to get backwards is exactly what drifts when it is copied —
 * the comment on `resolveBlow` records that the four hand-rolled resolvers it replaced had
 * already drifted once.
 *
 * **The reaction lands after the blow rather than folded into it, because the two are armoured
 * differently.** The blow's damage goes through `throughArmour` and Steam's deliberately does not
 * — see `applyReaction`, and the heavy's `armour.burst` of `{ damage: 0.5, knockback: 0 }` for
 * what Steam is bypassing. One `hitEnemy` call takes one damage figure, so a folded total would
 * have to be armoured or unarmoured as a unit and one of the two halves would be wrong. Two calls
 * is not a cost here: `hitEnemy` counts a rung only on a crossing, so the second call cannot
 * invent one.
 */
function markAndReact(
  enemy: Enemy,
  element: Element | null,
  c: ReactionConfig,
  blow: (target: Enemy) => Enemy,
): { enemy: Enemy; kind: ReactionKind } {
  const kind = element !== null && enemy.mark !== null
    ? reactionFor(enemy.mark.element, element)
    : 'none'
  const struck = blow(enemy)
  // `clearMark` rather than leaving the new mark to overwrite it, and the case that needs it is
  // `markEnemy`'s refusal to mark a downed body: a reaction that puts the soldier down — Steam
  // does, at 1.0 unarmoured against a spear's 1.5 — leaves no new mark to overwrite the old one,
  // so without this the spent mark would stand on a corpse and promise a reaction to a fight that
  // is over. `encounter.test.ts` pins that case.
  const reacted = kind === 'none' ? struck : applyReaction(clearMark(struck), kind, c)
  return {
    enemy: element === null ? reacted : markEnemy(reacted, element, c.markSeconds),
    kind,
  }
}

/** Who one of the player's moves reaches, and what the string says about it. */
interface Reach {
  /**
   * Live soldiers the armour let the blow through to, in enemy order.
   *
   * **The reporting list, and only that.** It becomes `hitThisFrame` and its siblings, which is
   * what `main.ts` pays `gustConnectGain` on — so a finisher must never add a name here. The
   * design note's own Global Constraints say combos pay in mechanics and never in Focus, and this
   * is the line that keeps that true. Who the blow is *applied* to is `landing` below.
   */
  connected: string[]
  /**
   * Live soldiers whose armour turned the whole blow away, in enemy order.
   *
   * **Retained on a finisher**, unlike `landing` below, and the asymmetry between the two is the
   * whole of this struct. The armour's verdict is what the feedback layer draws a clang for and
   * what the Focus meter is paid on, so a soldier its plate saved is reported as a clang whether
   * or not the string then shoved it.
   *
   * The first shape of this code emptied the list on a finisher instead, which put the soldier on
   * `connected` and paid `gustConnectGain` 6 for a blow that took zero health off it — the heavy's
   * `armour.gust` is `{ damage: 0, knockback: 0 }`, so there was nothing to pay for. Measured on
   * the shipped config, `staff, staff, gust` against a heavy beside a spear paid 24 Focus where the
   * same three presses without a string paid 18.
   */
  deflected: string[]
  /**
   * Who the blow is applied to: `connected`, **plus `deflected` when this was a finisher**.
   *
   * Widened wholesale rather than filtered per-enemy, because `deflects` is a whole-blow verdict:
   * nothing is turned away once the blow is a finisher. The heavy's `armour.gust` is
   * `{ damage: 0, knockback: 0 }`, so the ordinary path skips the target entirely — which would
   * mean a finisher gust did nothing at all to the one soldier the finisher exists for. §4.4 gives
   * the heavy a knockback economy and hands the currency to pressure; this is pressure spent.
   *
   * **So a finisher on a plate soldier displaces it and pays nothing**, and that is the trade
   * §4.4's knockback economy asks for rather than a shortfall. The damage still goes through the
   * armour, which is zero on that row; the impulse goes around it; and the soldier is reported as
   * a deflect, so the meter never sees it. Displacement is the only currency the finisher spends.
   */
  landing: ReadonlySet<string>
  /** Whether this landing was the one that completed the string. */
  finisher: boolean
}

/**
 * Who one blow reaches, split by armour, with the string advanced and the finisher decided.
 *
 * Its own function rather than the top of `resolveBlow`, because three of the nine bending sources
 * cannot go through `resolveBlow` at all — water's grip pulls and then holds, its freeze only
 * holds, earth's pillar shoves from the rock rather than from the player — and two of those three
 * still owe the finisher the same answer. Restating the catch-armour-and-decide split at each of
 * them is exactly how `resolveBlow`'s own comment records the four original resolvers drifting.
 *
 * Reads `enemies` before anything is written, so "connected" means a live soldier took the blow
 * rather than a body being shoved around the island.
 */
function reachAndLand(
  enemies: readonly Enemy[],
  caught: ReadonlySet<string>,
  source: BendingSource,
  c: CombatConfig,
  land: (connectedCount: number) => boolean,
): Reach {
  const reached = enemies.filter((enemy) => caught.has(enemy.id) && isTargetable(enemy))
  const turned = reached.filter((enemy) => deflects(c.enemies[enemy.kind], source))
  /**
   * The string is advanced from the blows the armour let *through*, and the finisher is decided
   * from the string as it stood *before* this landing — see `isFinisher` in `chain.ts`, which is
   * read that way because the completing landing spends the string. So a deflect builds nothing,
   * and the blow that completes a string is itself the finisher rather than the press after it.
   */
  const finisher = land(reached.length - turned.length)
  const turnedAway = new Set(turned.map((enemy) => enemy.id))
  const connected = reached.filter((enemy) => !turnedAway.has(enemy.id)).map((enemy) => enemy.id)
  return {
    connected,
    deflected: turned.map((enemy) => enemy.id),
    // The finisher widens who the blow is *applied* to and changes neither list above — see
    // `Reach.landing` for why the two are kept apart, and `Reach.deflected` for the Focus grant
    // that a single shared list quietly paid.
    landing: new Set(finisher ? reached.map((enemy) => enemy.id) : connected),
    finisher,
  }
}

/**
 * Resolve one of the player's moves against everyone it caught.
 *
 * All four moves used to be four near-identical `enemies.map` blocks, and the reason to
 * fold them into one is not brevity. `isTargetable` is the gate every resolver has to ask,
 * the four copies had already drifted once (`hitThisFrame` was read before the hits landed
 * in three of them and the vortex reported nothing at all), and armour has just given each
 * of them a second thing to get right. One function is one place for both.
 *
 * `damage` and `impulse` are callbacks rather than values because the vortex's impulse
 * depends on the charge and the staff's on which swing it was, and both are per-target.
 * Everything the caller already computed stays in the caller's closure.
 *
 * Who the blow reaches, and whether it is a finisher, comes from `reachAndLand`, which reads
 * `enemies` before anything is written — so "connected" means a live soldier took the blow rather
 * than a body being shoved around the island, the property the gust resolver's original comment
 * insisted on and now true for every source by construction.
 *
 * `land` is the fight's own chain, handed through as a callback rather than as a `ChainState` in
 * and a `ChainState` out. The awkward part of the chain is not the arithmetic but the *timing*:
 * the finisher has to be known before the blow is applied, and it cannot be known until the blow
 * is known to have connected. Threading the closure through lets the split happen once and the
 * blow be applied **exactly once**. The two alternatives were both worse: resolving the blow twice
 * — once to learn who connected, then again with the finisher known, discarding the first pass —
 * invites a later reader to see a double application and is one refactor away from being one; and
 * predicting connection at the call site would duplicate the catch-and-armour geometry at every
 * one of the six call sites, which is the duplication this function exists to have deleted.
 */
function resolveBlow(
  enemies: readonly Enemy[],
  caught: ReadonlySet<string>,
  source: BendingSource,
  c: CombatConfig,
  damage: (enemy: Enemy) => number,
  impulse: (enemy: Enemy) => Vector3,
  land: (connectedCount: number) => boolean,
): Blow {
  const element = elementOf(source)
  const reach = reachAndLand(enemies, caught, source, c, land)
  const reactions: { enemyId: string; kind: ReactionKind }[] = []
  return {
    connected: reach.connected,
    deflected: reach.deflected,
    reactions,
    enemies: enemies.map((enemy) => {
      // A deflected blow is not merely reduced to nothing, it is skipped: `hitEnemy` also
      // interrupts a wind-up and resets the stance, and armour that stopped the blow has no
      // business also cancelling the swing it was in the middle of. A reaction is skipped with
      // it — a blow the plate stopped is not a blow that arrived, so it can ignite nothing.
      //
      // `landing` rather than `connected`, and the difference is the finisher: at the last link a
      // soldier the armour turned away is applied to anyway, so it is interrupted, marked and can
      // react. It stays on `deflected` for reporting — see `Reach` for why the two lists differ.
      if (!reach.landing.has(enemy.id)) return enemy
      const armour = c.enemies[enemy.kind].armour[source]
      const outcome = markAndReact(enemy, element, c.reactions, (target) => {
        const armoured = throughArmour(damage(target), impulse(target), armour)
        // The damage still goes through the armour on a finisher; only the impulse goes around
        // it. A finisher that also did full damage would make the chain the answer to plate's
        // health pool, which is the environment route's job.
        return hitEnemy(
          target, armoured.damage, reach.finisher ? impulse(target) : armoured.impulse,
        )
      })
      if (outcome.kind !== 'none') reactions.push({ enemyId: enemy.id, kind: outcome.kind })
      return outcome.enemy
    }),
  }
}

/** Whether a gust can fire: off cooldown only. */
export function canGust(encounter: Encounter): boolean {
  return encounter.gustCooldown <= 0
}

/** Whether a vortex can start charging: off cooldown only. */
export function canVortex(encounter: Encounter): boolean {
  return encounter.vortexCooldown <= 0
}

/**
 * Whether a Water Grip can fire: off cooldown, and with the breath to pay for it.
 *
 * A thin wrapper over `canWaterGrip`, which owns the rule, so the fight and the action guide
 * ask the same question through the same shape the other two `can*` predicates here have. The
 * guide reaches this one rather than `canWaterGrip` directly for exactly that symmetry —
 * otherwise one row in the panel would be reading a cooldown off an `Encounter` by hand.
 */
export function canGrip(encounter: Encounter, breath: number, c: WaterConfig): boolean {
  return canWaterGrip(encounter.waterGripCooldown, breath, c)
}

/**
 * Whether a Stone Throw can fire: off cooldown, and with the breath to pay for it.
 *
 * The same thin wrapper `canGrip` is, for the same symmetry: the rule lives in `earth.ts` and both
 * the fight and the action guide reach it through a shape that takes an `Encounter`, so no row in
 * the panel reads a cooldown off a fight struct by hand.
 */
export function canStone(encounter: Encounter, breath: number, c: EarthConfig): boolean {
  return canStoneThrow(encounter.stoneThrowCooldown, breath, c)
}

/**
 * Whether a Fire Burst can fire: off cooldown, and with a charge to spend.
 *
 * A thin wrapper over `canFireBurst`, which owns the rule, so the fight and the action guide ask
 * the same question through the same shape the other three `can*` predicates here have. The guide
 * reaches this one rather than `canFireBurst` directly for exactly that symmetry — otherwise one
 * row in the panel would be reading a cooldown off an `Encounter` by hand.
 */
export function canBurst(encounter: Encounter, charges: number, c: FireConfig): boolean {
  return canFireBurst(encounter.fireBurstCooldown, charges, c)
}

/**
 * Advance the whole fight one frame.
 *
 * Order matters: the gust resolves, then the vortex, then the staff, then the wave,
 * then the enemies act. Each of the gust, the staff and the wave interrupts a
 * wind-up rather than trading with it, which requires all three to land before
 * enemies are stepped. Their relative order is arbitrary but deterministic, and it
 * means each later move sees the earlier ones' knockback already applied.
 *
 * The arrows already in flight are stepped before that enemy pass too, for a
 * different reason: the enemy pass is what spawns this frame's new arrows, and an
 * arrow stepped before it exists would advance on the very frame it is fired,
 * appearing already a metre or two from the bow.
 *
 * The Air Wall sits inside that same arrow pass, and both halves of where it sits are
 * load-bearing. It is stepped immediately *before* the loop, so a wall raised this frame can
 * catch an arrow already inside the wedge on the frame the player reacted rather than one
 * frame later. And each arrow is offered to the barrier *before* it advances, not after: at
 * the archer's shipped speed of 34 an arrow covers 0.57 units a frame at 60 Hz, so testing a
 * post-step position asks whether the arrow is in front of the wall having already crossed
 * it. A returned arrow's hit on a soldier also lands here, ahead of the enemy pass, for the
 * reason the gust, the staff and the wave all land ahead of it: `hitEnemy` interrupts a
 * wind-up, and an interrupt applied after the soldier has acted is not an interrupt.
 */
export function stepEncounter(
  encounter: Encounter,
  input: EncounterInput,
  dt: number,
  c: CombatConfig,
  deps: EncounterDeps,
): EncounterStep {
  const wasDowned = new Set(
    encounter.enemies.filter((enemy) => isDowned(enemy.health)).map((enemy) => enemy.id),
  )

  let enemies = encounter.enemies
  let gustCooldown = Math.max(0, encounter.gustCooldown - dt)
  let waterGripCooldown = Math.max(0, encounter.waterGripCooldown - dt)
  let stoneThrowCooldown = Math.max(0, encounter.stoneThrowCooldown - dt)
  /**
   * The standing pillars, one frame older, expired ones gone.
   *
   * Aged here beside the three cooldowns and for the identical reason: **unconditionally, whatever
   * element is selected.** A pillar whose clock only ran while earth was in hand would let a
   * player park cover by switching to air, and hard cover that lasts as long as you do not use the
   * rest of your kit is not a cost. This is also the only place a pillar's life is ever shortened
   * — see `Pillar.secondsLeft` for why nothing else may.
   */
  let pillars = stepPillars(encounter.pillars, dt)
  let nextPillarId = encounter.nextPillarId
  let fireBurstCooldown = Math.max(0, encounter.fireBurstCooldown - dt)
  /**
   * The string, one frame older, expired if its window has lapsed.
   *
   * Aged here beside the five cooldowns and the pillars, and for the identical reason:
   * **unconditionally, whatever element is selected.** A window that only ran while the element
   * the string started under was still in hand would make §4.2's own mixed sequence impossible to
   * lose, and a string a player can park is not pressure.
   */
  let chain = stepChain(encounter.chain, dt, c.chain)
  let finisherThisFrame = false
  /**
   * Every reaction any of this frame's blows set off, in the order they resolved.
   *
   * One list rather than one per move, for the reason `deflectedThisFrame` is one list: nothing
   * downstream tunes a reaction by which move produced it, and the feedback is one plume per
   * soldier however it was lit.
   */
  const reactionsThisFrame: { enemyId: string; kind: ReactionKind }[] = []
  /**
   * A blow has landed on somebody: advance the string, spending it if this was the landing that
   * completed it, and say whether it was.
   *
   * One helper rather than the same three lines at each resolver, because the ordering is easy to
   * get backwards. **The verdict is read before the landing, not after** — `landChain` spends the
   * string on the completing landing, so there is no post-landing state to read it off; see
   * `isFinisher` in `chain.ts`. It still names the completing blow rather than the press after it.
   *
   * A landing rather than a press, and `connectedCount` is deliberately the count of soldiers the
   * *armour let through*: a blow a plate turned away entirely is the armour working, not pressure
   * applied, and `focus.ts` pays a gust on connect for the same reason.
   *
   * **It reports nothing.** `land` below is what every source that can act on the verdict calls;
   * this one exists for the freeze, which cannot.
   */
  const advanceChain = (connectedCount: number): boolean => {
    if (connectedCount === 0) return false
    const finisher = isFinisher(chain, c.chain)
    chain = landChain(chain, c.chain)
    return finisher
  }
  /**
   * The same, for the eight sources that will act on the verdict — and may therefore report it.
   *
   * `finisherThisFrame` is what a later step will draw a flourish from, so only a frame that
   * actually behaved like a finisher may raise it. The freeze advances the string through
   * `advanceChain` and does not come through here, because a frame where a freeze completed a
   * string behaved like any other frame and a flourish drawn over it would be feedback for
   * nothing.
   *
   * The or lives here rather than at each call site for the reason the ordering does: an or
   * restated at eight sites is an or somebody eventually writes as an assignment.
   */
  const land = (connectedCount: number): boolean => {
    const finisher = advanceChain(connectedCount)
    if (finisher) finisherThisFrame = true
    return finisher
  }

  let hitThisFrame: string[] = []
  /**
   * Every soldier that had a blow turned away by its armour this frame, from any of the four
   * moves below.
   *
   * One list rather than four, because the feedback is one clang per soldier however many
   * moves bounced off it, and because nothing downstream tunes a deflect by which move
   * produced it. That is the opposite of the connect lists, which stay separate precisely
   * because each feeds a differently sized Focus grant.
   */
  const deflectedThisFrame: string[] = []
  let grippedThisFrame: string[] = []
  let frozenThisFrame: string[] = []
  let burstHitThisFrame: string[] = []
  let gripFired = false
  let freezeFired = false
  let stoneHitThisFrame: string[] = []
  let stoneFired = false
  let pillarRaised: Pillar | null = null
  let burstFired = false
  let focusSpent = 0
  let breathSpent = 0
  let chargesSpent = 0

  // The light bending key, dispatched on the active element. Air gusts; water grips; fire bursts.
  // All three cooldowns tick every frame regardless of which element is selected, above —
  // switching away must not park a cooldown, or a player could hide a gust's recovery inside water
  // and come back to a gust that never recovered.
  if (input.gustPressed && input.element === 'air' && canGust(encounter)) {
    const caught = new Set(
      gustTargets(input.playerPosition, input.playerForward, enemies, c.gust)
        .map((enemy) => enemy.id),
    )
    const blow = resolveBlow(
      enemies, caught, 'gust', c,
      () => c.gust.damage,
      (enemy) => gustImpulse(input.playerPosition, enemy.position, c.gust),
      land,
    )
    enemies = blow.enemies
    hitThisFrame = blow.connected
    deflectedThisFrame.push(...blow.deflected)
    reactionsThisFrame.push(...blow.reactions)
    // Spent whether or not anything was standing there, and whether or not the armour of
    // whoever was turned it away. A gust that costs nothing against a heavy would make
    // spamming it into plate free, which is the opposite of a knockback economy.
    gustCooldown = c.gust.cooldownSeconds
  }

  // Water Grip: pull, then hold. Same key as the gust, resolved here because water is selected.
  //
  // `canGrip(encounter, ...)` rather than the locally decremented `waterGripCooldown`, for the
  // reason the gust and the vortex both read their pre-step predicates: reading the decremented
  // copy would let a grip fire on the frame the cooldown expired, one frame before the action
  // guide would admit it could.
  if (input.gustPressed && input.element === 'water'
    && canGrip(encounter, input.breathAvailable, c.water)) {
    const caught = new Set(
      waterGripTargets(input.playerPosition, input.playerForward, enemies, c.water)
        .map((enemy) => enemy.id),
    )
    /**
     * Through the shared `reachAndLand` rather than a hand-rolled split, so a connect means a live
     * soldier was gripped rather than a body being dragged across the island, and so this move
     * gets the finisher rule on the same terms the six blows do.
     *
     * **The grip honours the verdict, and the reason is that it carries a real impulse.** The
     * pull is `waterGripImpulse` at `pullSpeed`, and the heavy's `grip` row scales exactly that —
     * `{ damage: 1, knockback: 0 }` in the shipped config, argued in `config.ts` as "plate resists
     * being dragged". A finisher is the one thing that drags it anyway, which is the same trade
     * the finisher gust makes against the same soldier's `gust` row.
     *
     * **With one caveat that the shipped config hides.** `Reach.landing` widens to everyone the
     * blow reached on a finisher, deflects included, so a `grip` row of `{ damage: 0, knockback:
     * 0 }` — a full deflect, which nothing ships today — would have a finisher land the *hold* the
     * armour refused outright. That is the thing ruled unacceptable for the freeze a hundred lines
     * down: overriding `deflects`' verdict on whether a move works at all is an edit to the armour
     * table, not a chain feature. Unobservable at `{ damage: 1, knockback: 0 }`, and the reason to
     * write it down anyway is that the row is meant to be a live lever.
     */
    const reach = reachAndLand(enemies, caught, 'grip', c, land)
    grippedThisFrame = reach.connected
    deflectedThisFrame.push(...reach.deflected)
    enemies = enemies.map((enemy) => {
      if (!reach.landing.has(enemy.id)) return enemy
      // Through `markAndReact` rather than marked by hand, so water's mark is written in the same
      // order every other source writes one: old mark read, blow applied, reaction resolved, new
      // mark written. A water verb can never fire a reaction — `REACTIONS[*].water` is 'none'
      // for all four — and it comes through here anyway, because the day the table gains a row
      // ending in water is not the day to remember this branch existed.
      const outcome = markAndReact(enemy, elementOf('grip'), c.reactions, (target) => {
        // Zero damage, like the Vortex: the move is control. `hitEnemy` still interrupts a
        // wind-up, and `holdEnemy` then keeps the soldier interrupted, which is the difference
        // between water and air on the same key.
        //
        // The impulse goes through armour, which is what makes the heavy's `grip` row mean
        // anything: at knockback 0 the water takes hold and the body does not move, so plate
        // resists being dragged while the hold still lands. Scaled rather than skipped, unlike a
        // deflect — a partially-resisted pull is a shorter drag, not a cancelled move. On a
        // finisher the pull goes around the row entirely, per the block comment above.
        //
        // Pull first, hold second, and the order is load-bearing: `holdEnemy` resets
        // `stanceTime` and would otherwise be overwritten by `hitEnemy`'s own reset to
        // 'recover'. It also means the pull's impulse is already on the body when the hold
        // starts, which is what makes the yank visible rather than instantaneous.
        const pull = waterGripImpulse(input.playerPosition, target.position, c.water)
        const armoured = throughArmour(0, pull, c.enemies[target.kind].armour.grip)
        const pulled = hitEnemy(target, armoured.damage, reach.finisher ? pull : armoured.impulse)
        return holdEnemy(pulled, c.water.gripHoldSeconds)
      })
      if (outcome.kind !== 'none') {
        reactionsThisFrame.push({ enemyId: enemy.id, kind: outcome.kind })
      }
      return outcome.enemy
    })
    waterGripCooldown = c.water.gripCooldownSeconds
    breathSpent += c.water.gripBreathCost
    gripFired = true
  }

  // Stone Throw: the light key with earth selected, and the only borrowed-element move in the
  // game that carries real damage. It goes through `resolveBlow` rather than a hand-rolled map
  // like the two water moves above, and that is not a stylistic choice: this move has a damage
  // figure and an impulse and needs `throughArmour` applied to both, which is exactly what that
  // function is for. Water's two need the hold applied as well, which is why they are the
  // exception rather than this.
  //
  // `canStone(encounter, ...)` rather than the locally decremented `stoneThrowCooldown`, for the
  // reason every other move here reads its pre-step predicate: reading the decremented copy would
  // let a stone fire on the frame the cooldown expired, one frame before the action guide would
  // admit it could.
  if (input.gustPressed && input.element === 'earth'
    && canStone(encounter, input.breathAvailable, c.earth)) {
    const caught = new Set(
      stoneThrowTargets(input.playerPosition, input.playerForward, enemies, c.earth)
        .map((enemy) => enemy.id),
    )
    const blow = resolveBlow(
      enemies, caught, 'stone', c,
      () => c.earth.stoneDamage,
      (enemy) => stoneImpulse(input.playerPosition, enemy.position, c.earth),
      land,
    )
    enemies = blow.enemies
    stoneHitThisFrame = blow.connected
    deflectedThisFrame.push(...blow.deflected)
    reactionsThisFrame.push(...blow.reactions)
    // Spent whether or not anything was standing there, and whether or not armour turned it
    // away — the same rule the gust's cooldown follows. A stone that cost nothing on a miss
    // would make the slowest move in the game free to fish with, which is the opposite of
    // "slow, committed".
    stoneThrowCooldown = c.earth.stoneCooldownSeconds
    breathSpent += c.earth.stoneBreathCost
    stoneFired = true
  }

  /**
   * Fire Burst: the same key again, resolved here because fire is selected.
   *
   * Straight through `resolveBlow`, unlike the two water moves, and that is the whole point of
   * fire being the damage element: it is an ordinary blow with a damage figure and an impulse, so
   * it wants the shared resolver that already applies `isTargetable`, consults the armour table and
   * splits connects from deflects. Water needed its own arithmetic only because a hold is not a blow.
   *
   * `canBurst(encounter, ...)` rather than the locally decremented `fireBurstCooldown`, for the
   * reason the gust, the grip and the vortex all read their pre-step predicates: reading the
   * decremented copy would let a burst fire on the frame the cooldown expired, one frame before the
   * action guide would admit it could.
   */
  if (input.gustPressed && input.element === 'fire'
    && canBurst(encounter, input.fireCharges, c.fire)) {
    const caught = new Set(
      fireBurstTargets(input.playerPosition, input.playerForward, enemies, c.fire)
        .map((enemy) => enemy.id),
    )
    const blow = resolveBlow(
      enemies, caught, 'burst', c,
      () => c.fire.burstDamage,
      (enemy) => fireBurstImpulse(input.playerPosition, enemy.position, c.fire),
      land,
    )
    enemies = blow.enemies
    burstHitThisFrame = blow.connected
    deflectedThisFrame.push(...blow.deflected)
    reactionsThisFrame.push(...blow.reactions)
    // Spent whether or not anything was standing there, and whether or not the armour of whoever
    // was turned it away — the rule the gust's cooldown already follows, and it matters more here
    // because the charge is a scarce resource: a burst thrown at empty sky has to cost one, or the
    // three charges would be three *connects* rather than three presses, and aiming would stop
    // being part of the move.
    fireBurstCooldown = c.fire.burstCooldownSeconds
    chargesSpent += 1
    burstFired = true
  }

  let vortexCooldown = Math.max(0, encounter.vortexCooldown - dt)
  let vortexHeldSeconds = encounter.vortexHeldSeconds
  let vortexFired: number | null = null

  // Gated on `canVortex(encounter)`, the same predicate the action guide asks, rather than
  // on the locally decremented copy above — reading the copy let charge start on the frame
  // the cooldown expired, one frame before the guide would admit it could. The gust does
  // the same thing with `canGust(encounter)`.
  //
  // Gated on air as well, so holding the heavy key with water selected banks no charge. Without
  // that a player could charge under water, switch to air and release into a full-strength
  // vortex they never held air for.
  if (input.vortexHeld && input.element === 'air' && canVortex(encounter)) {
    vortexHeldSeconds = Math.min(
      vortexHeldSeconds + dt, c.vortex.maxChargeSeconds,
    )
  } else if (!input.vortexReleased) {
    // Neither held nor released: R went away without a key-up edge, which is what
    // a window blur produces — InputTracker's blur handler clears the held-key set
    // but never fires keyup, so vortexReleased stays false. Left alone the charge
    // would freeze rather than clear, so a later tap would resume on top of a
    // stale total and fire a bigger vortex than that tap earned. The `else` keeps
    // this from firing on the frame a real release comes through, where
    // vortexHeld is already false but vortexReleased is true.
    vortexHeldSeconds = 0
  }

  /**
   * The heavy key's release, on the air branch.
   *
   * **Gated on the element, and it took a test to establish that it has to be.** The first version
   * of this dispatch left the release ungated, on the argument that a charge cannot survive into
   * water because the `else` branch above zeroes it every frame water is selected. That argument
   * is wrong by exactly one frame: the `else` is guarded on `!input.vortexReleased`, so on a frame
   * where the player switches to water *and* releases R, the charge built under air is still
   * standing when this block runs. A player who charged a vortex, pressed 2 and let go on the same
   * frame therefore got a full-strength vortex *and* an Ice Lock, and paid Focus for the freeze —
   * two heavy moves for one press.
   *
   * `vortexHeldSeconds` is still cleared unconditionally below, whichever element is selected, so
   * a release under water discards the charge rather than parking it for later.
   */
  if (input.vortexReleased) {
    if (input.element === 'air' && vortexHeldSeconds >= c.vortex.minChargeSeconds) {
      const charge = vortexCharge(vortexHeldSeconds, c.vortex)
      const caught = new Set(
        vortexTargets(input.playerPosition, enemies, charge, c.vortex).map((e) => e.id),
      )
      const blow = resolveBlow(
        enemies, caught, 'vortex', c,
        // Zero damage: the move is setup. hitEnemy still interrupts, which is
        // what a control move should do to a wind-up.
        () => 0,
        (enemy) => vortexImpulse(input.playerPosition, enemy.position, charge, c.vortex),
        land,
      )
      enemies = blow.enemies
      // Deliberately not reported as a connect: a vortex has never paid Focus, because
      // `hitThisFrame` feeds the gust's grant and the move carries no damage. Its deflects
      // are reported, though — nothing in the game deflects a vortex today, but if a future
      // armour does, the player must hear it rather than watch a charge do nothing.
      deflectedThisFrame.push(...blow.deflected)
      reactionsThisFrame.push(...blow.reactions)
      vortexFired = charge
      vortexCooldown = c.vortex.cooldownSeconds
    }
    // Either way the charge is spent. A release below the minimum costs nothing,
    // so a mistaken tap is not punished with a 3.5 second cooldown.
    vortexHeldSeconds = 0
  }

  // Ice Lock: the heavy key with water selected. The same press-and-release gesture the Vortex
  // uses, and deliberately not a charge — the freeze has one duration, and a charge would be a
  // second price on a move that is already priced in Focus. It fires on the release rather than
  // the press so that one gesture drives both elements' heavy verbs, which is what lets the two
  // keys mean four moves without a fifth binding.
  if (input.vortexReleased && input.element === 'water') {
    if (canIceLock(input.focusAvailable, input.breathAvailable, c.water)) {
      const caught = new Set(
        iceLockTargets(input.playerPosition, input.playerForward, enemies, c.water)
          .map((enemy) => enemy.id),
      )
      // `throughArmour` has nothing to scale here — the freeze carries no damage and no
      // impulse — so armour can only speak about this move in the one way `deflects` reports:
      // all of it, or none of it. Nothing in the shipped config turns a freeze away (the
      // heavy's `freeze` row is 1 and 1, argued in `config.ts`), so this branch never fires
      // today. It exists so that row is a live lever rather than a comment: blocking the
      // freeze against a kind is now a config edit with working code behind it.
      const frozen = (enemy: Enemy) =>
        caught.has(enemy.id) && isTargetable(enemy) && !deflects(c.enemies[enemy.kind], 'freeze')
      frozenThisFrame = enemies.filter(frozen).map((enemy) => enemy.id)
      deflectedThisFrame.push(...enemies
        .filter((enemy) => caught.has(enemy.id) && isTargetable(enemy)
          && deflects(c.enemies[enemy.kind], 'freeze'))
        .map((enemy) => enemy.id))
      /**
       * A freeze that took is a landing, so it builds the string too — and it is the one source
       * that can never cash the string in.
       *
       * **Because it carries no impulse at all.** It applies no damage and no knockback, so there
       * is nothing for a finisher to take around the armour: the only thing honouring the verdict
       * could do here is land a hold the armour turned away outright, which is not unarmouring an
       * impulse but overriding `deflects`' verdict on whether the move works — an edit to the
       * armour table wearing a chain feature's clothes. The grip is the counter-example three
       * blocks up: it carries a real pull, so it honours the verdict.
       *
       * `advanceChain` rather than `land`, so the frame reports no finisher: a freeze that
       * completed a string behaved like any other freeze, and `finisherThisFrame` is what a later
       * step will draw a flourish from. The string is still spent by the completing landing, which
       * is the cost of leading with ice — an order the player chooses.
       */
      advanceChain(frozenThisFrame.length)
      // No `hitEnemy` at all, unlike the grip: the freeze applies no impulse and no damage, so
      // there is nothing for it to deliver. `holdEnemy` does the interrupting on its own.
      // Passing a zero impulse through `hitEnemy` would work and would be worse — it would put
      // the soldier into 'recover' for one frame before the hold took over, and it would reset
      // `sinceHit`, which is the regeneration clock and has nothing to do with being frozen.
      //
      // It still marks, and marks *wet*: `reactions.ts` argues that a reaction firing for the
      // grip but not the freeze would be a distinction no player could see, and this is the line
      // that claim rests on.
      enemies = enemies.map((enemy) => {
        if (!frozen(enemy)) return enemy
        const outcome = markAndReact(
          enemy, elementOf('freeze'), c.reactions,
          (target) => holdEnemy(target, c.water.freezeHoldSeconds),
        )
        if (outcome.kind !== 'none') {
          reactionsThisFrame.push({ enemyId: enemy.id, kind: outcome.kind })
        }
        return outcome.enemy
      })
      focusSpent += c.water.freezeFocusCost
      breathSpent += c.water.freezeBreathCost
      freezeFired = true
    }
    // A refused freeze costs nothing at all — no Focus, no breath, no cooldown. The same shape
    // `stepSlipstream` gives a dodge that cannot be paid for, and the same shape a
    // below-minimum vortex release gets: a press the game declines must not be a press the
    // player is charged for.
  }

  /**
   * Stone Pillar: the heavy key with earth selected.
   *
   * The same press-and-release gesture the Vortex and the Ice Lock use, and deliberately not a
   * charge: a pillar has one size, and a charge would be a second price on a move already priced
   * in Focus. Firing on the release rather than the press is what lets one gesture drive three
   * elements' heavy verbs without a fourth binding.
   *
   * **Two gates, asked in this order, and the order is the reason a refusal is honest.** Whether
   * the player can pay comes first, then whether there is ground to raise from. Both refuse for
   * free, so the order cannot cost the player anything — but asking about the ground first would
   * mean a player with an empty Focus bar and no ground ahead of them was refused for the wrong
   * reason, and the action guide's row is dimmed on the payment gate alone (see `canRaisePillar`),
   * so the fight and the panel agree about the gate that has a widget behind it.
   */
  if (input.vortexReleased && input.element === 'earth') {
    if (canRaisePillar(input.focusAvailable, input.breathAvailable, c.earth)) {
      const site = pillarSite(
        input.playerPosition, input.playerForward, deps.ground, c.earth,
      )
      if (site) {
        const raised = spawnPillar(`pillar-${nextPillarId++}`, site, c.earth)
        pillars = addPillar(pillars, raised, c.earth)
        pillarRaised = raised

        // Anyone standing where the rock arrives is shoved off it. Zero damage, like the Vortex
        // and the grip: this is displacement and an interruption, not a blow. `hitEnemy` is what
        // applies both, and the wind-up it cancels is section 4.2's "drop a pillar under them"
        // arriving as a mechanic rather than as a sentence.
        //
        // The impulse goes through armour, which is what makes the heavy's `pillar` row mean
        // something: plate is shoved less far by ground coming up under it, and is not immune to
        // it the way it is to a gust. Scaled rather than skipped, unlike a deflect — a resisted
        // shove is a shorter stumble, not a cancelled move.
        /**
         * Through the shared `reachAndLand`, so the two lists are disjoint by construction and
         * this move gets the finisher rule on the same terms the six blows do. The `caught` set is
         * built from `pillarShoveTargets` rather than a cone, because the shove's origin is the
         * pillar rather than the player; `reachAndLand` applies `isTargetable` itself.
         *
         * **The shove honours the verdict, and the reason is that it carries a real impulse.**
         * `pillarShoveImpulse` at `raiseShoveSpeed` and `raiseLiftSpeed` is what the heavy's
         * `pillar` row scales, so a finisher taking it around that row is the same trade the
         * finisher gust and the finisher grip make.
         */
        const underfoot = new Set(pillarShoveTargets(raised, enemies).map((enemy) => enemy.id))
        const reach = reachAndLand(enemies, underfoot, 'pillar', c, land)
        deflectedThisFrame.push(...reach.deflected)
        // `landing` rather than `connected`, because a finisher shoves soldiers the armour turned
        // away and those are on `deflected` instead — gating on the connect list would skip the
        // map on exactly the frame the finisher exists for.
        if (reach.landing.size > 0) {
          enemies = enemies.map((enemy) => {
            if (!reach.landing.has(enemy.id)) return enemy
            // Marks *earth*, which is what lets rock arriving under a wet soldier's feet mud it —
            // the same pairing the Stone Throw fires, because the mark is written in the
            // element's name rather than the move's.
            const outcome = markAndReact(enemy, elementOf('pillar'), c.reactions, (target) => {
              const shove = pillarShoveImpulse(raised, target.position, c.earth)
              const armoured = throughArmour(
                0, shove, c.enemies[target.kind].armour.pillar,
              )
              return hitEnemy(
                target, armoured.damage, reach.finisher ? shove : armoured.impulse,
              )
            })
            if (outcome.kind !== 'none') {
              reactionsThisFrame.push({ enemyId: enemy.id, kind: outcome.kind })
            }
            return outcome.enemy
          })
        }

        focusSpent += c.earth.raiseFocusCost
        breathSpent += c.earth.raiseBreathCost
      }
      // No ground to raise from: refused, and it costs nothing. `pillarSite` owns both reasons
      // that can happen — the void between islands, and ground too far below a player in the air
      // — and neither is worth charging for, because both are conditions the player can see and
      // fix by standing somewhere else.
    }
    // A refused raise costs nothing at all: no Focus, no breath, no pillar. The same shape the
    // Ice Lock's refusal has.
  }
  // **There is deliberately no fire branch on the heavy key.** Fire's heavy verb is the Fire
  // Thrust, which adds velocity to the glider and does nothing to anyone in this fight, so it is
  // resolved by the caller — see `EncounterInput.element` for the whole argument and
  // `canFireThrust` in `src/combat/fire.ts` for the rule. What this function still does for a
  // release under fire is the one thing it must: `vortexHeldSeconds` is cleared unconditionally
  // below, so a charge built under air is discarded rather than parked, exactly as it is for water.
  // Nothing here can fire a vortex under fire either, because that branch is gated on air.

  let staffHitThisFrame: string[] = []

  if (input.staffSwing) {
    const { finisher } = input.staffSwing
    const caught = new Set(
      staffTargets(input.playerPosition, input.playerForward, finisher, enemies, c.staffArc)
        .map((enemy) => enemy.id),
    )
    const damage = staffDamage(finisher, c.staffArc)
    const blow = resolveBlow(
      enemies, caught, 'staff', c,
      () => damage,
      (enemy) => staffImpulse(input.playerPosition, enemy.position, finisher, c.staffArc),
      land,
    )
    enemies = blow.enemies
    staffHitThisFrame = blow.connected
    deflectedThisFrame.push(...blow.deflected)
    reactionsThisFrame.push(...blow.reactions)
  }

  let slamHitThisFrame: string[] = []

  if (input.slam) {
    const { strength } = input.slam
    const caught = new Set(
      waveTargets(input.playerPosition, enemies, strength, c.pressureWave)
        .map((enemy) => enemy.id),
    )
    const damage = waveDamage(strength, c.pressureWave)
    const blow = resolveBlow(
      enemies, caught, 'wave', c,
      () => damage,
      (enemy) => waveImpulse(input.playerPosition, enemy.position, strength, c.pressureWave),
      land,
    )
    enemies = blow.enemies
    slamHitThisFrame = blow.connected
    deflectedThisFrame.push(...blow.deflected)
    reactionsThisFrame.push(...blow.reactions)
  }

  // The barrier, resolved before the arrows it is meant to meet. `input.playerBreath` rather
  // than anything on `Encounter`: breath is the player's meter and the fight only reads it.
  const wall = stepAirWall(
    encounter.airWall, input.airWallHeld, input.playerBreath, dt, c.airWall,
  )
  const airWall = wall.state
  const wallUp = isAirWallUp(airWall)

  // Stepped before the enemy loop spawns this frame's shots, so a new arrow does not
  // advance on the frame it is fired and appear already metres from the bow. The
  // ordering comment at the top of this function applies here too: this order is
  // load-bearing, not incidental.
  let projectiles: Projectile[] = []
  let projectileDamage = 0
  const redirectedThisFrame: string[] = []
  const redirectHitsThisFrame: string[] = []
  /**
   * The longest refusal any net landed this frame, not their sum.
   *
   * Two nets arriving together should not stack into four seconds on the ground. The player
   * side takes the larger of this and whatever is already owed (`applyTangle`), so a volley
   * costs exactly one refusal and the extra nets are wasted — which is the right answer for a
   * mechanic whose cost is measured in seconds of being unable to fly.
   */
  let tangleIncoming = 0
  // Reported here, before `avoided` below can zero any of it. An arrow's `from` is
  // `arrow.position` -- the position it entered this step at, not the archer's -- because
  // by the time an arrow connects the archer that loosed it may have moved on, and the
  // player needs to know where the shot came from, not where the bow was. Already in hand
  // from the loop variable, so this is reporting what stepProjectile already knows rather
  // than computing anything new.
  const playerHitsThisFrame: PlayerHit[] = []
  const blockedThisFrame: PillarBlock[] = []
  for (const arrow of encounter.projectiles) {
    // Offered to the barrier before it advances -- see the ordering comment above. `turned` is
    // null on almost every frame, including every frame with no wall up, so the common path is
    // the same one arrow of code it always was.
    const turned = wallUp
      ? deflect(arrow, input.playerPosition, input.playerAim, c.airWall)
      : null
    if (turned) redirectedThisFrame.push(turned.id)
    const flying = turned ?? arrow

    // `pillars`, the array already aged at the top of this function, so a pillar that expired
    // this frame no longer stops anything — and one raised this frame does, because the raise
    // resolves above. That is the same "a barrier raised this frame catches an arrow already
    // inside it" property the Air Wall's placement buys, and it matters more here: the player
    // raising a pillar is reacting to a shot they can already see in the air.
    const step = stepProjectile(
      flying, input.playerPosition, enemies, pillars, deps.ground, dt, c.projectile,
    )
    projectileDamage += step.damageToPlayer
    tangleIncoming = Math.max(tangleIncoming, step.tangleSeconds)
    if (step.blockedByPillarId !== null) {
      // `flying.position`, the position the shot entered this step at, for the reason an arrow's
      // `from` above is read the same way: it is the last place the shot certainly was, and the
      // dust belongs on the face it struck rather than at the far side of a step that ended.
      blockedThisFrame.push({ pillarId: step.blockedByPillarId, at: flying.position.clone() })
    }
    if (step.damageToPlayer > 0) {
      playerHitsThisFrame.push({ from: arrow.position.clone(), damage: step.damageToPlayer })
    }
    if (step.hitEnemyId !== null) {
      redirectHitsThisFrame.push(step.hitEnemyId)
      const hit = step.hitEnemyId
      enemies = enemies.map((enemy) => (enemy.id === hit
        // A zero impulse, so no new tuning number is invented: an arrow is a thin shaft, and
        // the gust's 26 knockback is the weight of a mass of moving air. The stagger comes
        // free -- `hitEnemy` cancels a wind-up whatever the impulse, which is the same reason
        // the Vortex can pass zero damage and still interrupt.
        ? hitEnemy(enemy, flying.damage, new Vector3())
        : enemy))
    }
    if (step.projectile) projectiles.push(step.projectile)
  }

  let damageToPlayer = 0
  const lostThisFrame: string[] = []
  const firedThisFrame: string[] = []
  let nextProjectileId = encounter.nextProjectileId
  enemies = enemies.map((enemy) => {
    const config = c.enemies[enemy.kind]
    const step = stepEnemy(
      enemy, input.playerPosition, deps.ground, deps.worldFloorY, dt, config,
    )
    damageToPlayer += step.damageToPlayer
    // Same reporting rule as the arrow above, and for the same reason: recorded before
    // `avoided` can zero it, from the soldier's own position -- already returned in
    // step.enemy, so nothing new is computed here either.
    if (step.damageToPlayer > 0) {
      playerHitsThisFrame.push({ from: step.enemy.position.clone(), damage: step.damageToPlayer })
    }
    if (step.fellOutOfWorld) lostThisFrame.push(step.enemy.id)
    if (step.firedProjectile && config.attack.kind === 'projectile') {
      const id = `arrow-${nextProjectileId++}`
      projectiles.push(spawnProjectile(
        id,
        step.firedProjectile.origin,
        step.firedProjectile.direction,
        config.attack.damage,
        config.attack.speed,
        config.attack.tangleSeconds,
      ))
      firedThisFrame.push(id)
    }
    return step.enemy
  })

  // Into the same total the spears feed, which is what makes a Slipstream dodge an arrow
  // and `damageAvoided` grant Focus for it without a line of new code.
  damageToPlayer += projectileDamage

  // Avoided only counts when something was actually coming.
  const avoided = input.playerInvulnerable && damageToPlayer > 0
  const applied = avoided ? 0 : damageToPlayer

  /**
   * The refusal that actually lands, after a Slipstream has had its say.
   *
   * Gated on `input.playerInvulnerable` directly rather than on `avoided`, and the difference
   * is not cosmetic. `avoided` requires `damageToPlayer > 0`, so a net tuned to zero damage
   * would slip straight through a dodge — a coupling between the netter's damage figure and
   * whether its net is dodgeable, sitting in a different file from either. Read this way the
   * two are independent: an invulnerable player is not netted, whatever the net does.
   *
   * `damageAvoided` below keeps its own rule, because that flag pays Focus and is documented
   * as being about damage. Dodging a net still pays through its 0.5 damage.
   */
  const tangleSeconds = input.playerInvulnerable ? 0 : tangleIncoming

  const hurt = applied > 0 ? applyDamage(encounter.playerHealth, applied) : encounter.playerHealth
  const playerHealth = stepHealth(hurt, dt, c.player)

  // Subtracted, not merely reported alongside. `downedThisFrame` is a diff of the
  // downed set across the step, so an enemy that left the world appears in both -- and
  // Focus would pay downGain and accidentDownGain for the same soldier. The codebase
  // has met this overlap once already: `main.ts` drops a connect for an enemy that
  // also went down this frame. Same shape, same fix.
  const lost = new Set(lostThisFrame)
  const downedThisFrame = enemies
    .filter((enemy) => isDowned(enemy.health) && !wasDowned.has(enemy.id) && !lost.has(enemy.id))
    .map((enemy) => enemy.id)

  // Only the first crossing pays Focus, so a soldier cannot be walked up and down the
  // recovery ladder as a Focus engine. Kept apart from `downedThisFrame` rather than
  // replacing it, because every down is still worth its impact burst — the same split
  // hitThisFrame, slamHitThisFrame and staffHitThisFrame already make, for the same
  // reason: each feeds a differently tuned grant.
  const downedIds = new Set(downedThisFrame)
  const firstDownsThisFrame = enemies
    .filter((enemy) => downedIds.has(enemy.id) && enemy.downs === 1)
    .map((enemy) => enemy.id)

  // Last, deliberately. `wasDowned` is diffed at the top of this function, so
  // replacing the enemy array any earlier would compare a fresh soldier against a
  // downed one and report a phantom down or hit. Restoring here means the next frame
  // starts from a healthy patrol and an empty wasDowned, which reports nothing.
  // Held onto before the restore can overwrite `enemies`, because every event list this
  // function reports was computed against this array and nothing downstream can
  // reconstruct it afterwards.
  const enemiesBeforeRestore = enemies

  let restoredThisFrame: string[] = []
  if (shouldRestorePatrol(enemies, deps.spawns, input.playerPosition, deps.patrol)) {
    enemies = deps.spawns.map((spawn) => spawnEnemy(
      spawn.id, spawn.position, spawn.kind, c.enemies[spawn.kind],
    ))
    restoredThisFrame = enemies.map((enemy) => enemy.id)
    // The arrows belonged to a fight that is over. Left alone, one loosed before the
    // reset could strike a player who has walked back to a fresh patrol.
    //
    // This runs after the enemy loop that pushes this frame's new arrows, and discarding
    // them wholesale is safe only because no restore frame can have spawned one: a restore
    // requires every enemy downed, and stepEnemy returns firedProjectile: null on every
    // downed branch. If the restore rule is ever loosened to fire with a soldier still
    // standing, this line silently throws away a live shot and has to move above the loop.
    projectiles = []
    // **The pillars are deliberately not cleared here, unlike the arrows beside them.** An arrow
    // belongs to a fight and a raised pillar belongs to the player, which is the thematic half of
    // the argument; the half that actually decided it is that nothing may shorten a pillar's life
    // but its own clock, because the view layer cannot be told an object died early — see
    // `Pillar.secondsLeft`. Nothing survives the trip in any case: a restore needs the player
    // beyond `respawnRange` 52 and no ground speed in the game covers that inside
    // `pillarSeconds`, so this is a guard rather than a rule anyone will see working.
  }

  return {
    encounter: {
      enemies, projectiles, nextProjectileId, playerHealth, gustCooldown, vortexHeldSeconds,
      vortexCooldown, airWall, waterGripCooldown, stoneThrowCooldown, pillars, nextPillarId,
      fireBurstCooldown, chain,
    },
    downedThisFrame,
    firstDownsThisFrame,
    lostThisFrame,
    restoredThisFrame,
    enemiesBeforeRestore,
    hitThisFrame,
    slamHitThisFrame,
    staffHitThisFrame,
    deflectedThisFrame,
    playerHit: applied > 0,
    damageAvoided: avoided,
    vortexFired,
    grippedThisFrame,
    frozenThisFrame,
    burstHitThisFrame,
    gripFired,
    freezeFired,
    stoneHitThisFrame,
    stoneFired,
    pillarRaised,
    blockedThisFrame,
    burstFired,
    focusSpent,
    breathSpent,
    chargesSpent,
    firedThisFrame,
    redirectedThisFrame,
    redirectHitsThisFrame,
    airWallBreathSpent: wall.breathSpent,
    tangleSeconds,
    playerHitsThisFrame,
    reactionsThisFrame,
    finisherThisFrame,
  }
}
