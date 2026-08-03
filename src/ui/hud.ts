import type { PlayerState } from '../core/types'

/** Shown when a value is not finite, so the player never sees NaN. */
const NO_VALUE = '—'

export function formatAltitude(y: number): string {
  return Number.isFinite(y) ? `${Math.round(y)} m` : `${NO_VALUE} m`
}

export function formatAirspeed(speed: number): string {
  return Number.isFinite(speed) ? `${Math.round(speed)} m/s` : `${NO_VALUE} m/s`
}

export function breathFraction(state: PlayerState): number {
  if (!(state.maxBreath > 0)) return 0
  return state.breath / state.maxBreath
}

export interface HudModel {
  altitude: string
  airspeed: string
  /** 0 to 1. */
  breath: number
  showBreath: boolean
  /** 0 to 1. */
  health: number
  showHealth: boolean
}

/** Health is optional so the HUD still works anywhere combat is not running. */
export function hudModelFor(
  state: PlayerState,
  playerHealth?: { current: number; max: number },
): HudModel {
  const breath = breathFraction(state)
  const health = playerHealth && playerHealth.max > 0
    ? Math.max(0, Math.min(1, playerHealth.current / playerHealth.max))
    : 1
  return {
    altitude: formatAltitude(state.position.y),
    airspeed: formatAirspeed(state.velocity.length()),
    breath,
    // Keep the screen clean when the meter has nothing to say.
    showBreath: state.mode === 'glider' || breath < 1,
    health,
    // Health is a small pool, so showing it only once it matters keeps the screen
    // quiet while the player is exploring rather than fighting.
    showHealth: health < 1,
  }
}

const STYLE = `
.hud { position: fixed; inset: auto auto 20px 20px; color: #f3f6fb;
  font: 500 14px/1.4 system-ui, sans-serif; text-shadow: 0 1px 3px rgba(0,0,0,.6);
  pointer-events: none; }
.hud-readouts { display: flex; gap: 16px; margin-bottom: 8px; }
.hud-breath { width: 180px; height: 8px; border-radius: 4px;
  background: rgba(255,255,255,.22); overflow: hidden; transition: opacity .2s; }
.hud-breath-fill { height: 100%; width: 100%; background: linear-gradient(90deg,#8fd8ff,#d9f4ff);
  transform-origin: left center; }
.hud-health { width: 180px; height: 8px; border-radius: 4px; margin-bottom: 6px;
  background: rgba(255,255,255,.22); overflow: hidden; transition: opacity .2s; }
.hud-health-fill { height: 100%; width: 100%; background: linear-gradient(90deg,#ff8f6b,#ffd0a8);
  transform-origin: left center; }
`

export function createHud(parent: HTMLElement) {
  const style = document.createElement('style')
  style.textContent = STYLE
  document.head.append(style)

  const root = document.createElement('div')
  root.className = 'hud'
  root.innerHTML = `
    <div class="hud-readouts">
      <span data-altitude></span>
      <span data-airspeed></span>
    </div>
    <div class="hud-health"><div class="hud-health-fill"></div></div>
    <div class="hud-breath"><div class="hud-breath-fill"></div></div>
  `
  parent.append(root)

  const altitude = root.querySelector('[data-altitude]') as HTMLElement
  const airspeed = root.querySelector('[data-airspeed]') as HTMLElement
  const breathBar = root.querySelector('.hud-breath') as HTMLElement
  const breathFill = root.querySelector('.hud-breath-fill') as HTMLElement
  const healthBar = root.querySelector('.hud-health') as HTMLElement
  const healthFill = root.querySelector('.hud-health-fill') as HTMLElement

  return {
    update(model: HudModel): void {
      altitude.textContent = model.altitude
      airspeed.textContent = model.airspeed
      breathBar.style.opacity = model.showBreath ? '1' : '0'
      breathFill.style.transform = `scaleX(${model.breath})`
      healthBar.style.opacity = model.showHealth ? '1' : '0'
      healthFill.style.transform = `scaleX(${model.health})`
    },
    dispose(): void {
      root.remove()
      style.remove()
    },
  }
}
