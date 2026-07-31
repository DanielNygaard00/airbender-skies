# Assets

Every asset in this repository is CC0 or equivalently permissive, so the project
stays clean as a public repository.

| Asset | Path | Source | License |
| --- | --- | --- | --- |
| Animated Human character | `public/models/character.glb` | https://poly.pizza/m/c3Ibh9I3udk | CC-BY — Quaternius |

## Adding an asset

1. Confirm the license is CC0, public domain, or equally permissive. If
   redistribution in a public repository is unclear, do not commit it.
2. Put the file under `public/models/` or `public/audio/`.
3. Add a row to the table above with its real source URL.

## Recommended sources

- Quaternius (CC0) — animated low-poly characters and environment packs
- Kenney (CC0) — props and audio
- Poly Pizza (mixed, check per asset) — low-poly models

Clip names do not have to match the game's animation states. `src/player/clip-map.ts`
strips the armature prefix that exporters add — this model ships
`Human Armature|Idle` — and matches common synonyms, so `Sprint` counts as a run
and `Jump` stands in for a fall. A model with no glide clip borrows its fall clip
and holds a single frame. Adding a clip literally named `glide` overrides that
automatically.

Poly Pizza lists this model as Creative Commons Attribution while Quaternius's own
pages state CC0. The stricter reading is recorded here, so credit Quaternius when
distributing a build.
