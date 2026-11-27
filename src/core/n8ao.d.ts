/**
 * Types for the parts of `n8ao` this project uses.
 *
 * The package ships JavaScript and JSDoc but no declaration file, so under this project's strict
 * settings an import of it is an implicit `any`. Declared here rather than silenced with a
 * blanket `declare module 'n8ao'`, because the configuration object is exactly where a typo would
 * otherwise go unnoticed: it is a Proxy, so assigning `aoRaduis` would neither throw nor do
 * anything, and the occlusion would quietly render at its defaults.
 *
 * Covers only what `post.ts` touches. Field meanings follow the library's own JSDoc on
 * `N8AOPostPass.configuration`.
 */
declare module 'n8ao' {
  import type { Camera, Color, Scene } from 'three'
  import { Pass } from 'postprocessing'

  export interface N8AOConfiguration {
    /** Samples per pixel for the occlusion estimate. */
    aoSamples: number
    /** World-space radius occlusion is gathered over, unless `screenSpaceRadius` is set. */
    aoRadius: number
    /** How sharply occlusion falls off with depth difference, so distant surfaces do not darken
     *  near ones. */
    distanceFalloff: number
    /** Strength of the darkening. */
    intensity: number
    /** Samples and radius of the edge-aware blur that removes sampling noise. */
    denoiseSamples: number
    denoiseRadius: number
    /** The colour occlusion darkens toward; black for ordinary ambient occlusion. */
    color: Color
    /** Whether the pass applies sRGB encoding itself. Must be false anywhere but last. */
    gammaCorrection: boolean
    /** Render the occlusion at half resolution and upsample it. */
    halfRes: boolean
  }

  export class N8AOPostPass extends Pass {
    constructor(scene: Scene, camera: Camera, width?: number, height?: number)
    configuration: N8AOConfiguration
    /** When true the pass decides `gammaCorrection` itself from whether it renders to screen. */
    autosetGamma: boolean
    setSize(width: number, height: number): void
  }
}
