# walker

Four characters and a circular maze. Enter at the rim, walk every corridor,
finish at the centre. The character walks on the fly
circuit and hunts the flies; the flies fly on the same circuit and try not to be
caught. Lives in `web/walker/`, runs in a browser with no build step and no
network.

```
node web/walker/tools/serve.mjs      # http://localhost:8173/
node web/walker/tools/validate.mjs   # circuit checks
node web/walker/tools/smoke.mjs      # whole scene, headless
node web/walker/tools/experiment.mjs # the duel, measured
node web/walker/tools/imports.mjs    # browser entry points resolve
node web/walker/tools/maze.mjs       # the maze, the route, and a full march
```

Controls: `1-4` character, `C` camera (follow / POV / duel / top / free),
`N` night, `M` route (coverage or shortest), `L` landmark, `F` hold fire,
`space` pause, `R` reset, `H` hide overlays.

This is `docs/roadmap-3d.md` Level 2, and it obeys that document's rule about
how to describe itself.

## What is real and what is authored

The wiring is real. The bodies and the game around them are authored.

**Real, in the sense that it follows published circuitry:**

- Head direction is a ring attractor over 16 EPG wedges, rotated by a PEN
  pathway driven by angular velocity, pinned by ER landmark input.
- Steering is PFL3 read at +/-90 degree offsets, so the left-right difference is
  proportional to `sin(goal - heading)`, feeding DNa02. The published result is
  that the right-minus-left DNa02 difference is linearly related to the fly's
  subsequent rotational velocity, and that is how it is wired.
- The goal is held allocentrically and converted from an egocentric bearing
  using the compass **estimate**, not ground truth. Drift costs accuracy.
- Escape is LPLC2 loom detection driving the giant fiber, fixed ~5 ms latency,
  committed burst.
- Search is a correlated random walk with run-and-tumble reorientation, and it
  switches to area-restricted search on losing a target. All three are described
  foraging behaviours.
- `LoVP92` (male-specific, the "love spot") and `AOTU012` (dimorphic) are used at
  the level the male CNS release describes them.

**Authored, and not pretending otherwise:**

- Six coupled phase oscillators stand in for 708 VNC leg motor neurons.
  Spike-to-muscle-force has no established mapping. This is **an engineered gait
  whose parameters are modulated by circuit activity**, the framing
  `docs/roadmap-3d.md` requires. Not "the connectome walks the body".
- Weights in `brain/connectome.js` are hand-tuned for a ~10-population model,
  not measured synapse counts.
- The characters, the flies, the room, the weapons, the scoring and the duel are
  all mine.

Dataset counts come from `amfly/config.py` MEASURED (166,700 neurons;
25,582,938 connections; 1,314 descending neurons; 708 VNC leg motor neurons).

## Walking, and what HuMoR has to do with it

The reference given for motion was **HuMoR** (Rempe, Birdal, Hertzmann, Yang,
Sridhar, Guibas, ICCV 2021): a conditional VAE that learns the distribution of
pose *change* at each step, trained on AMASS, used as a motion prior for robust
pose estimation.

**HuMoR is not integrated and cannot be.** It needs a parametric body model,
trained weights and a PyTorch runtime. This project is dependency-free
JavaScript that runs offline in a browser. Saying otherwise would be a lie about
the pipeline.

What is taken is the principle: joint angles should come from a model of how
people actually move, not from a sine wave. `world/gait.js` holds normative
sagittal-plane kinematics from clinical gait analysis -- the same phenomenon
HuMoR learns from mocap, encoded directly, because 24 numbers do not need a
neural network.

The signature a sine wave never gets right is the **knee double bump**, and it
is checked rather than asserted:

| | measured from the tables |
|---|---|
| Knee loading-response peak | 18.0 deg at 15% of cycle |
| Knee midstance dip | 4.0 deg at 40% |
| Knee swing peak | 62.0 deg at 70% |
| Duty factor | 0.62 |
| **Double support** | **24.0%** of the cycle |

Double support is *derived*, not dialled: the two tripods of the fly CPG sit
exactly half a cycle apart, and a 0.62 duty factor with a 0.5 offset gives
`2 * (0.62 - 0.5) = 0.24`. That is the 20-25% gait labs measure, and it falls
out of the fly circuit driving human tables without either being adjusted to
suit the other.

## Scale

The character is 1.78 m, built to standard anthropometry (hip 0.530H, shoulder
0.818H, biacromial 0.259H). Legs are pendulums, so Froude similarity scales gait
frequency by `sqrt(L_fly/L_char)` = 1/26.7:

| | |
|---|---|
| Froude-predicted step frequency | 0.19 - 0.75 Hz |
| What the scene runs | 0.95 Hz |
| Authored gain | **1.27x** |
| Resulting speed | 1.35 m/s |

The fly is **534 mm**: 214x a real Drosophila, about 30% of the character. It
was 178 mm and was tripled, and its speed halved, so it can be hit. **That is an
authored playability choice and the opposite of what the physics gives** -- a
larger body should move *faster* under Froude, not slower. It is flagged in
`scale.js` as `FLY_SIZE_NOTE.derived = false` and the test asserts that flag.

Wingbeat follows the size honestly: 200 Hz real becomes 13.7 Hz at 534 mm.

## The brain budget

The character is specified at **1e6 times** the connectome: 1.667e11 neurons,
roughly **1.9x a human brain**.

**Nothing simulates that.** Eight modules run. The multiplier is a budget for
what the character is granted:

1. **Working memory** -- the track survives the target leaving view.
2. **Forward model** -- it solves an intercept instead of nulling bearing error.
3. **Velocity estimation** -- alpha-beta filter over a noisy observation.
4. **Multi-target selection** -- six flies, one lock, with hysteresis.
5. **Decoupled aim** -- the weapon points independently of where the body walks.
6. **Fire control** -- a decision with a confidence threshold, not a reflex.
7. **Peripheral orienting** -- noticing something outside the visual field and
   turning to look at it.

Walking is deliberately **not** upgraded. The legs are `brain/vnc.js` driving
`world/gait.js`. The extra capacity buys perception; the gait underneath is the
same circuit the fly is using.

## Reward and punishment

`score.js`. **Not reinforcement learning** -- nothing adapts a policy, no weights
change, no value function is estimated. It is an outcome ledger with two hooks
back into the simulation, so the signals are not merely displayed:

- **Reward**: a kill streak shortens the weapon cooldown, to a floor of 0.62x.
- **Punishment**: a fly that reaches the character lands on him -- points lost,
  streak reset, and the body impaired to 0.25x speed for 0.9 s. The commands are
  unchanged; the legs just cannot deliver them.

Shot +10, cut +25, **art +5, centre +150**, miss -2, landed on -15.

The two task rewards were added after a measured run finished at **-125**
with ten landings: the only scored events were combat and being bitten, so
the number said nothing about whether the maze had been solved. A clean run
is now +330, and still +180 after ten landings. The sword pays more because a cut has
to be made inside 1.1 m against something whose whole reflex triggers on
approach, with an edge live for a third of the swing.

## Measured: the reflex result did not survive

The first version of this measured **8.9% vs 41.8%** hit rate with the escape
reflex on and off -- a 4.7x reduction, consistent across five seeds. After the
fly was tripled and slowed, the same experiment gives:

| reflex | hit rate | cuts | landed on | score |
|---|---|---|---|---|
| ON | **75.3%** +/- 8.2 | 27.8 | 36.6 | 631 |
| OFF | **81.8%** +/- 9.0 | 28.2 | 36.2 | 712 |

6.4 points against standard deviations of 8.2 and 9.0. **That is noise, not a
defence.** The mechanism is arithmetic: an evasive jink only helps if it moves
the animal further than its own radius inside the projectile flight time.

```
bolt flight at 3.5 m, 22 m/s          159 ms
BEFORE  escape 5.2 m/s -> 0.83 m      7.5x the 0.11 m hit radius
NOW     escape 2.6 m/s -> 0.41 m      1.3x the 0.33 m hit radius
```

The claim worth keeping is therefore narrower than the one first written down:
*a 5 ms reflex with no target model beats a predictive solver when the jink
clears the target's own width inside the projectile flight time.* Only the first
half of that got recorded, which is what made the original result look more
general than it was. Full write-up in `docs/negative-results.md`.

### Re-run with partitions, 2026-09-16

Those figures were measured in the single 9 x 9 box. With wall occlusion live,
the same five seeds give, in the 16 x 12 plan and again in the 24 x 16 one:

| plan | reflex | hit rate | cuts | landed on | escapes |
|---|---|---|---|---|---|
| 16 x 12 | ON | **65.3%** +/- 10.2 | 2.8 | 2.0 | 34.8 |
| 16 x 12 | OFF | **95.9%** +/- 2.4 | 2.2 | 2.0 | 0.0 |
| 24 x 16 | ON | **64.5%** +/- 5.0 | 1.2 | 1.4 | 23.2 |
| 24 x 16 | OFF | **95.1%** +/- 4.6 | 0.8 | 1.6 | 0.0 |

The gap is 30.6 points both times, and doubling the floor tightened the spread
rather than moving the means. **Do not read it as the reflex working.**

- **Hit rate is conditional on firing, and firing dropped.** A fly that jinks
  behind a partition stops being a target at all, so the ON arm's denominator
  is a different, smaller, harder-won set of engagements. That is not the
  quantity the 9 x 9 numbers measured.
- **The escapes column is the tell.** 23-35 versus 0. What the partitions added
  is an escape *route*, not a better jink; the arithmetic in the block above is
  unchanged, because neither the fly's speed nor its radius moved.
- **Reproducing at two arena sizes rules out a fluke of one floorplan. It does
  not touch the confound**, which is present in both.

So the honest statement is that this is **not a re-confirmation of the original
result** and should not be quoted as one. It is a different experiment that
nobody designed: occlusion-assisted escape, measured by accident. Isolating it
means separating engagement rate from per-engagement hit rate, and that has not
been done.

## Calibration, not taste

`penVelocityGain` was measured: `tools/validate.mjs` sweeps angular velocity with
the landmark off and fits the slope of compass rotation against body rotation;
0.062 puts it at 0.974. Above about 0.4 the PEN rectifier saturates at ordinary
turn rates.

Two measured properties left in rather than tuned away:

- The bump settles ~11 deg from where it is seeded. Wedges are 22.5 deg apart
  and the attractor prefers a position between them. Discretisation, not drift:
  it then holds to 0.17 deg per 10 s.
- The compass under-rotates on slow turns (ratio 0.65 at 0.2 rad/s, 1.01 at
  1.2 rad/s). Wedge pinning. Real ring attractors have it too.

Two locomotion bugs were found the same way, by tracing rather than guessing,
and both only surfaced once the partitions existed:

- **The frozen character.** With no fly in view the target carrier was parked at
  `(body.x, -50, body.z)`. `sense()` measures target distance in the XZ plane,
  so that read as a target sitting ON the character at distance 0: LoVP92 fired,
  `arrived` went true, and walk drive dropped to zero. The carrier is now parked
  far in X and Z, and `nav.targetVisible` is set from whether anything is
  actually engaged.
- **MDN latched forever.** `resolveCollision` parks the body at exactly
  `BODY_RADIUS` from an obstacle and the contact test used a strict `<`, so
  contact read false by a hair. Worse, once contact did register, it re-armed
  the backward-walking latch every frame: DNp09 stayed suppressed and the
  character reversed into a corner for the rest of the run. Measured: frozen at
  `(-0.60, 5.60)` for 32 s. MDN is phasic now, with a 1.5 s refractory, and the
  contact sensor reaches 0.035 m further than the resolver pushes. Walked
  distance over 40 s went from 7.4 m to 49.8 m.

The sword geometry was also measured rather than guessed, after two bugs that
only a measurement would have caught: the brain was swinging from 1.40 m with a
blade that reaches 0.79 m, and the cut swept between 0.56 and 1.12 m while every
fly hovered at 1.42 m -- **it passed under the target every time**. The pose axes
were mislabelled: for a blade along +X, `rotation.z` is elevation, not
`rotation.x`.

## The characters

Four, selectable at runtime, built to the same skeleton:

| | hair | glasses | facial hair | shirt |
|---|---|---|---|---|
| curly | clustered volume | yes | moustache and beard | mustard |
| cropped | close crop | yes | full beard | light grey |
| shaggy | cap with locks | no | stubble | dark olive |
| clay | none | no | none | untextured, wireframe head |

**These are primitives and MeshStandardMaterial, not photoreal renders.** What
they match is what a silhouette carries: hair shape and volume, glasses, facial
hair, shirt colour, build. Calling it photoreal would be a lie about the
renderer.

Both weapons are carried at once, following the reference pose: **katana in the
right hand, carbine in the left**, neither stowed. Each is held one-handed, so
each arm solves to exactly one grip, and the hands sit on the grips to 0.000 m.
The firearm is a shortened carbine because a full-length rifle held in one hand
reads as a mistake rather than a style.

## The look of it

The geometry is the circular maze -- see **The maze, and the three algorithms
that solve it** below. This section is what it is made of.

**Sky.** `#87ceeb`, as `scene.background` and as the fog colour. The maze has
walls and no ceiling, so what is overhead is genuinely visible from inside it,
and the fog has to be the same colour as the sky or distant corridors fade
toward a horizon that is not there.

**Light.** A hemisphere light carries the ambient with sky above and carpet
below, and the sun only has to draw the shadow. That is what keeps shadows
subtle rather than black: under an open sky most of the light inside a shadow is
skylight, so modelling it that way is both the cheaper and the more accurate
thing. The sun sits higher and further round than the old key light, so walls
cast down corridors instead of along them; the counter-fill is tinted sky rather
than white, so faces the sun misses sit in blue instead of going flat grey.

**Floor.** Deep red carpet, `#6e181f`. The weave is generated, not loaded: a
128 px tile of speckle plus a faint directional rib, tiled at about 0.5 m, which
is enough to stop 800 m2 of one flat colour reading as painted concrete. It
needs a canvas, so it only happens in a browser; node gets the flat colour and
does not care, because nothing headless looks at the floor.

**Skirting.** Already instanced alongside the walls, but at `0xdededa` it was
near-white on a near-white wall and separated nothing. It is now `0x2f2a2c` and
a little taller, because the only way a baseboard draws a line is by being
darker than both the things it sits between -- and with red carpet against white
walls, that join is now the strongest edge in the scene.

### The plants

Eleven potted plants, one in each dead end that has room for one, modelled on
the reference render of *Medinilla magnifica*: dark matte pot, whorls of big
deep-green ovate leaves, pink panicles that hang.

**They are not a loaded 3D model.** This project vendors three.js and nothing
else -- no GLTFLoader, no `.glb` -- and node runs these same modules in the
tests where there is no loader to fetch with. Every leaf is a two-curve
`ShapeGeometry` and every bloom is a sphere, the same way the characters and the
flies are built. What carries the species at a glance is the droop and the leaf
whorls, so that is what `world/plant.js` spends its geometry on.

**The whole set is instanced.** One `InstancedMesh` per part kind, shared by
every plant in the maze, so eleven plants cost eight draw calls rather than
eleven times forty. The walls had just been taken from 1756 meshes to two draws;
decor that gave that back would not have been worth having.

**They are solid at body height and transparent at fly height.** Plants push the
character out and show up on the frontal proximity probes, because walking into
one is a collision the avoidance pathway should see coming. They are *not* in
`lineOfSight()`: a plant is 1.05 m and the flies hover above it, so occluding on
one in a 2D test would be a lie in the other direction.

**And they are not in the open arena at all.** `open: true` exists because a
benchmark needs a controlled space, and a plant is a physical obstacle in the
middle of it. With them in, the character in `tools/smoke.mjs` went from 175
melee frames and a cut to zero of both -- it could still shoot, but it could no
longer close. Decor that changes what a measurement measures is not decor.

#### Where they stand

This took four attempts, and the reason is the same each time: a 2.0 m corridor
has very little to spare once a 0.32 m body and a 0.09 m wall are taken out of
it.

1. *At the cell centre.* The plant sat on the route's own waypoint, and
   `tools/maze.mjs` caught it -- 16 cell centres stopped being standable.
2. *Offset sideways toward the outer wall.* The waypoint cleared but the
   corridor did not. The march stalled at ring 4 having reached 23 of 163
   waypoints.
3. *Offset away from the dead end's one open neighbour, 0.62 m.* Clears the
   waypoint, but the check was still asking the wrong question. The plant that
   jammed the march was 0.62 m from waypoint 41 and stood beside the straight
   line from 41 to 42, leaving 8 cm of lane. **The character steers at the
   waypoint and has no path planner, so the lanes between waypoints are what
   have to be clear, not the waypoints.**
4. *Candidates, filtered.* Each dead end now offers a dozen or so positions --
   four depths into the pocket, three lateral offsets, both sides -- ordered
   deepest and most tucked-in first. Two tests cull them: one against the wall
   segments, one against every route *segment* with a
   `BODY_RADIUS + PLANT_RADIUS + 0.16` margin. The first survivor per pocket
   wins.

Five of the sixteen dead ends have no position that passes, and stay empty. That
is the filter working: those pockets are short enough that any plant in them
would be standing in the lane.

Measured on the final placement: **11 plants, tightest pot-to-wall clearance
0.048 m**, none outside the shell, every cell centre still standable, the whole
route still walked 163/163.

The collision radius is the **pot** (0.22 m), not the canopy. Foliage is
something a body brushes through and a pot is something it trips over -- and it
has to be, because a plant wide enough to block a waypoint cannot also fit
against the wall.

One consequence worth naming: the camera rides at 2.25 m and the plants top out
at 1.05 m, so `render/camera.js` passes `{ props: false }` and ignores them
entirely. The first version did not, and parked the camera outside every dead
end that had a plant in it -- 104 bad placements out of 2500. Both
`tools/maze.mjs` and `tools/smoke.mjs` assert the camera is never inside
geometry, and both now make the same exclusion, because counting a plant there
asserts something false by construction.

### The pictures

Seventy-seven images in `web/walker/art/`, hung on the maze walls. **These are the
only image files the project loads**, served from disk, so it is still offline
with no network. Everything else in the scene is geometry.

- **Arcs only, never radial walls.** A radial wall is one corridor wide, so a
  picture on it is seen edge-on from almost everywhere. Every picture goes on a
  curved wall, facing the corridor.
- **And never the outer shell.** Shell arcs carry `facing: -1`, and the hang
  offset reads that as "the far side" -- which for the boundary wall is the
  side with no maze on it. Measured before they were excluded: a shell picture
  sat at radius **15.802** against a shell of **15.700**, on the outward face,
  pointing at nothing. Nothing in the scene could see it and nothing in the
  tour could reach it, so it would quietly make "look at every picture"
  unsatisfiable. `tools/maze.mjs` asserts none are on the shell.

**More than one picture per arc.** One-per-arc capped the gallery at the
interior wall count, and the art folder overtook it: at 77 files against 70
arcs, seven were dropped -- and not at random. The manifest is alphabetical and
the loop walked it in order against shuffled arcs, so the same tail of names was
excluded on *every* load. `wolverine.jpg` could never appear.

Arcs now take as many frames as fit, laid out in metres along the arc with
0.45 m between neighbours and 0.35 m clear of each end. Arcs run 1.34 to 3.81 m
against frames of about 0.5-1.0 m, so most take two and the longest take three.
Capacity goes from 70 to roughly 114 without touching the shell, the radial
walls, or the size of the maze.

Leftovers are **returned, not swallowed**: `buildMaze()` reports
`unhungPictures`, and `tools/maze.mjs` fails if it is non-empty. The folder can
still outgrow the maze -- it just cannot do it quietly.
- **Frames are cut to the picture**, not the other way round. Pixel dimensions
  come from `art/manifest.js`, which `tools/artManifest.mjs` generates by
  reading the file headers -- the frame has to exist before the texture
  arrives, so the sizes cannot be discovered at load time. **Drop files into
  `art/` and re-run that tool; nothing else needs touching.**
- **Every picture hangs on the same 1.15 m diagonal**, rather than the same
  width or the same height. A tall portrait and a wide landscape then read as
  the same size of object on the wall, which neither of the other two rules
  gives. All of them are centred at 1.45 m.
- **A picture is skipped if it does not fit.** The arc it would hang on has to
  be at least 1.15x the frame's width, so nothing wraps past the end of its own
  wall. `tools/maze.mjs` asserts how many were hung, so a picture that finds no
  wall is not dropped in silence.
- **Which arc each one gets is a seeded shuffle.** Deterministic, so the tests
  and the scene agree; change the seed for a different hang.
- **Textures load only when there is a `document`.** Headless, the canvas stays
  a flat grey, `buildMaze()` stays synchronous, and the tests are unchanged.

One of them, `samurai.jpg`, is the reference pose the player rig was built from:
katana in the right hand, sidearm in the left, neither stowed.

## Two view modes, and nothing in between

The camera used to be one cycle of six shots, and the default was a half-and-half
called `orbit`: the angle and distance were the viewer's, but the pivot was
dragged along behind the character. That is the worst of both. The view moves on
its own, so it is not yours; and it does not frame anything in particular, so it
is not a shot either.

There are two modes now and they do not blend:

| | FREE (the default) | FOLLOW |
|---|---|---|
| who moves the camera | only the viewer | only the rig |
| mouse | rotate, zoom, pan | **off** |
| the character | walks the maze on his own | is framed by the shot |
| `C` | switches into FOLLOW | picks the shot |

**FOLLOW switches the mouse off** rather than letting drags fight the rig. A
drag that is overwritten on the next frame is worse than a drag that does
nothing: the first looks broken, the second looks deliberate. The whole
separation is one line -- `controls.enabled = mode === 'free'` -- and
`setViewMode` is the only thing that sets either.

FREE has two one-off moves, because a camera that never follows will eventually
lose him: **FIND HIM** (`G`) moves the pivot onto the character while keeping
the angle and distance the viewer chose, and **WHOLE MAZE** (`B`) pulls back to
the opening shot. Both happen once when pressed. Neither starts a follow.

The page opens on the whole maze, since in FREE nothing will ever move the
camera on the viewer's behalf and the first frame has to be somewhere worth
starting from.

### Checked, because "separate" is a property of the source

FREE is free precisely because no line in its branch writes the camera, and that
is easy to undo by accident -- one `controls.target.lerp(...)` added for a good
reason and the view quietly starts dragging itself after the character again.
`tools/imports.mjs` reads the branch out of `main.js` and fails if it contains
`camera.position`, `controls.target` or either goal vector. It also fails if
`viewMode` is assigned anywhere but `setViewMode`, which is what would let the
mode and the input state disagree.

It strips comments before looking, because the branch explains itself by naming
the things it must not do -- the check failed on its own comment the first time
it was run.

## The camera, and why it sits above the maze

A corridor is 2.0 m wide and the body is 0.64 m across. There is no room in
there for a third-person camera at head height: it ends up either inside a wall
or pressed against the back of the character's head, which is exactly what it
did.

The follow camera therefore sits **above the 2.6 m walls** and looks down, so
the corridor, the turns ahead and the pictures on the far wall are all in shot.

Two bugs had to be fixed for that to work, and both were invisible to the tests
because the tests only asked about occlusion:

- `lineOfSight` is a **2D** test and knows nothing about height, so it rejected
  every camera position in a corridor even when the camera was above the wall.
  Above `MAZE.height` there is nothing to test, and it now returns early.
- `clampToRoom` clamped the camera to `ROOM.h - 0.25`, which is 2.35 m -- just
  *under* the 2.6 m walls, the one height from which nothing is visible. The
  vertical clamp is now generous.

Measured over 172 placements: 100% stay above the walls, 91% keep the full
4.6 m boom.

`C` cycles follow, shoulder, POV, duel, top and free. **Free** hands the camera
to OrbitControls with the target left where the last mode put it, so the view
does not jump: drag to turn round the character, wheel to pull in and out.

### POV has its own field of view, specified horizontally

three.js takes a **vertical** fov, and one fixed vertical number cannot serve
both a shot that watches him and a shot that is him. At the 50 degrees the
cinematic shots use, a 16:9 window gives only **79 degrees horizontal** -- a
fine long lens for watching a character, and a drinking straw to look through
as one.

Worse, a fixed vertical fov means the horizontal field *shrinks with the
window*: 73 degrees at 16:10, 64 at 4:3. Narrow the browser and it silently
zooms in.

POV is therefore specified horizontally at **100 degrees** and the vertical is
derived from the aspect -- the Hor+ convention every first-person game uses:

| window | vertical | horizontal |
|---|---|---|
| 21:9 | 53.4 | 100.0 |
| 16:9 | 67.7 | 100.0 |
| 16:10 | 73.4 | 100.0 |
| 4:3 | 83.6 | 100.0 |
| 1:1 | 85.0 | 85.0 |

Past a vertical ceiling of 85 the horizontal gives way instead, because holding
100 horizontal on a square window drives the vertical to 100 as well and that
is a fisheye.

**100 is a convention, not a measurement, and the difference is worth stating.**
Geometric correctness -- the fov at which the screen subtends the same angle as
the scene -- is about 40 degrees at a desk, and it feels like a telescope
precisely because it throws away the peripheral awareness a person has. Human
binocular vision is around 120 degrees and no flat monitor reproduces it. 90-100
is where games land, and this is not a place the project can derive its way to
an answer.

The eye height **is** derived: 1.666 m, from eye height standing at 0.936 of
stature, the same anthropometry `world/human.js` takes the hip at 0.530H and the
shoulder at 0.818H from. It was 1.60. The aim point also sat 0.08 m below the
eye, tilting the whole view a third of a degree downward for no reason; it is
level now, and rides on `body.y` so a knocked-down character takes the view with
him.

## Radar

A circular, heading-up map in the left column. It draws **what the brain knows,
not what is there**:

- solid blip -- observed this step (frontal field, in range, clear line of sight)
- hollow ring -- the tracker coasting on memory, sized by confidence
- red circle -- the currently locked target
- nothing at all -- a fly the character cannot see and has forgotten

Walk behind a partition and a contact goes hollow, then vanishes. That is the
point of drawing it this way: the radar makes occlusion and working memory
legible instead of quietly showing ground truth.

Wall geometry comes from `wallSegments()`, derived from the same constants the
room is built from, so the map cannot disagree with the room.

## The maze, and the three algorithms that solve it

The objective is the puzzle in the reference image: a circular maze where the
rule is to cover every corridor and finish in the middle. Three pieces of
textbook graph work do it, and they are in `world/mazeGraph.js` with no geometry
and no three.js so they can be reasoned about on their own.

**1. Generation -- randomised DFS (recursive backtracker).** A polar grid of
129 cells over 7 rings, with 256 possible corridors. The carve visits every cell
once and keeps 128 corridors, which is exactly `n - 1`: a spanning tree. The
maze is therefore *perfect* -- every cell reachable, exactly one simple path
between any two, no loops. That property is what makes step 3 correct, and it is
asserted rather than assumed.

**2. Shortest path -- BFS.** Entrance to centre, `O(V+E)`. On a tree it is the
only simple path.

**3. Full coverage ending at the centre.** A depth-first walk of a tree crosses
every edge exactly twice and returns to where it started, which is the wrong
place to finish. So the walk is *ordered*: at each node on the entrance-to-centre
path, explore the subtrees that do **not** contain the centre first -- each of
those returns to the node -- and take the branch that does contain the centre
**last**.

The raw DFS still unwinds back to the entrance at the end, so the walk is cut at
its last visit to the centre. Everything after that point is spine edges being
retraced on the way out, and each was already covered on the way in, so the cut
loses no coverage and puts the finish where the puzzle wants it.

Measured over five seeds, all passing:

| seed | route | corridors | shortest path |
|---|---|---|---|
| 1 | 181 moves | 128/128 | 77 |
| 7 | 202 moves | 128/128 | 56 |
| 23 | 217 moves | 128/128 | 41 |
| 99 | 193 moves | 128/128 | 65 |
| 4242 | 238 moves | 128/128 | 20 |

Off-route corridors are walked twice and on-route corridors once, which is the
minimum possible for a tree. The route is always longer than the direct path --
that is the cost of the rule -- and never more than twice the corridor count.

## Marching it

The character follows the route as a waypoint list. What makes that work is that
**locomotion and weapons are decoupled**: the legs follow the route and nothing
pulls them off it, while the aiming brain points independently at whatever flies
are about. With the approach pathway left switched on, a fly drifting past would
drag the character away and the march would never finish.

One control change was needed. Forward drive now falls off with the turn angle
(`cos` of the bearing to the waypoint, floored at 0.25). Walking flat out at
something 90 degrees off to the side means walking into whatever is straight
ahead, which in a 2 m corridor is a wall. Forward and angular velocity are
anti-correlated in walking flies too -- forward speed drops through a saccade.

Corridors were widened from 1.6 m to 2.0 m for the same reason: 1.6 left only
0.39 m of clearance either side of the body, and the march ground along the
walls instead of walking down them.

Verified end to end in `tools/maze.mjs`: from the rim to the centre, all 163
waypoints, 408 m walked in 350 s of simulated time, using the same brain, the
same collision and the same route the browser runs.

## What he does first, and what he does last

The legs take one instruction at a time, and the order is fixed:

1. **Settle a score.** A fly that got a hit in is dealt with before anything.
2. **Turn onto a fly the rifle cannot reach.** The rifle slews independently of
   the body, so the legs only get involved when the target is behind him or has
   been heard and not yet seen. Anything in front he shoots while walking.
3. **Look at a picture** -- and only with nothing seen and nothing heard.
4. **March.**

**Flies come before art, always.** The art is what he does with a clear field.
That ordering is also why the centre is no longer locked behind the pictures:
gating the exit on the art put it ahead of both the flies and the march, which
is the opposite of the order above. Reaching the middle ends the run; the
pictures are counted, not charged at the door.

**"A clear field" had to be defined, not assumed.** The first version tested for
nothing seen and nothing heard at all -- the full 11 m sight range. MEASURED at
eighty flies: two runs in three looked at **zero** pictures in ten minutes. With
that many about, "nothing in range" essentially never happens, so the lowest
priority was not merely last, it was unreachable. The test is now a threat
radius (`ART_CLEAR`, 5.5 m): ten pictures in all three runs, and still two of
three reaching the centre.

**The grudge was the other half of it.** Settling a score with a fly that landed
used to hold the legs for **8 s**, and at eighty flies a landing gets through
about every seven seconds -- one grudge ran into the next and he was almost
never marching. It is 2.5 s now, and it clears the moment the offending fly
dies, which with the faster slew is usually sooner than that.

Turning onto a fly **overrides the march, so it has to be able to run out.**
MEASURED: without a budget, one run at twenty flies reached 59% of the route in
twelve minutes -- a fly sat behind him, he turned toward it forever, and the
march never advanced. He now gets 1.6 s of turning before the march takes
priority back, and 2.2 s of marching before he may turn again.

A second thing that starved the march: the waypoint was ticked off only on the
frames the march owned the heading. With eighty flies the march owns barely half
of them, so ground he had already covered while fighting did not count. The
waypoint is ticked off wherever he has got to now, whatever was steering.

## The picture tour

`tour.js`. Each picture gets **1.2 s**, and the dwell only counts down while the
character is actually facing it (within 0.45 rad), so walking past with a
picture off to one side does not count as looking at it.

He **slows to a third** for a picture rather than stopping, and he stops
volunteering for new ones once ten have been seen.

Both numbers were 3.5 s and *every picture*, and between them they were most of
what made the march look broken: sixty-nine pictures at a proper look each is
three and a half minutes of standing still, and `required` only decided when the
centre opened, so the interruptions ran to the end of the route either way.
MEASURED over the headless march: **25% of frames below full speed with the
quota still uncapped, 5% with it capped** -- and wall contact fell from 17% of
frames to 5% with it.

The notice radius is **measured, not guessed**. Against the coverage route the
furthest any picture's standing spot sits from the nearest route point is
2.15 m, identical across every seed. At the original 1.7 m only 23 to 29 of the
36 were ever reachable, so "see every picture" was a rule the maze could not
satisfy. 2.4 m clears the worst case with 0.25 m to spare.

### Stopping, rather than being switched off

The stop in front of a picture is a **descending command, not a multiplier on
the position**. That distinction is the whole of a bug that was visible from the
first frame: the gate used to zero the body's translation and nothing else, so
the CPG carried on at full drive and the character stood in front of each
picture marching on the spot, legs striding, going nowhere.

Two things fixed it, and both were needed:

- **`halt` reaches `walkDrive` in `brain/index.js`.** The walking circuit is
  told it has stopped rather than being overruled after the fact. Because DNp09
  is a rate unit with a time constant, drive decays instead of snapping, and
  `world/gait.js` scales the whole pose by speed -- so the legs straighten on
  their own without a second animation path.
- **The gate scales the wish velocity, and the pose reads the achieved one.**
  One quantity, and the legs cannot disagree with the body about it because
  they are reading what the body actually did.

The stop is now produced rather than smoothed. It used to be an eased multiplier
on the position -- a 0.12 s time constant chosen to look right; it is now
`WALK_BRAKE` decelerating a velocity, and the 0.13 m roll-on falls out instead
of being dialled in. See **Momentum** below.

`tools/maze.mjs` makes the same stop, or its dwell counts would be measuring a
march the scene does not run.

Verified headlessly in `tools/maze.mjs`: 163 of 163 waypoints, 430 m, ten
pictures looked at on the way past, 5% of frames below full speed.

## Eighty flies

The count went from eight to eighty, which breaks in two places at once.

**Drawing.** One fly is 42 meshes. At eight that is 336 draw calls and nobody
notices; at eighty it is 3,360, doubled again by the shadow pass. `world/swarm.js`
builds ONE prototype fly, never adds it to the scene, and each frame poses it
once per fly and harvests its world matrices into one `InstancedMesh` per part.
MEASURED: **42 draw calls and 2.25 ms/frame for eighty flies**, against 3,360
meshes before.

**Collision.** The maze is about 880 wall segments, and every fly tests them
twice a step. At 120 Hz that is seventeen million distance tests a second before
anything is drawn. `world/maze.js` now files each segment into a 2 m uniform
grid, so a query touches four cells instead of the whole plan -- 3.9 segments
per cell.

The grid is a **pure optimisation and was checked as one**: bucket order is not
segment order, and the collision solver is iterative, so the first version
quietly changed behaviour (smoke melee went to zero). Candidates are insertion
sorted back into segment order, and the result is now bit-identical to brute
force over 8,000 queries.

**Perception.** The aiming brain evaluates only the **nearest ten**. The
line-of-sight test is the expensive part and the tracker locks onto one fly at a
time regardless, so testing all eighty bought nothing. The cut is at
`AIM.maxRange`, which is wider than `hearingRange`, so nothing that could have
been seen or heard is dropped by it.

## The life line

`life.js`. Landings cost life; at zero the run is over and the restart is the
only way on. Before this, a run could be bitten a hundred times and still stroll
to the centre.

The numbers are **measured, not chosen**. `tools/pressure.mjs` runs the real
march -- coverage route, same brain, same rifle and sword, same landing test --
with the swarm present, and reports what happens. Three seeds each:

| pool | recovery | result at 80 flies |
|------|----------|--------------------|
| 12 | 1 per 9 s after 14 s | every run over inside 90 s, about a seventh of the route |
| 48 | 1 per 3 s after 8 s | recovery outran the landings; no run could be lost |
| 60 | 1 per 5 s after 11 s | 1 of 3 reached the centre; losses at 84% and 92% |
| 72 | 1 per 5 s after 11 s | 2 of 3 reached the centre; the loss at 99% |

Then `FLY_CLEAR_RADIUS` went from 0.30 to 0.40 to stop the flies hanging through
the walls, and the balance moved with it. Keeping them off the walls puts more
of them in the open corridor where he is:

| | landings per run | reached the centre |
|---|---|---|
| radius 0.30, pool 72 | 82-97 | 2 of 3 |
| radius 0.40, pool 72 | 87-113 | **0 of 3** |
| radius 0.40, pool **88** | 97-120 | 2 of 3, the loss at 74% |

A correctness fix moving a balance number is the normal case rather than a
surprise, and it is the reason the pool is measured instead of chosen: the same
tool that set it the first time reset it without any argument about taste.

At eighty flies a landing gets through about every seven seconds and a coverage
run takes nine or ten minutes, so a run has to absorb something like ninety of
them. The grace window matters more than the pool: eleven clear seconds is rare
with eighty flies about, so recovery is something that happens when he has
actually cleared the area rather than a trickle that makes the pool meaningless.

Final measured run: 97 to 120 landings absorbed, 132 to 134 flies killed.

## The swing, integrated rather than keyframed

`world/sword.js`. The first version eased a parameter from 0 to 1 with a
smoothstep, which describes a position, not a motion: the blade had no momentum,
the wind-up and the follow-through were the same curve reversed, and the arc read
as pushed rather than swung.

The blade is a one-degree-of-freedom rigid body now. `u` is where it is along
its arc, `w` is how fast, and the only things written per frame are **torques**:

```
u" = T(phase) - c u'        semi-implicit Euler, substepped to 240 Hz
```

| phase | torque |
|-------|--------|
| wind-up | small negative; cocks it back over the shoulder |
| drive | large positive; the muscular effort |
| follow | a **brake** -- opposes motion, quits at zero |
| recover | critically damped spring back to the carry |

The brake is the part that had to be got right. A constant negative torque
instead of a brake yanks the blade back up the arc it has just come down, which
reads as a flinch; `tools/swing.mjs` checks for exactly that.

Everything that reads as physical falls out of the integration rather than being
drawn on. MEASURED by `tools/swing.mjs`:

- peak tip speed **26.4 m/s at u = 0.58** -- a hard human cut is roughly
  20-30 m/s at the tip, and it is fastest a little past the middle of the arc
  rather than at either end
- wind-up to **u = -0.23**, follow-through stopping at **u = 0.96**: it carries
  past the target line because it has momentum
- live edge sweeps **0.91 to 2.13 m**, and the flies hover at 1.42 m

The contact test comes off the same state: the edge is live **where the blade is
and while it is moving fast enough to cut**, not during a fixed slice of the
clock. A blade that has been slowed is not quietly still lethal.

### The brain has to know when the edge goes live

Ordering a cut does not make the edge live; the blade has to be wound up and
driven first, which takes **0.217 s**. A fly crosses about a fifth of a metre in
that time, which is most of the reach -- so testing where it *is* orders a swing
at a place it has already left.

`AIM.swingLead` carries that delay and the melee test uses the tracker's
velocity to ask where the fly *will be*, which is the same leading solution the
rifle already used, applied to the other weapon. `tools/swing.mjs` fails if the
constant and the measured live window drift apart.

MEASURED effect, same smoke scenario: **1 cut per 12.9 s of melee contact before,
2 cuts per 2.3 s after.**

### The arc it leaves behind

The trail was a fixed ring geometry with its opacity turned up during the cut,
so it was in the same place whatever the blade did. A motion trail is a record of
where something has been, so it records it: the blade's root and tip are sampled
into a 26-entry ring buffer and drawn as a ribbon, hot at the leading edge and
gone at the tail.

It lives in the **player's** space, not the sword's and not the world's. In the
sword's space nothing moves relative to it and there is nothing to draw; in world
space it is left behind as he walks.

## Both hands, on whichever weapon is being used

`world/player.js`. The hands were glued one to each weapon -- right on the
katana, left on the carbine, always. Both weapons carry a second grip point, so
the free hand now moves onto the weapon actually in use:

| state | left hand | right hand |
|-------|-----------|------------|
| shooting | pistol grip | **crosses to the forend** |
| cutting | **crosses to the lower tsuka** | tsuka |
| carrying | pistol grip | tsuka |

Nothing is stowed or hidden in any of them; it is the same silhouette with the
hands where they would actually be. The blend is eased, because a hand that
teleports between two grips is worse than a hand on the wrong one.

`poseHuman` takes the hold **per arm**, so the hand that is only carrying keeps
some of the gait's counter-swing instead of being clamped to its grip. The cut
also drives the torso: the shoulders lead the blade round and the weight drops
into it, both read off the same integrated state as the blade, which is what
keeps them in step with it without a second clock to keep in sync.

## Momentum, borrowed from Godot

`world/body3d.js`. The bodies accelerate, carry velocity, fall, and slide along
walls instead of being shoved out of them.

**It is Godot's `CharacterBody3D`, ported, not a physics engine.** `move_toward`
for acceleration, `move_and_slide` for contact, `is_on_floor` for ground state.
Godot is a separate engine and cannot be a dependency here -- this project
vendors three.js and nothing else, has no build step, and runs the same modules
under node in the tests -- but its character controller is a well-worn answer to
exactly this problem, and the answer ports in about a hundred lines. Reaching
instead for a rigid-body engine (Rapier, Jolt) would have meant a WASM
dependency, a build step, and headless tests that can no longer run the scene's
own code.

### What it replaced

Movement used to be written straight onto the position:

```js
body.x += Math.sin(yaw) * speed * dt
resolveCollision(...)        // then shove out of any overlap
```

Two faults. The body reached full speed in one frame and stopped in one frame,
so every start and stop was a cut rather than a move. And the push-out *fought
the command*: the brain kept steering into the wall, the push-out kept shoving
back, and the body buzzed along the surface.

Sliding fixes the second properly. Rather than only moving the body out of the
wall, it removes the **into-the-wall component of the velocity**, so what is
left runs along the surface. The body stops pushing and starts sliding.

| | before | after |
|---|---|---|
| frames of the march in contact | 11% | **5%** |

### Measured, with the walls taken away

| | |
|---|---|
| reach 1.75 m/s | 0.200 s |
| stop | 0.158 s over **0.132 m** |
| drift between velocity and facing, 0.6-2.0 rad/s turns | **0.0 deg** |

The drift number is the one that had to be checked. Momentum on a walking biped
is wrong if it lets him slide wide through a turn -- people do not do that. He
does not either: `move_toward` steps the velocity *vector* toward the wish
vector, and at 1.75 m/s even a 2.0 rad/s turn needs only 3.5 m/s2 of the 9.0
available, so heading and travel stay locked together. What *does* separate them
is a wall, and that is the slide working.

`WALK_ACCEL` 9.0 and `WALK_BRAKE` 11.0 m/s2 are picked so the 0.13 m roll-on
matches what the picture dwell was already tuned around. Faster is a teleport
again; slower and he skates.

### The flies keep their old dynamics on purpose

The flies get the slide but **no inertia**: their velocity is rewritten from
their heading every frame, so only the wall response changes. The escape reflex
is what `tools/experiment.mjs` measures, and a fly that has to accelerate out of
a jink is a different animal from the one those numbers describe.

That the character's momentum did not disturb the benchmark either was checked
rather than assumed, by re-running it with the acceleration set effectively
infinite -- which reproduces the old teleport:

| | reflex gap | ratio |
|---|---|---|
| teleport (accel = 1e6) | 25.4 points | 2.38x |
| with the controller | 26.0 points | 2.36x |

0.6 points against standard deviations around 2. The controller is invisible to
the measurement, which is what it had to be.

### And what it still is not

There is no mass, no inertia tensor, no restitution, no joints. Gravity runs and
`onFloor` is tracked, but with nothing to fall off, the character stays on the
floor at `y = 0`. **He still cannot be knocked down**, and that limitation is
still listed below. A kinematic controller that is honest about being kinematic
is the part of Godot worth taking.

The tour is what sets the run length, not the maze. Every picture added is
another 3.5 s of dwell plus whatever walking it takes to reach it, and the
centre stays shut until all of them are seen -- so the art folder is now the
main term in how long a run takes.

## The table, the chair, and sitting down

`world/furniture.js` builds the round pedestal table and the chair from the
reference sheet, in metres: 800 mm top at 750 mm high on a 500 mm foot, and a
chair 500 mm square with the seat at 450 mm and the back at 820 mm. Primitives
rather than FBX or OBJ, because this project ships no model loader -- everything
in the scene is generated.

They are **decoration only**: not in `segs`, so not in collision and not in
sight lines. Making them solid would put an obstacle on the one waypoint the
route has to finish on.

**The seated pose is solved, not eyeballed.** Both joints fold to a right angle,
which is not a stylistic choice: with the thigh horizontal and the shank
vertical the pelvis sits exactly one shank above the ankle -- 0.432 m -- so it
lands on a 0.505 m seat with the feet on the floor. The first attempt used 1.45
and 1.55 rad and the feet finished **5.9 cm through the floor**, because a thigh
that is not horizontal eats into that drop.

## Reaching the centre

Getting inside the goal disc does not end it immediately. The character eases
onto the exact middle and **turns all the way round over 16 seconds**, and only
then is the run declared over.

That turn is scripted rather than steered -- the yaw is set directly instead of
coming out of DNa02 -- because the point is a steady look at the room, and a
controller chasing a moving bearing does not give one. It is the one place in
the scene where the body is not being driven by the circuit, and it is marked as
such in the code.

The arrow keys turn the model by hand, at any time. They rotate the body the
viewer sees without touching the heading the brain believes, so the compass
readout stays honest. **LOOK AROUND** hides the result card so the room is
visible; **RESTART** generates a new maze from a new seed.

One honest limit: the paintings are not visible from the centre. The maze walls
are floor to ceiling, which is the whole point of a maze, so the turn is a
finish rather than a gallery view. Press `C` for POV and use the arrows if you
want to look at them properly.

## Why the benchmark is not run in the maze

`tools/duel.mjs` builds an **open circular arena** (`buildMaze({ open: true })`,
every corridor carved) rather than the maze. It measures the escape reflex
against the fire control, and in a real maze the flies are almost never in line
of sight -- the first run in the maze fired zero shots in thirty seconds.
Occlusion noise would swamp the effect being measured. A controlled measurement
needs a controlled space, and the alternative is a number that means nothing.

`tools/smoke.mjs` uses a smaller open arena for the same reason, sized down
because in the full 31 m one the flies are shot at range long before any of them
closes and the melee path never runs at all.

## Turning to a threat behind

A fly behind the character used to be safe: the visual field is the frontal
+/-75 degrees, so nothing outside it existed. There are now two channels.

| | frontal | peripheral |
|---|---|---|
| Coverage | +/-75 deg | 360 deg |
| Range | 11 m | 6.5 m |
| Blocked by walls | yes | yes |
| Gives | position, velocity, a firing solution | presence and a rough bearing |
| Bearing error | 0.018 rad | **0.22 rad** |

The peripheral channel is not a second pair of eyes. The scene fly beats its
wings at 13.7 Hz and that is the cue -- it carries presence and a coarse
bearing, no range and no velocity, and it is twelve times less accurate in
bearing than the eyes. It cannot aim. All it can do is start a turn, and that is
all it does: `orientBearing` becomes the steering goal, the body rotates until
the contact enters the accurate frontal field, and the ordinary engage path
takes over.

It is consulted **only** when the frontal field is empty, so it can never
override the accurate channel. The radar draws these contacts as a wedge on the
rim rather than a blip in the room, because there is no range to place them at
and drawing one would invent information.

This is how people work too: something is heard off to one side, the body turns,
and only then does the accurate channel get a look at it.

## Reflexes

Every aiming constant was set for eight slow flies. Against eighty, he was still
bringing the weapon round while the next one landed on him.

| | was | now |
|---|-----|-----|
| slew rate | 3.4 rad/s | 6.4 |
| fire tolerance | 0.045 rad | 0.055 |
| confidence to fire | 0.55 | 0.40 |
| cooldown | 0.55 s | 0.26 |
| tracker alpha / beta | 0.45 / 0.11 | 0.62 / 0.19 |
| aim blend | 5/s | 11/s |

Higher alpha trusts the new observation more, so the estimate converges in fewer
frames. It is noisier, but a solution that arrives late is worth nothing.

## Why the controls felt stiff

Reported as "zooming is slow, rotating is slow, any movement is slow" after the
fly count went up. It was not the frame rate, and it was not the character.

`OrbitControls` applies `dampingFactor` of the **outstanding** movement **per
frame** and decays the rest. Two things follow, and both were wrong:

- **It is a per-frame fraction, not a speed.** At 0.08 a twelfth of a drag lands
  each frame, so the view trails the cursor through the whole gesture instead of
  catching up at the end of it.
- **It is therefore frame-rate dependent.** The same drag takes twice as long in
  wall-clock at 30 fps as at 60. That is the link to the fly count: ten times
  the flies made the frame longer, and the camera got correspondingly slower to
  answer. Nothing about the camera had changed.

The factor is now recomputed from the real frame time against a fixed time
constant, `CAM_RESPONSE = 0.055 s` -- the same treatment the look target already
got. MEASURED in `tools/smoke.mjs`:

| frame rate | fixed 0.08 | scaled to dt |
|------------|-----------|--------------|
| 30 fps | 933 ms to 90% | **133 ms** |
| 60 fps | 467 ms | **133 ms** |
| 144 fps | 194 ms | **132 ms** |

1 ms of spread across the three, against 739 ms before.

Wheel zoom is **multiplicative** -- one notch scales the distance by
`0.95^zoomSpeed` -- so `zoomSpeed` 1.1 meant 5% a notch and **70 notches** to
cross the 1.2 m to 60 m range. At 2.4 it is 32. `rotateSpeed` and `panSpeed`
are up as well, to 1.15 and 1.2.

## One second per second

There was a 1x/2x/4x clock here and it is gone. A person does not move at 4x,
and a run watched at 4x is not the run. The length of a run is a property of the
route, not of the clock: `M` switches to the BFS shortest path if the full
coverage walk is more than is wanted.

What replaced it is making sure his pace is genuinely constant:

- **The accumulator cannot drop time above 7 fps.** `MAX_SUBSTEPS` is 16 at a
  120 Hz step, so a frame as long as 133 ms is still simulated in full. Dropping
  time is the one thing that makes his pace inconsistent -- he visibly slows
  whenever the frame rate dips -- so the cap sits well below any frame rate
  worth rendering at.
- **Being knocked about is a limp, not a switch.** `score.speedScale` was
  `stun > 0 ? 0.25 : 1` -- a step function. The body has momentum and absorbed
  some of it, but `yawRate` is scaled by it directly, so every landing snapped
  the turn rate. With eight flies that read as a stumble; with eighty a landing
  gets through every seven seconds and the run became a series of jolts. It
  eases back over the 0.9 s stun now. MEASURED in `tools/smoke.mjs`: the worst
  single frame changes his speed by **1.04%**, against 75% for the step it
  replaced, and the recovery never goes backwards.

## Frame cost

Reported as lag. The measurements:

**The pixel ratio was the whole game.** It was `min(devicePixelRatio, 2)`. On a
2x display that is FOUR times the pixels of a 1x one for the same window, and
every part of the frame scales with it. The ceiling is 1.5 now, and a governor
moves it between 1.5 and 0.7 from the frame time actually being achieved, so the
machine decides rather than a constant written here. It acts at most once every
700 ms -- changing the ratio reallocates the drawing buffers -- and has a dead
band between 13 ms and 22 ms per frame so it cannot oscillate.

**Eighty flies were casting shadows.** That draws the entire swarm a second time
into the shadow map every frame, for a handful of 2 cm smudges under a body that
is usually 1.4 m in the air and over a wall from the light. The most expensive
thing in the scene that nobody can see. Off.

**The panels ran at frame rate.** Two dozen `textContent` writes force a style
recalculation each time, and the compass, gait raster and radar are full 2D
canvas repaints. They run at 15 Hz now. Nobody reads a number at 60 Hz. The 3D
render is deliberately outside that throttle -- throttling the scene would be
the stutter this is meant to remove.

What was NOT the problem, PROFILED at eighty flies per 120 Hz step: flight
brains 413 us, wall collision 176 us, line of sight 17 us -- **1.21 ms of a
16.7 ms frame** at 60 fps with two substeps. The simulation was never the cost.

## Stuck at the same poster

Reported from the browser. The march test passed and `tools/stall.mjs` with a
clear room showed every picture costing about `dwell` and no more, so the bug
was not in the tour on its own -- it needed the flies.

`notice` (2.4 m) decides which picture is worth stopping for, but it only ever
gated **acquiring** one. Once a picture was current there was no distance limit
and no time limit at all. That is invisible with nothing else going on, because
an attempt runs straight through in about a second. In the scene the tour only
runs with the ground clear, so with eighty flies about an attempt is cut off
within a second or two and resumed whenever it next clears -- by which time he
has marched on. It then steered him BACK, from anywhere, with the march
suppressed the whole time.

MEASURED by `tools/stall.mjs`, which reproduces it with a duty cycle rather than
eighty flies, because the thing under test is the tour's bookkeeping:

| ground busy | worst single picture | steered from |
|---|---|---|
| 0% | 1.5 s | 1.6 m |
| 30% | 4.8 s | 2.7 m |
| 60% | 11.2 s | 7.2 m |
| **85%** (what eighty flies produce) | **71.8 s** | **19.0 m** |

Nineteen metres is most of the width of the maze.

Two limits fixed it, and both are needed -- distance alone leaves him stuck in
front of one he cannot face, time alone lets him walk the maze backwards first.
He gives up past **3.8 m** (1.6x notice, so shuffling in front of one is fine)
or after **5 s of actually attempting it**. The time is time spent steering, not
wall clock: frames where the tour is suppressed do not count, or a busy room
would abandon every picture untried. The picture is not marked viewed -- he
simply stops being dragged to it, and may pick it up again on the way past.

After: at most **3.9 s and 3.8 m at every duty cycle from 0% to 95%**.

## Going through the walls

Also reported: the sword, the carbine and the flies all pass through the
partitions. Collision here is a circle in the XZ plane -- the character keeps
`BODY_RADIUS` 0.32 m clear, each fly kept 0.30 m -- which says nothing about the
geometry hanging off them.

`tools/clearance.mjs` measures the world-space extent of everything that sticks
out, at many positions and angles. Two of the three were real:

| | reaches | room available | verdict |
|---|---|---|---|
| katana | 1.06 m | 0.95 m tightest | **23% of swings through a wall**, up to 0.04 m |
| carbine | 0.49 m | 0.95 m tightest | never; not a problem at all |
| fly | 0.42 m at the corner of its footprint | 0.345 m of clearance | **0.077 m of fly on the far side** |

**The carbine was never doing it.** Worth saying, because it was reported as one
of the three: the compact barrel only reaches 0.49 m and the corridor gives
0.95 m. Nothing was changed there.

**The flies** were flown at a 0.30 m radius while the built model is 0.329 m
wide and 0.422 m corner to corner -- wings and legs stick out well past the
0.534 m body it is scaled by. And `resolveCollision` keeps `radius + wallT` from
a wall's CENTRE line while the face is only half a thickness in, so the real
clearance was 0.345 m. `FLY_CLEAR_RADIUS` is 0.40 now, which gives 0.445 m
against 0.422 m of fly. It is a separate constant from `FLY_HIT_RADIUS`, because
how much room something needs and how big it is to shoot at are different
questions.

**The katana** gets the answer a person would use: bring the point up.
Elevating the blade shortens its horizontal reach by cos(elevation) without
shortening the blade, so it is the one adjustment that costs nothing but the
angle. `applyWeaponPose` now takes the distance to the nearest wall face --
`roomAround` in `world/maze.js` -- and stands the blade up between 1.06 m of
room and 0.85 m. Measured after: **0 of 260 swings**, and melee effectiveness
went up rather than down (3 cuts in the smoke run against 2), because the tuck
only engages where a swing was going through a wall anyway.

## Known limitations

- Occlusion is modelled for walls and nothing else. A fly is visible within 75
  degrees of frontal, within 11 m, and with a clear line to it -- `lineOfSight()`
  in `world/maze.js` crosses the segment against the same wall segments
  everything else uses. The plants are deliberately excluded: they are 1.05 m
  and the flies hover above them, so blocking sight on one in a 2D test would be
  a lie in the other direction. Working memory is exercised by real occlusion as
  well as by field-of-view exits.
- Wings are posed kinematically. There is no aerodynamics anywhere.
- No balance model. The character cannot fall over.
- The flies are attracted to the character and orbit at a fixed standoff with
  timed approach runs. That is authored behaviour, not a foraging model.
- Cut halves are cloned and share materials with the live fly, so they shrink
  out rather than fading.

## Files

```
web/walker/
  index.html          page, overlays, import map
  main.js             scene, both agents, the closed loop
  scale.js            body lengths, Froude retiming, the fly size note
  score.js            reward, punishment, and their two consequences
  life.js             the pool of landings, and running out of it
  tour.js             the pictures, and the ten he has to look at
  brain/
    neuron.js         rate units, ring populations, seeded RNG
    connectome.js     cell-type notes, MEASURED counts, weights
    centralComplex.js EPG ring attractor, PFL3 steering
    descending.js     DNa02, DNa01, DNp09, MDN
    vnc.js            six leg CPGs, tripod -> biped mapping
    sensory.js        ER, looming, LoVP92, AOTU012
    flight.js         wingbeat, altitude, LPLC2 -> giant fiber, approach runs
    forage.js         correlated random walk, area-restricted search
    zoro.js           tracker, intercept, multi-target, aim, fire, melee
    index.js          assembly
  art/                the pictures, the only image files loaded
  world/
    mazeGraph.js      the polar graph, the carve, BFS, the coverage walk
    maze.js           walls, carpet, collision, sight lines, pictures, plants
    plant.js          Medinilla magnifica from primitives, instanced
    body3d.js         Godot-style controller: accelerate, fall, slide
    human.js          four characters, anthropometry, arm IK
    gait.js           measured human walking kinematics
    player.js         the rig: human plus both weapons, and which hand is where
    swarm.js          eighty flies in 42 draw calls
    rifle.js  sword.js  fly.js  laser.js
  render/
    hud.js            compass, DN bars, gait raster, both brains
    camera.js         follow rig, pulled clear of walls but not of plants
  tools/              serve, validate, smoke, maze, duel, experiment, imports
                      swing     the blade's trajectory, speed, and reach
                      pressure  how survivable the march is at a fly count
                      stall     what holds him up, and for how long
                      clearance what goes through a wall, and how far
                      (imports also checks every id main.js reads is in the page)
  vendor/             three.js r169, MIT, vendored for offline use
```

## Credits

MaleCNS v1.0, Janelia FlyEM and Google Research, CC BY 4.0.
HuMoR, Rempe et al., ICCV 2021 -- reference for the motion approach, not a
dependency.
three.js r169, MIT.
