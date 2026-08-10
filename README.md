# Airbender Skies

A third-person browser game: explore an archipelago of floating islands on an Air Nomad glider
staff — a collapsible wooden staff whose fabric wings snap open into a hang glider, and fold
back down to a walking stick.

**Play:** https://danielnygaard00.github.io/airbender-skies/

## Controls

| Input | Ground | Glider |
| --- | --- | --- |
| Mouse | Look | Trim — nudges the nose toward where you look |
| `Mouse left` | Staff combo — up to three wide horizontal swings that hit everyone in front of you; keep swinging to continue, the third sweeps wider and shoves much harder | — |
| `W` / `S` | Walk forward / back | Airbending thrust / flare |
| `A` / `D` | Strafe | Shift your weight — this is how you steer |
| `Z` | Air scooter — tap to ride, tap to step off | — |
| `Shift` | Sprint — stacks with the air scooter, so sprinting while riding is faster than riding alone | Hover — hold position in mid-air |
| `Q` | Air blast dash — three in a chain, then a short recovery | — |
| `F` | Gust — a wide sweep of air that knocks enemies back | Gust |
| `E` | Avatar State — once the pip under your Focus bar is full | Avatar State |
| `R` | Vortex — hold to charge, release to pull nearby enemies inward and lift them off their feet | Vortex |
| `C` | Slipstream — a short dash, briefly unhittable | Slipstream |
| `Ctrl` | Hold through a landing to slam | Tuck — fold the wings for a fast dive, and hold it through the landing to slam |
| `Space` | Jump — twice, the second gains more height the faster you are rising | Deploy or stow the glider. Close to the ground the deploy gives way to the landing, so a press on the way down becomes a jump on touchdown rather than a glide you immediately stow |
| `H` | Guide — every action, and whether you can use it right now, plus the settings at the bottom of it. Opening it hands the mouse back, which is what makes those settings usable, so closing it leaves you on the pause card and one click resumes | Guide |
| `Escape` | Pause — releases the mouse; click to resume. With the guide open it closes the guide and lands you on the pause card, the same place `H` lands you, since opening the guide already released the mouse | Pause |

Gliding on its own can only trade altitude for distance, and it costs nothing. Airbending is
what makes the difference: thrust is the only way to gain net altitude, and hovering holds you
still in the air with no updraft to ride. Both spend breath, and hovering spends it fastest,
because holding station carries the glider's whole weight rather than just adding to a wing that
is already flying. Collect air shrines to raise your maximum breath.

On the ground, momentum is the resource. The run accelerates softly and slides on stops rather
than snapping, the scooter doubles your speed while halving your steering, and holding a clean
line on it builds a hidden accumulator that makes the ball tighter and faster — carve hard and you
give it back. Landing never stops you dead; you skim out of it. A jump is forgiven slightly at
both ends: press it just after walking off an edge and it still counts, and press it just before
you land and it waits for the ground rather than vanishing.

A patrol of spear infantry holds the east side of the home island. They pressure your spacing:
they close, they telegraph, and standing still costs health. Gust knocks them back and
interrupts a strike, but barely hurts them — enemies are downed, never killed, not for good. A
soldier you put down will push itself back onto its feet after a while, and rejoin weaker than
it was. Hit one while it is getting up and it goes straight back down, though that only buys
you time: wearing a soldier out for good still means taking its health to nothing, three times
over.
It cuts both ways: run your own health out and you go down too, waking up back at the island
with a full bar of health, an empty bar of Focus, and the patrol exactly as you left it.

A small reticle sits where your next attack will go, rather than in the middle of the screen,
and warms when something is inside the gust's reach. When you take a hit, a wedge appears around
it pointing at where the hit came from, and fades. A dodge shows one too, so slipping an attack
still tells you where it was thrown from.

Reach has a height as well as a distance. Every one of your moves — both staff arcs, the gust,
the Vortex and the Pressure Wave — sweeps a band around your own footing rather than an endless
column, so a soldier far enough below or above you is out of range even when it is squarely in
front. Each move gets its own band, and they are not the same: a swing with a staff barely
reaches past your own height, a gust of air reaches a good deal further, and the Vortex reaches
furthest of all, because getting people off their feet is the whole point of it. So climbing above
a fight buys you less than it used to: get high enough and your own attacks stop reaching, and how
high that is depends on the move — a couple of metres for the staff, a good deal more for the
Vortex. Your reach is still a flat shape with a ceiling and a floor rather than a sphere, though:
distance is measured across the ground and height is a separate limit, so backing away from a
soldier costs you reach in a different currency from climbing above it. The archers, by contrast,
measure a single straight-line distance and always did.

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
