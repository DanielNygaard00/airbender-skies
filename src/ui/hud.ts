import type { PlayerState } from '../core/types'

/** Shown when a value is not finite, so the player never sees NaN. */
const NO_VALUE = '—'

/** The health bar's warm tint, reused so the HUD gains no new colour vocabulary. */
const STALL_COLOUR = '#ff8f6b'

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

/**
 * The Focus values the HUD draws, as plain fractions.
 *
 * Deliberately not the Focus and AvatarState structs themselves — the HUD has no
 * business knowing how the meter works, and the caller already has to divide.
 */
export interface FocusReadout {
  /** 0 to 1. */
  focus: number
  /** 0 to 1: progress toward arming the Avatar State. */
  avatarCharge: number
  avatarActive: boolean
}

/** Fractions arrive from a division, so a non-finite one must not reach the DOM. */
function fraction(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.min(1, value))
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
  /** 0 to 1. */
  focus: number
  showFocus: boolean
  /** 0 to 1: progress toward arming the Avatar State. */
  avatarCharge: number
  avatarActive: boolean
  /** 0 to 1: how hard the screen is flashing from a hit taken. */
  hurtFlash: number
  /** 0 to 1: how far below stall speed the glider is. Always 0 on foot. */
  stall: number
}

/**
 * Health and Focus are both optional so the HUD still works anywhere those systems
 * are not running.
 */
export function hudModelFor(
  state: PlayerState,
  playerHealth?: { current: number; max: number },
  focus?: FocusReadout,
  hurtFlash = 0,
  stall = 0,
): HudModel {
  const breath = breathFraction(state)
  const health = playerHealth && playerHealth.max > 0
    ? Math.max(0, Math.min(1, playerHealth.current / playerHealth.max))
    : 1
  const focusValue = fraction(focus?.focus ?? 0)
  const avatarActive = focus?.avatarActive ?? false
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
    focus: focusValue,
    // Quiet until the player has earned something, and never hidden mid-state: an
    // empty bar vanishing during the Avatar State would read as the HUD breaking.
    showFocus: focusValue > 0 || avatarActive,
    avatarCharge: fraction(focus?.avatarCharge ?? 0),
    avatarActive,
    hurtFlash: fraction(hurtFlash),
    stall: fraction(stall),
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
.hud-focus { width: 180px; height: 8px; border-radius: 4px; margin-bottom: 4px;
  background: rgba(255,255,255,.22); overflow: hidden; transition: opacity .2s; }
.hud-focus-fill { height: 100%; width: 100%;
  background: linear-gradient(90deg,#e6b23c,#ffe9a8); transform-origin: left center;
  transition: background .3s; }
.hud-focus.is-avatar .hud-focus-fill {
  background: linear-gradient(90deg,#fff3c4,#ffffff); }
.hud-arm { width: 180px; height: 3px; border-radius: 2px; margin-bottom: 6px;
  background: rgba(255,255,255,.15); overflow: hidden; transition: opacity .2s; }
.hud-arm-fill { height: 100%; width: 100%; background: #fff8dc;
  transform-origin: left center; }
.hud-vignette { position: fixed; inset: 0; pointer-events: none; opacity: 0;
  transition: opacity .35s; box-shadow: inset 0 0 180px 40px rgba(255,214,102,.55); }
.hud-vignette.is-on { opacity: 1; }
.hud-hurt { position: fixed; inset: 0; pointer-events: none; opacity: 0;
  box-shadow: inset 0 0 220px 60px rgba(198,40,40,.75); }
.hud-hint { margin-top: 8px; font-size: 12px; opacity: .45; }
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
    <div class="hud-focus"><div class="hud-focus-fill"></div></div>
    <div class="hud-arm"><div class="hud-arm-fill"></div></div>
    <div class="hud-health"><div class="hud-health-fill"></div></div>
    <div class="hud-breath"><div class="hud-breath-fill"></div></div>
    <div class="hud-hint">H — guide</div>
    <div class="hud-vignette"></div>
    <div class="hud-hurt"></div>
  `
  parent.append(root)

  const altitude = root.querySelector('[data-altitude]') as HTMLElement
  const airspeed = root.querySelector('[data-airspeed]') as HTMLElement
  const breathBar = root.querySelector('.hud-breath') as HTMLElement
  const breathFill = root.querySelector('.hud-breath-fill') as HTMLElement
  const healthBar = root.querySelector('.hud-health') as HTMLElement
  const healthFill = root.querySelector('.hud-health-fill') as HTMLElement
  const focusBar = root.querySelector('.hud-focus') as HTMLElement
  const focusFill = root.querySelector('.hud-focus-fill') as HTMLElement
  const armBar = root.querySelector('.hud-arm') as HTMLElement
  const armFill = root.querySelector('.hud-arm-fill') as HTMLElement
  const vignette = root.querySelector('.hud-vignette') as HTMLElement
  const hurt = root.querySelector('.hud-hurt') as HTMLElement

  return {
    update(model: HudModel): void {
      altitude.textContent = model.altitude
      airspeed.textContent = model.airspeed
      // Interpolated in the DOM rather than by swapping a class, so the warning arrives
      // gradually as airspeed decays instead of snapping on at a threshold — a stall is a
      // slide into trouble, and a binary light would misrepresent it.
      airspeed.style.color = model.stall > 0
        ? `color-mix(in srgb, #f3f6fb, ${STALL_COLOUR} ${Math.round(model.stall * 100)}%)`
        : ''
      breathBar.style.opacity = model.showBreath ? '1' : '0'
      breathFill.style.transform = `scaleX(${model.breath})`
      healthBar.style.opacity = model.showHealth ? '1' : '0'
      healthFill.style.transform = `scaleX(${model.health})`
      focusBar.style.opacity = model.showFocus ? '1' : '0'
      focusFill.style.transform = `scaleX(${model.focus})`
      focusBar.classList.toggle('is-avatar', model.avatarActive)
      // The pip only ever fills at maximum Focus, so its appearance is itself the
      // signal that the Avatar State is coming.
      armBar.style.opacity = model.avatarCharge > 0 && !model.avatarActive ? '1' : '0'
      armFill.style.transform = `scaleX(${model.avatarCharge})`
      vignette.classList.toggle('is-on', model.avatarActive)
      hurt.style.opacity = String(model.hurtFlash)
    },
    dispose(): void {
      root.remove()
      style.remove()
    },
  }
}
