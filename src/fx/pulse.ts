/**
 * One decaying 0-to-1 value.
 *
 * Shared by the hurt flash and the dash FOV kick, which want exactly the same
 * behaviour — jump to 1 on an event, fall linearly to 0 — and would otherwise be two
 * timers that drift apart. Triggering is assignment to 1, so there is no `trigger`
 * function to keep in step with this one.
 */
export function stepPulse(value: number, dt: number, decayPerSecond: number): number {
  if (!Number.isFinite(value) || !Number.isFinite(dt) || !Number.isFinite(decayPerSecond)) {
    return 0
  }
  return Math.max(0, Math.min(1, value) - decayPerSecond * dt)
}
