# Landscape one-page layout

Captured on 2026-11-01 from `e3cf207` (the `pnpm build` output served with
`WEB_DIST_PATH` set), with a real three-player game. Entry, room creation,
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
while its toggle can still be clicked. It checks all six sizes for each screen and saves the
sizes listed below. Portrait viewports still fall back to a single scrolling
column and are only photographed.

This set keeps only the sizes `current/` does not cover. The script also saves
the 1366×768 captures (`01-entry`, `02-home`, `03-lobby`, `04-setup`,
`05-table`, `06-trade`, `07-result` and `08-result-timeline`); they show the
same states as `current/` and are not kept here, so copy only the files listed
below after a run.

| File | State |
|---|---|
| `01-entry-844x390` | entry: title and island on the left, nickname card on the right |
| `02-home-844x390` | home; the menu shrinks to an icon rail |
| `03-lobby-{1024x600,844x390}` | lobby with three ready players: seats, room settings and policy, invite code and start in three columns |
| `03-lobby-{390x844,1024x1366}` | the same lobby in the portrait fallback |
| `05-table-{1920x1080,1024x600,844x390}` | table on the host's turn: both rails collapsed (they open on hover), camera controls and legend in one row, dice beside the resource tally |
| `05-table-390x844` | the same table in portrait |
| `07-result-844x390` | result: outcome and final board on the left, post-game statistics on the right |

Regenerate into a new, empty directory after `pnpm build`, with the service
running (`UI_BASE_URL` defaults to `http://127.0.0.1:3000`):

```sh
python3 scripts/landscape-ui/capture.py docs/screenshots/landscape-ui-new
```

The script needs Python Playwright with a Chromium it can launch.
