import { describe, it, expect } from 'vitest'
import { Euler, Group, Mesh, MeshLambertMaterial, Object3D, Quaternion, Vector3 } from 'three'
import { createEnemyView } from './enemy-mesh'
import { spawnEnemy, hitEnemy, type Enemy, type EnemyKind, type Stance } from './enemy'
import { DEFAULT_COMBAT_CONFIG } from './config'

/**
 * A view for one kind, built against that kind's own shipped config.
 *
 * `createEnemyView` needs the config because the net thrower's throw lane is drawn at its real
 * `strikeRange`. Wrapped here rather than passed at each of the two dozen call sites below, so
 * a test that only cares about the rig does not have to say which reach it wants.
 */
const viewFor = (kind: EnemyKind) =>
  createEnemyView(kind, DEFAULT_COMBAT_CONFIG.enemies[kind])

const C = DEFAULT_COMBAT_CONFIG.enemies.spear
const CAMERA = new Quaternion().setFromEuler(new Euler(-0.4, 1.2, 0))
const enemyAt = (x: number, z: number): Enemy => spawnEnemy('a', new Vector3(x, 0, z), 'spear', C)
const damaged = (enemy: Enemy): Enemy => hitEnemy(enemy, C.maxHealth / 2, new Vector3())
const downed = (enemy: Enemy): Enemy => hitEnemy(enemy, C.maxHealth, new Vector3())

function child(view: { object: Object3D }, name: string): Object3D {
  const found = view.object.getObjectByName(name)
  if (!found) throw new Error(`expected a child named ${name}`)
  return found
}

/** The rig carries the rotation; the root carries only position. */
function rig(view: { object: Object3D }): Group {
  const found = child(view, 'rig')
  if (!(found instanceof Group)) throw new Error('expected the rig to be a Group')
  return found
}

function bodyColour(view: { object: Object3D }): number {
  const body = child(view, 'body')
  if (!(body instanceof Mesh)) throw new Error('expected the body to be a Mesh')
  return (body.material as MeshLambertMaterial).color.getHex()
}

describe('createEnemyView', () => {
  it('carries a health bar', () => {
    expect(viewFor('spear').object.getObjectByName('health-bar')).toBeDefined()
  })

  it('hides the bar on a downed enemy', () => {
    const view = viewFor('spear')
    view.sync(downed(enemyAt(0, 0)), CAMERA, 0)
    expect(child(view, 'health-bar').visible).toBe(false)
  })

  it('shows the bar on a damaged one', () => {
    const view = viewFor('spear')
    view.sync(damaged(enemyAt(0, 0)), CAMERA, 0)
    expect(child(view, 'health-bar').visible).toBe(true)
  })

  it('leaves the bar upright while the soldier turns', () => {
    // The whole reason the rig exists. If the bar were parented to the rotating root,
    // its world orientation would be the soldier's heading times the camera's, and it
    // would never actually face the camera.
    const view = viewFor('spear')
    const turned = { ...damaged(enemyAt(0, 0)), facing: new Vector3(1, 0, 0) }
    view.sync(turned, CAMERA, 0)
    const world = new Quaternion()
    child(view, 'health-bar').getWorldQuaternion(world)
    expect(world.angleTo(CAMERA)).toBeLessThan(1e-6)
  })

  it('stands the soldier at its own position', () => {
    const view = viewFor('spear')
    view.sync(enemyAt(3, -7), CAMERA, 0)
    expect(view.object.position.toArray()).toEqual([3, 0, -7])
  })

  it('turns the soldier to face its heading', () => {
    const view = viewFor('spear')
    view.sync({ ...enemyAt(0, 0), facing: new Vector3(1, 0, 0) }, CAMERA, 0)
    expect(rig(view).rotation.y).toBeCloseTo(Math.PI / 2, 5)
  })

  it('lays a downed soldier flat', () => {
    const view = viewFor('spear')
    view.sync(downed(enemyAt(0, 0)), CAMERA, 0)
    expect(rig(view).rotation.x).toBeCloseTo(Math.PI / 2, 5)
  })

  it('stands a living soldier upright', () => {
    const view = viewFor('spear')
    view.sync(enemyAt(0, 0), CAMERA, 0)
    expect(rig(view).rotation.x).toBeCloseTo(0, 5)
  })

  it('cocks the spear back on a wind-up and not otherwise', () => {
    // The dodge window depends on the player seeing this, so it is worth pinning.
    const view = viewFor('spear')
    const spear = child(view, 'spear')
    view.sync({ ...enemyAt(0, 0), stance: 'wind-up' }, CAMERA, 0)
    const winding = spear.rotation.x
    view.sync({ ...enemyAt(0, 0), stance: 'advance' }, CAMERA, 0)
    expect(winding).toBeLessThan(spear.rotation.x)
  })
})

describe('a soldier pushing back up', () => {
  const rising = (enemy: Enemy): Enemy => ({ ...downed(enemy), stance: 'rising' })

  it('lies flat at the start of the push-up', () => {
    const view = viewFor('spear')
    view.sync(rising(enemyAt(0, 0)), CAMERA, 0)
    expect(rig(view).rotation.x).toBeCloseTo(Math.PI / 2)
  })

  it('stands upright by the end of it', () => {
    const view = viewFor('spear')
    view.sync(rising(enemyAt(0, 0)), CAMERA, 1)
    expect(rig(view).rotation.x).toBeCloseTo(0)
  })

  it('is part way up in between', () => {
    const view = viewFor('spear')
    view.sync(rising(enemyAt(0, 0)), CAMERA, 0.5)
    const half = rig(view).rotation.x
    expect(half).toBeGreaterThan(0)
    expect(half).toBeLessThan(Math.PI / 2)
  })

  it('does not wear the wind-up colour', () => {
    // WINDUP is the dodge telegraph. Wearing it for a rise would teach the player to
    // dodge something that cannot hit them.
    const view = viewFor('spear')
    view.sync({ ...enemyAt(0, 0), stance: 'wind-up' }, CAMERA, 0)
    const windUpColour = bodyColour(view)
    view.sync(rising(enemyAt(0, 0)), CAMERA, 0.5)
    expect(bodyColour(view)).not.toBe(windUpColour)
  })

  it('rises whichever kind it is', () => {
    // The rise is driven by `rising` rather than by anything the prop knows about, so an
    // archer has to push up the same way. Cheap to state, and it is the one place the
    // two kinds could diverge without anything else in this file noticing.
    const view = viewFor('archer')
    const archer = spawnEnemy('a', new Vector3(), 'archer', DEFAULT_COMBAT_CONFIG.enemies.archer)
    const flat = hitEnemy(archer, DEFAULT_COMBAT_CONFIG.enemies.archer.maxHealth, new Vector3())
    view.sync({ ...flat, stance: 'rising' }, CAMERA, 0)
    expect(rig(view).rotation.x).toBeCloseTo(Math.PI / 2)
    view.sync({ ...flat, stance: 'rising' }, CAMERA, 1)
    expect(rig(view).rotation.x).toBeCloseTo(0)
  })
})

describe('the two kinds look different', () => {
  const ARCHER_CONFIG = DEFAULT_COMBAT_CONFIG.enemies.archer
  /** A bare archer in a given stance; position and facing don't matter to these tests. */
  const archerAt = (stance: Stance): Enemy => ({
    ...spawnEnemy('a', new Vector3(), 'archer', ARCHER_CONFIG),
    stance,
  })

  it('gives a spear soldier a spear and no bow', () => {
    // The pre-existing node name, which other tests in this file already find. It must
    // survive unchanged.
    const view = viewFor('spear')
    expect(view.object.getObjectByName('spear')).toBeTruthy()
    expect(view.object.getObjectByName('bow')).toBeFalsy()
  })

  it('gives an archer a bow and no spear', () => {
    const view = viewFor('archer')
    expect(view.object.getObjectByName('bow')).toBeTruthy()
    expect(view.object.getObjectByName('spear')).toBeFalsy()
  })

  it("telegraphs an archer's draw the same way a spear's thrust is telegraphed", () => {
    // The wind-up recolour is the existing tell and it must work for both, since it is
    // what the player's whole dodge window depends on seeing.
    const view = viewFor('archer')
    const body = view.object.getObjectByName('body') as Mesh
    const material = body.material as MeshLambertMaterial
    view.sync(archerAt('advance'), new Quaternion(), 0)
    const calm = material.color.getHex()
    view.sync(archerAt('wind-up'), new Quaternion(), 0)
    const drawing = material.color.getHex()
    expect(drawing).not.toBe(calm)
  })

  it('moves the bow on a draw', () => {
    const view = viewFor('archer')
    const bow = view.object.getObjectByName('bow') as Object3D
    view.sync(archerAt('advance'), new Quaternion(), 0)
    const calm = bow.rotation.x
    view.sync(archerAt('wind-up'), new Quaternion(), 0)
    // A real margin, not merely different: the draw has to be visible.
    expect(Math.abs(bow.rotation.x - calm)).toBeGreaterThan(0.3)
  })
})

describe('all four kinds are told apart by their prop', () => {
  /**
   * Which node name each kind carries, and — just as importantly — which it must not.
   *
   * A table rather than four pairs of assertions, so a fifth kind is one row and so the
   * "must not" half cannot be forgotten for one of them. The silhouette is what tells the
   * player which threat they are looking at, and two kinds answering to the same node name
   * would make a mesh test pass while the fight showed two identical soldiers.
   */
  const PROPS: Record<EnemyKind, string> = {
    spear: 'spear', archer: 'bow', heavy: 'shield', nets: 'net',
  }

  for (const [kind, prop] of Object.entries(PROPS) as [EnemyKind, string][]) {
    it(`gives a ${kind} soldier a ${prop} and nobody else's prop`, () => {
      const view = viewFor(kind)
      expect(view.object.getObjectByName(prop), `${kind} should carry a ${prop}`).toBeTruthy()
      for (const other of Object.values(PROPS)) {
        if (other === prop) continue
        expect(
          view.object.getObjectByName(other), `${kind} should not also carry a ${other}`,
        ).toBeFalsy()
      }
    })

    it(`telegraphs a ${kind} soldier's wind-up in the body colour`, () => {
      // The recolour is the shared dodge tell and the player's whole timing window depends on
      // seeing it, so it has to work for every kind rather than for the two that had it first.
      const view = viewFor(kind)
      const enemy = spawnEnemy('a', new Vector3(), kind, DEFAULT_COMBAT_CONFIG.enemies[kind])
      view.sync({ ...enemy, stance: 'advance' }, CAMERA, 0)
      const calm = bodyColour(view)
      view.sync({ ...enemy, stance: 'wind-up' }, CAMERA, 0)
      expect(bodyColour(view)).not.toBe(calm)
    })

    it(`moves a ${kind} soldier's prop visibly on a wind-up`, () => {
      // A real margin rather than merely a different number: a telegraph nobody can see at
      // distance is not a telegraph. The same 0.3 the archer's draw was held to.
      const view = viewFor(kind)
      const enemy = spawnEnemy('a', new Vector3(), kind, DEFAULT_COMBAT_CONFIG.enemies[kind])
      const held = child(view, PROPS[kind])
      view.sync({ ...enemy, stance: 'advance' }, CAMERA, 0)
      const calm = held.rotation.x
      view.sync({ ...enemy, stance: 'wind-up' }, CAMERA, 0)
      expect(Math.abs(held.rotation.x - calm)).toBeGreaterThan(0.3)
    })

    it(`lowers a downed ${kind} soldier's prop`, () => {
      // The downed branch resets `prop.rotation`, and `prop.rotation` is persistent mesh state:
      // without that line a body lies flat with its weapon still drawn at the angle the
      // interrupted telegraph left it, for the rest of the level.
      const view = viewFor(kind)
      const config = DEFAULT_COMBAT_CONFIG.enemies[kind]
      const enemy = spawnEnemy('a', new Vector3(), kind, config)
      const held = child(view, PROPS[kind])
      view.sync({ ...enemy, stance: 'wind-up' }, CAMERA, 0)
      expect(Math.abs(held.rotation.x)).toBeGreaterThan(0.3)
      view.sync(hitEnemy(enemy, config.maxHealth, new Vector3()), CAMERA, 0)
      expect(held.rotation.x).toBeCloseTo(0, 5)
    })

    it(`pushes a ${kind} soldier back up the same way`, () => {
      // Section 4.6's rise is driven by the `rising` argument rather than by anything the prop
      // knows about, so every kind has to do it. Cheap to state, and the one place four kinds
      // could diverge without anything else in this file noticing.
      const view = viewFor(kind)
      const config = DEFAULT_COMBAT_CONFIG.enemies[kind]
      const flat = hitEnemy(
        spawnEnemy('a', new Vector3(), kind, config), config.maxHealth, new Vector3(),
      )
      view.sync({ ...flat, stance: 'rising' }, CAMERA, 0)
      expect(rig(view).rotation.x).toBeCloseTo(Math.PI / 2)
      view.sync({ ...flat, stance: 'rising' }, CAMERA, 1)
      expect(rig(view).rotation.x).toBeCloseTo(0)
    })
  }

  it('wears a different body colour for the heavy than for everyone else', () => {
    // The armour has to be visible before the player throws a gust at it, not only after. The
    // three unarmoured kinds share one tint deliberately -- recolouring everybody would spend
    // the vocabulary on nothing -- so this is asserted as "the heavy differs from the others"
    // rather than "all four differ".
    const calm = (kind: EnemyKind) => {
      const view = viewFor(kind)
      const enemy = spawnEnemy('a', new Vector3(), kind, DEFAULT_COMBAT_CONFIG.enemies[kind])
      view.sync({ ...enemy, stance: 'advance' }, CAMERA, 0)
      return bodyColour(view)
    }
    expect(calm('heavy')).not.toBe(calm('spear'))
    expect(calm('heavy')).not.toBe(calm('archer'))
    expect(calm('heavy')).not.toBe(calm('nets'))
    // And the three that share a tint really do share it, so the line above is a statement about
    // the heavy rather than about four arbitrary colours.
    expect(calm('archer')).toBe(calm('spear'))
    expect(calm('nets')).toBe(calm('spear'))
  })

  it('keeps the heavy wearing its own colour while downed and while rising', () => {
    // `BASE_COLOUR[kind]` reaches all three branches of `sync`, not only the living one. A heavy
    // that reverted to leather the moment it fell over would tell the player the wrong thing
    // about the body they are standing next to and about to be gusted at again.
    const view = viewFor('heavy')
    const config = DEFAULT_COMBAT_CONFIG.enemies.heavy
    const enemy = spawnEnemy('a', new Vector3(), 'heavy', config)
    view.sync({ ...enemy, stance: 'advance' }, CAMERA, 0)
    const standing = bodyColour(view)
    const flat = hitEnemy(enemy, config.maxHealth, new Vector3())
    view.sync(flat, CAMERA, 0)
    expect(bodyColour(view)).toBe(standing)
    view.sync({ ...flat, stance: 'rising' }, CAMERA, 0.5)
    expect(bodyColour(view)).toBe(standing)
  })
})

describe("the net thrower's throw lane", () => {
  const NETS = DEFAULT_COMBAT_CONFIG.enemies.nets
  const netter = (over: Partial<Enemy> = {}): Enemy => ({
    ...spawnEnemy('a', new Vector3(), 'nets', NETS),
    ...over,
  })

  it('exists only for the kind that throws nets', () => {
    // A lane on a spear would be an aim tell for an attack that has no lane, and the player would
    // learn to read it as meaning something it does not.
    expect(viewFor('nets').object.getObjectByName('throw-lane')).toBeTruthy()
    for (const kind of ['spear', 'archer', 'heavy'] as const) {
      expect(viewFor(kind).object.getObjectByName('throw-lane'), kind).toBeFalsy()
    }
  })

  it('is hidden until the throw is wound up, and shown then', () => {
    // Both halves in one test, because either alone is unfalsifiable: a lane that is never shown
    // passes the hidden assertions and a lane that is always shown passes the shown one.
    const view = viewFor('nets')
    const lane = child(view, 'throw-lane')
    view.sync(netter({ stance: 'advance' }), CAMERA, 0)
    expect(lane.visible).toBe(false)
    view.sync(netter({ stance: 'wind-up' }), CAMERA, 0)
    expect(lane.visible).toBe(true)
    view.sync(netter({ stance: 'recover' }), CAMERA, 0)
    expect(lane.visible).toBe(false)
  })

  it('is hidden on a body and on one pushing back up', () => {
    // A lane hanging over a soldier on the ground is the worst failure this tell has: it promises
    // an attack from something that cannot attack. Both post-`isDowned` branches of `sync` return
    // early, which is exactly why the lane's visibility is decided above them.
    const view = viewFor('nets')
    const lane = child(view, 'throw-lane')
    const flat = hitEnemy(netter(), NETS.maxHealth, new Vector3())
    // Wound up first, so the lane was genuinely up before the down -- otherwise this passes for a
    // lane that is never shown at all.
    view.sync(netter({ stance: 'wind-up' }), CAMERA, 0)
    expect(lane.visible).toBe(true)
    view.sync(flat, CAMERA, 0)
    expect(lane.visible).toBe(false)
    view.sync({ ...flat, stance: 'rising' }, CAMERA, 0.5)
    expect(lane.visible).toBe(false)
  })

  it('points along the heading the net will actually be thrown on', () => {
    // The lane and the release read the same `facing`, so the drawn lane and the thrown net
    // cannot disagree. Two headings rather than one, since a lane frozen at its build rotation
    // would satisfy a single-heading assertion for whichever heading was tested.
    const view = viewFor('nets')
    const lane = child(view, 'throw-lane')
    view.sync(netter({ stance: 'wind-up', facing: new Vector3(1, 0, 0) }), CAMERA, 0)
    expect(lane.rotation.y).toBeCloseTo(Math.PI / 2, 5)
    view.sync(netter({ stance: 'wind-up', facing: new Vector3(0, 0, 1) }), CAMERA, 0)
    expect(lane.rotation.y).toBeCloseTo(0, 5)
  })

  it('stays flat on the ground when its owner is laid out flat', () => {
    // The reason the lane hangs off the root rather than the rig. The rig takes a quarter turn
    // about X when its owner goes down, which would stand a flat ground shape on its end -- the
    // mirror image of why the health bar is parented where it is.
    const view = viewFor('nets')
    const lane = child(view, 'throw-lane')
    view.sync(hitEnemy(netter(), NETS.maxHealth, new Vector3()), CAMERA, 0)
    expect(lane.rotation.x).toBeCloseTo(0, 6)
    // And the rig really did tip, so the line above is not passing because nothing rotated.
    expect(rig(view).rotation.x).toBeCloseTo(Math.PI / 2, 5)
  })

  it('is drawn at the reach the net actually has', () => {
    // A tell for a hit volume has to agree with the volume, the same rule `createAimTell` follows
    // for the player's own gust. Measured off the geometry rather than trusted, and compared
    // against the config rather than against a literal so retuning the throw moves the lane.
    const view = viewFor('nets')
    const lane = child(view, 'throw-lane')
    if (!(lane instanceof Mesh)) throw new Error('expected the lane to be a Mesh')
    lane.geometry.computeBoundingBox()
    const box = lane.geometry.boundingBox
    if (!box) throw new Error('expected the lane to have a bounding box')
    expect(box.max.z).toBeCloseTo(NETS.strikeRange, 5)
    // Starting at the thrower rather than floating out in front of it.
    expect(box.min.z).toBeCloseTo(0, 6)
    // Flat: a ground shape, not a wall.
    expect(box.max.y - box.min.y).toBeCloseTo(0, 6)
  })

  it('is kept out of the shadow pass, like every other tell in the game', () => {
    // `enableShadows` walks the whole view in `main.ts`, and a flat translucent overlay casting a
    // shadow would draw a hard dark wedge on the ground beside the one it is trying to describe.
    expect(child(viewFor('nets'), 'throw-lane').userData.excludeFromShadows).toBe(true)
  })
})

describe('a downed soldier drops whatever it was holding', () => {
  // The downed branch resets prop.rotation, and nothing covered it for either kind:
  // "lays a downed soldier flat" reads only rig.rotation.x, and the wind-up tests all
  // exercise the living branch. prop.rotation is persistent mesh state, so without that
  // line a body lies flat on the ground with its weapon still drawn, held at the angle
  // the interrupted telegraph left it at -- and it stays there for the rest of the level.
  //
  // Each test winds up first and asserts the prop actually moved, so a view that never
  // rotated the prop at all cannot pass this vacuously.
  const ARCHER_CONFIG = DEFAULT_COMBAT_CONFIG.enemies.archer

  it('lowers a downed spear', () => {
    const view = viewFor('spear')
    const spear = child(view, 'spear')
    view.sync({ ...enemyAt(0, 0), stance: 'wind-up' }, CAMERA, 0)
    expect(Math.abs(spear.rotation.x)).toBeGreaterThan(0.3)
    view.sync(downed(enemyAt(0, 0)), CAMERA, 0)
    expect(spear.rotation.x).toBeCloseTo(0, 5)
  })

  it('lowers a downed bow', () => {
    const view = viewFor('archer')
    const bow = child(view, 'bow')
    const archer = spawnEnemy('a', new Vector3(), 'archer', ARCHER_CONFIG)
    view.sync({ ...archer, stance: 'wind-up' }, CAMERA, 0)
    expect(Math.abs(bow.rotation.x)).toBeGreaterThan(0.3)
    view.sync(hitEnemy(archer, ARCHER_CONFIG.maxHealth, new Vector3()), CAMERA, 0)
    expect(bow.rotation.x).toBeCloseTo(0, 5)
  })
})
