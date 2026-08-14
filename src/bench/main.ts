import { Vector3 } from 'three'
import { createPost } from '../core/post'
import { profileFor, isQuality, DEFAULT_QUALITY } from '../core/quality'
import { createRenderer, hasWebGL, showFallback, WEBGL_MESSAGE } from '../core/renderer'
import { createEffectPool } from '../fx/effect-pool'
import { createGustCone } from '../fx/gust-cone'
import { DEFAULT_COMBAT_CONFIG } from '../combat/config'
import { buildWorld } from '../world/world'
import { LEVELS } from '../world/levels'
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
 * **A fixed clock, not real frame time.** Every frame advances the effect by exactly
 * `STEP_SECONDS`, so the effect is at the identical point in its life in every screenshot.
 * With real frame time a fast machine and a slow one would photograph different frames of
 * the same animation.
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
  // `main.ts` subscribes the same way, and for the same reason: `createRenderer` already
  // called `resize()` once during its own construction, before `post` existed to hear it, so
  // `createPost`'s own initial sizing is the composer's only chance to be right until a real
  // resize happens. Without this the composer can be stuck at whatever size — including a
  // legitimately empty one, if the page had not finished laying out yet — that was current at
  // that single moment, for the life of the bench.
  onResize((width, height) => post.setSize(width, height))

  const level = LEVELS.find((l) => l.id === scene.regionId)
  if (!level) { showFallback(`Bench scene "${scene.id}" names an unknown region.`); return }
  graph.add(buildWorld(level).group)

  camera.position.copy(scene.camera.position)
  camera.lookAt(scene.camera.target)
  followSun(scene.camera.target)

  const pool = createEffectPool(graph)
  let elapsed = 0
  let fired = false

  function frame(): void {
    if (elapsed < scene.duration) {
      elapsed += STEP_SECONDS
      if (!fired && scene.effect === 'gust' && elapsed >= scene.fireAt) {
        fired = true
        pool.add(createGustCone(
          scene.camera.target.clone(),
          new Vector3(0, 0, -1),
          DEFAULT_COMBAT_CONFIG.gust,
        ))
      }
      pool.advance(STEP_SECONDS)
    }
    // Keeps drawing after the clock stops, so the window holds the final frame instead of
    // going black the moment the effect ends.
    post.render(STEP_SECONDS)
    requestAnimationFrame(frame)
  }
  requestAnimationFrame(frame)
}

start()
