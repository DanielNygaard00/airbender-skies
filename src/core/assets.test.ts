import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import {
  BoxGeometry, Group, Mesh, MeshBasicMaterial, MeshLambertMaterial, MeshStandardMaterial, Texture,
} from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js'
import { relightUnlitMaterials } from './assets'

const MODEL_PATH = fileURLToPath(new URL('../../public/models/character.glb', import.meta.url))

/** A GLTF-shaped object, which is all `relightUnlitMaterials` reads. */
function fakeGltf(scene: Group): GLTF {
  return { scene, animations: [] } as unknown as GLTF
}

function meshWith(material: Mesh['material']): Mesh {
  return new Mesh(new BoxGeometry(1, 1, 1), material)
}

describe('relightUnlitMaterials', () => {
  it('converts an unlit material to Lambert, carrying the texture across', () => {
    const map = new Texture()
    const mesh = meshWith(new MeshBasicMaterial({ map, color: 0x336699 }))
    const scene = new Group()
    scene.add(mesh)

    relightUnlitMaterials(fakeGltf(scene))

    // A thrown narrowing rather than only `toBeInstanceOf`, because the assertion does
    // not narrow the type and the two reads below need `map` and `color` to exist.
    const material = mesh.material
    if (!(material instanceof MeshLambertMaterial)) throw new Error('expected a Lambert material')
    // The texture is the art; losing it would leave a flat-coloured character.
    expect(material.map).toBe(map)
    expect(material.color.getHex()).toBe(0x336699)
  })

  it('disposes the material it replaces', () => {
    // The GLTF is cached and handed to every later caller, so the unlit original is
    // dropped on the floor rather than returned to anyone -- it has to be released.
    const basic = new MeshBasicMaterial()
    let disposed = false
    basic.addEventListener('dispose', () => { disposed = true })
    const scene = new Group()
    scene.add(meshWith(basic))

    relightUnlitMaterials(fakeGltf(scene))

    expect(disposed).toBe(true)
  })

  it('leaves materials that already respond to light alone', () => {
    // Not every model in the game is authored unlit, and re-materialising a lit one
    // would throw away whatever the author chose.
    const standard = new MeshStandardMaterial()
    const mesh = meshWith(standard)
    const scene = new Group()
    scene.add(mesh)

    relightUnlitMaterials(fakeGltf(scene))

    expect(mesh.material).toBe(standard)
  })

  it('leaves a multi-material mesh alone rather than lighting it in patches', () => {
    // Converting one slot and not its siblings would light part of a character and
    // not the rest, which is worse than leaving it consistently unlit.
    const materials = [new MeshBasicMaterial(), new MeshBasicMaterial()]
    const mesh = meshWith(materials)
    const scene = new Group()
    scene.add(mesh)

    relightUnlitMaterials(fakeGltf(scene))

    expect(mesh.material).toBe(materials)
  })

  it('leaves the committed character model lit rather than unlit', async () => {
    // END TO END, and the reason this file exists: the character pack marks every
    // material KHR_materials_unlit, which three.js honours with a MeshBasicMaterial.
    // Basic materials ignore lights entirely -- they do not darken on the shaded side
    // of an island, do not dim at dusk, and never receive a shadow however the flags
    // are set, so the character would read as a sticker on the screen.
    const bytes = readFileSync(MODEL_PATH)
    const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
    const gltf = await new Promise<GLTF>((resolve, reject) => {
      new GLTFLoader().parse(buffer, '', resolve, reject)
    })

    const before: string[] = []
    gltf.scene.traverse((node) => {
      const mesh = node as Mesh
      if (mesh.isMesh && !Array.isArray(mesh.material)) before.push(mesh.material.type)
    })
    // Refuses to pass vacuously: if the model ever ships without unlit materials this
    // test should be deleted, not silently succeed on an empty traversal.
    expect(before).toContain('MeshBasicMaterial')

    relightUnlitMaterials(gltf)

    const after: string[] = []
    let maps = 0
    gltf.scene.traverse((node) => {
      const mesh = node as Mesh
      if (!mesh.isMesh || Array.isArray(mesh.material)) return
      after.push(mesh.material.type)
      if ((mesh.material as MeshLambertMaterial).map) maps++
    })
    expect(after).not.toContain('MeshBasicMaterial')
    expect(new Set(after)).toEqual(new Set(['MeshLambertMaterial']))
    // The atlas survived on every mesh that had one.
    expect(maps).toBe(after.length)
  })
})
