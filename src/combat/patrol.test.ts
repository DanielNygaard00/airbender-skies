import { describe, it, expect } from 'vitest'
import { Vector3 } from 'three'
import { shouldRestorePatrol, type PatrolConfig } from './patrol'
import { spawnEnemy, type Enemy, type EnemyConfig } from './enemy'
import type { EnemySpawn } from './encounter'
import { DEFAULT_COMBAT_CONFIG, DEFAULT_PATROL_CONFIG } from './config'

const C: PatrolConfig = { respawnRange: 40 }

const ENEMY_CONFIG: EnemyConfig = {
  maxHealth: 1.5, outOfCombatSeconds: 6, regenPerSecond: 0,
  moveSpeed: 4.2, strikeRange: 3.2, aggroRange: 26, windUpSeconds: 0.55,
  recoverSeconds: 0.7, attack: { kind: 'melee', damage: 1 }, knockbackDamping: 2.6,
  gravity: 20, snapDistance: 1.2,
  downedSeconds: 18, risingSeconds: 1.2, recoveryHealthFractions: [0.6, 0.3],
}

// Spread far wider apart than respawnRange, so the two spawn points can actually
// disagree about whether the player has left. With them only 10 apart against a
// respawnRange of 40 there is no player position that is beyond one and inside the
// other, which makes `every` and `some` agree on every input this file can feed
// shouldRestorePatrol -- and the quantifier test below could not fail.
const SPAWNS: EnemySpawn[] = [
  { id: 'a', position: new Vector3(0, 0, 0), kind: 'spear' },
  { id: 'b', position: new Vector3(100, 0, 0), kind: 'spear' },
]

const standing = (): Enemy[] =>
  SPAWNS.map((s) => spawnEnemy(s.id, s.position, 'spear', ENEMY_CONFIG))

const allDowned = (): Enemy[] =>
  standing().map((e) => ({ ...e, health: { ...e.health, current: 0 }, stance: 'downed' as const }))

const far = new Vector3(0, 0, -200)
const near = new Vector3(0, 0, -5)

describe('when a patrol restores', () => {
  it('restores once everyone is down and the player has gone', () => {
    expect(shouldRestorePatrol(allDowned(), SPAWNS, far, C)).toBe(true)
  })

  it('does not restore while anyone is still standing', () => {
    const one = allDowned()
    const first = one[0]
    if (!first) throw new Error('fixture')
    expect(shouldRestorePatrol([first, ...standing().slice(1)], SPAWNS, far, C)).toBe(false)
  })

  it('does not restore while the player can still see the bodies', () => {
    expect(shouldRestorePatrol(allDowned(), SPAWNS, near, C)).toBe(false)
  })

  it('measures against every spawn point, not just the nearest', () => {
    // Standing beyond one spawn but close to the other must not restore, or a soldier
    // materialises behind the player.
    //
    // 70 units out along x: 70 from spawn 'a' at the origin, which is past respawnRange's
    // 40, but only 30 from spawn 'b' at x=100, which is inside it. That is the one shape
    // that separates `every` from `some` -- with `some` this restores, and soldier 'b'
    // appears 30 units from a player who never left it.
    const beyondOneOnly = new Vector3(70, 0, 0)
    expect(shouldRestorePatrol(allDowned(), SPAWNS, beyondOneOnly, C)).toBe(false)
  })

  it('does not restore an empty patrol', () => {
    // "Every enemy is downed" is vacuously true for an empty list, which would restore
    // on every frame forever.
    expect(shouldRestorePatrol([], SPAWNS, far, C)).toBe(false)
    expect(shouldRestorePatrol([], [], far, C)).toBe(false)
  })

  it('does not restore when there is nowhere to restore to', () => {
    expect(shouldRestorePatrol(allDowned(), [], far, C)).toBe(false)
  })

  it('ignores altitude, because flying over is not leaving', () => {
    // Horizontal distance only. That matches how stepEnemy measures a spear's aggroRange,
    // but not an archer's, which is 3D -- so this deliberately keeps a player hovering
    // 300 units up from counting as gone, and the safety of a restore rests on
    // respawnRange clearing every aggroRange rather than on the two agreeing.
    const overhead = new Vector3(0, 300, 0)
    expect(shouldRestorePatrol(allDowned(), SPAWNS, overhead, C)).toBe(false)
  })
})

describe('the shipped patrol tuning', () => {
  it('keeps the respawn range clear of every enemy notice range, by a real margin', () => {
    // Both config.ts and patrol.ts call this gap load-bearing: a fresh soldier must
    // never appear already inside its own notice range, or the player turns around into
    // a fight that spawned on top of them. Nothing pinned it until now, so either value
    // could be retuned into the other's territory without a test objecting.
    //
    // Asserted as a relationship with a margin rather than against the literals 40 and
    // 26, so retuning either one for feel stays free as long as the gap survives. The
    // margin has to leave room for the restore frame itself: a restore fires the instant
    // the player passes respawnRange, and the player can be walking back in, so "just
    // outside aggroRange" is not enough separation.
    //
    // Iterated over every kind in DEFAULT_COMBAT_CONFIG.enemies rather than pinned to
    // `.spear`, because that literal is exactly what broke this test once already: when
    // CombatConfig.enemy became a per-kind Record, a mechanical rename inserted `.spear.`
    // here, and the archer -- at 48, wider than the spear's 26 -- became invisible to it.
    // A respawnRange of 40 shipped against an archer of 48 with nothing objecting. Keying
    // off the Record means a future third kind is covered automatically, without needing
    // this test edited again.
    for (const [kind, enemy] of Object.entries(DEFAULT_COMBAT_CONFIG.enemies)) {
      expect(DEFAULT_PATROL_CONFIG.respawnRange, `kind: ${kind}`)
        .toBeGreaterThan(enemy.aggroRange * 1.3)
    }
  })
})
