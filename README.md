# Fruit fly maze game

A man with a katana walks a circular maze, hunting flies. He is steered by fly
brain circuitry. So are they.

![over the shoulder](docs/cam-shoulder.gif)

Runs in a browser with **no build step, no npm install and no network**. Clone
it, start a static server, open the page.

```bash
node web/walker/tools/serve.mjs      # then open http://localhost:8173/
```

## Your pictures on the walls

The maze is a gallery, and it ships empty on purpose. **Drop image files into
`web/walker/art/` and they become the paintings**, framed to their own shape and
hung along the curved walls.

```bash
cp ~/wherever/*.jpg web/walker/art/
node web/walker/tools/serve.mjs      # rebuilds the gallery on every boot
```

Each picture gets a frame cut to its own pixel dimensions, hung on the same
1.15 m diagonal so a tall portrait and a wide landscape read as the same size of
object. Long walls take two or three, and every wall between two rings is hung
on **both** faces, so there is art whichever side you walk. About 130 fit. With
none at all, everything still works — the walls are just bare. Details in
[`web/walker/art/README.md`](web/walker/art/README.md).

## The cameras

`C` cycles five of them. Three, recorded separately:

**Free view** — orbit the whole maze from outside. The flecks of colour on the
walls are the pictures.

![free view](docs/cam-free.gif)

**Over the shoulder** — behind the character, hunting. This is the one at the
top of this page.

**POV** — first person, at 1.666 m eye height and 100 degrees horizontal.

![point of view](docs/cam-pov.gif)

The other two are `follow` and `duel`, which frames the character against
whichever fly is being engaged. Every one of these was recorded by
`tools/capture.mjs`; nothing was filmed by hand.

Two real paintings ship with the repo, so a fresh clone is not a blank gallery:
Vermeer's *Girl with a Pearl Earring* (c. 1665) and Arnold Böcklin's
*Self-Portrait with Death Playing the Fiddle* (1872). Both are public domain —
that is the test for anything going in. The Vermeer is the one hanging on the
right in the POV clip. The rest of the pictures in these recordings are
generated placeholders; the gallery is meant to be yours.

## Controls

| | |
|---|---|
| `C` | camera — follow, over-the-shoulder, POV, duel, top |
| `1`–`6` | swap character |
| `H` | hide the overlays |
| `L` | remove the compass landmark, and watch the heading drift |
| `space` | pause · `R` reset · `F` hold fire |

## What is real, and what is mine

The project is careful about this line, and
[`docs/walker.md`](docs/walker.md) draws it in detail.

**Follows published *Drosophila* circuitry:**

- **Head direction** is a ring attractor over 16 EPG wedges, rotated by a PEN
  pathway from angular velocity and pinned to a visual landmark by ER input.
  Take the landmark away with `L` and it dead-reckons, because that is what
  happens.
- **Steering** reads PFL3 at ±90° offsets, so the left-minus-right difference is
  proportional to `sin(goal − heading)`, and feeds DNa02 — whose published
  relationship to subsequent rotational velocity is linear.
- **Escape** is LPLC2 loom detection driving the giant fiber at a fixed ~5 ms
  latency, committed once triggered.
- **Search** is a correlated random walk with run-and-tumble reorientation,
  switching to area-restricted search when a target is lost.

**Mine, and not pretending otherwise:**

- Six coupled phase oscillators stand in for the 708 VNC leg motor neurons.
  Spike-to-muscle-force has no established mapping, so this is **an engineered
  gait whose parameters are modulated by circuit activity** — not "the
  connectome walks the body".
- The weights in `brain/connectome.js` are hand-tuned for a ~10-population
  model, not measured synapse counts. The *topology* follows the published
  circuit; the gains are tuned.
- The maze, the character, the flies, the weapons and the scoring are all
  authored.

Counts come from the **MaleCNS v1.0** connectome (Janelia FlyEM + Google
Research, CC BY 4.0), measured from the released files rather than from press
coverage: 166,700 neurons, 25,582,938 connections, 124,177,617 synapses, 1,314
descending neurons, 708 VNC leg motor neurons. Those first three are different
quantities and are routinely conflated.

## Things that were measured rather than guessed

- **Double support is 24% of the gait cycle** — and it is *derived*, not dialled.
  The two tripods of the fly CPG sit half a cycle apart, and a 0.62 duty factor
  gives `2 × (0.62 − 0.5)`. That is the 20–25% gait labs measure, falling out of
  a fly circuit driving human kinematics without either being adjusted to suit.
- **Momentum.** Borrowed from Godot's `CharacterBody3D`: `move_toward` for
  acceleration, `move_and_slide` for contact. From 1.75 m/s the character stops
  in 0.158 s over 0.132 m, with 0.0° of drift between facing and travel through
  a 2 rad/s turn. Sliding along walls rather than being shoved out of them
  halved the time spent in contact, 11% → 5%.
- **A 5 ms reflex with no target model beats a predictive solver** — but only
  when the jink clears the target's own width inside the projectile flight time.
  The first write-up missed that second half, and
  [`docs/negative-results.md`](docs/negative-results.md) records what happened
  when the arena changed underneath it.

## Tools

Everything runs headless in node, against the same modules the browser loads.

```bash
node web/walker/tools/validate.mjs   # the circuits, in isolation
node web/walker/tools/smoke.mjs      # the whole scene, no renderer
node web/walker/tools/maze.mjs       # generation, solving, and the full march
node web/walker/tools/experiment.mjs # the escape-reflex benchmark
node web/walker/tools/capture.mjs all  # re-record the camera GIFs
```

`capture.mjs` drives Chrome over the DevTools Protocol through node's built-in
WebSocket and assembles the GIF with Pillow — no puppeteer, nothing installed.

## Also in here

`amfly/` is the other half of the project: six copies of the MaleCNS connectome
run as leaky integrate-and-fire networks, bit-identical until something is done
to them. `godot-lab/` is a headless Jolt bench used to measure what a knocked-
down body does, because the walker has no balance model yet.

## Credits

MaleCNS v1.0 — Janelia FlyEM and Google Research, CC BY 4.0.
three.js r169, MIT, vendored for offline use.
Licence: see [`LICENSE`](LICENSE).
