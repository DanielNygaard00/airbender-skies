import { Vector3 } from 'three'
import {
  applyDamage, fullHealth, isDowned, stepHealth, type Health, type HealthConfig,
} from './health'
import {
  deflects, hitEnemy, holdEnemy, isTargetable, spawnEnemy, stepEnemy, throughArmour,
  type BendingSource, type Enemy, type EnemyConfig, type EnemyKind, type GroundHeightQuery,
} from './enemy'
import {
  canIceLock, canWaterGrip, iceLockTargets, waterGripImpulse, waterGripTargets,
  type WaterConfig,
} from './water'
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
   * Its own field rather than one shared "light verb cooldown", because the two moves on that
   * key have deliberately different cooldowns — 0.45 for a gust, 1.1 for a grip — and a shared
   * timer would let switching element launder one move's cooldown into the other's. Earth and
   * fire add their own for the same reason.
   */
  waterGripCooldown: number
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
   * gives Gust and Vortex, water gives Water Grip and Ice Lock. So this field is what makes the
   * two keys mean four moves, and it is the single place a new element plugs into the fight.
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
}

/** One hit aimed at the player this frame, and where it came from. */
export interface PlayerHit {
  from: Vector3
  damage: number
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
   */
  deflected: string[]
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
 * Reads `enemies` before it writes, so "connected" means a live soldier took the blow
 * rather than a body being shoved around the island — the property the gust resolver's
 * original comment insisted on, now true for all four by construction.
 */
function resolveBlow(
  enemies: readonly Enemy[],
  caught: ReadonlySet<string>,
  source: BendingSource,
  c: CombatConfig,
  damage: (enemy: Enemy) => number,
  impulse: (enemy: Enemy) => Vector3,
): Blow {
  const connected: string[] = []
  const deflected: string[] = []
  for (const enemy of enemies) {
    if (!caught.has(enemy.id) || !isTargetable(enemy)) continue
    if (deflects(c.enemies[enemy.kind], source)) deflected.push(enemy.id)
    else connected.push(enemy.id)
  }
  const turnedAway = new Set(deflected)
  return {
    connected,
    deflected,
    enemies: enemies.map((enemy) => {
      if (!caught.has(enemy.id) || !isTargetable(enemy)) return enemy
      // A deflected blow is not merely reduced to nothing, it is skipped: `hitEnemy` also
      // interrupts a wind-up and resets the stance, and armour that stopped the blow has no
      // business also cancelling the swing it was in the middle of.
      if (turnedAway.has(enemy.id)) return enemy
      const armoured = throughArmour(
        damage(enemy), impulse(enemy), c.enemies[enemy.kind].armour[source],
      )
      return hitEnemy(enemy, armoured.damage, armoured.impulse)
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
  let gripFired = false
  let freezeFired = false
  let focusSpent = 0
  let breathSpent = 0

  // The light bending key, dispatched on the active element. Air gusts; water grips. Both
  // cooldowns tick every frame regardless of which element is selected, above — switching away
  // must not park a cooldown, or a player could hide a gust's recovery inside water and come
  // back to a gust that never recovered.
  if (input.gustPressed && input.element === 'air' && canGust(encounter)) {
    const caught = new Set(
      gustTargets(input.playerPosition, input.playerForward, enemies, c.gust)
        .map((enemy) => enemy.id),
    )
    const blow = resolveBlow(
      enemies, caught, 'gust', c,
      () => c.gust.damage,
      (enemy) => gustImpulse(input.playerPosition, enemy.position, c.gust),
    )
    enemies = blow.enemies
    hitThisFrame = blow.connected
    deflectedThisFrame.push(...blow.deflected)
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
    // Read before the pull lands, so a connect means a live soldier was gripped rather than a
    // body being dragged across the island — the same rule the other four resolvers apply.
    // A soldier whose armour turns the grip away entirely is not a connect: it goes to the
    // deflect list instead, the same split `resolveBlow` makes for the four air moves.
    const gripHeld = (enemy: Enemy) =>
      caught.has(enemy.id) && isTargetable(enemy) && !deflects(c.enemies[enemy.kind], 'grip')
    grippedThisFrame = enemies.filter(gripHeld).map((enemy) => enemy.id)
    deflectedThisFrame.push(...enemies
      .filter((enemy) => caught.has(enemy.id) && isTargetable(enemy)
        && deflects(c.enemies[enemy.kind], 'grip'))
      .map((enemy) => enemy.id))
    enemies = enemies.map((enemy) => {
      if (!gripHeld(enemy)) return enemy
      // Zero damage, like the Vortex: the move is control. `hitEnemy` still interrupts a
      // wind-up, and `holdEnemy` then keeps the soldier interrupted, which is the difference
      // between water and air on the same key.
      //
      // The impulse goes through armour, which is what makes the heavy's `grip` row mean
      // anything: at knockback 0 the water takes hold and the body does not move, so plate
      // resists being dragged while the hold still lands. Scaled rather than skipped, unlike a
      // deflect — a partially-resisted pull is a shorter drag, not a cancelled move.
      //
      // Pull first, hold second, and the order is load-bearing: `holdEnemy` resets
      // `stanceTime` and would otherwise be overwritten by `hitEnemy`'s own reset to
      // 'recover'. It also means the pull's impulse is already on the body when the hold
      // starts, which is what makes the yank visible rather than instantaneous.
      const armoured = throughArmour(
        0, waterGripImpulse(input.playerPosition, enemy.position, c.water),
        c.enemies[enemy.kind].armour.grip,
      )
      const pulled = hitEnemy(enemy, armoured.damage, armoured.impulse)
      return holdEnemy(pulled, c.water.gripHoldSeconds)
    })
    waterGripCooldown = c.water.gripCooldownSeconds
    breathSpent += c.water.gripBreathCost
    gripFired = true
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
      )
      enemies = blow.enemies
      // Deliberately not reported as a connect: a vortex has never paid Focus, because
      // `hitThisFrame` feeds the gust's grant and the move carries no damage. Its deflects
      // are reported, though — nothing in the game deflects a vortex today, but if a future
      // armour does, the player must hear it rather than watch a charge do nothing.
      deflectedThisFrame.push(...blow.deflected)
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
      // No `hitEnemy` at all, unlike the grip: the freeze applies no impulse and no damage, so
      // there is nothing for it to deliver. `holdEnemy` does the interrupting on its own.
      // Passing a zero impulse through `hitEnemy` would work and would be worse — it would put
      // the soldier into 'recover' for one frame before the hold took over, and it would reset
      // `sinceHit`, which is the regeneration clock and has nothing to do with being frozen.
      enemies = enemies.map((enemy) =>
        frozen(enemy) ? holdEnemy(enemy, c.water.freezeHoldSeconds) : enemy)
      focusSpent += c.water.freezeFocusCost
      breathSpent += c.water.freezeBreathCost
      freezeFired = true
    }
    // A refused freeze costs nothing at all — no Focus, no breath, no cooldown. The same shape
    // `stepSlipstream` gives a dodge that cannot be paid for, and the same shape a
    // below-minimum vortex release gets: a press the game declines must not be a press the
    // player is charged for.
  }

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
    )
    enemies = blow.enemies
    staffHitThisFrame = blow.connected
    deflectedThisFrame.push(...blow.deflected)
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
    )
    enemies = blow.enemies
    slamHitThisFrame = blow.connected
    deflectedThisFrame.push(...blow.deflected)
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
  for (const arrow of encounter.projectiles) {
    // Offered to the barrier before it advances -- see the ordering comment above. `turned` is
    // null on almost every frame, including every frame with no wall up, so the common path is
    // the same one arrow of code it always was.
    const turned = wallUp
      ? deflect(arrow, input.playerPosition, input.playerAim, c.airWall)
      : null
    if (turned) redirectedThisFrame.push(turned.id)
    const flying = turned ?? arrow

    const step = stepProjectile(
      flying, input.playerPosition, enemies, deps.ground, dt, c.projectile,
    )
    projectileDamage += step.damageToPlayer
    tangleIncoming = Math.max(tangleIncoming, step.tangleSeconds)
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
  }

  return {
    encounter: {
      enemies, projectiles, nextProjectileId, playerHealth, gustCooldown, vortexHeldSeconds,
      vortexCooldown, airWall, waterGripCooldown,
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
    gripFired,
    freezeFired,
    focusSpent,
    breathSpent,
    firedThisFrame,
    redirectedThisFrame,
    redirectHitsThisFrame,
    airWallBreathSpent: wall.breathSpent,
    tangleSeconds,
    playerHitsThisFrame,
  }
}
