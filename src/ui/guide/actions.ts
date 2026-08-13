import type { FlightConfig, GroundConfig, PlayerState } from '../../core/types'
import type { PressureWaveConfig } from '../../combat/pressure-wave'
import { canDash } from '../../player/dash'
import { canAirJump } from '../../player/jump'
import { canBend } from '../../player/breath'
import { staffBusy, staffOf } from '../../player/staff'
import { isElementAvailable, type Element } from '../../elements/element'

/**
 * Every action the player can perform, and whether they can perform it now.
 *
 * The availability predicates call the game's own exported predicates rather than
 * restating their rules. That is the whole point of this module: a guide that
 * reimplements the rules drifts, and a guide that lies to a tester is worse than no
 * guide at all. Where a rule has no importable predicate, the comment names where the
 * original lives so the two can be checked against each other by hand.
 */
export type ActionMode = 'ground' | 'glider' | 'both'

export interface ActionContext {
  player: PlayerState
  /** `canDash` and `canAirJump` both need it. */
  ground: GroundConfig
  /** `canBend` needs it, for `hasBreath` below. */
  flight: FlightConfig
  /** For the Pressure Wave's fall-speed threshold. */
  wave: PressureWaveConfig
  /**
   * A gust is off cooldown, and the Avatar State is armed and not already running.
   *
   * Passed in rather than computed here: both live on other systems' structs — an
   * Encounter and an AvatarState — which have no business in a UI module. The caller
   * asks `canGust` and `isArmed`, so no rule is restated either way.
   */
  gustReady: boolean
  avatarStateReady: boolean
  /** A vortex is off cooldown. The caller asks `canVortex`. */
  vortexReady: boolean
  /** A slipstream is off cooldown and not already running. The caller asks `canSlipstream`. */
  slipstreamReady: boolean
  /**
   * An Air Wall can be raised: off cooldown, not already up, and paid for. The caller asks
   * `canAirWall`, which is the same predicate `stepAirWall` gates the raise on.
   */
  airWallReady: boolean
   /**
   * Which element is selected.
   *
   * F and R resolve to a different move per element, so four of the six rows on those two keys are
   * struck through whenever a different element is selected. That is a *binding* fact — which key
   * does what — rather than a game rule this module would be restating, and the catalogue is
   * exactly where binding facts live. It also makes the panel answer the question a player opening
   * it mid-fight actually has, which is what their two bending keys do right now.
   */
  element: Element
  /** A Water Grip is off cooldown and affordable. The caller asks `canGrip`. */
  gripReady: boolean
  /** An Ice Lock is affordable in both Focus and breath. The caller asks `canIceLock`. */
  iceLockReady: boolean
  /** A Stone Throw is off cooldown and affordable. The caller asks `canStone`. */
  stoneReady: boolean
  /**
   * A Stone Pillar is affordable in both Focus and breath. The caller asks `canRaisePillar`.
   *
   * Affordability only, and deliberately not whether there is ground to raise one from — the fight
   * asks that separately, through `pillarSite`. A row that also tracked the terrain would flicker
   * as the player looked around, because the ground six metres ahead comes and goes, and a
   * readiness widget that reported terrain would be answering a question it was not asked. See
   * `canRaisePillar` for the same argument from the other side.
   */
  pillarReady: boolean
  /** A Fire Burst is off cooldown and has a charge to spend. The caller asks `canBurst`. */
  burstReady: boolean
  /**
   * A Fire Thrust would do something: a charge in hand, and the wings out.
   *
   * The caller asks `canFireThrust`, which is the same predicate `main.ts` resolves the press with
   * — so the row dims exactly when the key would be refused, including on the ground, where fire is
   * ruled not to move the player at all. That posture half is why this cannot be derived from
   * `player.mode` here as well: the panel must not hold a second opinion about the rule.
   */
  fireThrustReady: boolean
   /**
   * A press of the carry key would do something: either a payload is in reach, or one is
   * being carried and the player is standing on ground.
   *
   * Passed in for the same reason `gustReady` is. The rule needs the level's payload list,
   * which is world state and has no business in a UI module, and the caller already asks
   * `carryIntent` to resolve the press itself — so this row follows the same answer the
   * interaction acts on rather than a second opinion about it.
   */
  carryReady: boolean
}

export interface GameAction {
  /**
   * The physical key, spelled as the README's controls table spells it. The drift test
   * compares these against that table in both directions.
   */
  key: string
  /** How it is pressed, when that distinguishes it from another action on the same key. */
  press?: string
  name: string
  detail: string
  mode: ActionMode
  available(ctx: ActionContext): boolean
}

const always = (): boolean => true
const onGround = (ctx: ActionContext): boolean => ctx.player.mode === 'ground'
const inGlider = (ctx: ActionContext): boolean => ctx.player.mode === 'glider'
const standing = (ctx: ActionContext): boolean => onGround(ctx) && ctx.player.grounded
const airborne = (ctx: ActionContext): boolean => onGround(ctx) && !ctx.player.grounded
/** Gliding with breath left: both thrust and hover spend it, and neither works empty. */
const hasBreath = (ctx: ActionContext): boolean => inGlider(ctx) && canBend(ctx.player, ctx.flight)
/**
 * Whether a given element is the one the bending keys currently resolve to.
 *
 * Asks `isElementAvailable` as well, so an element that a future act structure has not unlocked
 * is struck through even if something managed to select it — the panel must not offer a move the
 * fight would refuse, and that predicate is the one authority on availability.
 */
const bending = (element: Element) => (ctx: ActionContext): boolean =>
  ctx.element === element && isElementAvailable(element)

export const ACTIONS: readonly GameAction[] = [
  {
    key: 'Mouse', name: 'Look / trim', mode: 'both', available: always,
    detail: 'Look around on foot. In the glider it trims — the nose drifts toward where you look.',
  },
  {
    key: 'Mouse left', name: 'Staff combo', mode: 'ground',
    // staffBusy is the same predicate the controller gates the glider on, so the panel
    // cannot claim the staff is free while the fight disagrees.
    available: (ctx) => ctx.player.mode === 'ground' && !staffBusy(staffOf(ctx.player)),
    detail: 'Up to three swings, each a wide horizontal arc that hits everyone in front of '
      + 'you rather than one enemy hard. The third sweeps wider and shoves much harder. Keep '
      + 'swinging inside the window to continue the combo, or it restarts. While the staff is '
      + 'busy — swinging, or recovering once the combo ends — it is not a glider, so you '
      + 'cannot deploy until it is free: the glider IS the staff. Ground only; in the glider '
      + 'a click does nothing.',
  },
  {
    key: 'W / S', name: 'Walk forward / back', mode: 'ground', available: onGround,
    detail: 'The run eases up to speed and slides on stops rather than snapping.',
  },
  {
    key: 'W', name: 'Airbending thrust', mode: 'glider', available: hasBreath,
    detail: 'The only way to gain net altitude. Spends breath.',
  },
  {
    key: 'S', name: 'Flare', mode: 'glider', available: inGlider,
    detail: 'Raise the nose to trade speed for a moment of lift.',
  },
  {
    key: 'A / D', name: 'Strafe', mode: 'ground', available: onGround,
    detail: 'Step sideways without turning.',
  },
  {
    key: 'A / D', name: 'Weight shift', mode: 'glider', available: inGlider,
    detail: 'This is how you steer. The mouse only trims; the turn comes from here.',
  },
  {
    key: 'Z', press: 'tap', name: 'Air scooter', mode: 'ground', available: standing,
    detail: 'Tap to ride, tap to step off. Doubles your speed and halves your steering; ' +
      'holding a clean line builds a hidden charge that makes it faster still. Leaving ' +
      'the ground — a jump, a fall off a ledge, or stepping off — stows it and loses the charge.',
  },
  {
    // No key of its own, so it is listed under the key that summons the thing it is a property
    // of. `Z` therefore has two rows, which is the same shape `Space` and `Ctrl` already use for
    // moves that differ by how they are pressed rather than by which key.
    //
    // `available` is the entry gate restated, and it is restated rather than imported because
    // the third condition cannot be answered here: whether a near-vertical wall is within
    // lateral reach is a raycast, and a UI module has no terrain. So the panel dims this row
    // when the scooter is down or the charge is short — the two halves it can honestly check —
    // and the wall itself is left to the world. Named here so the next reader knows the
    // omission is deliberate: see `stepWallRide` in src/player/wall-ride.ts for the full gate.
    key: 'Z', press: 'while riding, into a wall', name: 'Wall ride', mode: 'ground',
    available: (ctx) => onGround(ctx) && ctx.player.scooterActive
      && ctx.player.scooterCharge >= ctx.ground.wallRideMinCharge,
    detail: 'Drive a charged scooter square into a near-vertical face at speed and it carries '
      + 'you up the wall instead of stopping you. The squarer you hit it the higher you go; a '
      + 'glancing approach just skims. It spends the charge as you climb, so a shortcut up a '
      + 'wall costs the speed you built to reach it — and the ride ends when the charge runs '
      + 'out, when the wall does, when the climb dies, or when you step off. Your second jump '
      + 'is still in hand up there, and it pays more the faster you are rising.',
  },
  {
    key: 'Shift', press: 'hold', name: 'Sprint', mode: 'ground', available: onGround,
    detail: 'Hold to run instead of walk, nearly doubling your base speed. Independent of ' +
      'the scooter, and it stacks with riding one — sprinting on a scooter is faster than ' +
      'riding without it.',
  },
  {
    key: 'Shift', press: 'hold', name: 'Hover', mode: 'glider', available: hasBreath,
    detail: 'Hold station in mid-air. The most expensive thing you can do with breath.',
  },
  {
    key: 'Q', name: 'Air blast dash', mode: 'ground',
    detail: 'Three in a chain, then a short recovery. Ground only.',
    // canDash covers the chain and the recovery; stepDash separately requires
    // grounded. See src/player/dash.ts for that half of the gate.
    available: (ctx) => standing(ctx)
      && canDash({ used: ctx.player.dashesUsed, recovery: ctx.player.dashRecovery }, ctx.ground),
  },
  {
    key: 'F', press: 'airbending', name: 'Gust', mode: 'both',
    available: (ctx) => bending('air')(ctx) && ctx.gustReady,
    detail: 'A wide sweep of air, thrown where you are looking. Knocks enemies back and '
      + 'interrupts a strike; barely hurts them. F is whichever element you have selected — '
      + 'switch to water and this key grips instead, or to earth and it throws a rock.',
  },
  {
    key: 'F', press: 'waterbending', name: 'Water Grip', mode: 'both',
    available: (ctx) => bending('water')(ctx) && ctx.gripReady,
    detail: 'Pull, then hold. A narrow reach straight ahead — much tighter than a gust, and it '
      + 'does not reach nearly as far above or below you — that yanks whoever it catches toward '
      + 'you and locks them there for a moment. No damage at all: it drags a spear out of its own '
      + 'reach and into yours, and a held soldier simply cannot act. The cooldown is a shade '
      + 'shorter than the hold, so you can keep one soldier pinned indefinitely if you spend '
      + 'nothing else on it — that buys time, not progress.',
  },
  {
    key: 'F', press: 'earthbending', name: 'Stone Throw', mode: 'both',
    available: (ctx) => bending('earth')(ctx) && ctx.stoneReady,
    detail: 'Hurls a rock down a narrow line ahead of you — the tightest aim of the three quick '
      + 'moves, and the only one that really hurts. It hits harder than anything else you can '
      + 'press outside a dive-slam, and armour does not reduce it at all, which makes it the '
      + 'answer to the soldier in plate that ignores a gust and shrugs off the staff: four rocks '
      + 'put that one down where the staff needs about thirteen swings inside its reach. The '
      + 'trade is that it is slow — the longest cooldown of any quick move, several times a '
      + 'gust\'s — and it spends breath. Throw it at something worth the wait.',
  },
  {
    key: 'F', press: 'firebending', name: 'Fire Burst', mode: 'both',
    available: (ctx) => bending('fire')(ctx) && ctx.burstReady,
    detail: 'The only move you have that really hurts one soldier. A very narrow blast straight '
      + 'ahead — the tightest reach in the game, and the one that extends least above and below you, '
      + 'so you have to be close and roughly level with what you are burning. Two of them put a '
      + 'spearman down the first time and one puts a net thrower down; a heavy in plate shrugs off '
      + 'half of it and is not what fire is for. It spends one of your three charges whether or not '
      + 'it connects, so aim it, and the charges only come back when you touch the ground.',
  },
  {
    key: 'G', press: 'hold', name: 'Air Wall', mode: 'both',
    available: (ctx) => ctx.airWallReady,
    detail: 'A short-lived barrier of air, held in front of you, that turns arrows around '
      + 'instead of swallowing them — and a turned arrow hurts whoever it hits. It only covers '
      + 'the way you are looking, and only stops things in flight: a spear thrust goes '
      + 'straight through it. Unlike everything else you aim, looking up and down matters '
      + 'here, because the wall is a mirror and the angle you hold it at is where the arrow '
      + 'goes. Level with the shooter, aim a little high or the arrow comes back into the '
      + 'ground; from the glider, look down the line the shot came up. It spends breath, it '
      + 'lasts under a second, and the gap before the next one is as long as the gap between '
      + 'dodges, so it answers a shot you saw coming rather than every shot.',
  },
  {
    key: 'E', name: 'Avatar State', mode: 'both', available: (ctx) => ctx.avatarStateReady,
    detail: 'Once the pip under your Focus bar is full. Eight seconds of free breath, ' +
      'a gust that downs a soldier outright, and every wind feature turning to your side.',
  },
  {
    key: 'R', press: 'airbending: hold, then release', name: 'Vortex', mode: 'both',
    available: (ctx) => bending('air')(ctx) && ctx.vortexReady,
    detail: 'Hold to gather a charge, release to pull everyone near you inward and lift '
      + 'them off their feet. It does no damage at all — a lifted soldier simply cannot '
      + 'act, which is the opening. Charging longer widens the reach and throws them higher. '
      + 'Releasing early cancels for free.',
  },
  {
    key: 'R', press: 'waterbending: press, then release', name: 'Ice Lock', mode: 'both',
    available: (ctx) => bending('water')(ctx) && ctx.iceLockReady,
    detail: 'Freezes the rank in front of you where it stands — wider than the grip and '
      + 'shorter, and it holds them far longer. No pull, no damage, and they stay frozen even if '
      + 'you hit them, which is the whole point: a locked target is locked so you can work on '
      + 'it. This is the one move that spends Focus, and it spends about a third of a full bar '
      + '— rather more than a spear hit takes off you. Two are affordable from a full meter, '
      + 'and either one costs you the Avatar State. There is no cooldown; the meter is the '
      + 'price. Unlike the Vortex it does not charge, so how long you hold makes no difference.',
  },
  {
    key: 'R', press: 'earthbending: press, then release', name: 'Stone Pillar', mode: 'both',
    available: (ctx) => bending('earth')(ctx) && ctx.pillarReady,
    detail: 'Raises a column of rock a few paces ahead of you, and it is the only hard cover in '
      + 'the game: arrows and nets stop dead against it, from either side. It stands about six '
      + 'seconds — three shots from an archer — and you have to stay behind it, because stepping '
      + 'much more than a pace aside gives the shot its line back. Two can stand at once, so you '
      + 'can shut down two directions and not three; a third press sinks the oldest. Anyone '
      + 'standing where it comes up is knocked off their feet, which interrupts them. It spends '
      + 'Focus — a little less than an Ice Lock, about what a spear hit costs you — and you need '
      + 'ground near your own feet to raise it from, so it is not something to drop from a hover. '
      + 'It does not stop anyone walking: a spearman comes straight round it.',
  },
  {
    // 'glider' rather than 'both', and it is the only bending row in the catalogue that is not
    // 'both'. That is the rule rather than a formatting choice: fire does not move the player on the
    // ground at all, so a row in the ground column would be offering something that is refused
    // there. The other three heavy verbs work in either posture and are listed accordingly.
    key: 'R', press: 'firebending: press, then release', name: 'Fire Thrust', mode: 'glider',
    available: (ctx) => bending('fire')(ctx) && ctx.fireThrustReady,
    detail: 'One shove up and forward, for one charge. This is what fire is for when the breath bar '
      + 'is empty and the ground is coming up: it is worth about one push of air, enough to pull a '
      + 'stalled wing back into flying, and it never touches your breath in either direction. It '
      + 'does nothing at all on foot — fire moves you in the air or not at all. Three charges is '
      + 'every fire move you have until you land, so a thrust is a burst you did not throw.',
  },
  {
    key: 'C', name: 'Slipstream', mode: 'both',
    available: (ctx) => ctx.slipstreamReady,
    detail: 'A dash that cannot be hit for the first instant of it. The window is shorter '
      + 'than the dash, so it beats an attack you can see coming rather than everything. '
      + 'Timed right it also builds Focus. On foot it goes wherever you are moving or '
      + 'looking; in the glider, bank left or right to dodge sideways, since thrust and '
      + 'flare are not directions. It spends breath, so it cannot be chained forever.',
  },
  {
    key: 'V', press: 'hold, flick, release', name: 'Element radial', mode: 'both',
    available: always,
    // Air is the only direction named. Every other element's flick moves when the count changes
    // -- water was straight down at two elements, at 120 degrees at three, and is straight right
    // at four -- so the copy names the fact that survives an append instead: air is up, and the
    // rest sit clockwise from it in the order the ring draws them. See `ELEMENT_ORDER`.
    detail: 'Hold to open the radial, flick the mouse toward an element, let go. Air is straight '
      + 'up and the others sit clockwise from it, in the order the ring shows them. It never '
      + 'pauses or slows the game and it never takes the mouse off you — the same flick that '
      + 'picks also nudges your view a little, which is the price of nothing being taken away. A '
      + 'flick too small to mean anything keeps what you had, so you can change your mind by just '
      + 'letting go.',
  },
  {
    key: '1 / 2 / 3 / 4', name: 'Select element directly', mode: 'both', available: always,
    detail: '1 is air, 2 is water, 3 is earth, 4 is fire. The same switch without the gesture, '
      + 'and the faster way to do it once you know which one you want. Switching costs nothing at '
      + 'all — no cooldown, no windup — so it belongs inside a combo: vortex a group, switch and '
      + 'freeze the front rank, then switch again and break the one the freeze cannot hurt.',
  },
  {
    // 'both' rather than 'ground', even though the press only ever works with feet on the
    // ground. The row has to be readable from the glider column too: that is where the
    // player is when they wonder why the wing feels heavy and go looking for the rule.
    key: 'B', name: 'Pick up or set down a payload', mode: 'both',
    available: (ctx) => ctx.carryReady,
    detail: 'Stand next to a bundle and press B to lift it; press B again, on the ground, to '
      + 'set it down. Carrying it on the glider costs you three things at once: the wing '
      + 'makes less lift, so you sink faster and cannot climb as high on a bar of breath; '
      + 'the weight shift turns you at half the rate, so you have to slow down to fit inside '
      + 'a thermal; and both thrust and hover drink breath half again as fast. Thrusting the '
      + 'whole way somewhere will just about get you there with nothing left over, so ride the '
      + 'air instead. Set it down on the island it is meant for and you are done with it. Go '
      + 'down or fall out of the world and it goes back where you found it.',
  },
  {
    key: 'Ctrl', press: 'hold', name: 'Tuck', mode: 'glider', available: inGlider,
    detail: 'Fold the wings for a fast dive.',
  },
  {
    key: 'Ctrl', press: 'hold through a landing', name: 'Pressure Wave', mode: 'both',
    detail: 'Land fast enough while holding this and the fall becomes a ground slam. What ' +
      'matters is your speed at touchdown, not your speed right now — a fall that is still ' +
      'accelerating can clear the threshold before it lands. The harder the landing, the ' +
      'wider and heavier the blast: a committed dive downs a soldier outright, and throws ' +
      'you back up.',
    // The fall-speed threshold lives inside detectSlam, which needs a landing to test,
    // so it is restated here. See src/player/slam.ts.
    available: (ctx) => !ctx.player.grounded
      && -ctx.player.velocity.y >= ctx.wave.minImpactSpeed,
  },
  {
    key: 'Space', press: 'tap', name: 'Jump', mode: 'ground', available: standing,
    detail: 'A short hop.',
  },
  {
    key: 'Space', press: 'hold, then release', name: 'Charged jump', mode: 'ground',
    available: standing,
    detail: 'Hold to crouch and charge, release to launch. Roughly five times the height.',
  },
  {
    key: 'Space', press: 'tap, airborne', name: 'Double jump', mode: 'ground',
    detail: 'Gains more height the faster you are already rising.',
    available: (ctx) => airborne(ctx) && canAirJump(ctx.player, ctx.ground),
  },
  {
    key: 'Space', press: 'tap, airborne, jump spent', name: 'Deploy the glider',
    mode: 'ground',
    detail: 'The wings snap open and keep your momentum, plus an upward kick. Space ' +
      'escalates: jump, then double jump, then deploy.',
    // The staff IS the glider folded up, so mid-combo or still recovering, there is no
    // wing to snap open — the panel has to dim this exactly when the controller refuses it.
    available: (ctx) => airborne(ctx) && !canAirJump(ctx.player, ctx.ground)
      && !staffBusy(staffOf(ctx.player)),
  },
  {
    key: 'Space', name: 'Stow the glider', mode: 'glider', available: inGlider,
    detail: 'Fold the wings back into a walking stick.',
  },
  {
    // Rewritten for the settings section. This row used to say H "puts you back wherever
    // you opened it from: straight into play if you were playing", which was true while
    // closing the guide never touched the pointer lock and *opening* it never did either.
    // Opening it now calls document.exitPointerLock (panel.ts, api.open) so the settings
    // rows have a cursor to be dragged with, and closing still never re-acquires the lock,
    // so there is no longer a case where H hands the player straight back into play. Both
    // keys now land on the "Paused" card, and one click resumes.
    key: 'H', name: 'This guide', mode: 'both', available: always,
    detail: 'Opens and closes this panel, and pauses while it is open. Opening it also hands '
      + 'the mouse back, which is what makes the settings at the bottom usable — so closing '
      + 'it leaves you on the "Paused" card, and one click on the game takes the mouse back '
      + 'and resumes.',
  },
  {
    // This row is read from inside the very panel it describes, so the detail has to
    // describe both contexts. Escape is the browser's own pointer-lock release key and
    // nothing in this codebase can decline it: panel.ts closes the guide on Escape but
    // never touches the lock, so in the guide the two effects happen together — the panel
    // closes and the mouse is released — and what the player lands on is the "Paused"
    // card, not the game.
    //
    // The last clause used to distinguish Escape from H, because H alone "leaves the mouse
    // alone". That distinction is gone: opening the guide now releases the lock itself, so
    // by the time either key closes the panel there is no lock left for Escape to release
    // or for H to preserve, and both land on the same card. Two earlier wordings got this
    // row wrong in three different ways; the one thing worth keeping is that nothing here
    // can decline Escape.
    key: 'Escape', name: 'Pause', mode: 'both', available: always,
    detail: 'During play, releases the mouse, so the game pauses and the "Paused" card '
      + 'comes up; click the canvas to take the mouse back and resume. While this guide is '
      + 'open, it closes the guide, and you land on the "Paused" card — the same place H '
      + 'lands you, since opening the guide has already released the mouse.',
  },
]

/**
 * Every physical key the catalogue uses, deduplicated and sorted.
 *
 * Compound keys like "W / S" split into their parts, so this can be compared against
 * the README's table key for key.
 */
export function actionKeys(): string[] {
  const keys = ACTIONS.flatMap((action) => action.key.split('/').map((part) => part.trim()))
  return [...new Set(keys)].sort()
}
