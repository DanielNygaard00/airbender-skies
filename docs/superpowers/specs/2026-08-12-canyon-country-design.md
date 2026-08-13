# Canyon Country — design note

**Written after the fact.** The cycle that built this region was interrupted before it wrote its
note. What follows is assembled from what the level, the two test files and their comments actually
assert, with the figures taken from the tests rather than restated from memory. Where the code
records an argument, this note reports it; where it records only a number, the note says so.

---

## 1. What this cycle was for

Wall-riding shipped working and starving. The sweep in `wall-ride-geometry.test.ts` measured the
archipelago and found **290 rideable contacts out of 117,080 sampled position/bearing pairs —
0.25%** — with a median rideable band of 0.25 m and the tallest wall in the whole region at
**6.00 m**, on `spire`. Loosening the steepness threshold was measured and did not rescue it. The
islands are round; §2.1's promise that the scooter "can ride up vertical walls while speed holds"
had almost nothing to be true of.

§3.3's Canyon Country is the region that answers it: *"narrow, twisting, low ceiling. Ridge lift on
every wall, dead air at the bottom. Rewards precision over altitude."* This cycle is the second
region, and the measurement below is its result.

## 2. The result, measured the same way

`canyon-wall-geometry.test.ts` runs the archipelago sweep's methodology against both regions in one
file, so the comparison is like-for-like rather than two numbers from two harnesses:

| | Archipelago | Canyon Country | Ratio |
|---|---|---|---|
| Samples | 117,080 | 219,176 | — |
| Rideable contacts | 290 | **4,960** | — |
| Rideable share | 0.25% | **2.26%** | **>9×** |
| Median band | 0.25 m | **4.00 m** | **16×** |
| p90 band | 1.50 m | **45.00 m** | **30×** |
| Tallest wall | 6.00 m | **64.25 m** | **10.5×** |

The tallest run is on `canyon-elbow-tall-2`, and the test records the thing that actually matters
about it: 64.25 m is **47 m past what one full accumulator can pay for**. That is the inversion this
region was built to produce — *on the archipelago the rock ran out first; here the move does.*

**The figure that describes the game rather than the mesh** needed two filters, and the test
explains why: a position sampled from a floor slab's grid does not mean feet on the floor, because
`groundHeightAt` returns the topmost surface and a slab position under a hoodoo answers with that
hoodoo's cap. All 820 slab-grid contacts have a median band of 16.00 m; the **538** whose feet are
actually below the floor line plus 8 m have a median of **27.25 m** and a p90 of **47.00 m**. Those
538 are riders walking the corridor with ridable wall within arm's reach.

## 3. The shape

Six floor slabs and 25 hoodoos, every island one or the other, all on the `rock` biome. Pinned:

- **Continuous floor for its whole 111 steps**, within an **11.3 m band** — so the canyon has one
  bottom rather than a staircase of disconnected shelves.
- **Narrow: a median 19.5 m between walls**, against the home island's 140 m of open plateau. This
  is the "narrow" of §3.3 expressed as a number.
- **Turns 110 degrees**, so the far end is not visible from the mouth. That is §3.4's readability
  rule used in reverse: a corridor you can see the end of is a corridor, and one you cannot is a
  place.
- **Every hoodoo stands on floor rather than on air**, and no wall on one side of the corridor ever
  fuses to a wall on the other — 68 overlapping pairs are flagged and all 68 are intended joins.
- **The world floor sits below the real geometry rather than below the nominal geometry**, which is
  a distinction the test names explicitly: islands generate deeper than their declared height by
  `MAX_DEPTH_MULTIPLIER`, so a floor placed under the nominal figure would be inside the rock.

## 4. Wind

Ridge lift on the walls and dead air at the bottom, both existing kinds in `wind.ts` — `ridge`
carries an axis, `dead` is strength 0. The ridge columns are centred **a little above mid-wall**, so
the column runs from the floor to somewhat over the cap line and the lift a rider feels grows as he
climbs. Every feature has a visible tell per §3.2's artist rule, and the tests assert each feature
sits inside the region it belongs to.

## 5. Deliberately not built

- **No encounter.** `HOME_PATROL`'s coordinates are relative to the home island and mean nothing
  here, and a second site would need a second `patrolSpawns`, a second `PatrolConfig` and a second
  restore rule in `main.ts`, none of which exists. §5 also says each new region "opens with an
  unpressured traversal sequence before the first encounter", so an empty canyon is what the
  document asks for at this stage.
- **No waterfalls.** A waterfall needs a rim with sky under it and every rim here has canyon under
  it. §3.3's canyon is stone and dead air; the archipelago is where the water is.
- **No payload.** That route is authored on the archipelago.
- **No region-selection UI.** See below.
- **No art direction.** Palette and silhouette language were explicitly deferred to the owner; this
  region works entirely within the existing `Biome` values and the existing vertex-colour zoning.

## 6. How a second region is loaded, and why there is no menu

`src/world/levels/index.ts` holds `LEVELS`, a `DEFAULT_REGION_ID`, and a resolver. The reasoning is
recorded there and is worth repeating: §3.1's regions connect *in the world*, at altitude and at
ground level, so the eventual answer is one scene containing both rather than a menu between them —
and a menu built now is a menu to throw away. What was needed today is a way to load either one.

- **`DEFAULT_REGION_ID` is the archipelago**, because it is the region with the teaching sequence,
  the patrol, the payload and the waterfalls.
- **`?region=<id>` overrides it**, which is how the canyon gets looked at in a browser.
- **An unknown id falls back to the default rather than throwing.** A mistyped query parameter
  should not be the difference between a game and a blank page.

## 7. Shrine ids across regions, added when this was integrated

Six shrines, one per room. `placeShrines` sets each shrine's `id` to its `islandId`, and
`SaveData.collectedShrines` is a flat list of those ids with **no region qualifier** — so two
regions sharing an island id would share a shrine id, and collecting one would silently mark the
other collected, in a saved file, permanently, with the `maxBreath` it granted still banked.

That is a save-corruption bug rather than a cosmetic one, and it is invisible until someone reuses a
name as ordinary as `mouth` or `rest`. Two tests now guard it, over `LEVELS` rather than between
these two regions by name, so a third region is covered without anyone remembering to come back:
one asserts no island id repeats between regions, the other asserts no *shrine* id does. Both are
asserted because they fail differently — an island collision is a geometry bug and a shrine
collision is a save bug — and each region is placed against its own terrain, because `placeShrines`
drops a shrine with no ground under it and one region's meshes cannot answer for another's
coordinates. Verified by mutation: pointing a canyon shrine at `home` reddens four tests.

## 8. Verification status, stated honestly

The suite is green and the sweeps are pinned. Two gaps a reader should know about:

- **The original run's mutation record was lost** when it was interrupted, so this note cannot claim
  a per-assertion mutation sweep over the geometry tests the way the water and earth notes can. The
  shrine-id guard added at integration was mutation-verified; the rest was verified only as green.
- **Nobody has flown it.** The region has never been played, and a canyon that reads as a trench, or
  a wall that reads as a slope, is exactly the class of defect no test in this file can catch.
  `?region=canyon-country` is how to look.
