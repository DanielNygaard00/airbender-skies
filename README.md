# Airbender Skies

A third-person browser game: explore an archipelago of floating islands while flying on an
air kite.

**Play:** https://danielnygaard00.github.io/airbender-skies/

## Controls

| Input | Ground | Kite |
| --- | --- | --- |
| Mouse | Look | Steer — the kite turns toward where you look |
| `W` / `S` | Walk forward / back | Airbending thrust / flare |
| `A` / `D` | Strafe | Bank into the turn |
| `Shift` | Sprint | — |
| `Space` | Jump | Deploy or stow the kite |

Gliding costs nothing. Thrust costs breath, and thrust is the only way to gain net altitude.
Collect air shrines to raise your maximum breath.

## Development

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # unit tests
npm run typecheck  # type check only
npm run build      # production build into dist/
```

Design documents live in `docs/superpowers/`.

## Credits

The player character model ("Animated Human") is by Quaternius, used under
CC-BY. See `ASSETS.md` for the full asset list and sources.
