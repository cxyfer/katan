# Board visual polish

Before/after captures for the sculpted 3D island. See the
[work record](../../aegis/work/2026-10-31-board-visual-polish.md).

`before/` was captured from `6d1cb97` (`origin/master`); `after/` from
`23e0fdb` on `feat/board-visual-polish`, whose 3D code matches this set. Both
use the `pnpm build` output served with `WEB_DIST_PATH` set, headless Chromium
with SwiftShader WebGL, device scale factor 1 and reduced motion. Each run plays
a real three-player game: the setup and about 24 (before) or 45 (after) turns
are driven through the HTTP API with legal moves from each player's own hints,
so piece counts differ between the two sets while the fixed starting layout is
the same.

| File | Renderer | Viewport | State |
|---|---|---|---|
| `r3f-board-1366x768.png` | 3D (`?renderer=r3f`) | 1366×768 | board surface at the default fit |
| `r3f-closeup-1366x768.png` | 3D | 1366×768 | the same board after three zoom-in steps |
| `r3f-phone-390x844.png` | 3D | 390×844 | phone portrait table (after only) |
| `island-preview-1600x1000.png` | 3D (`?preview=island`) | 1600×1000 | standalone 19-hex island preview |
| `island-preview-r56-1600x1000.png` | 3D | 1600×1000 | 30-hex extended island (after only) |
| `island-preview-r56-low-1600x1000.png` | 3D, low quality | 1600×1000 | the same island without shadows or antialiasing (after only) |

Regenerate into a new, empty directory after `pnpm build`, with the service
running (`UI_BASE_URL` defaults to `http://127.0.0.1:3000`):

```sh
python3 scripts/board-polish/capture.py <new empty directory>
```

The script also captures the SVG board. It makes no assertions beyond failing on
a browser runtime error. SwiftShader output shows shapes and colour, not GPU
frame time.
