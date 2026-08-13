# Fire — design note

**Written after the fact, and this note says so up front.** The cycle that built fire was
interrupted before it wrote its design note, and the reasoning behind each choice was never
recorded anywhere except in the code. What follows is assembled from what the config comments,
the module doc comments and the tests actually say, plus measurements re-taken here. Where the
code records an argument, this note reports it. Where the code records only a number and no
argument, this note says that too rather than inventing one — those are the places a future
reader should be most willing to overrule.

---

## 1. What the owner ruled, and what §4.2 said

§4.2: *"**Fire** — burst and propulsion. The only element with real single-target damage. Also
the emergency mid-air thrust when Breath is empty, at the cost of a Fire resource."*

Five owner rulings shaped this cycle, and three of them override or narrow that line:

1. **The resource is three discrete charges, not a bar.** A count reads at a glance and cannot be
   trickled, and it keeps a fourth gauge out of a HUD already carrying health, breath and Focus.
2. **Charges refill on landing, and only on landing.** Not over time, not in the air.
3. **Fire may thrust the player in mid-air, and this is wanted.** The propulsion half stays.
4. **Fire thrust is never paid for in Breath** and must never read as a way to keep flying once
   Breath is gone.
5. **On the ground, fire does not move the player at all.** No lunge, no dash, no shove.

A sixth constraint was added for integration rather than design reasons: **fire does not spend
Focus.** Water's Ice Lock already spends 35 of 100 and earth's pillar spends 30; a three-way
pricing problem nobody has played is a worse outcome than a slightly cheap fire. Charges plus a
cooldown are its whole price.

**Why ruling 2 is the load-bearing one.** Breath is the pacing mechanism for the entire air
layer: `flight.ts` is a soaring model where thrust is the only source of net climb and running dry
is the intended failure. A fire resource that refilled *in the air* would be a second Breath bar
whatever it was called — the player would alternate meters and the tension would be gone. Refilling
only on touchdown is what keeps fire a burst rather than a sustain, and it matches §6's tuning
target that a player who never lands should run out of fuel.

## 2. The two verbs

`F` is the burst, `R` is the thrust — the element contract water established, where `F` is the
light verb and `R` the heavy one.

**Fire is the only element whose heavy verb is a movement move rather than a combat one.** That
asymmetry is real and worth stating. The defence the code offers is that fire's *identity* in §4.2
is two things, damage and propulsion, and the propulsion half has nowhere else to live: a third key
was ruled out by the contract, and putting the thrust on the light verb would make the burst — the
thing §4.2 calls fire's whole point — the committed press. On the ground the heavy verb therefore
does nothing at all, which the README states plainly rather than hiding: *"Firebending: nothing, on
the ground"*.

## 3. The burst

```
burst:              { range: 7, halfAngle: Math.PI / 12 }   // 30 degrees swept
verticalReach:      2.5
burstDamage:        1.0
burstKnockback:     5
burstCooldownSeconds: 1.2
```

Every one of these carries its argument in `config.ts`; the summary:

- **The narrowest cone in the game by a wide margin** — 30 degrees against water's 60 and the
  gust's 120. At range 7 that is a band about 3.6 m across at full reach, inside the shipped
  patrol's closest pair at 11.31 m. So *single-target* is a property of the geometry rather than a
  rule written into the resolver, which is the honest way to build it.
- **The shortest vertical band of the six after the staff's 2.0**, and deliberately below water's
  3.0: reaching high is what fire pays for doing the game's best aimed damage.
- **Damage 1.0 — two gusts.** Two bursts for a spear's first down, one per rung after it, one press
  for a net thrower. Under the Pressure Wave's 2.2, so a committed dive remains the biggest single
  blow in the game.
- **Knockback 5, a fifth of the gust's 26.** Against `knockbackDamping` 2.6 the target travels
  1.92 m, so anything hit inside 5.08 m is still inside the burst's own 7 m reach for the next one.
  Fire hurts; air displaces.
- **Cooldown 1.2 s**, above the grip's 1.1 — damage costs more than denial — and sized so three
  charges take 2.4 s to spend, longer than a spear's whole exchange of 1.25 s.

## 4. The thrust

```
thrustUpSpeed:      9    // DEFAULT_GROUND_CONFIG.airJumpSpeed exactly
thrustForwardSpeed: 6
```

- **The up component is exactly the air jump's speed**: one thrust is worth one push of air, which
  is the anchor that keeps it from being a new movement primitive.
- **Total impulse 10.8 m/s**, about 0.49 s of bent-air thrust at `thrustAccel` 22 — so all three
  charges together are under a third of a Breath bar, *and they do not come back until the player
  lands*. That pair of facts is the whole of how ruling 4 was satisfied: fire cannot substitute for
  Breath because it is both smaller than Breath and non-renewable in the air.
- **The forward component is under the up component and less than a quarter of the blast dash's
  26**, so it can never be used as a third horizontal movement move. It is enough that the total
  clears `stallSpeed` 8, so a stalled wing comes out of the push flying.

`canFireThrust(charges, mode)` refuses on the ground and at zero charges, which is rulings 5 and 4
expressed as a single predicate the guide row also reads — so the row dims exactly when the key
would be refused.

## 5. Charges

`fullCharges`, `spendCharges` and `stepFireCharges(charges, landed, c)` are the whole model, and
the refill is driven by the landing edge.

**One authority on what "full" means.** `recover()` in `main.ts` restores charges by calling
`stepFireCharges(charges, true, config)` — the same function the landing edge uses, with `landed`
true — rather than assigning `maxCharges` directly. The comment there gives the reason: a respawn
and a touchdown must not be able to come to different answers about what a full count is.

A fall out of the world is handled by the same path, since it routes through the respawn.

The HUD draws the count as pips and **fails toward zero**: a corrupt count reads as no charges,
the same direction the meter fractions fail. That is the safe direction — a player who sees no
charges tries something else, where a player shown phantom charges presses a key that does nothing.

## 6. Fire against plate, and why it is not earth

`BendingSource` gains `'burst'`, so the armour table is total over it. The heavy armoured
soldier's row is **`burst: { damage: 0.5, knockback: 0 }`**, and `config.ts` argues it at length
because this is the row that decides whether fire quietly becomes the armour-breaker §4.4 promises
to *earth*.

It does not, and the arithmetic is what makes that true rather than the intent: at 0.5 a burst does
0.5 to a heavy, so its 4.0 health is **eight bursts for the first rung and sixteen for a permanent
down** — against two full dives per rung for the Pressure Wave, and earth's four stones for the
first rung and nine for the ladder. Fire is capped harder still by its own resource: three charges
per touchdown is 1.5 damage per landing, so grinding a heavy down with fire means walking away and
coming back three times. That is the same "wrong tool" feeling the staff route is deliberately
given.

**Halved rather than refused**, because a blast of burning air is neither a sweep the soldier can
ignore (gust 0) nor a shock travelling through the ground beneath it (wave 1). A full deflect was
the other candidate and was rejected for the reason a full deflect on the water grip was: it would
read as "fire does not work on plate", and the element the design document builds around
single-target damage should not have *nothing* to say to the one high-health single target.

## 7. Presentation

- Effects in `src/fx/fire-burst.ts` and `src/fx/fire-thrust.ts`, on the existing `Effect` contract.
- `COMBAT_LEVELS.fireThrust` is 0.28. The mix invariant holds: `hurt` at 0.47 remains the loudest
  voice by more than the 1.1 margin the test demands, and that test derives its rivals from the
  whole record so a new voice cannot quietly outgrow it.
- The radial and the guide's element legend both gain fire. Because both are total `Record`s over
  `Element`, neither could have been forgotten — appending to the union fails the compile until
  they are filled in, which is the mechanism water's contract note describes.
- README: the `F` and `R` rows describe all three elements, and `1`/`2`/`3` select them directly.

## 8. Act gating

§5 places fire in Act 3 and there is no act structure, so fire ships unlocked exactly as water and
earth do. The note belongs with `isElementAvailable` in `src/elements/element.ts`, where water left
the seam. An act-structure cycle is in progress separately; the one-line change fire will need there
is an entry in whatever act table that cycle builds.

## 9. Tests

63 tests across the three new files — 42 in `fire.test.ts`, 11 in `fire-burst.test.ts`, 10 in
`fire-thrust.test.ts` — with 15 assertions in `fire.test.ts` touching the ground refusal and the
landing refill specifically, which are the two rulings most likely to be broken by a later change.

**The mutation record for this cycle was not preserved.** The original run reported its mutations
as it went and that transcript is gone. The tests were verified green on the finished tree, and one
mutation was re-run afterwards against the shipped config to confirm the suite still discriminates,
but this note cannot claim the full per-assertion mutation sweep the other element cycles recorded.
A reader who wants that confidence should re-run it; a reader changing fire's numbers should assume
less coverage here than in `water.ts` or `earth.ts` until they have.

## 10. What §4.2 asked for that is not built

- **"Emergency mid-air thrust when Breath is empty"** — the thrust exists but it is not conditional
  on Breath being empty, and deliberately: gating it on an empty meter would make it a rescue, and a
  rescue is the thing ruling 4 exists to prevent. It is available whenever a charge is, in the air.
- **No burning, no damage over time.** §4.6 says nothing dies; a lingering burn is also a second
  damage model, and the recovery ladder is the only one this game has.
