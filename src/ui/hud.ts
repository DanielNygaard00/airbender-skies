import type { PlayerState } from '../core/types'

/** Shown when a value is not finite, so the player never sees NaN. */
const NO_VALUE = '—'

/**
 * The HUD's own text colour, and the base the airspeed readout mixes the stall warning into.
 *
 * Named because it is used twice: once in the stylesheet below and once in the `color-mix`
 * that reddens the airspeed. As a bare literal in both places, retuning `.hud` would leave
 * the airspeed snapping to the stale value the instant `stall` rose above 0 — the readout
 * would be a different white from everything beside it, for exactly as long as the wing was
 * slow.
 */
const HUD_TEXT_COLOUR = '#f3f6fb'
/** The health bar's warm tint, reused so the HUD gains no new colour vocabulary. */
const STALL_COLOUR = '#ff8f6b'

/**
 * The custom property `src/main.ts` writes the reduce-motion vignette scale into.
 *
 * Exported and imported rather than spelled out on both sides, because the failure mode is
 * silent in the worst direction: the rule below falls back through `var(..., 1)` to a
 * full-strength gold rim, so a typo on either side would leave reduce motion quietly not
 * softening the vignette, with nothing red and nothing visibly broken.
 *
 * Sharing the name does not make a typo a type error — `setProperty` takes any string — but
 * it does mean there is only one spelling in the codebase and the two sides cannot drift
 * apart. Which is more than `src/ui/pause-overlay.ts` can manage for the same hazard with
 * `.pause`/`is-on`, since a CSS selector cannot be shared this way and it has to settle for
 * a rename-both-together warning. So: rename this constant freely, inline it never.
 */
export const VIGNETTE_SCALE_PROPERTY = '--vignette-scale'

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

/**
 * Fire's charges, as the HUD draws them.
 *
 * An object rather than three more trailing parameters on `hudModelFor`, and that is a decision the
 * file's own warning forces: there are already three optional numbers in a row down there, and the
 * comment on them says outright that this is the shape where a caller silently swaps two. A fourth
 * and fifth number would join that queue; an object's fields cannot be transposed without a type
 * error.
 *
 * `active` is here rather than derived from a count, because "fire is selected" and "some charges are
 * missing" are two independent reasons to show the pips and the HUD's culture is to hide anything with
 * nothing to say — the same rule `showBreath` follows.
 */
export interface FireReadout {
  /** Charges in hand. */
  charges: number
  /** How many the player holds when full, so the HUD draws the right number of pips. */
  max: number
  /** Fire is the selected element, so the two bending keys spend these right now. */
  active: boolean
}

/** Fractions arrive from a division, so a non-finite one must not reach the DOM. */
function fraction(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.min(1, value))
}

/**
 * A pip count: a whole number, never negative, and zero for anything corrupt.
 *
 * The counting sibling of `fraction` above, and it exists for the same reason rather than for tidiness.
 * The view loops over these to build DOM nodes, so a fraction would draw a pip 2.4 pips wide, and the
 * obvious `Math.max(0, Math.floor(value))` does *not* handle a NaN — `Math.max(0, NaN)` is NaN, which
 * would reach `hud-fire` as a loop bound and draw nothing at all. Found by the test that asserts it,
 * which is why the guard is a named function instead of an inline clamp.
 *
 * Fails toward zero, the same direction `fraction` fails: a corrupt count reads as no charges, which
 * is what every gate in `fire.ts` also refuses on, so the widget and the rules fail the same way.
 */
function wholeCount(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) return 0
  return Math.max(0, Math.floor(value))
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
  /** 0 to 1: how black the full-screen overlay is. */
  fade: number
  /**
   * A net has the wings shut, so a `Space` press will not open them.
   *
   * A boolean rather than the remaining seconds, and that is a deliberate refusal to draw a
   * countdown. A shrinking bar would invite the player to stare at the HUD and wait, which is
   * the opposite of what the two seconds are for — they are meant to be spent moving, on foot,
   * getting out from under whatever is shooting. What the player needs to know is only "not
   * yet", and the tell disappearing is "now".
   *
   * Read straight off `PlayerState.tangled`, so this needs no extra argument to `hudModelFor`
   * and cannot disagree with the gate in `controller.ts` that actually refuses the deploy.
   */
  tangled: boolean
  /**
   * Fire charges in hand, and how many pips to draw for them.
   *
   * **A count and not a fraction, unlike every other resource in this model.** That is the owner's
   * ruling made structural: a fraction here would let a future edit draw a fourth bar without
   * anything objecting, and the whole argument for three discrete charges is that the player reads
   * a number at a glance rather than watching a level. Both values are integers clamped to sanity
   * by `hudModelFor`, so the view can loop over them without checking anything.
   */
  fireCharges: number
  maxFireCharges: number
  /**
   * Whether the pips are on screen at all.
   *
   * True while fire is selected, and *also* true whenever a charge is missing whatever element is
   * held — the same two-clause rule `showBreath` uses. A player who spent two charges and switched
   * to air still needs to know fire is nearly out, because the thing that gives them back is a
   * landing rather than a wait, and that is a decision about where to fly rather than about which
   * key to press.
   */
  showFireCharges: boolean
}

/**
 * **The payload deliberately adds nothing to this model, and that is a decision rather than an
 * omission.** Carrying something degrades flight three ways (`src/player/payload.ts`), so a
 * "CARRYING" label or a fourth bar is the obvious thing to reach for. Three reasons not to.
 *
 * The state is already on screen, continuously and in world space: the bundle is parented to
 * the avatar and the follow camera sits behind and above it, so unlike breath or Focus — which
 * have no representation anywhere but here — a carried payload is visible on every frame it is
 * carried, and a HUD element would restate what the player is already looking at.
 *
 * The consequences are already on screen too, in the elements that exist. The faster drain is
 * the breath bar emptying faster, and the guide's own Breath note names the payload as a cause
 * (`reference.ts`). The lost lift shows up in the altitude and airspeed readouts and, at the
 * limit, in the stall colour this file already mixes. A payload row would tell the player a
 * fact; the bars tell them the size of it.
 *
 * And this HUD's culture is to stay quiet: `showBreath`, `showHealth` and `showFocus` all hide
 * a bar that has nothing to say. A permanent element for a binary state that is visible in the
 * world would be the one thing here that is on screen without earning it.
 *
 * What the payload does need is *why*, and that is the guide's job rather than the HUD's — a
 * dimming row on `B` for the interaction, plus the two written notes. The trade being accepted
 * is real and worth stating: a player who never opens the guide learns the degradation by
 * feel, and the only thing pointing at its cause is the bundle they can see. If that proves
 * too subtle in play, the cheap answer is a one-shot line rather than a permanent element —
 * the fields to add would be a `payload: boolean` here and a rule beside `showBreath`.
 *
 * Health and Focus are both optional so the HUD still works anywhere those systems
 * are not running.
 */
export function hudModelFor(
  state: PlayerState,
  playerHealth?: { current: number; max: number },
  focus?: FocusReadout,
  // Three trailing optional numbers in a row, which is the shape where a caller
  // silently swaps two and nothing complains. The test file pins all three together
  // in one assertion for exactly that reason.
  hurtFlash = 0,
  stall = 0,
  fade = 0,
  // The one non-number in the trailing group, and deliberately so: see `FireReadout`. Optional like
  // the other two structs, so the HUD still works anywhere fire is not running.
  fire?: FireReadout,
): HudModel {
  const breath = breathFraction(state)
  const health = playerHealth && playerHealth.max > 0
    ? Math.max(0, Math.min(1, playerHealth.current / playerHealth.max))
    : 1
  const focusValue = fraction(focus?.focus ?? 0)
  const avatarActive = focus?.avatarActive ?? false
  // Whole pips, never negative, and the count never above the max: the view loops over these to build
  // DOM nodes, so an inverted pair would draw an empty row while the resource was live. Every gate in
  // `fire.ts` refuses at zero so nothing in the game can produce either; this is two comparisons
  // against a widget that silently stops reporting a resource.
  const maxFireCharges = wholeCount(fire?.max)
  const fireCharges = Math.min(maxFireCharges, wholeCount(fire?.charges))
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
    fade: fraction(fade),
    // `> 0` rather than a finiteness-guarded comparison, matching `isTangled`. A NaN fails this
    // and reads as free, which is the same direction the gate fails in — so the tell and the
    // gate cannot end up disagreeing about a corrupt value, which is the failure that would
    // actually confuse a player.
    tangled: state.tangled > 0,
    fireCharges,
    maxFireCharges,
    // Nothing at all when fire is not running: with no readout there are no pips to draw, which is
    // what keeps this file usable by a caller that has no element system.
    showFireCharges: maxFireCharges > 0 && ((fire?.active ?? false) || fireCharges < maxFireCharges),
  }
}

/**
 * Exported for one assertion, not for reuse: the vignette rule below is the only place in
 * this stylesheet whose deletion changes behaviour rather than looks, and it takes
 * `main.ts`'s reduce-motion softening with it without reddening anything.
 */
export const STYLE = `
.hud { position: fixed; inset: auto auto 20px 20px; color: ${HUD_TEXT_COLOUR};
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
/* Through a custom property, so reduce-motion can soften the gold rim without this file
   knowing what a setting is. main.ts writes it on the root element from
   motionScales(settings).vignette whenever the settings change; the 1 fallback is what
   makes the HUD correct on its own if nothing ever sets it. Softened rather than switched
   off, because this rim is how the player knows the Avatar State is running.

   The property name is interpolated from VIGNETTE_SCALE_PROPERTY, which main.ts writes
   through as well, precisely so it cannot be misspelled on one side only: that fallback is
   a convenience for a standalone HUD and a trap for a typo, since it would leave the rim at
   full strength under reduce motion with nothing to notice. Do not inline the name. */
.hud-vignette.is-on { opacity: var(${VIGNETTE_SCALE_PROPERTY}, 1); }
.hud-hurt { position: fixed; inset: 0; pointer-events: none; opacity: 0;
  box-shadow: inset 0 0 220px 60px rgba(198,40,40,.75); }
.hud-fade { position: fixed; inset: 0; background: #000; pointer-events: none;
  opacity: 0; }
/* The net's state tell. Above the readouts rather than below the bars, because it is a
   statement about what the player currently cannot do and belongs where the eye goes when
   something has gone wrong, not in the meter stack. Cool grey-blue to match the net's own
   colour in enemy-mesh.ts and the throw lane it was thrown down, and deliberately not the
   health bar's warm orange -- being grounded is not damage. */
.hud-tangled { display: inline-block; margin-bottom: 8px; padding: 2px 8px;
  border-radius: 4px; font-size: 12px; letter-spacing: .04em;
  background: rgba(159,182,196,.22); color: #d6e6f0; opacity: 0;
  transition: opacity .15s; }
/* Fire's charges. A row of pips rather than a bar, which is the owner's ruling and is the whole
   reason this rule looks nothing like .hud-breath: a bar invites the player to watch a level, and a
   count is read in a glance. Sized and spaced so three of them are countable in peripheral vision
   without being a fourth meter competing with the stack below.

   Above the readouts, beside the tangled tell rather than inside the meter stack, and for the same
   reason that one sits there: both are statements about what the player can and cannot do right now,
   where the bars below are quantities that drift. It also keeps the pips out of the run of three
   180px bars, so the eye does not read them as a fourth one that happens to be broken up.

   Orange-red, matching the element's badge dot and its burst cone, and deliberately not the health
   bar's pale salmon: the two are the only warm things in this corner, so fire is the saturated one. */
.hud-fire { display: flex; gap: 5px; align-items: center; margin-bottom: 8px;
  opacity: 0; transition: opacity .15s; }
.hud-fire-pip { width: 9px; height: 9px; border-radius: 50%;
  background: #ff5a2d; transition: background .12s, box-shadow .12s;
  box-shadow: 0 0 5px rgba(255,90,45,.55); }
/* A spent charge stays on screen as an empty socket rather than disappearing, so the row's length
   always says how many the player would have if they landed. A row that shrank would make "two left"
   and "two total" look identical. */
.hud-fire-pip.is-spent { background: rgba(255,255,255,.18); box-shadow: none; }
.hud-hint { margin-top: 8px; font-size: 12px; opacity: .45; }
/* The pause card (src/ui/pause-overlay.ts) repeats this same "H — guide" hint, and its
   backdrop is translucent rather than opaque, so without this rule the front door shows
   the hint twice at once. The alpha itself is deliberately not quoted here: it lives in the
   .pause rule's own background in that file, and a copy of the number in this comment would
   have nothing to catch it drifting from the one that actually renders.

   Narrow on purpose, and worth knowing where it does *not* apply. .pause.is-on is off
   whenever the guide is the pause reason -- pauseOverlayModel returns an invisible card
   there, since the guide is already a full-screen panel that says the game is paused -- so
   this rule never fires in the guide case. The guide's own backdrop is translucent too, not
   opaque, which leaves this hint faintly legible behind the panel. Pre-existing and
   cosmetic, and left alone rather than answered with a second rule keyed off the guide; the
   point of saying so is that a reader must not conclude from the rule above that the guide
   case is already covered. */
body:has(.pause.is-on) .hud-hint { visibility: hidden; }
`

export function createHud(parent: HTMLElement) {
  const style = document.createElement('style')
  style.textContent = STYLE
  document.head.append(style)

  const root = document.createElement('div')
  root.className = 'hud'
  root.innerHTML = `
    <div class="hud-tangled">Wings tangled</div>
    <!-- Empty: the pips are built on first sight from the model's own max, because how many
         charges the player has is config and this file must not carry a second copy of it. -->
    <div class="hud-fire"></div>
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
    <!-- Last, so the blackout covers the hurt flash and the vignette rather than
         letting a red pulse or a gold rim bleed through a screen that is meant to
         be fully black. -->
    <div class="hud-fade"></div>
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
  const fade = root.querySelector('.hud-fade') as HTMLElement
  const tangled = root.querySelector('.hud-tangled') as HTMLElement
  const fire = root.querySelector('.hud-fire') as HTMLElement

  /**
   * The pip elements, grown to the model's max on first sight and then reused.
   *
   * The same grow-and-reuse shape `element-radial.ts` uses for its wedges and
   * `hit-direction-view.ts` for its marks, and for the same reason: rebuilding the row every frame
   * would churn the DOM sixty times a second for a widget that toggles one class. Grown from the
   * model rather than from a constant here, so `maxCharges` lives in the combat config and nowhere
   * else.
   */
  const pips: HTMLElement[] = []

  function pipsFor(count: number): HTMLElement[] {
    while (pips.length < count) {
      const pip = document.createElement('div')
      pip.className = 'hud-fire-pip'
      fire.append(pip)
      pips.push(pip)
    }
    // Anything beyond the current max is hidden rather than removed, so a max that ever shrank
    // mid-session leaves no orphan on screen and no node to rebuild if it grows back.
    for (let i = count; i < pips.length; i++) pips[i]!.style.display = 'none'
    for (let i = 0; i < count; i++) pips[i]!.style.display = ''
    return pips
  }

  return {
    update(model: HudModel): void {
      altitude.textContent = model.altitude
      airspeed.textContent = model.airspeed
      // Interpolated in the DOM rather than by swapping a class, so the warning arrives
      // gradually as airspeed decays instead of snapping on at a threshold — a stall is a
      // slide into trouble, and a binary light would misrepresent it.
      airspeed.style.color = model.stall > 0
        ? `color-mix(in srgb, ${HUD_TEXT_COLOUR}, ${STALL_COLOUR} `
          + `${Math.round(model.stall * 100)}%)`
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
      fade.style.opacity = String(model.fade)
      // Opacity rather than `display`, so the badge fading in does not shift the readouts
      // beneath it every time a net lands.
      tangled.style.opacity = model.tangled ? '1' : '0'
      // Opacity for the row and a class per pip, for the same reason: the row appearing must not
      // shift the readouts under it every time the player flicks to fire and back.
      fire.style.opacity = model.showFireCharges ? '1' : '0'
      const row = pipsFor(model.maxFireCharges)
      for (let i = 0; i < model.maxFireCharges; i++) {
        row[i]!.classList.toggle('is-spent', i >= model.fireCharges)
      }
    },
    dispose(): void {
      root.remove()
      style.remove()
    },
  }
}
