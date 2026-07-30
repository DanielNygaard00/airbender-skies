# Assets

Every asset in this repository is CC0 or equivalently permissive, so the project
stays clean as a public repository.

| Asset | Path | Source | License |
| --- | --- | --- | --- |
| Placeholder character | generated in code | `src/player/avatar.ts` | n/a |

## Adding an asset

1. Confirm the license is CC0, public domain, or equally permissive. If
   redistribution in a public repository is unclear, do not commit it.
2. Put the file under `public/models/` or `public/audio/`.
3. Add a row to the table above with its real source URL.

## Recommended sources

- Quaternius (CC0) — animated low-poly characters and environment packs
- Kenney (CC0) — props and audio
- Poly Pizza (mixed, check per asset) — low-poly models

When adding a rigged character, name its clips `idle`, `walk`, `run`, `fall`,
and `glide` so `avatar.ts` matches them automatically.
