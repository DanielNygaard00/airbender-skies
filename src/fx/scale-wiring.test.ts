import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { Object3D, Vector3 } from 'three'
import { DEFAULT_COMBAT_CONFIG } from '../combat/config'
import { DEFAULT_GROUND_CONFIG, DEFAULT_SLIPSTREAM_CONFIG } from '../core/config'
import { createGustCone } from './gust-cone'
import { createAimTell } from './aim-tell'
import { createSlipstreamTrail } from './slipstream-trail'
import { createVortexChargeTell } from './vortex-charge'
import { createWaterReach } from './water-reach'
import { createShockwave } from './shockwave'
import { createVortexRing } from './vortex-ring'
import { createIceShell } from './ice-shell'
import { createImpact } from './impact'
import { createStaffArc } from './staff-arc-fx'
import { createDashTrail } from './dash-trail'
import { createAirWallPanel } from './air-wall'
import { createSteam } from './steam'

/**
 * One invariant over the whole effects directory: no effect may hand the scene graph a scale that
 * is not a usable number, whatever nonsense reaches it.
 *
 * Written as a table here rather than as a NaN test inside each effect's own file, because the
 * claim is about the directory rather than about any one effect — the audit under "The scale
 * floors" in `HANDOFF.md` found that the per-effect version of this convention had drifted into
 * eight hand-written clamps, five identical sites with no clamp at all, and no test reaching any
 * of them. A single table is the thing that cannot drift quietly, and the coverage test at the
 * bottom makes it police itself: a new effect that imports `safeScale` without appearing here
 * fails rather than being silently uncovered.
 *
 * Each case drives its effect the way a NaN could actually arrive in the running game — a NaN
 * `dt` reaching `advance`, or a NaN in a config value — not by reaching inside and writing a
 * scale directly.
 */

const ORIGIN = new Vector3(1, 2, -3)
const NORTH = new Vector3(0, 0, -1)
const GUST = DEFAULT_COMBAT_CONFIG.gust
const WATER = DEFAULT_COMBAT_CONFIG.water
const VORTEX = DEFAULT_COMBAT_CONFIG.vortex
const AIR_WALL = DEFAULT_COMBAT_CONFIG.airWall
const OPENER = DEFAULT_COMBAT_CONFIG.staffArc.opener
const NAN = Number.NaN

interface Case {
  /** The module file this case covers, checked against the directory below. */
  module: string
  /** How the NaN gets in, named so a failure says which path broke. */
  path: string
  drive: () => Object3D
}

const CASES: Case[] = [
  {
    module: 'gust-cone.ts',
    path: 'a NaN dt into advance',
    drive: () => {
      const cone = createGustCone(ORIGIN, NORTH, GUST)
      cone.advance(NAN)
      return cone.object
    },
  },
  {
    module: 'aim-tell.ts',
    path: 'a NaN range in the shape it is handed each frame',
    drive: () => {
      const tell = createAimTell()
      tell.update(ORIGIN, NORTH, true, true, { ...GUST, range: NAN })
      return tell.object
    },
  },
  {
    module: 'slipstream-trail.ts',
    path: 'a NaN speed in the config',
    drive: () => createSlipstreamTrail(ORIGIN, NORTH, { ...DEFAULT_SLIPSTREAM_CONFIG, speed: NAN }).object,
  },
  {
    module: 'vortex-charge.ts',
    path: 'a NaN radius in the config',
    drive: () => {
      const tell = createVortexChargeTell()
      tell.update(1 / 60, VORTEX.minChargeSeconds, { ...VORTEX, minRadius: NAN, maxRadius: NAN })
      return tell.object
    },
  },
  {
    module: 'water-reach.ts',
    path: 'a NaN dt into advance',
    drive: () => {
      const reach = createWaterReach(ORIGIN, NORTH, 'grip', WATER)
      reach.advance(NAN)
      return reach.object
    },
  },
  {
    module: 'shockwave.ts',
    path: 'a NaN radius from the caller',
    drive: () => createShockwave(NAN, 1).object,
  },
  {
    module: 'vortex-ring.ts',
    path: 'a NaN radius from the caller',
    drive: () => createVortexRing(ORIGIN, NAN).object,
  },
  {
    module: 'ice-shell.ts',
    path: 'a NaN dt into advance, which is the only route to this one',
    drive: () => {
      const shell = createIceShell(ORIGIN, 1)
      shell.advance(NAN)
      return shell.object
    },
  },
  {
    module: 'impact.ts',
    path: 'a NaN dt into advance',
    drive: () => {
      const impact = createImpact(ORIGIN, 'hit')
      impact.advance(NAN)
      return impact.object
    },
  },
  {
    module: 'staff-arc-fx.ts',
    path: 'a NaN range in the arc shape',
    drive: () => createStaffArc(ORIGIN, NORTH, { ...OPENER, range: NAN }).object,
  },
  {
    module: 'dash-trail.ts',
    path: 'a NaN dashSpeed in the config, which trailLength divides',
    drive: () => createDashTrail(ORIGIN, NORTH, 1, { ...DEFAULT_GROUND_CONFIG, dashSpeed: NAN }).object,
  },
  {
    module: 'air-wall.ts',
    path: 'a NaN range in the config',
    drive: () => {
      const panel = createAirWallPanel()
      panel.update(1 / 60, true, ORIGIN, NORTH, { ...AIR_WALL, range: NAN })
      return panel.object
    },
  },
  {
    module: 'steam.ts',
    path: 'a NaN dt into advance',
    drive: () => {
      const steam = createSteam(ORIGIN)
      steam.advance(NAN)
      return steam.object
    },
  },
]

describe('no effect hands the scene graph an unusable scale', () => {
  for (const { module, path, drive } of CASES) {
    it(`survives ${path} in ${module}`, () => {
      const object = drive()
      // Every node, not just the one known to be scaled: an effect is free to rearrange its
      // children, and a test that reached for `children[1]` would stop covering the thing it
      // named. Default scales are 1, so the same bound holds for the unscaled nodes too.
      object.traverse((node) => {
        const where = `${module}: ${node.name || node.type}`
        for (const axis of ['x', 'y', 'z'] as const) {
          const value = node.scale[axis]
          expect(Number.isFinite(value), `${where} scale.${axis} is ${value}`).toBe(true)
          expect(value, `${where} scale.${axis} collapsed`).toBeGreaterThan(0)
        }
      })
    })
  }

  it('covers every module that clamps a scale', () => {
    // The table's own guard. Without this, adding a thirteenth effect that imports `safeScale`
    // would leave it uncovered here with nothing objecting — which is precisely how the previous
    // convention drifted: five sites structurally identical to clamped ones had no clamp, and no
    // test anywhere noticed. Reads the directory rather than a hand-kept list for the same reason
    // `mapping.test.ts` reads COMBAT_LEVELS rather than naming voices.
    const directory = fileURLToPath(new URL('.', import.meta.url))
    const clampers = readdirSync(directory)
      .filter((file) => file.endsWith('.ts') && !file.endsWith('.test.ts') && file !== 'scale.ts')
      .filter((file) => readFileSync(join(directory, file), 'utf8').includes("from './scale'"))
      .sort()

    expect(clampers).toEqual(CASES.map((one) => one.module).sort())
  })
})
