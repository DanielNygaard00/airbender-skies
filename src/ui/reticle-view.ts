import type { ReticleModel } from './reticle'

/**
 * The aim reticle: a dot with a thin ring around it, drawn where the aim point projects to.
 *
 * Untested, like `createHud`, `createPauseOverlay` and `createGuide`: the test environment is
 * node, so there is no DOM to build against. Everything here that a test could catch already
 * lives in `src/ui/reticle.ts` — the NDC-to-viewport conversion, and the decision to hide the
 * reticle when the aim point is behind the camera or has no finite position, are pure and tested
 * there. What is left in this file is stylesheet and two `style` writes.
 */

/**
 * A viewport fraction as a CSS percentage, rounded to three decimals.
 *
 * A projected coordinate is a full-precision float, so the unrounded string is regularly
 * seventeen significant digits — `4.163336342344337e-17%` for an aim point dead centre — written
 * into the DOM once per rendered frame. Three decimals of a percent is a hundredth of a pixel on
 * any window anyone owns, so nothing visible is lost.
 *
 * It is *not* a correctness fix, and it is worth saying so because it looks like one: CSS numbers
 * accept exponent notation (`left: 1.2e-14%` was checked in a browser and both parsed and read
 * back intact), so the unrounded value was never invalid. If you are here because the reticle is
 * stuck horizontally while it still moves vertically, this function is not the cause — look for a
 * NaN in `ndc.x`, which a camera with a non-finite `aspect` produces while leaving `y` and `z`
 * alone. A 0×0 canvas is one way to get one. `reticleModel` now reports that model as invisible,
 * so reaching this function with a NaN would mean that check has been broken.
 */
function percent(fraction: number): string {
  return `${(fraction * 100).toFixed(3)}%`
}

/** The HUD's own text colour, so the reticle adds no new colour to the screen. */
const RETICLE_COLOUR = '#f3f6fb'
/**
 * The Focus bar's gold, reused for the hot state for the same reason.
 *
 * The whole game already spells "this is charged / this will land" in this colour — the Focus
 * fill, the arm pip, the Avatar State vignette — so a warm reticle needs no explaining.
 */
const HOT_COLOUR = '#ffe9a8'

/*
 * `left`/`top` in percent rather than pixels, because that is what a viewport fraction already
 * is: `reticleModel` hands over 0..1 from the top-left, so a percentage needs no window size
 * and cannot go stale across a resize the way a cached `innerWidth` would.
 *
 * The root is a zero-size point and the two rings are pulled onto it by negative margins, so
 * the point the model names is the reticle's centre rather than its top-left corner. Margins
 * rather than a `translate(-50%, -50%)`: `src/ui/hit-direction-view.ts` puts a rotation on its
 * own marks, and keeping centring out of `transform` entirely means neither file has a
 * transform that a future edit could overwrite from the other side.
 */
const STYLE = `
.reticle { position: fixed; left: 0; top: 0; width: 0; height: 0;
  /* Never interactive, like every other overlay in this project -- a click sink over the
     canvas would swallow the click that requests the pointer lock, which is how play
     resumes. Same reasoning as .pause and the guide panel. */
  pointer-events: none; }
.reticle-ring { position: absolute; left: 0; top: 0; width: 20px; height: 20px;
  margin: -10px 0 0 -10px; border-radius: 50%;
  border: 1px solid ${RETICLE_COLOUR}59; box-sizing: border-box;
  /* Both halves fade between the two states rather than snapping, so a target sliding out
     of the cone reads as leaving rather than as the HUD blinking. Colour only: there is no
     size, position or opacity change here, so this transition is not motion in the
     reduce-motion sense and is deliberately left unscaled. */
  transition: border-color .12s; }
.reticle-dot { position: absolute; left: 0; top: 0; width: 3px; height: 3px;
  margin: -1.5px 0 0 -1.5px; border-radius: 50%; background: ${RETICLE_COLOUR}d9;
  transition: background .12s; }
/* The one state change, and there are deliberately no per-move variants: four reticles for
   four moves is noise, and src/fx/gust-cone.ts already draws the real footprint when a gust
   fires. Colour and nothing else -- growing the ring would put motion in the one HUD element
   that sits under the player's eye the whole time. */
.reticle.is-hot .reticle-ring { border-color: ${HOT_COLOUR}d9; }
.reticle.is-hot .reticle-dot { background: ${HOT_COLOUR}; }
`

export function createReticle(parent: HTMLElement) {
  const style = document.createElement('style')
  style.textContent = STYLE
  document.head.append(style)

  const root = document.createElement('div')
  root.className = 'reticle'
  root.innerHTML = `
    <div class="reticle-ring"></div>
    <div class="reticle-dot"></div>
  `
  parent.append(root)

  return {
    update(model: ReticleModel): void {
      // `model.visible` is the whole test, and it covers more than the name suggests:
      // `reticleModel` answers false for a point outside the depth range *and* for a model
      // whose fractions are not finite, which a camera with a non-finite `aspect` produces
      // (an `ndc.x` of NaN while `y` and `z` stay finite — watched happening in this repo's
      // preview pane, whose canvas is 0×0 at load). That check deliberately does not have a
      // copy here. It used to, and moving it out is the point: it is a correctness rule about
      // what a placeable position is, this file cannot be tested in node, and `reticle.ts`
      // can and now pins it per component. A second copy in the untested layer would make
      // this file's own header — stylesheet plus two `style` writes — quietly untrue, and
      // would give the rule two homes that a future edit could move apart.
      //
      // `display`, not `opacity`: no position at all is not something to fade toward.
      //
      // Returning early leaves `left`, `top` and `is-hot` stale while hidden, which is safe and
      // is not the same thing as painting them stale: nothing paints between two statements of
      // one synchronous function, so the frame the reticle comes back is the frame all three are
      // rewritten, in this same call, before the browser looks at the tree again.
      root.style.display = model.visible ? 'block' : 'none'
      if (!model.visible) return
      root.style.left = percent(model.x)
      root.style.top = percent(model.y)
      root.classList.toggle('is-hot', model.hot)
    },
    /**
     * Take the reticle off screen without an aim point to report.
     *
     * Separate from `update` because the pause branch of `frame()` has no projected point to
     * pass — `syncVisuals` is what projects one, and it does not run while the game is
     * paused. The guide and the pause card own the screen then, and a reticle floating over
     * a settings panel is noise.
     */
    hide(): void {
      root.style.display = 'none'
    },
    dispose(): void {
      root.remove()
      style.remove()
    },
  }
}
