import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { Box3, Mesh, MeshLambertMaterial, Quaternion, Vector3, type SkinnedMesh } from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js'
import {
  createEnemyView, clipForStance, windUpTimeScale, MODEL_FILE,
} from './enemy-mesh'
import { relightUnlitMaterials } from '../core/assets'
import { spawnEnemy, type Enemy, type EnemyKind, type Stance } from './enemy'
import { DEFAULT_COMBAT_CONFIG } from './config'

const KINDS: EnemyKind[] = ['spear', 'archer', 'heavy', 'nets']

function loadModel(kind: EnemyKind): Promise<GLTF> {
  const path = fileURLToPath(new URL(`../../public/models/${MODEL_FILE[kind]}`, import.meta.url))
  const bytes = readFileSync(path)
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
  return new Promise((resolve, reject) => {
    new GLTFLoader().parse(buffer, '', (gltf) => {
      // Through the same door main.ts uses, because the wind-up tint only reaches materials
      // that relighting has already turned into Lambert ones.
      relightUnlitMaterials(gltf)
      resolve(gltf)
    }, reject)
  })
}

function viewFor(kind: EnemyKind) {
  return createEnemyView(kind, DEFAULT_COMBAT_CONFIG.enemies[kind])
}

function enemyWith(kind: EnemyKind, over: Partial<Enemy> = {}): Enemy {
  const enemy = spawnEnemy(
    'e1', new Vector3(0, 0, 0), kind, DEFAULT_COMBAT_CONFIG.enemies[kind],
  )
  return { ...enemy, ...over }
}

const CAMERA = new Quaternion()

/** A health record at zero, which is what `isDowned` reads. */
const DOWNED = { current: 0, max: 3, sinceHit: 0 }

/** Every Lambert material on the view, which is what the wind-up tint writes to. */
function materialsOf(view: ReturnType<typeof viewFor>): MeshLambertMaterial[] {
  const found: MeshLambertMaterial[] = []
  view.object.traverse((node) => {
    const mesh = node as Mesh
    if (!mesh.isMesh || Array.isArray(mesh.material)) return
    if (mesh.material instanceof MeshLambertMaterial) found.push(mesh.material)
  })
  return found
}

describe('a soldier wearing a real model', () => {
  it('stands every kind at the placeholder capsule s height', async () => {
    // The capsule is 1.7 tall and every reach, lane height and health-bar offset in the fight
    // was authored against it, so a model that arrives at its own 3.0 units would be a soldier
    // whose head is where nothing expects it.
    for (const kind of KINDS) {
      const view = viewFor(kind)
      view.attachModel(await loadModel(kind))
      view.sync(enemyWith(kind), CAMERA, 0)
      view.update(0)
      view.object.updateMatrixWorld(true)

      const box = new Box3().setFromObject(view.object)
      // The health bar and pip hang above the body, so the top is not the soldier's head --
      // the floor is what this pins, plus that nothing is scaled to a wildly wrong size.
      expect(box.min.y).toBeCloseTo(0, 1)
      expect(box.max.y).toBeLessThan(3)
    }
  })

  it('gives each kind its own model rather than sharing one', async () => {
    // Casting, pinned: swapping two of these silently would put a bow on the heavy.
    expect(new Set(Object.values(MODEL_FILE)).size).toBe(KINDS.length)
  })

  it('clones the model, so two soldiers of a kind both have one', async () => {
    // REGRESSION: loadGLTF caches by URL and three of HOME_PATROL's seven soldiers are spears,
    // so both views are handed the very same GLTF. An Object3D has one parent, so attaching it
    // directly meant the second soldier stole the model and the first stood empty -- and
    // nothing would have thrown.
    const gltf = await loadModel('spear')
    const first = viewFor('spear')
    const second = viewFor('spear')
    first.attachModel(gltf)
    second.attachModel(gltf)

    const skinnedIn = (view: ReturnType<typeof viewFor>): number => {
      let count = 0
      view.object.traverse((node) => { if ((node as SkinnedMesh).isSkinnedMesh) count++ })
      return count
    }
    expect(skinnedIn(first)).toBeGreaterThan(0)
    expect(skinnedIn(second)).toBeGreaterThan(0)
    expect(skinnedIn(second)).toBe(skinnedIn(first))
  })

  it('clones materials, so one soldier winding up does not tint the rest', async () => {
    // REGRESSION, and the visible half of the sharing problem above: the wind-up telegraph
    // writes material.color, so two spear soldiers sharing one material both flashed orange
    // when either wound up.
    const gltf = await loadModel('spear')
    const winding = viewFor('spear')
    const calm = viewFor('spear')
    winding.attachModel(gltf)
    calm.attachModel(gltf)

    const calmBefore = materialsOf(calm).map((m) => m.color.getHex())
    winding.sync(enemyWith('spear', { stance: 'wind-up' }), CAMERA, 0)
    winding.update(0)

    expect(materialsOf(calm).map((m) => m.color.getHex())).toEqual(calmBefore)
    // And the one that is winding up did change, so this is not passing because nothing tints.
    const windingColours = materialsOf(winding).map((m) => m.color.getHex())
    expect(windingColours).not.toEqual(calmBefore)
  })

  it('puts the wind-up tint back when the wind-up ends', async () => {
    const view = viewFor('archer')
    view.attachModel(await loadModel('archer'))
    view.sync(enemyWith('archer'), CAMERA, 0)
    const resting = materialsOf(view).map((m) => m.color.getHex())

    view.sync(enemyWith('archer', { stance: 'wind-up' }), CAMERA, 0)
    expect(materialsOf(view).map((m) => m.color.getHex())).not.toEqual(resting)

    view.sync(enemyWith('archer', { stance: 'recover' }), CAMERA, 0)
    // The colours the model arrived wearing, not one shared base tint: these models are
    // textured, and flattening every material to one colour would erase the art permanently.
    expect(materialsOf(view).map((m) => m.color.getHex())).toEqual(resting)
  })

  it('leaves the rig unpitched when a model lies down, and pitches it without one', async () => {
    // The placeholder has no way to say "lying down" but to rotate the whole rig; a model holds
    // the end of its own Death clip instead, and pitching it as well would rotate a body that
    // is already flat.
    const withModel = viewFor('nets')
    withModel.attachModel(await loadModel('nets'))
    const downed = enemyWith('nets', { health: DOWNED, stance: 'downed' })
    withModel.sync(downed, CAMERA, 0)
    const rigOf = (view: ReturnType<typeof viewFor>) => {
      const rig = view.object.getObjectByName('rig')
      if (!rig) throw new Error('rig missing')
      return rig
    }
    expect(rigOf(withModel).rotation.x).toBe(0)

    const placeholder = viewFor('nets')
    placeholder.sync(downed, CAMERA, 0)
    expect(rigOf(placeholder).rotation.x).toBeCloseTo(Math.PI / 2, 6)
  })

  it('lays a downed model along the way it was facing', async () => {
    // The placeholder throws the yaw away, which is free for a capsule and wrong for a body.
    const view = viewFor('spear')
    view.attachModel(await loadModel('spear'))
    view.sync(
      enemyWith('spear', {
        health: DOWNED, stance: 'downed', facing: new Vector3(1, 0, 0),
      }),
      CAMERA, 0,
    )
    const rig = view.object.getObjectByName('rig')
    if (!rig) throw new Error('rig missing')
    expect(rig.rotation.y).toBeCloseTo(Math.PI / 2, 6)
  })

  it('drives the get-up from the simulation rather than from the clock', async () => {
    // `rising` is the simulation's own 0-to-1 progress, and the clip is held at the point it
    // names. So the animation cannot disagree with the sim about how far up the soldier is,
    // and running the mixer on does not carry the body past it.
    const view = viewFor('heavy')
    view.attachModel(await loadModel('heavy'))

    const rising = enemyWith('heavy', { health: DOWNED, stance: 'rising' })
    view.sync(rising, CAMERA, 0.25)
    view.update(0)
    view.object.updateMatrixWorld(true)
    const quarterUp = new Box3().setFromObject(view.object).max.y

    view.sync(rising, CAMERA, 0.25)
    for (let i = 0; i < 30; i++) view.update(1 / 60)
    view.object.updateMatrixWorld(true)
    expect(new Box3().setFromObject(view.object).max.y).toBeCloseTo(quarterUp, 6)
  })

  it('does not walk a soldier that is standing still', async () => {
    // END TO END through the view, because the movement fact is derived here rather than read
    // from the simulation: the view compares the position it is handed against the last one.
    const view = viewFor('spear')
    view.attachModel(await loadModel('spear'))
    const standing = enemyWith('spear')

    /**
     * How far apart the feet are. The observable has to be a bone: the view's bounding box is
     * dominated by the health bar and the mark pip, which hang at fixed heights above the body
     * and are identical whichever clip is running -- measuring `max.y` proves nothing, which is
     * how the first version of this test passed while asserting the opposite.
     */
    const feetApart = (): number => {
      view.object.updateMatrixWorld(true)
      const left = view.object.getObjectByName('FootL')
      const right = view.object.getObjectByName('FootR')
      if (!left || !right) throw new Error('foot bones missing')
      return left.getWorldPosition(new Vector3())
        .distanceTo(right.getWorldPosition(new Vector3()))
    }

    // Synced twice at the same place, which is what a soldier at its post looks like. Running
    // the mixer on must not carry it into a stride.
    view.sync(standing, CAMERA, 0)
    view.update(1 / 60)
    view.sync(standing, CAMERA, 0)
    for (let i = 0; i < 20; i++) view.update(1 / 60)
    const standingStride = feetApart()

    // Now actually moving, which has to look different.
    const moved = enemyWith('spear', { position: new Vector3(0, 0, 1) })
    view.sync(moved, CAMERA, 0)
    for (let i = 0; i < 20; i++) view.update(1 / 60)
    expect(feetApart()).not.toBeCloseTo(standingStride, 2)
  })

  it('keeps working when no model ever arrives', () => {
    // loadGLTF resolves null on failure, so this is the shipped behaviour on a 404 rather than
    // a hypothetical: the soldier has to stay a readable capsule with a moving prop.
    const view = viewFor('spear')
    view.sync(enemyWith('spear', { stance: 'wind-up' }), CAMERA, 0)
    const prop = view.object.getObjectByName('spear')
    if (!prop) throw new Error('prop missing')
    expect(Math.abs(prop.rotation.x)).toBeGreaterThan(0.3)
  })
})

describe('clipForStance', () => {
  it('covers every stance for every kind', () => {
    const stances: Stance[] = ['advance', 'wind-up', 'recover', 'downed', 'rising', 'held']
    for (const kind of KINDS) {
      for (const stance of stances) {
        expect(clipForStance(stance, kind, true)).toBeTruthy()
      }
    }
  })

  it('names a clip each kind actually ships', async () => {
    // The mapping is strings, so nothing but this stops a typo resolving to no clip at all --
    // and a missing clip does not throw, it silently leaves the previous pose up.
    const stances: Stance[] = ['advance', 'wind-up', 'recover', 'downed', 'rising', 'held']
    for (const kind of KINDS) {
      const gltf = await loadModel(kind)
      const available = new Set(gltf.animations.map((clip) => clip.name))
      for (const stance of stances) {
        expect(available).toContain(clipForStance(stance, kind, true))
      }
    }
  })

  it('gives each kind its own wind-up motion', () => {
    const windUps = KINDS.map((kind) => clipForStance('wind-up', kind, true))
    expect(new Set(windUps).size).toBe(KINDS.length)
  })

  it('stands still while advancing but not actually moving', () => {
    // REGRESSION: `advance` is the stance every soldier spawns in and returns to after each
    // attack, so it does not mean "walking". All seven of HOME_PATROL stand at their posts
    // until the player comes inside aggroRange -- and keyed on the stance alone, every one of
    // them walked on the spot from the moment the game loaded.
    for (const kind of KINDS) {
      expect(clipForStance('advance', kind, false)).toBe('Idle')
      expect(clipForStance('advance', kind, true)).toBe('Walk')
    }
  })

  it('opens up on recover rather than following through', () => {
    // The recover window is the punish window, so it has to read as open.
    for (const kind of KINDS) expect(clipForStance('recover', kind, true)).toBe('Idle')
  })
})

describe('windUpTimeScale', () => {
  it('makes the clip last exactly as long as the telegraph', () => {
    expect(windUpTimeScale(0.833, 0.55)).toBeCloseTo(1.5145, 4)
    expect(1 / windUpTimeScale(1.25, 0.8)).toBeCloseTo(0.64, 4)
  })

  it('fits every kind s real clip to its real window', async () => {
    // The point of deriving it: config.ts argues the heavy s 0.95 is "the game s most generous
    // telegraph" and the netter s 1.0 is "the longest telegraph in the game", and none of the
    // borrowed clips is naturally that long. Played raw, the animation would be telling the
    // player a different window from the one the simulation keeps.
    for (const kind of KINDS) {
      const gltf = await loadModel(kind)
      const name = clipForStance('wind-up', kind, true)
      const clip = gltf.animations.find((candidate) => candidate.name === name)
      if (!clip) throw new Error(`missing clip ${name} for ${kind}`)

      const windUpSeconds = DEFAULT_COMBAT_CONFIG.enemies[kind].windUpSeconds
      const scale = windUpTimeScale(clip.duration, windUpSeconds)
      // The clip, run at this speed, takes the telegraph's own time to the millisecond.
      expect(clip.duration / scale).toBeCloseTo(windUpSeconds, 6)
      // Refuses to pass vacuously: if a clip ever happened to match its window exactly the
      // scale would be 1 and this test would prove nothing, so record that none of them do.
      expect(scale).not.toBe(1)
    }
  })

  it('falls back to real time rather than dividing by zero', () => {
    expect(windUpTimeScale(0, 0.5)).toBe(1)
    expect(windUpTimeScale(1, 0)).toBe(1)
  })
})
