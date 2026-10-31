# Board visual polish: a sculpted 3D coast

## Scope

User request: the SVG board looked bare and the 3D board's modelling was not
refined enough; redesign and remodel where needed. Starting point: `6d1cb97`
(`origin/master`). Worktree `.worktrees/board-visual-polish`, branch
`feat/board-visual-polish`. The 3D island and the shared coastline were split
into branch `feat/board-3d-coast` (this record); the SVG redesign stays on
`feat/board-visual-polish`.

Presentation only. No rules, protocol, persistence or projection changes. Board
indices, target overlays, inspection, animation hooks and the renderer
fallback contract are untouched.

## Shared coastline

`packages/web/src/board/coastline.ts` chains every topology edge that touches a
single land hex into closed, counter-clockwise loops with per-corner outward
miters. The 3D island derives its shoreline from it (`hex-r2` has 30 shore
edges, `hex-r56` 44); the SVG redesign is meant to reuse it so both renderers
share one outline.

## 3D board

| Area | Before | After |
|---|---|---|
| Sea | one flat colour with a faint ripple | baked shore distance field drives shallow → mid → deep water, a surf line and a broken swell line |
| Coast | boxes and rocks along each outer edge | continuous smoothed sand skirt from under the tile rim to below the waterline, with boulders, pebbles, dune grass and driftwood |
| Tile tops | one colour per terrain | finely triangulated caps with noise-painted tones, a darker rim, a packed-earth ring round the token and terrain-specific furrows or ripples; whole-sixth rotation varies each tile |
| Forest | conifers along the back half | a dense mixed wood across the whole tile (tiered spruce, round broadleaf trees), a stack of sawn logs and a stump with an axe |
| Mountains / gold | seven-sided pyramids | faceted rock masses with jittered rings, scree, rock tones, a ragged snow line, alpine pines, gold seams on gold tiles; a timber-framed mine with rails, a loaded ore cart and an ore (or nugget) heap |
| Hills | a stepped cylinder and a torus | terraced clay pits with turf ledges and strata, a beehive kiln with chimney smoke and firewood, two pallets of fired brick |
| Fields | single wheat stalks | ridged grain plots over dark soil with nodding heads (one plot green-gold per variant), a windmill with lattice sails, stooks on the stubble |
| Pasture | five small sheep and a fence | grassy knolls, seven fleecy sheep, a split-rail fence, hay bales and a shade tree |
| Desert | dunes, one cactus, bones | lee-steep dunes, a banded butte and spire, a sandstone arch, a palm oasis with reeds, a saguaro and bleached bones |
| Harbors | jetty with a sign and boat | adds a stone abutment, cross bracing, a framed sign, a lantern, a lofted hull with gunwale and pennant, and cargo matching the trade (logs, brick, wool bales, grain sacks, ore, or a barrel for 3:1) |
| Robber | hooded figure of primitives | a lathe-turned draped cloak with folds and a pale hem, a peaked hood that slumps back over a shadowed masked face, a red scarf, belt, a loot sack, a dagger and a lantern |
| Number tokens | plain cylinder | turned disc with chamfered foot, rounded rim and dished face |
| Light | — | slightly warmer key, cooler back rim |

`ModelBuilder.addPainted` and `PaintedMesh` bake multi-tone faceted parts into
the same single vertex-coloured draw path as before. All terrain models still
pass the existing lane, token-well, height, determinism and closed-volume
checks; footprints are clamped to keep a 0.335 radius well so every chord stays
outside 0.3. Round features (trees, oasis, palms) size themselves to the room
left between the lanes and the well. Harbors batch by trade so each type can
carry its own cargo.

## Sharpness

The 3D board looked soft on high-DPI screens: the standard-quality canvas was
capped at 1.5× device pixels, so a 2× display upscaled it. The cap is now 2×
(low quality stays at 1×); in a DPR 2 headless check the canvas renders
2580 px for a 1290 px wide element. The number and harbor label atlas is drawn
from its 1024 px SVG into a 2048 px canvas texture with trilinear mipmaps and up
to 8× anisotropy, so labels stay crisp when zoomed in and stop shimmering when
zoomed out. The extra pixels cost GPU fill rate on 2× screens; low quality
remains the fallback for weak devices.

## Verification

- `pnpm verify` passes: typecheck; rules 138, protocol 7, server 99 (11
  PostgreSQL-only skipped), web 537 tests in 52 files (adds `coastline.test.ts`; terrain, harbor and robber
  checks follow the new models);
  build, smoke and `test:dev`.
- `scripts/board-polish/capture.py` drives a real three-player game through the
  HTTP API and captures both renderers at desktop, close-up and phone sizes,
  plus the island preview; it fails on any browser runtime error. The 3D
  captures are in `docs/screenshots/board-polish/`.

Headless Chromium uses SwiftShader, so these captures say nothing about GPU
frame time. No physical-device, screen-reader or 200% zoom check was run.
