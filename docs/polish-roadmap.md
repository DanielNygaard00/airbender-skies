# Polish roadmap: smoothness and graphics

Written 2026-08-04. A reference for the polish phase that comes after the core mechanics are
done. Items are ordered by visual payoff per unit of effort within each section. The
foundation is already better than most prototypes: fixed-timestep loop, ACES tone mapping,
soft shadows, distance fog, and a sky dome are all in place.

## Smoothness (code-only, mostly cheap)

### 1. Render interpolation — DONE (2026-08-04)

The simulation runs at a fixed 60 Hz, but rendered frames now draw the player, enemies, and
camera at positions interpolated between the last two steps (`src/core/interpolation.ts`,
`syncVisuals` in `src/main.ts`). This removes judder on 120 Hz+ displays and smooths
frame-drop hitches at 60 Hz. Cosmetic animations (effects, waterfalls, shrine markers, wind
tells) still advance at step rate; they can migrate piecemeal if it ever shows.

### 2. Framerate-independent damping

Any smoothing written as `x += (target - x) * constant` per frame behaves differently at
different refresh rates. The correct form is `1 - Math.exp(-k * dt)`. The follow camera's
`smoothTowards` already does this and now runs on real frame time. When adding new smoothing
anywhere (UI bars, effect fades, procedural animation), use the exponential form from the
start — retrofitting it silently corrupts feel-tuning done in the meantime.

### 3. Camera polish

Feel comes more from the camera than from any shader:

- Damped spring on position and rotation, with slight lag behind velocity.
- FOV widening with speed (exists — `fovForSpeed` in `src/fx/mapping.ts`).
- Small camera shake on impacts.
- Brief hitstop (2–4 frames) when a Pressure Wave or heavy hit connects.

### 4. Animation blending

Once the character model has clips: three.js `AnimationMixer` crossfades between
idle/run/glide states, plus procedural lean into turns and banking on the glider. Snapping
between poses reads as jank even at a perfect frame rate.

## Graphics ("real game" look)

### 1. Real assets

The single biggest difference between prototype and game. Sources, roughly by effort:

- CC0 low-poly packs: Kenney, Quaternius, Poly Pizza.
- CC-BY models: Sketchfab (attribution required).
- Character rig and animation clips: Mixamo (free).
- Custom work: Blender.

Ship as GLTF with Draco compression. The stylised low-poly direction already chosen is
smart — it ages well and hides missing texture work.

### 2. Post-processing pass

`EffectComposer`, or the better-maintained `pmndrs/postprocessing` library: bloom on the sun
and effects, vignette, a subtle colour-grading LUT, possibly SSAO. This alone shifts the
look from "raw WebGL" to "shipped indie game", and it layers on top of the existing ACES
pipeline.

### 3. Toon / stylised materials

The airbender theme suits a Ghibli look: gradient-ramp toon shading, an outline pass,
hand-painted-style gradients instead of flat vertex colours. `MeshToonMaterial` or
`onBeforeCompile` tweaks on the existing materials.

### 4. Environment density

Cheap instancing, large gain in life:

- Instanced grass with vertex-shader wind sway (`InstancedMesh`).
- Drifting clouds (billboards are enough).
- Birds, floating particles, wind-streak lines while gliding.

### 5. Ability VFX

Gust, blast, Vortex, Slipstream, and the Avatar State want particle systems, mesh trails,
and distortion. Ribbon trails behind the glider wingtips are a high-payoff starting point.

### 6. Shadows at scale

The follow-the-player shadow frustum works but is resolution-limited. If quality bothers
anyone later, the three.js CSM addon (cascaded shadow maps) covers large terrain properly.

Four other levers were tried on 2026-08-11 and 2026-08-12, and all four are recorded with
their measurements in `docs/HANDOFF.md`: VSM (closed — no `normalBias` is both free of terrain
acne and solid enough to keep the character's shadow readable), a 4096-texel map (shipped, for
a modest detail gain), a smaller `SHADOW_EXTENT` (closed — its floor is pinned by the largest
island), and a screen-space contact shadow pass (built and removed — a contact technique needs
a close camera, and the follow cam watches from 15 to 40 units back). CSM is the one untried
option left here. If what anyone actually wants is crevice darkening, ambient occlusion is the
technique to reach for; contact shadows were measured and are not it.

## Sequencing

Gameplay first — that instinct is right. The two exceptions were render interpolation
(done; retrofitting later would have touched every visual object) and the
framerate-independent damping rule, which applies to every new piece of smoothing as it is
written. Everything else layers on cleanly afterwards.

Budget performance while adding: instancing, LOD, and draw-call count. A stable frame rate
*is* smoothness — the prettiest bloom is useless if frame time spikes.
