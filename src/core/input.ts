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
): InputState {
  const axis = (pos: string, neg: string) => (held.has(pos) ? 1 : 0) - (held.has(neg) ? 1 : 0)
  return {
    lookDirection: lookDirection.clone().normalize(),
    forward: axis('KeyW', 'KeyS'),
    strafe: axis('KeyD', 'KeyA'),
    sprint: held.has('ShiftLeft') || held.has('ShiftRight'),
    actionPressed,
    actionHeld: held.has('Space'),
    actionReleased,
  }
}

const MOUSE_SENSITIVITY = 0.0022

export class InputTracker {
  private readonly held = new Set<string>()
  private yaw = 0
  private pitch = 0
  private actionPressed = false
  private actionReleased = false
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
        e.preventDefault()
      }
    })
    on<KeyboardEvent>('keyup', (e) => {
      this.held.delete(e.code)
      if (e.code === 'Space') this.actionReleased = true
    })
    // Held keys would otherwise stick when the window loses focus.
    on('blur', () => this.held.clear())

    on<MouseEvent>('mousemove', (e) => {
      if (document.pointerLockElement !== canvas) return
      this.yaw -= e.movementX * MOUSE_SENSITIVITY
      this.pitch = clampPitch(this.pitch - e.movementY * MOUSE_SENSITIVITY)
    })

    const requestLock = () => void canvas.requestPointerLock()
    canvas.addEventListener('click', requestLock)
    this.listeners.push(() => canvas.removeEventListener('click', requestLock))
  }

  /** Call exactly once per frame: reading clears the action edge. */
  sample(): InputState {
    const state = toInputState(
      this.held,
      lookDirectionFrom(this.yaw, this.pitch),
      this.actionPressed,
      this.actionReleased,
    )
    this.actionPressed = false
    this.actionReleased = false
    return state
  }

  dispose(): void {
    for (const off of this.listeners) off()
    this.listeners.length = 0
  }
}
