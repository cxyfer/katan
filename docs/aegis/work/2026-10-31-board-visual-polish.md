# Board visual polish: illustrated SVG island and a sculpted 3D coast

## Scope

User request: the SVG board looked bare and the 3D board's modelling was not
refined enough; redesign and remodel where needed. Starting point: `6d1cb97`
(`origin/master`). Worktree `.worktrees/board-visual-polish`, branch
`feat/board-visual-polish`.

Presentation only. No rules, protocol, persistence or projection changes. Board
indices, target overlays, inspection, animation hooks and the renderer
fallback contract are untouched.

## Shared coastline

`packages/web/src/board/coastline.ts` chains every topology edge that touches a
single land hex into closed, counter-clockwise loops with per-corner outward
miters. Both renderers derive their shoreline from it, so the 2D and 3D islands
have the same outline for `hex-r2` (30 shore edges) and `hex-r56` (44).

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

## SVG board

`SvgBoardArt.tsx` holds the 2D art; `SvgBoard.tsx` keeps every test hook
(`hex-N` with its terrain fill, `.board__terrain` letter/glyph, `robber`,
`harbor-*`, `road-*`, `building-*`, drop/reveal classes).

- Stepped shallows, a dashed swell, surf and a sand rim from the shared coastline.
- Each tile keeps its flat fill and adds a texture pattern, a light gradient and an inner bevel.
- Each tile keeps the original single-icon language: one centred emblem on an
  earthen plate above the number token, redrawn with two-tone light (pines with
  a broadleaf, snow-capped peaks, a clay hill with a brick stack, five wheat
  stalks, sheep by a fence, a butte and cactus). Probability pips are drawn dots
  and the terrain letter/glyph tag sits left of the token.
  An earlier iteration that scattered small scenes around a centred token was
  dropped after review in favour of the single icon.
- Harbours are two-plank jetties to a badge with ratio and resource glyph (`<title>` keeps `2:1L`).
- Roads have a dark outline and highlight, keep the seat dash pattern, and are inset at their ends.
- Settlements and cities are drawn with a lit face and a shaded side.
- The robber is a hooded figure to the right of the token instead of over it.

## Verification

- `pnpm verify` passes: typecheck; rules 138, protocol 7, server 99 (11
  PostgreSQL-only skipped), web 533 tests in 52 files (adds `coastline.test.ts`);
  build, smoke and `test:dev`.
- `scripts/board-polish/capture.py` drives a real three-player game through the
  HTTP API and captures both renderers at desktop, close-up and phone sizes,
  plus the island preview; it fails on any browser runtime error. Captures are
  in `docs/screenshots/board-polish/`.

Headless Chromium uses SwiftShader, so these captures say nothing about GPU
frame time. No physical-device, screen-reader or 200% zoom check was run.
