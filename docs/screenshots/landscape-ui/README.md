# Landscape one-page layout

Captured on 2026-10-31 from the `pnpm build` output served with
`WEB_DIST_PATH` set, with a real three-player game. Entry, room creation,
joining, ready and start go through the UI; setup placements and later turns
advance through the same HTTP API the client uses, choosing legal moves from
each player's own `hints`, until it is the host's turn. The game is then
finished the same way for the result screen. Every capture is at device scale
factor 1, in zh-Hant.

The script asserts one thing: on every landscape viewport it visits
(1366×768, 1920×1080, 1280×720, 1024×600 and 844×390) the page itself does not
scroll. It checks all five sizes for each screen and saves only the sizes listed
below. Portrait viewports still fall back to a single scrolling column and are
only photographed.

| File | State |
|---|---|
| `01-entry-*` | entry: title and island on the left, nickname card on the right |
| `02-home-*` | home; at 844×390 the menu shrinks to an icon rail |
| `03-lobby-*` | lobby with three ready players: seats, room settings and policy, invite code and start in three columns; `390x844` is the portrait fallback |
| `04-setup-1366x768` | opening placement with the setup guide in the right column |
| `05-table-*` | table on the host's turn; 1366×768 and 1920×1080 dock the scoreboard and build list beside a framed board, 1024×600 and 844×390 keep the collapsible rails, `390x844` is portrait |
| `06-trade-1366x768` | trade tool, opened over the board instead of the scoreboard |
| `07-result-*` | result: outcome and final board on the left, post-game statistics on the right |
| `08-result-timeline-1366x768` | statistics timeline tab, scrolling inside its panel |

`before/` holds the same states on `master` at `6d1cb97`, captured by an
ad-hoc driver against the dev server: the lobby and entry screens only show the
first viewport of a page that scrolls, the table keeps both rails collapsed,
and at 844×390 the home menu and panel stack and overflow.

Regenerate into a new, empty directory after `pnpm build`, with the service
running (`UI_BASE_URL` defaults to `http://127.0.0.1:3000`):

```sh
python3 scripts/landscape-ui/capture.py docs/screenshots/landscape-ui-new
```

The script needs Python Playwright with a Chromium it can launch.
