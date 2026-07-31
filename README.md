# Airbender Skies

A third-person browser game: explore an archipelago of floating islands while flying on an
air kite.

**Play:** https://danielnygaard00.github.io/airbender-skies/

## Controls

| Input | Ground | Kite |
| --- | --- | --- |
| Mouse | Look | Trim — nudges the nose toward where you look |
| `W` / `S` | Walk forward / back | Airbending thrust / flare |
| `A` / `D` | Strafe | Shift your weight — this is how you steer |
| `Shift` | Sprint | Hover — hold position in mid-air |
| `Space` | Jump | Deploy or stow the kite |

Gliding on its own can only trade altitude for distance, and it costs nothing. Airbending is
what makes the difference: thrust is the only way to gain net altitude, and hovering holds you
still in the air with no updraft to ride. Both spend breath, and hovering spends it fastest,
because holding station carries the glider's whole weight rather than just adding to a wing that
is already flying. Collect air shrines to raise your maximum breath.

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
