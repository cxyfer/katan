# Development card drag and resource pickers

Review captures of dragging a development card out of the hand and of the
Monopoly and Year of Plenty resource pickers. They were taken from the
production build at `a200840` on 2026-11-04, against a disposable live service
with a real three-player game: the host's first turn, before the first roll.

The development cards are injected only into the host's browser projection
(HTTP responses and the WebSocket snapshot). No card is played against the
server; dragging and the pickers are the client-side states before the command
is sent. The four-card set is Knight, Road Building, Year of Plenty and
Monopoly.

| File | Locale | Viewport | State |
|---|---|---|---|
| `01-hand-expanded-1366x768-zh-Hant.png` | zh-Hant | 1366×768 | Hovered hand expanded: six cards including Knight, Road Building, Year of Plenty and Monopoly; 1 wood, 1 wheat, 6 cards |
| `02-drag-not-armed-1366x768-zh-Hant.png` | zh-Hant | 1366×768 | Knight lifted but still inside the hand: hint 往上拖到桌面使用, drop not armed |
| `03-drag-armed-monopoly-1366x768-zh-Hant.png` | zh-Hant | 1366×768 | Monopoly dragged over the board: card enlarged, hint 放開以使用壟斷, drop armed |
| `04-monopoly-picker-empty-1366x768-zh-Hant.png` | zh-Hant | 1366×768 | Monopoly picker: 0/1, 還沒有選資源, confirm disabled as 還要選 1 張 |
| `05-monopoly-picker-ore-1366x768-zh-Hant.png` | zh-Hant | 1366×768 | Ore chosen: 1/1, 壟斷礦石 enabled |
| `06-year-of-plenty-picker-one-1366x768-zh-Hant.png` | zh-Hant | 1366×768 | Year of Plenty: one wool chosen, 1/2, confirm disabled as 還要選 1 張 |
| `07-year-of-plenty-picker-full-1366x768-zh-Hant.png` | zh-Hant | 1366×768 | Two wool chosen: 2/2, 拿取羊毛、羊毛 enabled |
| `08-year-of-plenty-picker-full-1366x768-en.png` | en | 1366×768 | The same full selection in English: 2/2, Take wool, wool enabled |
| `09-inspect-play-button-390x844-zh-Hant.png` | zh-Hant | 390×844 | Phone portrait, Year of Plenty inspected from the hand: 使用豐收之年 shown in the card dock |
| `10-year-of-plenty-picker-390x844-zh-Hant.png` | zh-Hant | 390×844 | Phone portrait picker: wood and ore chosen, 2/2, 拿取木材、礦石 enabled |
| `11-monopoly-picker-844x390-zh-Hant.png` | zh-Hant | 844×390 | Landscape picker: brick chosen, 1/1, 壟斷磚塊 enabled |

## Reproduce

After `pnpm build`, start the service and point the script at it (the output
directory must be new and empty):

```sh
UI_BASE_URL=http://127.0.0.1:3000 python3 scripts/dev-card-drag/capture.py <output-dir>
```

The script seats three players through the API, plays the setup placements, and
asserts that dragging past the hand arms the card, dragging back cancels,
dropping outside the board does not arm it, and each picker enforces its count.
It fails on a browser runtime error.

## Limitations

These are headless Chromium captures of a live three-player fixture, not a
human visual-acceptance run. The injected cards are a browser-side projection,
so the resulting Monopoly or Year of Plenty command is never sent and the
server-side effect is not shown.
