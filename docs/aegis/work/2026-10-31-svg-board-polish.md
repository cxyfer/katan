# SVG board polish and shared terrain emblems

## Scope

User request: the SVG board looked bare; make it more refined. Starting point:
`6d1cb97` (`origin/master`), later merged with `6afeeda`. Worktree
`.worktrees/board-visual-polish`, branch `feat/board-visual-polish`.

Presentation only. No rules, protocol, persistence or projection changes. Board
indices, target overlays, inspection, animation hooks and the renderer fallback
contract are untouched. The 3D board work that started on this branch moved to
`feat/board-3d-coast`; this branch leaves `packages/web/src/board/three/` and
`packages/web/public/og-image.png` exactly as on `master`.

## Shared coastline

`packages/web/src/board/coastline.ts` chains every topology edge that touches a
single land hex into closed, counter-clockwise loops with per-corner outward
miters (`hex-r2`: 30 shore edges, `hex-r56`: 44). The SVG board draws its
shore from it. The file and `coastline.test.ts` are byte-identical to the copies
on `feat/board-3d-coast`, so both branches can merge independently.

## SVG board

`SvgBoardArt.tsx` holds the board art; `SvgBoard.tsx` keeps every test hook
(`hex-N` with its terrain fill, `.board__terrain` letter/glyph, `robber`,
`harbor-*`, `road-*`, `building-*`, drop/reveal classes).

- Stepped shallows, a dashed swell, surf and a sand rim from the shared coastline.
- Each tile keeps its flat fill and adds a texture pattern, a light gradient and an inner bevel.
- Each tile keeps the original single-icon language: one centred emblem on an
  earthen plate above the number token, redrawn with two-tone light (pines with
  a broadleaf, snow-capped peaks, a strata-lined clay hill with a dimensional
  brick stack, five wheat stalks, a large and a small curly-wool sheep by a
  fence, shaded dunes with a distant rock and a cactus). Probability pips are
  drawn dots and the terrain letter/glyph tag sits left of the token.
  An earlier iteration that scattered small scenes around a centred token was
  dropped after review in favour of the single icon.
- Harbours are two-plank jetties to a badge with ratio and resource glyph; the `<title>` names the harbour in the current locale with its resource letter.
- Roads have a dark outline and highlight, keep the seat dash pattern, and are inset at their ends.
- Settlements and cities are drawn with a lit face and a shaded side.
- The robber is a hooded figure to the right of the token instead of over it.

## Shared terrain emblems

The emblems live in `components/TerrainArt.tsx`. `TerrainIllustration`
(resource card art, cost chips in the action list, production flights) draws
the same emblem, mapping each resource to its terrain, so the board, the cards,
the small resource icons and the entry/result island illustration share one
drawing. The island illustration also gains a sand rim and shallows like the
board. The flat corner `ResourceGlyph` symbols and the logo (`HexEmblem`, seven
solid-colour cells) are unchanged.

## Verification

- `scripts/svg-board-polish/capture.py` captures the entry page, then drives a
  real three-player game through the HTTP API and captures the SVG board at
  desktop, close-up and phone sizes plus the expanded hand; it fails on any
  browser runtime error. Captures are in `docs/screenshots/svg-board-polish/`.
- `svg-board-art.test.tsx`: two boards in one document share no `id`, every
  `url(#…)` paint resolves inside its own board, each tile has one emblem, and
  every harbour badge (radius plus half its stroke) sits outside its land hex and
  inside the view box, the memoised tile layer redraws after a layout change,
  and harbour titles are localized.
- `pnpm verify` passes: typecheck; rules 138, protocol 7, server 99 (11
  PostgreSQL-only skipped), web 538 tests in 53 files; build, smoke, `test:dev`.

## Review follow-ups

- The view box padding grows from 0.35 to 0.55 hex and harbour badges sit 32
  units off the coast, so sand and badges stay inside the SVG fit instead of
  sliding under the side rails on a phone. Target projection reads the same
  view box, so hit targets stay aligned.
- Shore, tiles, emblems and tokens render in a memoised `StaticTiles` layer, so
  pan and zoom frames only re-render roads, buildings, the robber and the ghost.
- Same-style shapes are merged into single paths (wool circles, brick faces,
  wheat kernels). The board drops from 1,597 to 1,194 SVG elements; a jsdom
  lobby test that mounts the board went from about 800 ms back to about 500 ms
  (`master`: about 490 ms) after a first `pnpm verify` timed out its 1 s
  `findBy` under parallel load.
- A second subagent review found nothing high or medium; its low items are
  fixed here: badge stroke inside the padding, localized harbour titles, the
  emblem class renamed to `terrain-emblem`, and dead `.board__robber` and
  text-pip CSS removed.
- `coastline.ts` treats a vertex shared by two separate land regions and inland
  sea holes naively. Only disabled rulesets could produce such boards; the file
  stays byte-identical to the 3D branch's copy, so a fix belongs in a follow-up
  that both branches share.

No physical-device, screen-reader or 200% zoom check was run.
