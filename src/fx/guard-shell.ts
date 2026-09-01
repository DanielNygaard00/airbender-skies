import {
  BackSide, Color, Group, MathUtils, Mesh, SphereGeometry, type Object3D,
} from 'three'
import { createEffectMaterial } from './effect-material'

/**
 * The shell shown while a Slipstream's invulnerability window is open.
 *
 * The window is the entire mechanic, and it is 0.11 seconds long — so the tell has to
 * track it exactly. A shell that lingered would tell the player they were protected
 * when they were not, which is worse than no tell at all.
 */
export interface GuardShell {
  object: Object3D
  /** Call every frame with whether the window is open. */
  update(dt: number, active: boolean): void
  dispose(): void
}

const RADIUS = 1.15
/** Centred on the body, since the avatar's origin is at its feet. */
const CENTRE_Y = 0.95
const TINT = 0xd6f6ff
const PEAK_OPACITY = 0.4
/** Short, because the 0.11s window is brief and a slow fade-in eats a chunk of it
 * before the tell is even readable. */
const FADE_IN_SECONDS = 0.02
/** Bounded to a small fraction of `invulnerableSeconds`: this tail must not outlive
 * the protection, so it decays close enough to instantly that a player never sees a
 * glow they can no longer act on. */
const FADE_OUT_SECONDS = 0.03

/**
 * A bright silhouette and a dim interior, so the shell reads as a surface and not a wash.
 *
 * A flat `MeshBasicMaterial` at one opacity draws the whole projected disc at the same value,
 * which over a character reads as a tinted smear with no shape to it. What tells the eye this is
 * a *shell* is its edge — and on a closed surface the edge is wherever the surface turns
 * edge-on to the camera, which is a fact about the view rather than about the mesh.
 * `ice-shell.ts`'s `SHELL_BODY` carries that argument in full; this file does not restate it.
 *
 * `abs` because the shell is `BackSide`: its rendered normals point away from the viewer, so the
 * raw view-space z is negative over the whole visible half.
 *
 * No `time` uniform, deliberately, and the reason is the mechanic rather than taste: the window
 * this advertises is 0.11 seconds long, and `update` writing `alpha` is the only thing that
 * moves this material. A shell with a clock of its own could keep animating past the protection
 * it stands for, which is the one failure this tell must not have.
 *
 * **Duplicated in `avatar-aura.ts` rather than shared.** The two bodies are byte-identical today,
 * which makes the duplication look like the wrong call at a glance — but a shared constant would
 * be a real coupling between two mechanics that have nothing to do with each other: the
 * Slipstream's invulnerability window and the Avatar State just happen to render as the same
 * shape this task. Retuning one shell's grazing curve or floor later would either drag the other
 * along with it through a shared file, or force splitting the constant apart at that point anyway
 * — paying the coupling now for a saving that is not guaranteed to last. It also matches this
 * directory's own precedent: `water-reach.ts`, `earth-reach.ts`, `fire-burst.ts` and
 * `ice-shell.ts` all write `mix(tint * 0.18, tint, core)` as their own local constant rather than
 * importing one, and `impact.ts`'s own comment on that line calls it out explicitly — five
 * bodies, sharing a literal, none of them sharing a symbol. Sharing here would be the first
 * departure from that pattern rather than a continuation of it. If a third caller ever wants this
 * exact body, that is the point to promote it into `effect-material.ts` beside `POLAR_PREAMBLE`
 * — not before, on the strength of two.
 *
 * **`mix(tint * 0.35, tint, core)`, not the arc bodies' `0.18`.** Checked rather than assumed:
 * `0xd6f6ff * 0.18` is `(39, 44, 46)` of 255 and `0xfff3c4 * 0.18` (the aura's own tint) is
 * `(46, 44, 35)` — both under 46 on every channel, the same "nearly black" result `impact.ts`'s
 * own comment measures for `0xbcc4d2 * 0.18` and `0xfff3d8 * 0.18`. That reads fine on the arc
 * bodies because their interior alpha is `(1.0 - core) * 0.45` or a per-kind `dark` term tuned
 * against a travelling arc's own silhouette. This body's interior alpha is flat: `max(core, 0.30)`
 * puts every non-rim fragment at the same `0.30` floor regardless of how close to the edge it is,
 * and that floor is then scaled by a peak opacity of only 0.4 here (0.3 on the aura) — an
 * effective interior alpha of 0.12 (0.09 on the aura). A colour that is already within 46 of 0 at
 * that alpha renders as no colour at all against almost anything it is drawn over. `0.35` — `(75,
 * 86, 89)` for this tint, `(89, 85, 69)` for the aura's — keeps the interior a dim but legible
 * version of the tint instead, which is what this shape needs given its own alpha floor rather
 * than a case for abandoning the arc bodies' number generally.
 */
const SHELL_BODY = /* glsl */ `
    vec3 n = normalize(vViewNormal);
    float grazing = 1.0 - abs(n.z);
    float core = smoothstep(0.30, 0.70, grazing);
    gl_FragColor = vec4(mix(tint * 0.35, tint, core), alpha * max(core, 0.30));
`

export function createGuardShell(): GuardShell {
  const object = new Group()
  const geometry = new SphereGeometry(RADIUS, 20, 14)
  const material = createEffectMaterial({
    body: SHELL_BODY,
    uniforms: { tint: new Color(TINT), alpha: 0 },
    // `depthTest` left at the builder's own default of `true`, for `air-wall.ts`'s reason: this
    // shell is a closed volume around the player, extending as far below their footing as above
    // it, and the depth test is what keeps that underground half hidden by the ground it is under.
    side: BackSide,
  })
  const shell = new Mesh(geometry, material)
  shell.userData.excludeFromShadows = true
  object.add(shell)
  object.position.y = CENTRE_Y
  object.visible = false

  let shown = 0

  return {
    object,
    update(dt: number, active: boolean): void {
      const seconds = active ? FADE_IN_SECONDS : FADE_OUT_SECONDS
      const step = seconds > 0 ? dt / seconds : 1
      shown = active
        ? Math.min(1, shown + step)
        : Math.max(0, shown - step)
      material.uniforms.alpha!.value = PEAK_OPACITY * MathUtils.clamp(shown, 0, 1)
      object.visible = shown > 0.001
    },
    dispose(): void {
      geometry.dispose()
      material.dispose()
    },
  }
}
