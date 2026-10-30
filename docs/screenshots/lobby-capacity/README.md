# Lobby capacity and short-handed start

Review captures for the pre-start capacity control and the rule that a lobby
may start with any player count its ruleset supports, up to the room capacity.
They were rendered from the built client against a disposable live service,
with guest seats driven through the same HTTP API the client uses.

| File | Locale | Viewport | State |
|---|---|---|---|
| `01-short-start-4p-zh-Hant.png` | zh-Hant | 1366×768 | Four-seat base room, three seated and ready: `3/4`, no blockers, Start enabled, capacity options `3` and `4` |
| `02-short-start-4p-mobile-zh-Hant.png` | zh-Hant | 390×844 | The same state in the phone layout |
| `03-capacity-3p-zh-Hant.png` | zh-Hant | 1366×768 | Host lowered the cap to three: `3/3`, no empty seat, save disabled until the value changes |
| `04-capacity-3p-en.png` | en | 1366×768 | The three-player room in English |
| `05-short-start-6p-zh-Hant.png` | zh-Hant | 1366×768 | Six-seat paired room, five seated and ready: `5/6`, no blockers, Start enabled, capacity options `5` and `6` |

Reproduce after `pnpm build`:

```sh
python3 scripts/lobby-capacity/capture.py --out docs/screenshots/lobby-capacity
```

The script starts its own service on a temporary SQLite database and checks the
visible seat count, capacity options, save-button state and server-reported
start blockers before each capture. It is evidence for these rendered states,
not a visual-regression baseline.
