import type { WindKind } from '../../world/wind'
import type { Element } from '../../elements/element'

/**
 * The parts of the guide that are not a key with a rule: the chains that emerge from
 * combining moves, what the HUD's three bars mean, and what the mote clouds are.
 *
 * All static. Nothing here reads game state.
 */
export interface Combo {
  name: string
  /**
   * The physical keys involved, in order. Structured rather than buried in the prose so
   * a test can check they all exist — a combo citing a key the game does not have is a
   * lie a tester would waste time chasing.
   */
  keys: string[]
  detail: string
}

export const COMBOS: readonly Combo[] = [
  {
    name: 'Dive into a slam, and back into the air',
    keys: ['Ctrl', 'Space', 'Space'],
    detail: 'Tuck into a dive, hold Ctrl through the landing to slam, then Space twice on ' +
      'the way back up — once for the double jump, once to open the wings. The flagship ' +
      'chain: the harder the dive, the heavier the slam and the higher the bounce.',
  },
  {
    name: 'Deploy out of a rising jump',
    keys: ['Space'],
    detail: 'Deploying while you are still rising climbs higher than either the jump or ' +
      'the deploy alone, because the wings keep your momentum and add a kick on top of it.',
  },
  {
    name: 'Three dashes and a recovery',
    keys: ['Q'],
    detail: 'The dash chains three times before it needs a moment back. An unspent chain ' +
      'never expires, so you can hold the third one for when you need it.',
  },
  {
    name: 'Give the arrow back',
    keys: ['G', 'F'],
    detail: 'Hold G facing an archer as it draws and the arrow it looses comes off the wall ' +
      'instead of into you, and it hurts whatever it lands on. Whoever is closing on you is ' +
      'usually what that is, which is the cheapest damage in the game — you did not throw ' +
      'anything. Threading it back into the archer that fired it is a fine shot rather than a ' +
      'reliable one, so gust the spears off you first and let the wall handle the range.',
  },
  {
    name: 'Gather them, then freeze them',
    keys: ['R', '2', 'R'],
    detail: 'Charge a Vortex on air and release to pull a group into one place, then 2 to switch '
      + 'to water and R again to freeze the lot where they land. Switching is free and instant, so '
      + 'this is one continuous action rather than three — which is the whole reason the two '
      + 'bending keys mean a different move per element.',
  },
  {
    name: 'Drag one out of the group and deal with it',
    keys: ['2', 'F', 'Mouse left'],
    detail: 'On water, F yanks whoever is in front of you toward you and holds them there. The '
      + 'pull lands them inside the staff\'s reach and the hold means they cannot answer, so the '
      + 'combo goes in for free. Water does no damage at all — it makes the staff\'s damage safe '
      + 'to spend.',
  },
  {
    name: 'Break the one in armour',
    keys: ['3', 'F'],
    detail: 'The soldier in plate ignores a gust completely and shrugs off the staff, and a rock '
      + 'does not care about either. On earth, F throws one: four of them put it down, where the '
      + 'staff needs about thirteen swings in its face and it hits for two. Nothing else you '
      + 'carry breaks armour on demand — a dive-slam also does it, but only if you have the height '
      + 'to spend first. Throw from range and let it walk.',
  },
  {
    name: 'Put a rock between you and the archers',
    keys: ['3', 'R'],
    detail: 'On earth, R raises a pillar a few paces ahead of you and it stops arrows and nets '
      + 'dead for about six seconds — the only hard cover in the game. You have to stay behind it: '
      + 'step much more than a pace or so aside and the shot has a clear line again. Two can stand '
      + 'at once, so you can answer two directions and not three, and a third press sinks the '
      + 'oldest. It costs Focus, about what taking a spear hit costs you, so cover that stops one '
      + 'arrow has broken even.',
  },
  {
    name: 'Freeze the rank, then break the one that matters',
    keys: ['2', 'R', '3', 'F'],
    detail: 'Water buys time and earth spends it. Freeze the front rank where it stands, switch '
      + 'to earth, and throw rocks at the armoured one while nothing can answer — it is the one '
      + 'enemy the freeze cannot hurt and the one earth can. A full Focus bar pays for one freeze '
      + 'and one pillar with something left over, and switching costs nothing, so all of this is '
      + 'one continuous action.',
  },
  {
    // The other pair the borrowed elements make: water buys the time, fire spends it. Listed after
    // the water combos because it only makes sense once the freeze does.
    name: 'Lock them down, then burn one out of the group',
    keys: ['2', 'R', '4', 'F'],
    detail: 'Freeze the rank in front of you on water, switch to fire, and burn the one you most '
      + 'want gone while none of them can answer. Water does no damage and fire does almost nothing '
      + 'else, so neither element finishes a fight on its own — this is the sequence where that '
      + 'stops mattering. You have three charges, so pick the soldier that is hurting you most: the '
      + 'net thrower goes down to a single burst.',
  },
  {
    name: 'Spend a charge to save the flight',
    keys: ['3', 'R', 'Space'],
    detail: 'Out of breath, low, and still over water: hold fire and press R for one shove up and '
      + 'forward. It costs a charge and never touches your breath, and one is enough to pull a '
      + 'stalled wing back into flying — but you only have three, they are the same three the burst '
      + 'spends, and nothing gives them back until you are standing on something. Which is the point: '
      + 'it buys you a landing, not a longer flight.',
  },
  {
    name: 'Ride a wall on the scooter',
    keys: ['Z', 'Shift', 'W'],
    detail: 'Build a charge on the scooter, then drive it square into a near-vertical face at ' +
      'speed and it carries you up instead of stopping you. The squarer you hit it the higher ' +
      'you go — a glancing approach just skims along the rock. It spends the charge while you ' +
      'climb, so a shortcut up a wall costs the speed you built to reach it, and you come off ' +
      'the top on foot with nothing in the bank.',
  },
  {
    name: 'Kick off a wall while you are still climbing',
    keys: ['Z', 'Space'],
    detail: 'You reach a wall on your feet, so your second jump is untouched when you get ' +
      'there. Spend it partway up rather than at the top: the double jump is a downward air ' +
      'push and it gains more the faster you are already rising, so kicking off early beats ' +
      'waiting for the ride to run out.',
  },
  {
    name: 'Ride the air rather than fight it',
    keys: ['W', 'A', 'D'],
    detail: 'Thrust costs breath; a thermal does not. Steering into a mote cloud and ' +
      'circling inside it climbs for free, and it builds Focus about twice as fast.',
  },
  {
    // Listed as a chain rather than as a note about the key, because that is what it is: the
    // payload on its own is one press, and the interesting part is what carrying it forces you
    // to do with everything else. It sits last on purpose — every earlier entry is a move,
    // and this one only makes sense once thermals do.
    name: 'Carry a payload the long way up',
    keys: ['B', 'A', 'D'],
    detail: 'Lift the bundle on the home plateau and it is meant for the rock island high to ' +
      'the north. Loaded, the wing sinks faster, rolls at half the rate and drinks breath ' +
      'half again as fast, so thrusting the whole way arrives on fumes if it arrives at all. ' +
      'The thermal over home and the one under the island are the way there — and because you ' +
      'turn slower loaded, you have to ease off the speed to stay inside a column rather than ' +
      'carving out the far side of it.',
  },
]

export interface MeterNote {
  name: string
  detail: string
}

/**
 * Ordered by how much the player has to think about them, not by how the HUD stacks
 * them — the HUD's order is Focus, health, breath top to bottom, and leading a written
 * explanation with Focus would explain the subtlest meter first. Each entry names its
 * own colour and position instead.
 */
export const METERS: readonly MeterNote[] = [
  {
    name: 'Breath',
    // The payload's drain is named here as well as on its own row, and deliberately so: this
    // is the bar the player watches emptying, so this is where they will look to find out why
    // it is emptying faster than they remember.
    detail: 'Flight fuel, in blue at the bottom. Thrust spends it and hovering spends it ' +
      'fastest, because holding station carries the glider\'s whole weight. Carrying a ' +
      'payload makes both cost half again as much. Refills when you are not spending it, ' +
      'faster on the ground. Air shrines raise the maximum, and five of them cover what a ' +
      'payload costs you.',
  },
  {
    name: 'Focus',
    detail: 'The gold bar. Builds while you hold a clean line — gliding above stall, and ' +
      'about twice as fast riding a wind feature — and much faster in a fight. On foot it ' +
      'drains unless you are riding the scooter — walking costs it exactly as fast as ' +
      'standing still. A hit takes nearly a third. The longer you go unbroken the ' +
      'better everything pays. Hold it at full and the thin pip beneath it fills; once ' +
      'that is full, E spends the lot on the Avatar State. It is also what pays for both ' +
      'committed elemental moves: an Ice Lock takes about a third of it and a Stone Pillar a ' +
      'little less, about what a spear hit takes off you. A full bar is two freezes, or three ' +
      'pillars, or one of each with room to spare — and any of them costs you the Avatar State, ' +
      'so the whole trade lives on this one bar and nowhere else.',
  },
  {
    // Fourth, and the only entry here that is not a bar. It is in this list rather than in
    // SCREEN_MARKS because it lives in the same bottom-left stack as the meters and answers the same
    // question they do — how much of something have I got — where those two are directions around
    // the crosshair.
    name: 'Fire charges',
    detail: 'Three orange pips above the bars, and they only show while you are holding fire or '
      + 'have spent one. Not a meter, on purpose: it is a count, and a count is something you '
      + 'read in a glance rather than watch. Both fire moves spend one pip, and nothing refills '
      + 'them except touching the ground — not time, and not standing still in the air. So the '
      + 'question fire asks is always the same one: is this worth a charge, given that I may need '
      + 'the last one to get down safely?',
  },
  {
    name: 'Health',
    detail: 'The orange bar, and it only appears once you have lost some. Small on ' +
      'purpose, and it regenerates slowly once you are out of combat. You are never ' +
      'killed by a fall, and neither is anyone else by you — enemies are downed.',
  },
]

/**
 * The two rings of shapes drawn around the crosshair.
 *
 * A list of its own rather than three more `METERS` entries: those are bars with values,
 * these are markers with directions, and the guide renders them under their own heading so
 * a player looking for "what is that shape" is not reading past the health bar to find it.
 *
 * They exist as written copy at all because there are two of them around one point. One
 * ring needed no legend; two similar rings do.
 */
export const SCREEN_MARKS: readonly MeterNote[] = [
  {
    name: 'Hit direction',
    detail: 'A solid orange wedge, close in around the crosshair, pointing at where an '
      + 'attack came from. It marks the direction at the moment it landed and then holds '
      + 'still while you turn, so once you have come round to face it you can ignore it. '
      + 'Fades out in about a second.',
  },
  {
    name: 'Threats off screen',
    detail: 'A hollow red chevron, further out, for each soldier close enough to be a threat '
      + 'and outside the view. It fades in as they leave the frame and follows them while '
      + 'you turn, so it always points where they actually are. It flares to a hotter red '
      + 'while that soldier is winding up to attack — that is the moment to move.',
  },
]

/**
 * What each element is for, in one line each.
 *
 * Typed as a `Record` over `Element` for the same reason `WIND_LEGEND` is typed over `WindKind`:
 * adding earth or fire fails to compile until it has been described here. Cheaper and stronger
 * than a test that could be deleted, and it means the guide can never ship an element the player
 * has a key for and no explanation of.
 *
 * Each line says what the element *does to a fight*, not what its two moves are — the rows in the
 * action catalogue already list the moves, and repeating them here would be the same text twice
 * with two places to keep it true. What a player reading this section needs is the reason to
 * switch at all.
 *
 * **Only air names an absolute direction, and that is a rule rather than an inconsistency.** Every
 * other element's flick direction changes when the element count does — water was straight down at
 * two elements, sits at 120 degrees at three, and will be straight right at four — so a legend that
 * named one would go stale the day earth lands, silently and in the one place a player goes to look
 * it up. What survives an append is the number bind and the position clockwise from air, because
 * `ELEMENT_ORDER` is append-only and air is always slot 0. `reference.test.ts` derives each entry's
 * expected digit from that array, so a legend left behind by a reorder reddens instead of lying.
 *
 * The availability rule is expressible here and today has nothing to say, which is deliberate.
 * When acts exist and `isElementAvailable` starts refusing, an unavailable element is already
 * struck through in the radial and its rows are already struck through in the columns above; this
 * legend is where the sentence explaining *why* would go.
 */
export const ELEMENT_LEGEND: Record<Element, string> = {
  air: 'Always yours, and the element everything else is built on top of. Wide, fast, and it '
    + 'moves people — a gust clears space and a Vortex gathers a group. It barely hurts anyone, '
    + 'which is the trade. Straight up on the radial, or 1.',
  water: 'Control. It does no damage whatsoever: it pulls, it holds, and it freezes, and what it '
    + 'buys you is time and position for something else to work in. Its reach is narrow and it does '
    + 'not extend nearly as far above or below you as air does, so it is a close-quarters answer '
    + 'rather than something to throw from a hover. One step clockwise from air, or 2.',
  earth: 'Damage, and the only cover. A thrown rock is the hardest single hit you have outside a '
    + 'dive, and the only thing that reliably breaks armour — the soldier in plate ignores a gust '
    + 'and shrugs off the staff, and earth is the answer to it. A raised pillar is the one solid '
    + 'object you can put between yourself and an archer. Both are slow and both commit you: the '
    + 'throw has the longest cooldown of any quick move and the pillar spends Focus. Two steps '
    + 'clockwise from air, or 3.',
  fire: 'The best aimed damage in the kit — one burst hurts one soldier more than anything else '
    + 'you can point at them, though it will not break plate the way earth does. You get three '
    + 'charges, both fire moves spend one, and they only come back when you touch the ground: fire '
    + 'is a thing you spend, not a thing you hold. The narrowest reach in the game and the '
    + 'shortest above and below you, so you have to be close and level with what you are burning. '
    + 'Three steps clockwise from air, or 4.',
}

/**
 * What the mote clouds mean.
 *
 * Typed as a Record over WindKind, so adding a sixth kind of wind fails to compile
 * until it is documented here. Cheaper and stronger than a test that could be deleted.
 */
export const WIND_LEGEND: Record<WindKind, string> = {
  thermal: 'Rising column. Circle inside it to climb without spending breath.',
  ridge: 'Lift running along a slope. Follow the edge to stay up.',
  river: 'A horizontal current. Enter it going the same way and it hands you speed.',
  downdraft: 'Pushes down. Cross it fast, or thrust through it.',
  dead: 'Still air that gives the wing nothing. Your lift drops to almost nothing until ' +
    'you are clear of it.',
}
