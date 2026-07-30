import {
  Mesh, PlaneGeometry, MeshBasicMaterial, CanvasTexture, RepeatWrapping,
  Vector3, DoubleSide, type Texture,
} from 'three'
import type { IslandDef } from './island'
import type { TerrainQuery } from '../core/types'
import { mulberry32 } from '../core/rng'

export interface WaterfallDef {
  islandId: string
  /** Radians around the island rim, measured from +X toward +Z. */
  angle: number
  width: number
  /** Metres of visible fall before it fades out. */
  length: number
}

/** How far in from the silhouette edge to hang the curtain, so it meets the rock. */
const RIM_INSET = 0.88
/** How far above the found ground the curtain starts, hiding the seam. */
const LIP_RAISE = 0.6
const TEXTURE_SIZE = 64
const SCROLL_SPEED = 1.4

/** Scrolling texture offset, wrapped so it never grows without bound. */
export function advanceScroll(offset: number, dt: number, speed: number): number {
  const next = (offset + dt * speed) % 1
  return next < 0 ? next + 1 : next
}

/**
 * Where the curtain hangs and which way it faces. Returns null when the rim
 * point has no ground under it, so a misplaced waterfall is dropped rather
 * than left hanging in mid-air.
 */
export function waterfallAnchor(
  island: IslandDef, def: WaterfallDef, terrain: TerrainQuery,
): { position: Vector3; rotationY: number } | null {
  const reach = island.radius * RIM_INSET
  const x = island.position.x + Math.cos(def.angle) * reach
  const z = island.position.z + Math.sin(def.angle) * reach

  const groundY = terrain.groundHeightAt(x, z)
  if (groundY === null) return null

  return {
    position: new Vector3(x, groundY, z),
    // Face outward, away from the island centre.
    rotationY: -def.angle + Math.PI / 2,
  }
}

/**
 * Vertical streaks generated in code rather than loaded, so the effect needs no
 * asset and no licence. Seeded, so it is reproducible.
 */
export function createWaterfallTexture(seed: number): CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = TEXTURE_SIZE
  canvas.height = TEXTURE_SIZE
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Could not get a 2D context for the waterfall texture')

  const random = mulberry32(seed)
  ctx.fillStyle = 'rgba(226, 244, 255, 0.30)'
  ctx.fillRect(0, 0, TEXTURE_SIZE, TEXTURE_SIZE)

  for (let i = 0; i < 26; i++) {
    const x = Math.floor(random() * TEXTURE_SIZE)
    const height = TEXTURE_SIZE * (0.3 + random() * 0.7)
    const y = random() * TEXTURE_SIZE
    ctx.fillStyle = `rgba(255, 255, 255, ${0.25 + random() * 0.5})`
    ctx.fillRect(x, y, 1 + Math.floor(random() * 2), height)
  }

  const texture = new CanvasTexture(canvas)
  texture.wrapS = RepeatWrapping
  texture.wrapT = RepeatWrapping
  return texture
}

/** A curtain of falling water, or null if it has nowhere to hang. */
export function createWaterfall(
  island: IslandDef, def: WaterfallDef, terrain: TerrainQuery,
): { mesh: Mesh; advance(dt: number): void } | null {
  const anchor = waterfallAnchor(island, def, terrain)
  if (!anchor) return null

  const geometry = new PlaneGeometry(def.width, def.length)
  const texture: Texture = createWaterfallTexture(island.noiseSeed)
  // Repeat vertically so the streaks tile as the offset scrolls.
  texture.repeat.set(1, Math.max(1, Math.round(def.length / def.width)))

  const material = new MeshBasicMaterial({
    map: texture, transparent: true, opacity: 0.55,
    side: DoubleSide, depthWrite: false,
  })

  const mesh = new Mesh(geometry, material)
  // The plane's origin is its centre, so drop it half its length to hang from the lip,
  // raised by LIP_RAISE above the found ground so the mesh overlaps the rock and hides the seam.
  mesh.position.set(
    anchor.position.x,
    anchor.position.y + LIP_RAISE - def.length / 2,
    anchor.position.z,
  )
  mesh.rotation.y = anchor.rotationY

  let offset = 0
  return {
    mesh,
    advance(dt: number): void {
      offset = advanceScroll(offset, dt, SCROLL_SPEED)
      texture.offset.y = -offset
    },
  }
}
