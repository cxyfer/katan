# Captured interface states

Rendered states captured with headless Chromium (Playwright) against the built
client and a live service, driving a real three-player game. They are **captured
states for review**, not accepted visual-regression baselines: no baseline
comparison runs, and no physical-device, touch, screen-reader or 200%-zoom
evidence exists yet (`docs/FIDELITY.md`, gap 5).

| File | Locale | Viewport | State |
|---|---|---|---|
| `01-entry-zh.png` | zh-Hant | 1366×768 | entry screen: nickname and language switch |
| `02-home-zh.png` | zh-Hant | 1366×768 | home: resumable game, create room, public room browser |
| `03-lobby-zh.png` | zh-Hant | 1366×768 | lobby with three seats and a localised start blocker |
| `04-board-zh.png` | zh-Hant | 1366×768 | board after initial placement; a robber move is required |
| `05-board-full-zh.png` | zh-Hant | 1366×768 | the whole board fitted above the fold |
| `06-board-other-seat-zh.png` | zh-Hant | 1366×768 | another seat's view: waiting state, own hand only |
| `07a-trade-panel-zh.png` | zh-Hant | element | structured trade offer builder and bank/harbor trade |
| `07b-chat-panel-zh.png` | zh-Hant | element | room chat with sent messages |
| `08-board-en.png` | en | 1366×768 | the same board in English |
| `09-mobile-board-zh.png` | zh-Hant | 390×844 | mobile: status strip, required action, fitted board |
| `10-mobile-drawer-zh.png` | zh-Hant | 390×844 | mobile secondary drawer open |
| `11-tablet-zh.png` | zh-Hant | 768×1024 | tablet reflow |

The board itself is legible at its fitted size: each hex carries a terrain
symbol and letter, its number token and pips, so terrain is identifiable without
colour.
