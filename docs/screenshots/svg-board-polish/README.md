# SVG board polish

Captures of the illustrated SVG board from PR #43 and the terrain emblems it
shares with the resource cards and the entry island, in `after/`. See the
[work record](../../aegis/work/2026-10-31-svg-board-polish.md).

`after/` comes from the `feat/board-visual-polish` head, served from the
`pnpm build` output with `WEB_DIST_PATH` set, in headless Chromium at device
scale factor 1 with reduced motion. The run plays a real three-player game: the
setup and about 45 turns are driven through the HTTP API with legal moves from
each player's own hints.

The entry page with the shared emblems on its island is
`current/01-entry-1366x768-zh-Hant.png`; the script's `entry-1366x768.png` was
byte-identical to it and is not kept here. The `before/` comparison from
`6d1cb97` was removed in the 2026-11-07 review and remains in git history at
`b8d0d1f`.

| File | Viewport | State |
|---|---|---|
| `svg-board-1366x768.png` | 1366×768 | SVG board surface (`?renderer=svg`) at the default fit |
| `svg-closeup-1366x768.png` | 1366×768 | the same board after three zoom-in steps |
| `svg-phone-390x844.png` | 390×844 | phone portrait table |
| `hand-1366x768.png` | 1366×768 | expanded hand: resource card art uses the same emblems |

Regenerate into a new, empty directory after `pnpm build`, with the service
running (`UI_BASE_URL` defaults to `http://127.0.0.1:3000`):

```sh
python3 scripts/svg-board-polish/capture.py <new empty directory>
```

The script makes no assertions beyond failing on a browser runtime error.
