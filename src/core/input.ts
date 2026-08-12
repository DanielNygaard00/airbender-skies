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
  carryPressed = false,
): InputState {
  const axis = (pos: string, neg: string) => (held.has(pos) ? 1 : 0) - (held.has(neg) ? 1 : 0)
  return {
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
    carryPressed,
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
  private carryPressed = false
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
      // Edge-triggered like the rest, and for a sharper reason than most: held down, a
      // repeating G would set the payload down and lift it again on alternate frames.
      if (!e.repeat && e.code === 'KeyB') this.carryPressed = true
    })
    on<KeyboardEvent>('keyup', (e) => {
      this.held.delete(e.code)
      if (e.code === 'Space') this.actionReleased = true
      if (e.code === 'KeyR') this.vortexReleased = true
    })
    // Held keys would otherwise stick when the window loses focus.
    on('blur', () => this.held.clear())

    on<MouseEvent>('mousemove', (e) => {
      if (document.pointerLockElement !== canvas) return
      const { yaw, pitch } = lookDelta(e.movementX, e.movementY, this.sensitivity, this.invertY)
      this.yaw += yaw
      this.pitch = clampPitch(this.pitch + pitch)
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
      this.carryPressed,
    )
    this.actionPressed = false
    this.actionReleased = false
    this.scooterPressed = false
    this.dashPressed = false
    this.gustPressed = false
    this.avatarStatePressed = false
    this.vortexReleased = false
    this.slipstreamPressed = false
    this.staffPressed = false
    this.carryPressed = false
    return state
  }

  dispose(): void {
    for (const off of this.listeners) off()
    this.listeners.length = 0
  }
}
