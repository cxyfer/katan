# SVG board polish

Before/after captures for the illustrated SVG board and the terrain emblems it
shares with the resource cards and the entry island. See the
[work record](../../aegis/work/2026-10-31-svg-board-polish.md).

`after/` comes from the `feat/board-visual-polish` head, served from the
`pnpm build` output with `WEB_DIST_PATH` set, in headless Chromium at device
scale factor 1 with reduced motion. The `svg-*` files in `before/` were captured
the same way from `6d1cb97`; `entry` and `hand` in `before/` are copies of
`current/01-entry-1366x768-zh-Hant.png` and
`hand-cards/02-hand-expanded-1366x768-zh-Hant.png` (`79c1039`). Each run plays a
real three-player game: the setup and about 24 (before) or 45 (after) turns are
driven through the HTTP API with legal moves from each player's own hints, so
piece counts differ while the fixed starting layout is the same.

| File | Viewport | State |
|---|---|---|
| `svg-board-1366x768.png` | 1366×768 | SVG board surface (`?renderer=svg`) at the default fit |
| `svg-closeup-1366x768.png` | 1366×768 | the same board after three zoom-in steps |
| `svg-phone-390x844.png` | 390×844 | phone portrait table (after only) |
| `entry-1366x768.png` | 1366×768 | entry page: the island illustration uses the shared emblems |
| `hand-1366x768.png` | 1366×768 | expanded hand: resource card art uses the same emblems |

Regenerate into a new, empty directory after `pnpm build`, with the service
running (`UI_BASE_URL` defaults to `http://127.0.0.1:3000`):

```sh
python3 scripts/svg-board-polish/capture.py <new empty directory>
```

The script makes no assertions beyond failing on a browser runtime error.
