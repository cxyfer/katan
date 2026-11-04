# Dialogs portalled out of table panels

Review captures for dialogs rendering through a portal (#92). They were
rendered from commit `a200840` on 2026-11-04.

Captured from the production build (`pnpm build`) in headless Chromium with
reduced motion. The script starts a disposable service and serves the
deterministic four-seat `hex-r2` fixture (as in `scripts/notice-dismiss`). The
host has proposed a table-wide offer that another player consented to, so
"Confirm exchange" opens the settle dialog. The trade panel is scrolled to the
offer before the panel shots.

| File | Locale | Viewport | State |
|---|---|---|---|
| `01-trade-panel-consented-offer-1366x768-en.png` | en | 1366×768 | Trade panel scrolled to the host's offer: consented and interested responses, counterparty chosen |
| `02-settle-dialog-1366x768-en.png` | en | 1366×768 | Settle dialog centred over a full-viewport backdrop, outside the panel |
| `03-settle-dialog-1366x768-zh-Hant.png` | zh-Hant | 1366×768 | The same dialog in Traditional Chinese |
| `04-trade-panel-consented-offer-844x390-en.png` | en | 844×390 | The offer in the compact landscape trade panel |
| `05-settle-dialog-844x390-en.png` | en | 844×390 | Settle dialog fully on screen on the short landscape phone |
| `06-settle-dialog-667x375-zh-Hant.png` | zh-Hant | 667×375 | Settle dialog on a 667×375 touch viewport |

The script asserts the backdrop is a child of `<body>`, covers the viewport,
the dialog is outside the trade panel and fully on screen, both buttons are the
topmost element at their centres, and confirming sends `trade.settle` for the
chosen counterparty.

## Reproduce

```sh
pnpm build
python3 scripts/dialog-portal/capture.py --out test-results/dialog-portal
```

The output directory must be new and empty. Copy the PNGs from there into this
one.
