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
| Mountains / gold | seven-sided pyramids | faceted rock masses with jittered rings, scree, rock tones, a ragged snow line, alpine pines, gold seams on gold tiles |
| Hills | a stepped cylinder and a torus | rolling clay mounds with strata and grassy crowns, a brick kiln with smoke, two brick pallets |
| Desert | dunes, one cactus, bones | adds a banded sandstone butte, a spire and dry scrub |
| Number tokens | plain cylinder | turned disc with chamfered foot, rounded rim and dished face |
| Light | — | slightly warmer key, cooler back rim |

`ModelBuilder.addPainted` and `PaintedMesh` bake multi-tone faceted parts into
the same single vertex-coloured draw path as before. All terrain models still
pass the existing lane, token-well, height, determinism and closed-volume
checks; footprints are clamped to keep a 0.335 radius well so every chord stays
outside 0.3.

## Verification

- `pnpm verify` passes: typecheck; rules 138, protocol 7, server 99 (11
  PostgreSQL-only skipped), web 534 tests in 52 files (adds `coastline.test.ts`);
  build, smoke and `test:dev`.
- `scripts/board-polish/capture.py` drives a real three-player game through the
  HTTP API and captures both renderers at desktop, close-up and phone sizes,
  plus the island preview; it fails on any browser runtime error. The 3D
  captures are in `docs/screenshots/board-polish/`.

Headless Chromium uses SwiftShader, so these captures say nothing about GPU
frame time. No physical-device, screen-reader or 200% zoom check was run.
