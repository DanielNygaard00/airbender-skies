import { Vector3, Mesh, OctahedronGeometry, MeshBasicMaterial, Group } from 'three'
import { createRenderer, hasWebGL, showFallback, WEBGL_MESSAGE } from './core/renderer'
import { createStepper } from './core/loop'
import { InputTracker } from './core/input'
import { DEFAULT_FLIGHT_CONFIG, DEFAULT_GROUND_CONFIG } from './core/config'
import { loadSave, writeSave } from './core/save'
import { loadGLTF } from './core/assets'
import { buildWorld, type World } from './world/world'
import { ARCHIPELAGO } from './world/levels/archipelago'
import { placeShrines } from './world/shrine'
import { windSampler } from './world/wind'
import { createWindTell } from './world/wind-tell'
import { startEncounter, stepEncounter } from './combat/encounter'
import { DEFAULT_COMBAT_CONFIG, HOME_PATROL } from './combat/config'
import { createEnemyView } from './combat/enemy-mesh'
import { createWaterfall } from './world/waterfall'
import { createPlayerState, spawnPointFor } from './player/state'
import { controllerStep, type ControllerDeps } from './player/controller'
import { collectStep } from './player/shrine-collect'
import { enableShadows } from './core/sun'
import { createAvatar } from './player/avatar'
import { createGlider } from './player/glider'
import { animationFor, chargeSquashScale } from './player/avatar-anim'
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

  const { renderer, scene, camera, followSun } = createRenderer(canvas)
  scene.add(world.group)
  enableShadows(world.group)

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

  const waterfalls: { advance(dt: number): void }[] = []
  for (const def of ARCHIPELAGO.waterfalls) {
    const island = ARCHIPELAGO.islands.find((i) => i.id === def.islandId)
    if (!island) continue
    const waterfall = createWaterfall(island, def, world.terrain)
    if (!waterfall) {
      console.warn(
        `Dropped waterfall on island "${def.islandId}" at angle ${def.angle}: no ground found ` +
        'at any rim inset.',
      )
      continue
    }
    scene.add(waterfall.mesh)
    waterfalls.push(waterfall)
  }

  // A wind feature the player cannot see is a bug, so each one is given its tell.
  const windTells = (ARCHIPELAGO.winds ?? []).map((def) => {
    const tell = createWindTell(def)
    scene.add(tell.object)
    return tell
  })

  // The one encounter: spear infantry on the home island.
  let encounter = startEncounter(
    HOME_PATROL.map((spawn) => ({
      ...spawn,
      // Dropped onto the ground rather than trusting the authored y.
      position: spawn.position.clone().setY(
        world.terrain.groundHeightAt(spawn.position.x, spawn.position.z) ?? spawn.position.y,
      ),
    })),
    DEFAULT_COMBAT_CONFIG,
  )
  const enemyViews = new Map(encounter.enemies.map((enemy) => {
    const view = createEnemyView()
    scene.add(view.object)
    enableShadows(view.object)
    return [enemy.id, view] as const
  }))

  const avatar = createAvatar()
  scene.add(avatar.object)

  const glider = createGlider()
  // A child of the avatar, so it inherits the character's position and facing.
  avatar.object.add(glider.object)

  // BASE_URL, not a bare absolute path: vite.config.ts sets base to
  // '/airbender-skies/' for GitHub Pages, so "/models/..." would resolve in dev
  // and 404 only on the deployed site. Fire-and-forget on purpose — loadGLTF
  // resolves null instead of rejecting, so a missing file leaves the placeholder
  // standing and the game still starts.
  void loadGLTF(`${import.meta.env.BASE_URL}models/character.glb`).then((gltf) => {
    if (!gltf) return
    avatar.attachModel(gltf)
    // The model's meshes arrive after the first frame, so they miss the initial pass.
    enableShadows(avatar.object)
  })

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
    windAt: windSampler(ARCHIPELAGO.winds ?? []),
  }

  let cameraPosition = camera.position.clone()

  function update(dt: number): void {
    const state = input.sample()
    player = controllerStep(player, state, dt, deps)

    const collection = collectStep(player, shrines, DEFAULT_FLIGHT_CONFIG)
    if (collection.collected.length > 0) {
      player = collection.player
      shrines = collection.shrines
      for (const id of collection.collected) {
        const marker = markers.get(id)
        if (marker) marker.visible = false
      }
      writeSave(localStorage, {
        collectedShrines: shrines.filter((s) => s.collected).map((s) => s.id),
        maxBreath: player.maxBreath,
      })
    }

    // Face the character along the glider forward, or along travel on foot.
    const facing = player.mode === 'glider'
      ? player.forward
      : new Vector3(player.velocity.x, 0, player.velocity.z)
    avatar.object.position.copy(player.position)
    if (facing.lengthSq() > 1e-4) {
      avatar.object.lookAt(player.position.clone().add(facing))
    }
    avatar.setAnimation(animationFor(player))
    avatar.setSquash(chargeSquashScale(player, deps.ground))
    followSun(player.position)
    avatar.update(dt)
    glider.update(dt, player.mode === 'glider')

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
    camera.fov = player.mode === 'glider' ? fovForSpeed(airspeed) : fovForSpeed(0)
    camera.updateProjectionMatrix()

    for (const marker of markers.values()) marker.rotation.y += dt * 1.5
    for (const waterfall of waterfalls) waterfall.advance(dt)
    for (const tell of windTells) tell.advance(dt)

    const fight = stepEncounter(encounter, {
      playerPosition: player.position,
      playerForward: player.forward,
      gustPressed: state.gustPressed,
    }, dt, DEFAULT_COMBAT_CONFIG)
    encounter = fight.encounter
    for (const enemy of encounter.enemies) enemyViews.get(enemy.id)?.sync(enemy)

    wind.update(player.mode === 'glider' ? airspeed : 0)
    hud.update(hudModelFor(player, encounter.playerHealth))
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
