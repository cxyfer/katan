# Board visual polish

Before/after captures for the illustrated SVG board and the sculpted 3D
island. See the [work record](../../aegis/work/2026-10-31-board-visual-polish.md).

`before/` was captured from `6d1cb97` (`origin/master`); `after/` from the
`feat/board-visual-polish` head. Both use the `pnpm build` output served with
`WEB_DIST_PATH` set, headless Chromium with SwiftShader WebGL, device scale
factor 1 and reduced motion. Each run plays a real three-player game: the setup
and about 24 (before) or 45 (after) turns are driven through the HTTP API with
legal moves from each player's own hints, so piece counts differ between the
two sets while the fixed starting layout is the same.

| File | Renderer | Viewport | State |
|---|---|---|---|
| `svg-board-1366x768.png` | SVG (`?renderer=svg`) | 1366×768 | board surface at the default fit |
| `svg-closeup-1366x768.png` | SVG | 1366×768 | the same board after three zoom-in steps |
| `svg-phone-390x844.png` | SVG | 390×844 | phone portrait table (after only) |
| `r3f-board-1366x768.png` | 3D (`?renderer=r3f`) | 1366×768 | board surface at the default fit |
| `r3f-closeup-1366x768.png` | 3D | 1366×768 | the same board after three zoom-in steps |
| `r3f-phone-390x844.png` | 3D | 390×844 | phone portrait table (after only) |
| `entry-1366x768.png` | — | 1366×768 | entry page: the island illustration uses the shared terrain emblems (before: copied from `current/01-entry`, `79c1039`) |
| `hand-1366x768.png` | SVG | 1366×768 | expanded hand: resource card art uses the same emblems (before: copied from `hand-cards/02-hand-expanded`, `79c1039`) |
| `og-image-1200x630.png` | 3D | 1200×630 | link preview image, a copy of `packages/web/public/og-image.png` (before: the `origin/master` file) |
| `island-preview-1600x1000.png` | 3D (`?preview=island`) | 1600×1000 | standalone 19-hex island preview |
| `island-preview-r56-1600x1000.png` | 3D | 1600×1000 | 30-hex extended island (after only) |
| `island-preview-r56-low-1600x1000.png` | 3D, low quality | 1600×1000 | the same island without shadows or antialiasing (after only) |

Regenerate into a new, empty directory after `pnpm build`, with the service
running (`UI_BASE_URL` defaults to `http://127.0.0.1:3000`):

```sh
python3 scripts/board-polish/capture.py <new empty directory>
```

`og-image-1200x630.png` comes from `scripts/og-image/render.py`, which
photographs the island preview from a near-overhead angle and composes it with
the fixed title layout.

The script makes no assertions beyond failing on a browser runtime error.
SwiftShader output shows shapes and colour, not GPU frame time.
