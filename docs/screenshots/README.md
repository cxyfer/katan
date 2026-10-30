# Review screenshots

Rendered states captured with headless Chromium (Playwright) against the built
client and a live service. They are **captured states for review**, not accepted
visual-regression baselines: no baseline comparison runs, and no physical-device,
touch, screen-reader or 200%-zoom evidence exists yet (`docs/FIDELITY.md`, gap 5).

## Layout

| Path | Contents | Captured from | Producer |
|---|---|---|---|
| [`current/`](current/) | Entry → home → lobby → setup → table → tools, full three-player flow, zh-Hant and en | `3264a94` (2026-10-30) | [`scripts/screenshots/capture-current.py`](../../scripts/screenshots/capture-current.py) |
| [`hover-details/`](hover-details/) | Map-detail tooltips and collapsed/expanded rails, desktop and mobile | 2026-10-30 | `scripts/side-rails/verify.py`, see [work record](../aegis/work/2026-10-30-hover-details.md) |
| [`table-ui-polish/`](table-ui-polish/) | Dice focus, hand-gain feedback, trade surface (desktop and mobile) | 2026-10-30 | `scripts/table-ui-polish/verify.py`, see [work record](../aegis/work/2026-10-30-table-ui-polish.md) |
| [`island-diorama/`](island-diorama/README.md) | Standalone 3D island preview at several camera angles and sizes, plus game-surface checks | 2026-10-29 | `scripts/board-3d/verify-diorama.py`, see [work record](../aegis/work/2026-10-29-island-diorama.md) |

Only the `current/` set reflects the table as it is now. The other sets are
focused feature reviews kept with their work records; each was captured at the
commit named in its record.

## `current/`

Captured on 2026-10-30 from `3264a94` (the `pnpm build` output served on
`127.0.0.1:3000`), with a real three-player game driven through the UI. Every
capture is at device scale factor 1. The script makes no assertions; it fails
on any browser runtime error.

| File | Locale | Viewport | State |
|---|---|---|---|
| `01-entry-1366x768-zh-Hant.png` | zh-Hant | 1366×768 | entry: nickname and language switch |
| `02-home-1366x768-zh-Hant.png` | zh-Hant | 1366×768 | home after three nicknames are set: create/join |
| `03-lobby-waiting-1366x768-zh-Hant.png` | zh-Hant | 1366×768 | lobby right after the host creates the room |
| `03-lobby-ready-1366x768-zh-Hant.png` | zh-Hant | 1366×768 | lobby with all three players ready and start enabled |
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

Regenerate into a new, empty directory after `pnpm build`, with the service
running on `:3000` (or set `UI_BASE_URL`):

```sh
python3 scripts/screenshots/capture-current.py docs/screenshots/current
```

The script needs Python Playwright with a Chromium it can launch.

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
