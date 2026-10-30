# Review screenshots

Rendered states captured with headless Chromium (Playwright) against the built
client and a live service. They are **captured states for review**, not accepted
visual-regression baselines: no baseline comparison runs, and no physical-device,
touch, screen-reader or 200%-zoom evidence exists yet (`docs/FIDELITY.md`, gap 5).

## Layout

| Path | Contents | Captured from | Producer |
|---|---|---|---|
| [`current/`](current/) | Entry → home → lobby → setup → table → tools → post-game statistics, full three-player game, zh-Hant and en | `ac3844b` (2026-10-30) | [`scripts/screenshots/capture-current.py`](../../scripts/screenshots/capture-current.py) |
| [`hand-cards/`](hand-cards/) | Card faces from PR #27: collapsed/expanded hand fan, card inspect and development-card closeups (desktop, phone, landscape) | `ac3844b` (2026-10-30) | [`scripts/hand-cards/capture.py`](../../scripts/hand-cards/capture.py) |
| [`hover-details/`](hover-details/) | Map-detail tooltips and collapsed/expanded rails, desktop and mobile | 2026-10-30 | `scripts/side-rails/verify.py`, see [work record](../aegis/work/2026-10-30-hover-details.md) |
| [`table-ui-polish/`](table-ui-polish/) | Dice focus, hand-gain feedback, trade surface (desktop and mobile) | 2026-10-30 | `scripts/table-ui-polish/verify.py`, see [work record](../aegis/work/2026-10-30-table-ui-polish.md) |
| [`island-diorama/`](island-diorama/README.md) | Standalone 3D island preview at several camera angles and sizes, plus game-surface checks | 2026-10-29 | `scripts/board-3d/verify-diorama.py`, see [work record](../aegis/work/2026-10-29-island-diorama.md) |
| [`lobby-capacity/`](lobby-capacity/README.md) | Four-seat base and six-seat paired lobbies below capacity, plus the lowered-capacity state, desktop/mobile and both locales | 2026-10-30 | [`scripts/lobby-capacity/capture.py`](../../scripts/lobby-capacity/capture.py) |

`current/` and `hand-cards/` reflect the table as it is now. The other sets are
focused feature reviews kept with their work records; each was captured at the
commit named in its record.

## `current/`

Captured on 2026-10-30 from `ac3844b` (the `pnpm build` output served with
`WEB_DIST_PATH` set), with a real three-player game driven through the UI up to
the table. The game is then finished through the same HTTP API the client uses,
choosing legal moves from each player's own `hints`, so the result screen and
post-game statistics come from a completed game. Every capture is at device
scale factor 1. The script makes no assertions; it fails on any browser runtime
error. The two lobby captures are full page, because PR #29 added the room
settings plaque and the lobby is now taller than one 1366×768 viewport.

| File | Locale | Viewport | State |
|---|---|---|---|
| `01-entry-1366x768-zh-Hant.png` | zh-Hant | 1366×768 | entry: nickname and language switch |
| `02-home-1366x768-zh-Hant.png` | zh-Hant | 1366×768 | home after three nicknames are set: create/join |
| `03-lobby-waiting-1366x768-zh-Hant.png` | zh-Hant | 1366×768 | lobby right after the host creates the room, full page |
| `03-lobby-ready-1366x768-zh-Hant.png` | zh-Hant | 1366×768 | lobby with all three players ready and start enabled, full page (room settings and room policy plaques included) |
| `04-setup-1366x768-zh-Hant.png` | zh-Hant | 1366×768 | opening placement with the setup guide |
| `05-table-1366x768-zh-Hant.png` | zh-Hant | 1366×768 | table after the opening roll |
| `05-table-1366x768-en.png` | en | 1366×768 | the same table in English |
| `06-table-768x1024-zh-Hant.png` | zh-Hant | 768×1024 | tablet reflow |
| `07-table-390x844-zh-Hant.png` | zh-Hant | 390×844 | phone portrait |
| `07-table-390x844-en.png` | en | 390×844 | phone portrait in English |
| `08-table-844x390-zh-Hant.png` | zh-Hant | 844×390 | phone landscape |
| `09-trade-1366x768-zh-Hant.png` | zh-Hant | 1366×768 | trade tool open |
| `10-chat-1366x768-zh-Hant.png` | zh-Hant | 1366×768 | chat tool after sending one message |
| `11-trade-390x844-zh-Hant.png` | zh-Hant | 390×844 | trade tool on a phone |
| `12-result-overview-1366x768-zh-Hant.png` | zh-Hant | 1366×768 | result screen, full page: outcome, overview tab of the post-game statistics, final board |
| `12-result-overview-1366x768-en.png` | en | 1366×768 | the same result screen in English |
| `13-result-economy-1366x768-zh-Hant.png` | zh-Hant | 1366×768 | post-game statistics, economy tab (dice output, resource income, spending and losses) |
| `14-result-timeline-1366x768-zh-Hant.png` | zh-Hant | 1366×768 | post-game statistics, timeline tab (victory points per roll, dice distribution) |
| `15-result-390x844-zh-Hant.png` | zh-Hant | 390×844 | result screen on a phone, full page, timeline tab |

Regenerate into a new, empty directory after `pnpm build`, with the service
running (`UI_BASE_URL` defaults to `http://127.0.0.1:3000`):

```sh
python3 scripts/screenshots/capture-current.py docs/screenshots/current
```

The script needs Python Playwright with a Chromium it can launch.

## `hand-cards/`

Captured on 2026-10-30 from `ac3844b` (the `pnpm build` output served with
`WEB_DIST_PATH` set), with a real three-player game. The host keeps ending
turns until its hand holds enough cards, then the fan is captured collapsed and
expanded at desktop, phone and landscape sizes. The final group rewrites only
the host's own projection inside the browser (HTTP and WebSocket snapshots) to
show 17 resources and 5 development cards; no commands are sent for it. Every
capture is at device scale factor 1.

This set covers the card faces PR #27 introduced: full-bleed art with a corner
glyph, a name ribbon and a use caption, shared by resource and development
cards, plus the resource tally above the hand.

| File | Locale | Viewport | State |
|---|---|---|---|
| `01-hand-collapsed-1366x768-zh-Hant.png` | zh-Hant | 1366×768 | hand fan collapsed, resource tally on its top edge |
| `02-hand-expanded-1366x768-zh-Hant.png` | zh-Hant | 1366×768 | hand fan expanded: full-bleed resource card faces |
| `03-hand-collapsed-1366x768-en.png` | en | 1366×768 | collapsed hand in English |
| `04-hand-expanded-1366x768-en.png` | en | 1366×768 | expanded hand in English |
| `05-hand-collapsed-390x844-zh-Hant.png` | zh-Hant | 390×844 | collapsed hand on a phone |
| `06-hand-expanded-390x844-zh-Hant.png` | zh-Hant | 390×844 | expanded hand on a phone |
| `07-hand-collapsed-844x390-zh-Hant.png` | zh-Hant | 844×390 | collapsed hand in phone landscape |
| `08-hand-expanded-844x390-zh-Hant.png` | zh-Hant | 844×390 | expanded hand in phone landscape |
| `09-hand-dense-collapsed-1366x768-zh-Hant.png` | zh-Hant | 1366×768 | dense hand (17 resources, 5 development cards) collapsed |
| `10-hand-dense-expanded-1366x768-zh-Hant.png` | zh-Hant | 1366×768 | dense hand expanded, resource kinds grouped with a gap between them |
| `11-hand-dense-inspect-1366x768-zh-Hant.png` | zh-Hant | 1366×768 | one resource card inspected, lifted out of the fan |
| `12-devcard-knight.png` | zh-Hant | card crop | knight face |
| `13-devcard-roadBuilding.png` | zh-Hant | card crop | road building face |
| `14-devcard-yearOfPlenty.png` | zh-Hant | card crop | year of plenty face |
| `15-devcard-monopoly.png` | zh-Hant | card crop | monopoly face, with its resource choice |
| `16-devcard-victoryPoint.png` | zh-Hant | card crop | victory point face with the "New" tag |
| `17-hand-dense-devcard-1366x768-zh-Hant.png` | zh-Hant | 1366×768 | monopoly focused, with its play button and resource choice |
| `18-hand-dense-devcard-1366x768-en.png` | en | 1366×768 | the same focused monopoly card in English |
| `19-hand-dense-expanded-390x844-zh-Hant.png` | zh-Hant | 390×844 | dense hand expanded on a phone |

Regenerate into a new, empty directory after `pnpm build`, with the service
running (`UI_BASE_URL` defaults to `http://127.0.0.1:3000`):

```sh
python3 scripts/hand-cards/capture.py docs/screenshots/hand-cards
```

## Limitations

These images were not visually approved by a reviewer; they show rendered
states and the behaviour the capture run observed, and no baseline comparison
is made against them.

## History

Earlier capture sets (the 2026-10-27/28 canonical, island-ui, card-table,
table-interactions, side-rails, table-experience and ui-refresh sets) were
removed in the 2026-10-30 reorganization because they predate the current
table HUD and rail. They remain in git history at `ca1e8db` under
`docs/screenshots/`.
