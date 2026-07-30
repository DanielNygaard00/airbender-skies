import { Vector3, Mesh, OctahedronGeometry, MeshBasicMaterial, Group } from 'three'
import { createRenderer, hasWebGL, showFallback, WEBGL_MESSAGE } from './core/renderer'
import { createStepper } from './core/loop'
import { InputTracker } from './core/input'
import { DEFAULT_FLIGHT_CONFIG, DEFAULT_GROUND_CONFIG } from './core/config'
import { loadSave, writeSave } from './core/save'
import { buildWorld, type World } from './world/world'
import { ARCHIPELAGO } from './world/levels/archipelago'
import { placeShrines, collectShrinesAt } from './world/shrine'
import { createPlayerState, spawnPointFor } from './player/state'
import { controllerStep, type ControllerDeps } from './player/controller'
import { applyShrineBonus } from './player/breath'
import { createAvatar } from './player/avatar'
import { animationFor } from './player/avatar-anim'
import { profileFor, desiredCameraPosition, smoothTowards, pullInForTerrain } from './camera/follow-cam'
import { createHud, hudModelFor } from './ui/hud'
import { createWindAudio } from './fx/audio'
import { fovForSpeed } from './fx/mapping'

function start(): void {
  if (!hasWebGL()) return showFallback(WEBGL_MESSAGE)

  const canvas = document.getElementById('game')
  if (!(canvas instanceof HTMLCanvasElement)) {
    return showFallback('Could not find the game canvas.')
  }

  let world: World
  try {
    world = buildWorld(ARCHIPELAGO)
  } catch (error) {
    return showFallback(`The level failed to load: ${(error as Error).message}`)
  }

  const { renderer, scene, camera } = createRenderer(canvas)
  scene.add(world.group)

  const save = loadSave(localStorage, DEFAULT_FLIGHT_CONFIG.baseMaxBreath)
  let player = createPlayerState(ARCHIPELAGO, world.terrain, save, DEFAULT_FLIGHT_CONFIG)
  let shrines = placeShrines(ARCHIPELAGO, world.terrain, save.collectedShrines)

  // Shrine markers: a spinning octahedron each, hidden once collected.
  const shrineGroup = new Group()
  const markers = new Map<string, Mesh>()
  for (const shrine of shrines) {
    const mesh = new Mesh(
      new OctahedronGeometry(1.2),
      new MeshBasicMaterial({ color: 0xd9f4ff }),
    )
    mesh.position.copy(shrine.position)
    mesh.visible = !shrine.collected
    markers.set(shrine.id, mesh)
    shrineGroup.add(mesh)
  }
  scene.add(shrineGroup)

  const avatar = createAvatar()
  scene.add(avatar.object)

  const input = new InputTracker(window, canvas)
  const hud = createHud(document.body)
  const wind = createWindAudio()
  canvas.addEventListener('click', () => wind.start(), { once: true })

  const deps: ControllerDeps = {
    terrain: world.terrain,
    flight: DEFAULT_FLIGHT_CONFIG,
    ground: DEFAULT_GROUND_CONFIG,
    worldFloorY: ARCHIPELAGO.worldFloorY,
    spawnPointFor: spawnPointFor(ARCHIPELAGO, world.terrain),
  }

  let cameraPosition = camera.position.clone()

  function update(dt: number): void {
    const state = input.sample()
    player = controllerStep(player, state, dt, deps)

    const collected = collectShrinesAt(shrines, player.position)
    if (collected.length > 0) {
      for (const id of collected) {
        const marker = markers.get(id)
        if (marker) marker.visible = false
      }
      shrines = shrines.map((s) => (collected.includes(s.id) ? { ...s, collected: true } : s))
      const bonus = collected.reduce(
        (acc) => applyShrineBonus(acc, DEFAULT_FLIGHT_CONFIG),
        { breath: player.breath, maxBreath: player.maxBreath },
      )
      player = { ...player, breath: bonus.breath, maxBreath: bonus.maxBreath }
      writeSave(localStorage, {
        collectedShrines: shrines.filter((s) => s.collected).map((s) => s.id),
        maxBreath: player.maxBreath,
      })
    }

    // Face the character along the kite forward, or along travel on foot.
    const facing = player.mode === 'kite'
      ? player.forward
      : new Vector3(player.velocity.x, 0, player.velocity.z)
    avatar.object.position.copy(player.position)
    if (facing.lengthSq() > 1e-4) {
      avatar.object.lookAt(player.position.clone().add(facing))
    }
    avatar.setAnimation(animationFor(player))
    avatar.update(dt)

    const profile = profileFor(player.mode)
    const desired = pullInForTerrain(
      player.position,
      desiredCameraPosition(player.position, state.lookDirection, profile),
      world.terrain,
    )
    cameraPosition = smoothTowards(cameraPosition, desired, profile.smoothing, dt)

    const airspeed = player.velocity.length()
    camera.position.copy(cameraPosition)
    camera.lookAt(player.position)
    camera.fov = player.mode === 'kite' ? fovForSpeed(airspeed) : fovForSpeed(0)
    camera.updateProjectionMatrix()

    for (const marker of markers.values()) marker.rotation.y += dt * 1.5

    wind.update(player.mode === 'kite' ? airspeed : 0)
    hud.update(hudModelFor(player))
  }

  const stepper = createStepper({ update, render: () => renderer.render(scene, camera) })

  let last = performance.now()
  function frame(now: number): void {
    stepper.advance((now - last) / 1000)
    last = now
    requestAnimationFrame(frame)
  }
  requestAnimationFrame(frame)
}

start()
