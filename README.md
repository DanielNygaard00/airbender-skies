# Airbender Skies

A third-person browser game: explore an archipelago of floating islands on an Air Nomad glider
staff — a collapsible wooden staff whose fabric wings snap open into a hang glider, and fold
back down to a walking stick.

**Play:** https://danielnygaard00.github.io/airbender-skies/

## Controls

| Input | Ground | Glider |
| --- | --- | --- |
| Mouse | Look | Trim — nudges the nose toward where you look |
| `W` / `S` | Walk forward / back | Airbending thrust / flare |
| `A` / `D` | Strafe | Shift your weight — this is how you steer |
| `Shift` | Air scooter — tap to ride, tap to step off | Hover — hold position in mid-air |
| `Q` | Air blast dash — three in a chain, then a short recovery | — |
| `F` | Gust — a wide sweep of air that knocks enemies back | — |
| `Ctrl` | — | Tuck — fold the wings for a fast dive |
| `Space` | Jump — twice, the second gains more height the faster you are rising | Deploy or stow the glider |

Gliding on its own can only trade altitude for distance, and it costs nothing. Airbending is
what makes the difference: thrust is the only way to gain net altitude, and hovering holds you
still in the air with no updraft to ride. Both spend breath, and hovering spends it fastest,
because holding station carries the glider's whole weight rather than just adding to a wing that
is already flying. Collect air shrines to raise your maximum breath.

On the ground, momentum is the resource. The run accelerates softly and slides on stops rather
than snapping, the scooter doubles your speed while halving your steering, and holding a clean
line on it builds a hidden accumulator that makes the ball tighter and faster — carve hard and you
give it back. Landing never stops you dead; you skim out of it.

A patrol of spear infantry holds the east side of the home island. They pressure your spacing:
they close, they telegraph, and standing still costs health. Gust knocks them back and interrupts a
strike, but it barely hurts them — enemies are downed, never killed, and a downed soldier stays
lying where the air put them.

Transitions are free and meant to be chained: deploying the wings mid-jump keeps every bit of
horizontal momentum and adds an upward kick, so a well-timed deploy out of a rising double jump
climbs higher than either move alone.

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
