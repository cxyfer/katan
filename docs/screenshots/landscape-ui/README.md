# Landscape one-page layout

Captured on 2026-10-31 from the `pnpm build` output served with
`WEB_DIST_PATH` set, with a real three-player game. Entry, room creation,
joining, ready and start go through the UI; setup placements and later turns
advance through the same HTTP API the client uses, choosing legal moves from
each player's own `hints`, until it is the host's turn. The game is then
finished the same way for the result screen. Every capture is at device scale
factor 1, in zh-Hant.

On every landscape viewport it visits (1366×768, 1920×1080, 1280×720,
1024×600, 844×390 and 667×375) the script asserts that the page itself does not
scroll and that each screen's key controls are reachable: after scrolling the
control into view inside its own panel, it lies fully inside the viewport and
nothing covers its centre. On the result screen it also opens the final board's
legend and display settings and asserts that each stays inside the viewport
while its toggle can still be clicked. It checks all six sizes for each screen and saves only
the sizes listed below. Portrait viewports still fall back to a single scrolling
column and are only photographed.

| File | State |
|---|---|
| `01-entry-*` | entry: title and island on the left, nickname card on the right |
| `02-home-*` | home; at 844×390 the menu shrinks to an icon rail |
| `03-lobby-*` | lobby with three ready players: seats, room settings and policy, invite code and start in three columns; `390x844` and `1024x1366` are the portrait fallback |
| `04-setup-1366x768` | opening placement with the setup guide |
| `05-table-*` | table on the host's turn: both rails collapsed (they open on hover), camera controls and legend in one row, dice beside the resource tally; `390x844` is portrait |
| `06-trade-1366x768` | trade tool |
| `07-result-*` | result: outcome and final board on the left, post-game statistics on the right |
| `08-result-timeline-1366x768` | statistics timeline tab, scrolling inside its panel |

`before/` holds the same states on `master` at `6d1cb97`, captured by an
ad-hoc driver against the dev server: the lobby and entry screens only show the
first viewport of a page that scrolls, the legend floats above the camera
controls (at 1024×600 the scoreboard toggle overlaps them), the dice share the
lower-right corner with the build rail, and at 844×390 the home menu and panel
stack and overflow.

Regenerate into a new, empty directory after `pnpm build`, with the service
running (`UI_BASE_URL` defaults to `http://127.0.0.1:3000`):

```sh
python3 scripts/landscape-ui/capture.py docs/screenshots/landscape-ui-new
```

The script needs Python Playwright with a Chromium it can launch.
