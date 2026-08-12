import type { WindKind } from '../../world/wind'

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
    keys: ['G', 'A', 'D'],
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
      'that is full, E spends the lot on the Avatar State.',
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
