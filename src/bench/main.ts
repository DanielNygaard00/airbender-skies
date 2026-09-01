import { Vector3 } from 'three'
import { createPost } from '../core/post'
import { profileFor, isQuality, DEFAULT_QUALITY } from '../core/quality'
import { createRenderer, hasWebGL, showFallback, WEBGL_MESSAGE } from '../core/renderer'
import { enableShadows } from '../core/sun'
import { createEffectPool } from '../fx/effect-pool'
import { buildWorld } from '../world/world'
import { LEVELS } from '../world/levels'
import { runFixedClock } from './clock'
import { benchEffect } from './effects'
import { BENCH_SCENES, resolveBench } from './scenes'

/**
 * The bench's own entry point, deliberately separate from the game's.
 *
 * `main.ts` is 2280 lines and every render path in it runs through the player, the HUD, the
 * pause state and the input tracker. A bench branch inside it would either reuse that
 * machinery — and then the shot is not deterministic, because the player and the soldiers are
 * live — or add a second path through the largest file in the project. This shares the
 * modules that decide how things look and touches no gameplay code at all.
 *
 * **A fixed clock, not real frame time.** Every step of the simulation advances the effect by
 * exactly `STEP_SECONDS`, so the effect is at the identical point in its life in every
 * screenshot. With real frame time a fast machine and a slow one would photograph different
 * frames of the same animation.
 *
 * **The simulation runs synchronously, once, before the first render — it does not live
 * inside `requestAnimationFrame`.** It used to: each rAF callback added one `STEP_SECONDS` to
 * `elapsed`, fired the effect once `elapsed` reached `scene.fireAt`, and called
 * `pool.advance`. That works only for as long as `requestAnimationFrame` actually fires, and
 * in a hidden or backgrounded tab it never does — measured directly against the browser this
 * bench runs in: a promise waiting on the first rAF callback never resolved, through repeated
 * multi-second waits, with `document.hidden === true`. A clock driven by rAF in that state
 * never reaches `fireAt`, so the bench photographs the region, the light and the shadows with
 * no effect in them at all — a picture that is pixel-for-pixel what a compiled effect that
 * draws nothing would also produce, which is the one failure this bench exists to catch (see
 * the `..._pars_fragment` guard in `../fx/effect-material.ts`, and the shadow comment just
 * below on a claim that outlived the thing it claimed). Running the sim to completion in a
 * plain loop (`./clock.ts`'s `runFixedClock`) before the first `post.render` removes rAF from
 * the correctness path entirely: nothing here reads back anything a render produces, so
 * nothing needs the two interleaved, and a tab that never becomes visible until the shot is
 * taken still gets the whole simulation.
 *
 * The rejected alternatives both leave that failure mode intact rather than removing it:
 * waiting longer before shooting still depends on the tab having been visible at some point
 * during the wait, and requiring the pane to be visible before shooting depends on whoever
 * drives the bench remembering to check. Either way the bench's correctness would rest on
 * something no test can verify and no reader of a screenshot can see — which is exactly the
 * trap this bench exists to keep effects out of.
 *
 * The fixed step and the frame counts it produces are unchanged by any of this: every scene
 * still runs the exact number of `STEP_SECONDS` increments it always did, so the comments on
 * individual scenes about where their frozen frame lands in an effect's life (`gust`'s 0.1s
 * into its 0.22s `LIFETIME`, for instance) are still accurate.
 */
const STEP_SECONDS = 1 / 60

function tierFromSearch(search: string): ReturnType<typeof profileFor> {
  const raw = new URLSearchParams(search).get('quality')
  return profileFor(isQuality(raw) ? raw : DEFAULT_QUALITY)
}

function start(): void {
  const canvas = document.getElementById('game')
  if (!(canvas instanceof HTMLCanvasElement)) return
  if (!hasWebGL()) { showFallback(WEBGL_MESSAGE); return }

  const requested = resolveBench(window.location.search)
  if (!requested) {
    showFallback(
      `Add ?scene=<id> to this URL. Scenes: ${BENCH_SCENES.map((s) => s.id).join(', ')}.`,
    )
    return
  }
  // Rebound to a name whose type has no `null` in it: control-flow narrowing on `requested`
  // does not survive into `frame`, a nested function that outlives this check, so without
  // this the calls below would need a repeated guard or a non-null assertion on every use.
  const scene = requested

  const profile = tierFromSearch(window.location.search)
  const { renderer, scene: graph, camera, followSun, onResize } =
    createRenderer(canvas, profile, scene.elevation)
  const post = createPost(renderer, graph, camera, profile)
  // `main.ts` subscribes the same way, and for the same reason: `createRenderer` owns the one
  // `resize` listener, so a second listener here would race it — the composer resizing before
  // the renderer would size its targets to the previous frame's dimensions.
  //
  // This is no longer what keeps the composer correctly sized. `Post.render` re-checks its
  // buffers against the renderer's drawing buffer every frame and re-sizes itself when they
  // disagree, so a construction-time miss corrects itself on the next frame rather than
  // waiting for a resize event that a player may never generate. This subscription is now the
  // cheap path — it resizes once, on the event, instead of letting the next frame discover it.
  onResize((width, height) => post.setSize(width, height))

  const level = LEVELS.find((l) => l.id === scene.regionId)
  if (!level) { showFallback(`Bench scene "${scene.id}" names an unknown region.`); return }
  const world = buildWorld(level)
  graph.add(world.group)
  /*
   * Without this the bench has no shadows at all, and it took a review to notice: nothing in
   * `src/world/` sets `castShadow` or `receiveShadow`, so the flags come entirely from this
   * call, which `main.ts` makes and this file did not. Two things were broken by the omission.
   * The `light` scene's comment claimed the shadow direction was in frame when no shadow was;
   * and `shadowMapSize` — the most visible difference between the high and medium tiers, and
   * the one §8 of the design note nominates as the way to tell them apart — was invisible to
   * every bench shot, because a shadow map only shows up in a frame that has a shadow in it.
   */
  enableShadows(world.group)

  camera.position.copy(scene.camera.position)
  camera.lookAt(scene.camera.target)
  followSun(scene.camera.target)

  const pool = createEffectPool(graph)
  // Rebound the same way `scene` is above: the check happens here, but `benchEffect` is only
  // called from inside a callback `runFixedClock` may invoke later, and control-flow narrowing
  // on `scene.effect` would not survive into that separate function scope.
  const effectId = scene.effect
  runFixedClock(
    effectId === null ? null : scene.fireAt,
    scene.duration,
    STEP_SECONDS,
    () => {
      if (effectId === null) return
      pool.add(benchEffect(effectId, scene.camera.target.clone(), new Vector3(0, 0, -1)))
    },
    (dt) => pool.advance(dt),
  )

  function frame(): void {
    // The clock above already ran the whole simulation before this loop starts, so all this
    // does now is keep drawing — the window would otherwise go black the instant rAF stopped
    // being driven by anything, rather than holding the final frame.
    post.render(STEP_SECONDS)
    requestAnimationFrame(frame)
  }
  requestAnimationFrame(frame)
}

start()
