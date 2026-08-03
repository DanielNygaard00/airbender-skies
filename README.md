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
| `Shift` | Air scooter (tap to ride, tap to step off) — or hold to sprint instead, which also raises the scooter's speed | Hover — hold position in mid-air |
| `Q` | Air blast dash — three in a chain, then a short recovery | — |
| `F` | Gust — a wide sweep of air that knocks enemies back | Gust |
| `E` | Avatar State — once the pip under your Focus bar is full | Avatar State |
| `Ctrl` | Hold through a landing to slam | Tuck — fold the wings for a fast dive, and hold it through the landing to slam |
| `Space` | Jump — twice, the second gains more height the faster you are rising | Deploy or stow the glider |
| `H` | Guide — every action, and whether you can use it right now | Guide |

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

Height is a weapon. Hold `Ctrl` through a landing and the fall becomes a Pressure Wave — a
ring of air that goes out in every direction, with no facing to aim and nobody safe behind
you. How hard it hits scales with how fast you were falling: a short drop is a gust with no
aim, while a committed dive downs a soldier outright and clears the space around them. It
costs nothing but the commitment, and it pays Focus for landing it.

The slam also throws you back into the air with your second jump available, so the dive is
not the end of the move. Tuck into a dive, slam, then hit `Space` twice on the way back
up — once for the double jump, once to snap the wings back open — and you're flying again.

Focus is the reward for playing well rather than merely surviving. It builds while you hold a clean
line — gliding above stall speed, and about twice as fast riding a thermal or a wind river — and
much faster in a fight, on every gust that connects and every soldier you put down. Standing still
drains it, and a spear hit takes nearly a third of the bar. The longer you go unbroken the better
everything pays, so a long run is worth more than the sum of its parts, and losing it costs more too.
From a standing start, a clean glide fills the bar in around half a minute.

Hold Focus at maximum and a thin pip fills beneath the bar. Once it is full, `E` spends the whole
meter on the Avatar State: eight seconds of free breath, a gust that downs a soldier outright, and
every wind feature in the archipelago turning to your side — thermals surge, downdrafts relent, dead
air comes back to life. The pip only holds while Focus stays at maximum, so one hit takes both.

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
