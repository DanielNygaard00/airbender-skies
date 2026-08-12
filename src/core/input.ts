import { Vector3, MathUtils } from 'three'
import type { InputState } from './types'

/** Just under vertical, so looking straight up can never flip the view. */
export const PITCH_LIMIT = MathUtils.degToRad(85)

export function clampPitch(pitch: number): number {
  return MathUtils.clamp(pitch, -PITCH_LIMIT, PITCH_LIMIT)
}

export function lookDirectionFrom(yaw: number, pitch: number): Vector3 {
  const cp = Math.cos(pitch)
  return new Vector3(-Math.sin(yaw) * cp, Math.sin(pitch), -Math.cos(yaw) * cp).normalize()
}

/**
 * The element radial's own edges and deltas, bundled.
 *
 * An object rather than four more positional parameters on `toInputState`. That list is already
 * eleven long and `input.test.ts` carries a test whose whole purpose is catching an off-by-one
 * in it; adding a boolean, a boolean, a pair and a nullable number to the end of it would be
 * four more chances to make exactly that mistake. Bundled, a caller that mixes two fields up
 * gets a type error instead.
 */
export interface RadialEdges {
  radialReleased: boolean
  pointerDelta: { x: number; y: number }
  elementIndex: number | null
}

/** What the radial contributes when nothing has happened. Shared so callers need not spell it. */
export const NO_RADIAL_EDGES: RadialEdges = {
  radialReleased: false,
  pointerDelta: { x: 0, y: 0 },
  elementIndex: null,
}

/**
 * How many element binds the number row offers.
 *
 * Digit1 through Digit4, which is the full set the design document names — air, water, earth,
 * fire. Bound now rather than when earth and fire arrive, because `stepElements` already ignores
 * an index past the end of `ELEMENT_ORDER`: pressing 3 today does nothing, and on the day earth
 * is appended it starts working with no change here. The alternative — widening this alongside
 * the union — is a second place to remember.
 */
const ELEMENT_BIND_COUNT = 4

/** Map held key codes to intent. Movement code never sees key codes. */
export function toInputState(
  held: ReadonlySet<string>,
  lookDirection: Vector3,
  actionPressed: boolean,
  actionReleased = false,
  scooterPressed = false,
  dashPressed = false,
  gustPressed = false,
  avatarStatePressed = false,
  vortexReleased = false,
  slipstreamPressed = false,
  staffPressed = false,
  radial: RadialEdges = NO_RADIAL_EDGES,
): InputState {
  const axis = (pos: string, neg: string) => (held.has(pos) ? 1 : 0) - (held.has(neg) ? 1 : 0)
  return {
    // Read off the held set rather than tracked as an edge, the way `actionHeld` and
    // `vortexHeld` are: "the radial is open" is a state, not an event, and reading the set means
    // the blur handler's `held.clear()` closes the radial for free.
    radialHeld: held.has('KeyV'),
    radialReleased: radial.radialReleased,
    pointerDelta: radial.pointerDelta,
    elementIndex: radial.elementIndex,
    lookDirection: lookDirection.clone().normalize(),
    forward: axis('KeyW', 'KeyS'),
    strafe: axis('KeyD', 'KeyA'),
    sprint: held.has('ShiftLeft') || held.has('ShiftRight'),
    tuck: held.has('ControlLeft') || held.has('ControlRight'),
    actionPressed,
    actionHeld: held.has('Space'),
    actionReleased,
    scooterPressed,
    dashPressed,
    gustPressed,
    avatarStatePressed,
    vortexHeld: held.has('KeyR'),
    vortexReleased,
    slipstreamPressed,
    staffPressed,
  }
}

/** Base look speed. The player's sensitivity setting is a multiplier on top of this, not a replacement for it — sensitivity 1 must reproduce today's feel exactly. */
export const MOUSE_SENSITIVITY = 0.0022

/** How far a mouse delta turns the view, given the player's sensitivity and invert choice. */
export function lookDelta(
  movementX: number,
  movementY: number,
  sensitivity: number,
  invertY: boolean,
): { yaw: number; pitch: number } {
  const yaw = -movementX * MOUSE_SENSITIVITY * sensitivity
  // Sensitivity scales the magnitude first; invert only ever flips the sign after that,
  // so the two never interact in a way that would make inverted look feel faster or slower.
  let pitch = -movementY * MOUSE_SENSITIVITY * sensitivity
  if (invertY) pitch = -pitch
  return { yaw, pitch }
}

/**
 * Elements that own the Space key themselves.
 *
 * A checkbox is activated by Space and by nothing else: Enter does not activate one, and
 * there is no form here for Enter to submit. So a `preventDefault()` on a Space keydown
 * leaves a focused checkbox impossible to operate from the keyboard at all — and it does
 * that regardless of which element the listener is bound to or which phase it runs in,
 * because `preventDefault` cancels the activation behaviour rather than the propagation.
 * The settings panel's three toggle rows are checkboxes, which is why this list exists.
 */
const SPACE_OWNING_TAGS = new Set(['INPUT', 'BUTTON', 'SELECT', 'TEXTAREA'])

/**
 * Whether the jump may claim this Space press — that is, `preventDefault()` it.
 *
 * A free function taking the event target rather than a method reading `document`, for the
 * reason `lookDelta` above is one: the node test environment has no DOM, so the decision
 * has to be exercisable by handing it plain objects and `null`. Duck-typed on `tagName`
 * for the same reason — `instanceof HTMLInputElement` cannot be evaluated there.
 *
 * Anything that is not a form control claims Space, `null`, `window` and the canvas
 * included. The default has to stay the jump: an unclaimed Space with nothing focused
 * scrolls the page under the player, which is worse than the bug the gate fixes.
 */
export function shouldClaimSpace(target: EventTarget | null): boolean {
  const tagName = (target as { tagName?: unknown } | null)?.tagName
  if (typeof tagName !== 'string') return true
  return !SPACE_OWNING_TAGS.has(tagName.toUpperCase())
}

export class InputTracker {
  private readonly held = new Set<string>()
  private yaw = 0
  private pitch = 0
  private sensitivity = 1
  private invertY = false
  private actionPressed = false
  private scooterPressed = false
  private dashPressed = false
  private gustPressed = false
  private avatarStatePressed = false
  private actionReleased = false
  private vortexReleased = false
  private slipstreamPressed = false
  private staffPressed = false
  private radialReleased = false
  /**
   * Pointer movement accumulated since the last sample.
   *
   * Separate from `yaw`/`pitch` rather than derived from them: those are absolute angles that
   * `clampPitch` bounds, so a player already looking straight up produces no further pitch change
   * and a radial driven off them would go dead in exactly that posture. Raw pixels have no such
   * ceiling.
   */
  private pointerX = 0
  private pointerY = 0
  private elementIndex: number | null = null
  private readonly listeners: (() => void)[] = []

  constructor(target: EventTarget, canvas: HTMLCanvasElement) {
    const on = <E extends Event>(type: string, handler: (e: E) => void) => {
      const fn = handler as (e: Event) => void
      target.addEventListener(type, fn)
      this.listeners.push(() => target.removeEventListener(type, fn))
    }

    on<KeyboardEvent>('keydown', (e) => {
      this.held.add(e.code)
      if (e.code === 'Space') {
        // Auto-repeat must not re-fire the press edge — it would reset a charge.
        if (!e.repeat) this.actionPressed = true
        // Gated on the target, because this listener is bound to `window` and therefore
        // also sees the Space press aimed at a focused checkbox in the settings panel.
        // Claiming that one made the panel's three toggle rows keyboard-inoperable, in a
        // panel whose whole purpose is accessibility. Everything else still claims it, so
        // Space is still the jump and still does not scroll the page.
        //
        // The press edge above is deliberately still recorded even when the key belongs to
        // a control: the guide is open in that case, so `pauseReason` is `'guide'` and
        // `main.ts`'s paused branch calls `sample()` every frame precisely to drain edges,
        // meaning a Space that toggled a checkbox cannot surface as a jump on resume.
        if (shouldClaimSpace(e.target)) e.preventDefault()
      }
      // Both are toggles or one-shots, so auto-repeat must not re-fire them either:
      // a held key would otherwise flip the scooter on and off every frame. This used to be
      // Shift, which also meant sprint and hover, so the key that summoned the scooter also
      // raised its speed while still held -- measured at identical charge, cruise was
      // 27.5 m/s with Shift held against 14.8 m/s released. Z has no other meaning, so
      // riding the scooter and sprinting are independent choices now.
      if (!e.repeat && e.code === 'KeyZ') {
        this.scooterPressed = true
      }
      if (!e.repeat && e.code === 'KeyQ') this.dashPressed = true
      if (!e.repeat && e.code === 'KeyF') this.gustPressed = true
      if (!e.repeat && e.code === 'KeyE') this.avatarStatePressed = true
      if (!e.repeat && e.code === 'KeyC') this.slipstreamPressed = true
      /**
       * The element binds, from the number row.
       *
       * `e.code` rather than `e.key`, like every other binding here, which matters more for
       * digits than for letters: on a French AZERTY layout the unshifted top row produces
       * `&`, `é`, `"`, `'` as `e.key` while `e.code` stays `Digit1`..`Digit4`. Reading `key`
       * would leave the binds unreachable on that layout without a shift.
       *
       * Not guarded on `e.repeat`, and deliberately: re-selecting the element already selected
       * is idempotent — `stepElements` writes the same value — so an auto-repeat cannot do
       * anything a single press did not. The scooter needs that guard because it toggles.
       */
      const digit = e.code.startsWith('Digit') ? Number(e.code.slice(5)) : NaN
      if (Number.isInteger(digit) && digit >= 1 && digit <= ELEMENT_BIND_COUNT) {
        this.elementIndex = digit
      }
    })
    on<KeyboardEvent>('keyup', (e) => {
      this.held.delete(e.code)
      if (e.code === 'Space') this.actionReleased = true
      if (e.code === 'KeyR') this.vortexReleased = true
      if (e.code === 'KeyV') this.radialReleased = true
    })
    // Held keys would otherwise stick when the window loses focus.
    on('blur', () => this.held.clear())

    on<MouseEvent>('mousemove', (e) => {
      if (document.pointerLockElement !== canvas) return
      const { yaw, pitch } = lookDelta(e.movementX, e.movementY, this.sensitivity, this.invertY)
      this.yaw += yaw
      this.pitch = clampPitch(this.pitch + pitch)
      // Accumulated in addition to the look above, never instead of it. Diverting the movement
      // into the radial while its key was held would be the obvious implementation and is
      // forbidden: the owner's ruling is that opening the radial must not cost a frame of
      // control, and taking the camera away for as long as a key is down is exactly that.
      //
      // Raw pixels, unscaled by sensitivity. The radial's dead zone is a wrist movement, and a
      // player who has turned their sensitivity down to aim has not asked for a radial that
      // needs a bigger flick — scaling here would couple the two settings for no reason.
      this.pointerX += e.movementX
      this.pointerY += e.movementY
    })

    // The rejection is caught and dropped rather than voided. Chrome refuses a re-lock
    // inside its short post-Escape cooldown, and a voided rejected promise raises an
    // unhandled rejection in the console -- which, now that Escape-then-click is the
    // ordinary way to resume, would appear in every session. Discarding it is right rather
    // than merely quiet: nothing here needs to know the attempt failed, because the pause
    // card is driven by `pointerlockchange` and not by this call, so a refused attempt
    // simply leaves the card up and the next click works. Optional-chained even though the
    // DOM lib types the return as a plain Promise: browsers only started returning one
    // fairly recently, and older ones return undefined, where a bare .catch would throw.
    const requestLock = () => { canvas.requestPointerLock()?.catch(() => {}) }
    canvas.addEventListener('click', requestLock)
    this.listeners.push(() => canvas.removeEventListener('click', requestLock))

    on<MouseEvent>('mousedown', (e) => {
      // Left button only, and only while the canvas holds the pointer: otherwise a click
      // on the page chrome would swing the staff.
      if (e.button === 0 && document.pointerLockElement === canvas) this.staffPressed = true
    })
  }

  /** Applies the settings panel's look preferences to subsequent mouse movement. */
  setLook(sensitivity: number, invertY: boolean): void {
    this.sensitivity = sensitivity
    this.invertY = invertY
  }

  /** Call exactly once per frame: reading clears the action edge. */
  sample(): InputState {
    const state = toInputState(
      this.held,
      lookDirectionFrom(this.yaw, this.pitch),
      this.actionPressed,
      this.actionReleased,
      this.scooterPressed,
      this.dashPressed,
      this.gustPressed,
      this.avatarStatePressed,
      this.vortexReleased,
      this.slipstreamPressed,
      this.staffPressed,
      {
        radialReleased: this.radialReleased,
        // A fresh object each sample rather than a reused scratch: `stepElements` folds this
        // into accumulated state and nothing holds onto it, but a shared mutable pair handed to
        // a pure function is the sort of aliasing this codebase already had to fix once, in
        // `toInputState`'s own `lookDirection.clone()`.
        pointerDelta: { x: this.pointerX, y: this.pointerY },
        elementIndex: this.elementIndex,
      },
    )
    this.pointerX = 0
    this.pointerY = 0
    this.radialReleased = false
    this.elementIndex = null
    this.actionPressed = false
    this.actionReleased = false
    this.scooterPressed = false
    this.dashPressed = false
    this.gustPressed = false
    this.avatarStatePressed = false
    this.vortexReleased = false
    this.slipstreamPressed = false
    this.staffPressed = false
    return state
  }

  dispose(): void {
    for (const off of this.listeners) off()
    this.listeners.length = 0
  }
}
