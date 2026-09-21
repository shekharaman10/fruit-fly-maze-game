// The gallery, and what happens when there isn't one.
//
// `manifest.js` is GENERATED from whatever image files sit in this folder, by
// tools/artManifest.mjs, and it is not in git -- neither it nor the pictures
// are. The repo ships an empty gallery on purpose: the art in the maze is
// whoever's art you put there, and a clone should not arrive carrying somebody
// else's 38 MB of posters.
//
// So the import has to survive the file not being there at all. A fresh clone
// has no manifest, and a static `import ... from './manifest.js'` would be a
// hard module-resolution failure that takes the whole scene down with it. The
// dynamic import below fails softly instead, and the maze builds with bare
// walls.
//
// To hang your own: drop images in this folder and run
//
//     node web/walker/tools/artManifest.mjs
//
// or just start `tools/serve.mjs`, which does it for you on every boot.
// See README.md here.

// .mjs, not .js, and that matters. There is no package.json here, so node
// decides a .js file's module type by sniffing its syntax -- and the top-level
// await below made it guess CommonJS and fail. The extension removes the guess.
// Browsers do not care either way; they go by the served MIME type.

/** @type {Array<[file: string, widthPx: number, heightPx: number]>} */
let ART = [];

try {
  ({ ART } = await import('./manifest.js'));
} catch {
  // No manifest: an empty art folder, or the tool has not been run yet. Both
  // are ordinary states, not errors, so nothing is logged in the browser --
  // the walls are simply blank and every test still passes.
}

export { ART };
