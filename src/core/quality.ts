/**
 * What the renderer is allowed to spend, as three named tiers.
 *
 * Adding post-processing raises a question the game has not had to answer before: who pays
 * for it. A composited frame costs real milliseconds, and the machines this runs on range
 * from a discrete GPU to integrated graphics in a laptop. One fixed pipeline would either
 * waste the fast machine or lock out the slow one.
 *
 * **A `Record<Quality, QualityProfile>` rather than a lookup with defaults**, so a fourth
 * tier fails to compile until every field is specified — the device `LOOKS` in
 * `element-radial.ts` and `WIND_LEGEND` in `ui/guide/reference.ts` already use, and cheaper
 * than a test that could be deleted. (`wind.ts` only defines `WindKind`, the union the legend
 * is keyed by; this comment named the wrong file, and two later comments copied it.)
 *
 * **The low tier bypasses the composer entirely rather than running an empty one.** An
 * `EffectComposer` with no effects still costs a render target and a fullscreen blit, which
 * is precisely what the cheapest tier cannot spare. That bypass is what makes
 * `toneMappingOwner` necessary — see its comment.
 */
export type Quality = 'low' | 'medium' | 'high'

/** Every tier, cheapest first. Exported so a test can sweep them rather than list them. */
export const QUALITIES: readonly Quality[] = ['low', 'medium', 'high']

export interface QualityProfile {
  /** Whether the post-processing composer runs at all. */
  composer: boolean
  bloom: boolean
  /** The brightness/contrast/saturation trim. Cheap, and the whole "graded" look. */
  grade: boolean
  smaa: boolean
  /** Upper bound on `devicePixelRatio`. The single biggest lever on fill cost. */
  pixelRatioCap: number
  /** Square edge of the sun's shadow map, in texels. */
  shadowMapSize: number
}

/**
 * The tiers themselves.
 *
 * **High is today's game plus the passes**, deliberately: a pixel-ratio cap of 2 and a 4096
 * shadow map are what `renderer.ts` and `sun.ts` already ship, both after measurement, so
 * "the high tier changed nothing except adding the composer" is a claim a test can hold.
 *
 * **Medium's step down is the shadow map, and it is a known loss rather than a guess.**
 * `renderer.ts` records that at 2048 the character's shadow renders the staff as a vague
 * smear, and that 4096 was chosen to fix exactly that. So medium gives up a detail the owner
 * has already looked at, which is the right kind of degradation: visible, legible, and about
 * detail rather than correctness.
 *
 * **SMAA stays on wherever the composer runs.** Aliasing is visible on every edge in every
 * frame; bloom's absence is visible only where something is bright. When medium needs to give
 * up more, bloom's resolution goes before antialiasing does.
 */
export const QUALITY_PROFILES: Record<Quality, QualityProfile> = {
  high: {
    composer: true, bloom: true, grade: true, smaa: true,
    pixelRatioCap: 2, shadowMapSize: 4096,
  },
  medium: {
    composer: true, bloom: true, grade: true, smaa: true,
    pixelRatioCap: 1.5, shadowMapSize: 2048,
  },
  low: {
    composer: false, bloom: false, grade: false, smaa: false,
    pixelRatioCap: 1, shadowMapSize: 1024,
  },
}

/**
 * High, and not medium.
 *
 * The default is what a player who never opens the settings panel sees, so it is the tier the
 * game is judged on. A cautious default would mean most players never see the pipeline this
 * step exists to build. The tiers below it are a remedy for a machine that cannot keep up, and
 * a stutter is a legible prompt to go looking for them; a permanently duller game is not.
 */
export const DEFAULT_QUALITY: Quality = 'high'

export function profileFor(q: Quality): QualityProfile {
  return QUALITY_PROFILES[q]
}

export function isQuality(value: unknown): value is Quality {
  return typeof value === 'string' && (QUALITIES as readonly string[]).includes(value)
}

/**
 * Who applies ACES tone mapping.
 *
 * This is the one piece of state the composer and the renderer share, and it exists because
 * the low tier bypasses the composer. Applying ACES in both places tone maps the image twice
 * and the world turns milky; applying it in neither leaves the low tier rendering raw linear
 * colour, which does not read as "lower quality" but as broken. So the owner moves with the
 * tier, and it is a function rather than a comment so the switch is testable.
 */
export function toneMappingOwner(p: QualityProfile): 'composer' | 'renderer' {
  return p.composer ? 'composer' : 'renderer'
}
