import { createRenderer, hasWebGL, showFallback, WEBGL_MESSAGE } from './core/renderer'
import { createStepper } from './core/loop'
import { buildWorld } from './world/world'
import { ARCHIPELAGO } from './world/levels/archipelago'
import { Vector3 } from 'three'

function start(): void {
  if (!hasWebGL()) {
    showFallback(WEBGL_MESSAGE)
    return
  }

  const canvas = document.getElementById('game')
  if (!(canvas instanceof HTMLCanvasElement)) {
    showFallback('Could not find the game canvas.')
    return
  }

  let world
  try {
    world = buildWorld(ARCHIPELAGO)
  } catch (error) {
    showFallback(`The level failed to load: ${(error as Error).message}`)
    return
  }

  const { renderer, scene, camera } = createRenderer(canvas)
  scene.add(world.group)

  // Temporary fixed vantage point. Task 15 replaces this with the follow camera.
  camera.position.set(160, 90, 200)
  camera.lookAt(new Vector3(0, 0, 0))

  const stepper = createStepper({
    update: () => {},
    render: () => renderer.render(scene, camera),
  })

  let last = performance.now()
  function frame(now: number): void {
    stepper.advance((now - last) / 1000)
    last = now
    requestAnimationFrame(frame)
  }
  requestAnimationFrame(frame)
}

start()
