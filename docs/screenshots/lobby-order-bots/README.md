# Lobby game order and bot marks

Review captures for the random game order (#66) and the bot mark beside the
avatar in the players rail (#78). They were rendered from commit `a200840` on
2026-11-04.

Captured from the production build (`pnpm build`) in headless Chromium at device
scale factor 1 with reduced motion. The script starts a disposable service on a
temporary SQLite database and drives one host through the real UI: it creates a
four-seat base room with three bots, saves the order setting as join order and
back to random, starts the game and waits for the draw. A run whose draw equals
the join order is discarded and repeated. The run in this set drew
`Robo, Bram, Cleo, Ada` from the join order `Ada, Bram, Robo, Cleo`.

| File | Locale | Viewport | State |
|---|---|---|---|
| `01-create-form-order-random-1366x768-zh-Hant.png` | zh-Hant | 1366×768 | Create form with "Game order" set to random draw |
| `02-create-form-order-random-1366x768-en.png` | en | 1366×768 | The same form in English |
| `03-lobby-before-draw-1366x768-en.png` | en | 1366×768 | Lobby before the draw: seats in join order, host-only order setting |
| `04-lobby-before-draw-1366x768-zh-Hant.png` | zh-Hant | 1366×768 | The same lobby in Traditional Chinese |
| `05-lobby-before-draw-390x844-zh-Hant.png` | zh-Hant | 390×844 | The same lobby in the phone layout |
| `06-lobby-order-saved-as-join-1366x768-en.png` | en | 1366×768 | Order changed to join order, saved, confirmation visible |
| `07-table-rail-collapsed-after-draw-1366x768-en.png` | en | 1366×768 | Table after the draw, collapsed players rail; bot marks sit outside the avatars |
| `08-table-rail-expanded-after-draw-1366x768-en.png` | en | 1366×768 | Expanded and pinned rail in drawn order, names on one line |
| `09-table-chat-seat-after-draw-1366x768-en.png` | en | 1366×768 | Chat message meta showing the host's drawn seat number |
| `10-table-rail-expanded-after-draw-1366x768-zh-Hant.png` | zh-Hant | 1366×768 | The expanded rail in Traditional Chinese |
| `11-table-rail-expanded-after-draw-390x844-zh-Hant.png` | zh-Hant | 390×844 | The expanded rail in the phone layout |

The script asserts the order mode on the room API, that lobby seats stay in join
order, that the drawn order differs from it, that the rail and chat seat numbers
follow the scoreboard, and that every bot mark's centre is outside its avatar.

## Reproduce

```sh
pnpm build
python3 scripts/lobby-order-bots/capture.py --out test-results/lobby-order-bots
```

The output directory must be new and empty. Copy the PNGs from there into this
one.
