# Captured interface states

Rendered states captured with headless Chromium (Playwright) against the built
client and a live service, driving a real three-player game. They are **captured
states for review**, not accepted visual-regression baselines: no baseline
comparison runs, and no physical-device, touch, screen-reader or 200%-zoom
evidence exists yet (`docs/FIDELITY.md`, gap 5).

Recaptured on 2026-10-28 from the build that serves `index-BN2uccZK.js` and
`index-DIALwB7a.css`. Every image is rendered at `deviceScaleFactor: 2`, so the
pixel size is twice the CSS viewport in the table. The game table is a fixed
viewport; the entry page is 842 px tall at a 768 px viewport, so that one image
is a full-document capture and is 1684 px tall.

| File | Locale | CSS viewport | State |
|---|---|---|---|
| `01-entry-zh.png` | zh-Hant | 1366×768 | entry: title, island art, nickname field, language switch |
| `02-home-zh.png` | zh-Hant | 1366×768 | home: create/join form, resume, room browser and identity tabs |
| `03-lobby-zh.png` | zh-Hant | 1366×768 | lobby with three seats, two ready, start blocked with a named blocker |
| `04-setup-zh.png` | zh-Hant | 1366×768 | opening placement: settlement targets and the setup guide |
| `05-table-zh.png` | zh-Hant | 1366×768 | table after the opening roll: dice, fitted board, expanded hand, score rail |
| `06-other-seat-zh.png` | zh-Hant | 1366×768 | another seat's view: own hand only, no opponent resource piles |
| `07a-trade-panel-zh.png` | zh-Hant | element 408×511 | structured trade offer builder and bank/harbor trade |
| `07b-chat-panel-zh.png` | zh-Hant | element 408×343 | room chat with a sent message |
| `08-table-en.png` | en | 1366×768 | the same table in English |
| `09-mobile-table-zh.png` | zh-Hant | 390×844 | mobile: status strip, required action, fitted board, expanded hand |
| `10-mobile-tools-zh.png` | zh-Hant | 390×844 | mobile tool surface open on the trade panel |
| `11-tablet-zh.png` | zh-Hant | 768×1024 | tablet reflow of the same table |
| `12-panel-seats.png` | zh-Hant | element 242×650 | score rail expanded with seat inventory and awards |
| `13-panel-hand.png` | zh-Hant | element 862×359 | hand dock with the five resource cards and development area |
| `14-panel-devcards.png` | zh-Hant | element 836×55 | development area in this opening deal (no affordable card) |
| `15-panel-log.png` | zh-Hant | element 408×500 | event log |
| `16-panel-actions.png` | zh-Hant | element 214×314 | action bar |
| `17-panel-legend.png` | zh-Hant | element 530×316 | terrain, number and resource legend |
| `19-mobile-tool-trade.png` | zh-Hant | element 370×598 | mobile trade surface |
| `19-mobile-tool-chat.png` | zh-Hant | element 370×401 | mobile chat surface |
| `19-mobile-tool-log.png` | zh-Hant | element 370×557 | mobile event log |
| `19-mobile-tool-help.png` | zh-Hant | element 370×399 | mobile help surface |

The board itself is legible at its fitted size: each hex carries a terrain
symbol and letter, its number token and pips, so terrain is identifiable without
colour.

## Naming

The 2026-10-28 refresh renamed states whose old names described controls that no
longer exist: `04-board` → `04-setup`, `05-board-full` → `05-table`,
`06-board-other-seat` → `06-other-seat`, `08-board-en` → `08-table-en`,
`09-mobile-board` → `09-mobile-table`, `10-mobile-drawer` → `10-mobile-tools`,
and `19-mobile-drawer-*` → `19-mobile-tool-*`. The mobile drawer component is no
longer mounted; a 390 px viewport uses the same tool rail as the desktop and the
hand dock at the bottom.

## Other capture sets

| Directory | Contents | Harness |
|---|---|---|
| [`island-ui/`](island-ui/README.md) | 53 full-page states: 6 scenes × 4 viewports × 2 locales, plus 5 mobile panels | `docs/aegis/work/2026-10-27-island-ui/verify-browser.py` |
| [`card-table/`](card-table/README.md) | 20 game states: setup, game, card inspection and trade across 6 viewports × 2 locales | `docs/aegis/work/2026-10-27-island-ui/verify-card-table.py` |
| [`table-interactions/`](table-interactions/README.md) | 8 fixture-driven interaction states plus 20 real-game captures in `real/` | `docs/aegis/work/2026-10-27-island-ui/verify-table-interactions.py`, `verify-card-table.py` |

The canonical set above was produced by
[`capture-canonical.py`](../aegis/work/2026-10-28-screenshots/capture-canonical.py)
(119 assertions, 0 browser runtime exceptions); its machine-readable report is
[`capture-report.json`](../aegis/work/2026-10-28-screenshots/capture-report.json).

## Limitations

The capture model has no image input, so the images were verified by geometry
and DOM assertions — no subjective visual approval is claimed. Two layout facts
are recorded rather than corrected: the entry document is 842 px tall at
1366×768, and the 360×640 lobby capture shows the invite card overlapping the
ready control.
