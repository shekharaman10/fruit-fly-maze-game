# Your pictures on the maze walls

**Put image files in here and they become the paintings hanging in the maze.**
Nothing is hard-coded; the gallery is whatever you drop in.

One picture ships, so a clone is not a blank gallery: Arnold Böcklin's
*Self-Portrait with Death Playing the Fiddle* (1872). Böcklin died in 1901, so
it is public domain — which is exactly why it is that painting and not anything
else. Delete it if you would rather start clean.

## Two steps

```
1. copy any .jpg / .jpeg / .png / .webp files into this folder
2. node web/walker/tools/serve.mjs      # http://localhost:8173/
```

That is all. The server regenerates the manifest every time it starts, so a
refresh is enough after adding more. If you are serving the files some other
way, run the generator yourself:

```
node web/walker/tools/artManifest.mjs
```

**With no images at all, everything still works** — the maze builds, the
character walks it, the tests pass. The walls are just bare.

## What happens to a picture you add

- **It gets a frame cut to its own shape.** Pixel dimensions are read from the
  file header, so a tall portrait and a wide landscape both hang correctly
  instead of being squeezed into one frame size.
- **Every picture hangs on the same 1.15 m diagonal.** Not the same width or
  the same height — the same diagonal, which is what makes a portrait and a
  landscape read as the same *size of object* on the wall.
- **It goes on a curved wall, never a radial one.** A radial wall is one
  corridor wide, so a picture on it would be seen edge-on from almost
  everywhere.
- **Never on the outer shell.** Those walls face outward, so a picture there
  would hang on the far side of the boundary pointing away from the maze.
- **Where it lands is a seeded shuffle**, so the hang is deterministic — the
  same files give the same gallery every run — but not alphabetical.
- **Long walls take several.** Frames are laid out along an arc with 0.45 m
  between them and 0.35 m clear of each end, so a 3.8 m wall takes three.

## How many fit

About **114**, from 70 interior walls. Past that, files start finding no wall;
they are reported rather than dropped in silence, and `tools/maze.mjs` fails
with the names of the ones left homeless.

## Formats and sizes

`.jpg`, `.jpeg`, `.png`, `.webp`. The type is sniffed from the file's magic
bytes, not its extension, so a PNG misnamed `.jpg` still works.

Anything goes, but **prefer JPEG around 1000 px on the long edge**. Textures are
decoded on the main thread and uploaded to the GPU the first time they come into
view, so a folder of 3 MB PNGs will hitch as you walk. A 2048 px PNG costs about
12 MB of video memory whatever its file size.

## Why none of this is committed

Both the pictures and the generated `manifest.js` are in `.gitignore`, with one
exception: the Böcklin above. The art is yours, the repo should not ship someone
else's, and image files in git history are there forever whether you want them
or not — which is also why the one that does ship is out of copyright.

`index.mjs` is the other file here that *is* committed: it loads the manifest if
there is one and shrugs if there is not.
