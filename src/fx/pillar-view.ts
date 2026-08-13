import {
  CylinderGeometry, Mesh, MeshLambertMaterial, Vector3,
  type MeshLambertMaterialParameters, type Object3D,
} from 'three'
import type { Pillar } from '../combat/earth'

/**
 * One raised pillar, drawn.
 *
 * **Persistent rather than a one-shot `Effect`, and that is a correctness decision rather than a
 * stylistic one.** Every other bending tell in this directory is a pooled `Effect`, and a pillar
 * cannot be: `createEffectPool` caps itself at 24 live effects and evicts **oldest first**, so a
 * six-second pillar is by a wide margin the oldest thing in the pool and would be the first thing
 * thrown away by a busy exchange. The rock would vanish while it was still stopping arrows, which
 * is the worst failure this object can have — invisible cover is cover the player walks out from
 * behind. `createArrowView` is shaped this way for the same family of reason, and its comment says
 * the equivalent thing about arrows.
 *
 * So the pillar is drawn the way the arrows and the soldiers are drawn: one view per record, keyed
 * by id, created on first sight and disposed when the record is gone. The fight's own
 * `Pillar.secondsLeft` is then the single authority on how long the rock exists, in the mechanic
 * and on screen at once, which is the property `ice-shell.ts` argues for at length under a
 * different name.
 *
 * **Depth-tested and shaded, unlike everything else here.** The other files in `src/fx/` draw
 * attack tells — statements about where a move reached, deliberately painted over the world so
 * terrain cannot bury them. A pillar is not a tell. It is a solid object that the player has to
 * judge distances against and stand behind, so it is lit like the props and the arrows, and it is
 * occluded by the hill in front of it exactly as a real rock would be. Drawn over the world it
 * would be the one object in the game visible through terrain, which for a thing whose whole job
 * is blocking line of sight would be actively misleading.
 */
export interface PillarView {
  object: Object3D
  update(pillar: Pillar): void
  dispose(): void
}

/**
 * A sandstone that reads as bent earth rather than as architecture.
 *
 * **Measured in a browser rather than chosen, and the first two attempts were both wrong.** The
 * reach effect is an unlit `MeshBasicMaterial` painted at exactly the tint it is given; this is a
 * `MeshLambertMaterial` that the light then multiplies, so the same hex is two different colours and
 * the lit one is always darker. `0xe0ae78` — a value that looks like sandstone written down — rendered
 * as a muddy chocolate brown against the archipelago's pale green, close enough to `props.ts`'s
 * `TRUNK_BROWN` of `0x6b4f35` that a raised rock read as a tree stump. Correcting it by
 * desaturating instead (`0xd9c9a3`) went the other way and produced a grey-khaki that drifted
 * toward the terrain green — the exact invisibility hazard `gust-cone.ts` records its first
 * pale-blue pass falling into.
 *
 * This is brighter and still warm, which separates from the green, from the sky and from the trees
 * at once. It stays clear of the golds — the Focus bar's `#e6b23c`, the hot reticle's `#ffe9a8`, the
 * aura's `0xfff3c4` — by being a good deal less yellow, and it is in a different part of the screen
 * from all three in any case: those are thin HUD marks and this is a solid object in the world.
 */
const TINT = 0xf2b877

/**
 * The material settings, hoisted out so they can be asserted on.
 *
 * Exported rather than read back off the built material, for the reason `SHAFT_MATERIAL_OPTIONS`
 * in `arrow.ts` is: `Material`'s constructor backfills every option it was not given, so
 * `depthTest` reads as `true` whether or not this file asks for it and deleting the line would
 * leave a test green. Read off this object instead, a removed key is `undefined`, which fails.
 */
export const PILLAR_MATERIAL_OPTIONS: MeshLambertMaterialParameters = {
  color: TINT,
  // Depth-tested, unlike the attack tells in this directory. See the interface comment: an object
  // that stops arrows must not be the one thing in the game you can see through a hill.
  depthTest: true,
}

/**
 * How long the rock takes to rise into place, and to sink back out of it, in seconds.
 *
 * One constant for both ends, because they are the same motion read in two directions and a rock
 * that came up faster than it went down would be saying something about itself that is not true.
 *
 * **The mechanic leads the visual at both ends, and that is the safe direction of the two.** The
 * fight blocks arrows for exactly `Pillar.secondsLeft`, and the rock spends the first and last
 * sixth of a second of that partway out of the ground — so for a handful of frames the cover is
 * very slightly better than it looks, and never once worse. The alternative at the near end —
 * blocking only after the rock had finished rising — would be cover that fails on the frame the
 * player raised it *for*, which is the frame an arrow is already in the air. `ice-shell.ts` makes
 * the same choice in its own terms by adding its melt after the hold rather than taking it out of
 * the hold: where a tell and a mechanic cannot be exactly simultaneous, the tell must never claim
 * more than the mechanic is doing.
 *
 * The sink matters as much as the rise, and not only for looks. A rock that blinked out of
 * existence would give the player no warning that cover was ending, and cover ending is the
 * moment they most need to be moving already. Sinking over the last sixth of a second is the
 * warning, and it finishes exactly as the block does.
 *
 * Short enough to be a punch of rock rather than an elevator.
 */
const RISE_SECONDS = 1 / 6

/**
 * How many radial segments the shaft gets.
 *
 * Seven, and odd on purpose: an even count gives a cylinder two exactly parallel flat faces, and at
 * this radius that reads as a machined column — which is what the *decorative* temple pillars in
 * `props.ts` are, built with six. An odd count breaks the symmetry so a bent rock does not look
 * like architecture standing next to architecture.
 */
const SEGMENTS = 7

export function createPillarView(pillar: Pillar): PillarView {
  // Built at the record's own radius and height rather than from the config, because the record
  // carries the shape it was raised with — see `Pillar.radius`. A view that read the config would
  // draw a different rock than the one blocking arrows the moment either number was retuned.
  //
  // Slightly tapered, wider at the base, so it reads as pushed up out of the ground rather than
  // dropped in. The taper is inside the collision radius at the top and outside it at the bottom,
  // which is the honest way round: the part of the rock that matters for cover is the part in front
  // of the player's chest, and that is nearer the middle.
  const geometry = new CylinderGeometry(
    pillar.radius * 0.86, pillar.radius * 1.08, pillar.height, SEGMENTS,
  )
  // The cylinder is authored centred on its own origin, so lift it by half its height to seat the
  // base on the ground the record names.
  geometry.translate(0, pillar.height / 2, 0)
  const material = new MeshLambertMaterial(PILLAR_MATERIAL_OPTIONS)
  const mesh = new Mesh(geometry, material)
  mesh.name = 'pillar'

  // Reused rather than allocated, since this runs every frame for every standing pillar.
  const seated = new Vector3()

  /**
   * The pillar's whole life, captured once, so elapsed time can be recovered from `secondsLeft`.
   *
   * The view therefore holds no clock of its own and cannot drift from the fight — the same reason
   * `createArrowView` reads a position off the record every frame instead of integrating one. It
   * also means a pillar whose view is created late appears already risen rather than erupting under
   * the player's nose, which cannot happen today but would the moment anything culled distant
   * views.
   *
   * Reconstructed rather than passed in, because a pillar's `secondsLeft` at the moment of raising
   * *is* its full life, and reading it here keeps the signature to one argument.
   */
  const total = pillar.secondsLeft

  function apply(current: Pillar): void {
    const elapsed = total - current.secondsLeft
    // The lesser of "how far up it has come" and "how far it has left to sink", which is exactly
    // `ice-shell.ts`'s `Math.min(forming, melting)`. Guarded against a non-positive constant
    // rather than dividing by it: the result places a mesh, and a NaN there loses the object
    // entirely instead of merely looking wrong.
    const rising = RISE_SECONDS > 0 ? Math.min(1, Math.max(0, elapsed / RISE_SECONDS)) : 1
    const sinking = RISE_SECONDS > 0
      ? Math.min(1, Math.max(0, current.secondsLeft / RISE_SECONDS))
      : 1
    const risen = Math.min(rising, sinking)
    seated.copy(current.position)
    // Sunk into the ground by the part of its height it has not risen yet, so the rock emerges
    // through the surface instead of growing. Growing would make a short pillar and a tall one
    // look like the same object at different scales, and the height is a mechanic.
    seated.y -= current.height * (1 - risen)
    mesh.position.copy(seated)
  }

  apply(pillar)

  return {
    object: mesh,

    update(current: Pillar): void {
      apply(current)
    },

    dispose(): void {
      geometry.dispose()
      material.dispose()
    },
  }
}
