# Startup progress screens

Review captures of the step-by-step startup screen. They were taken from the
production build at `a200840` on 2026-11-04 with a temporary service: Playwright
routes hold or abort individual requests so each step stays on screen long
enough to be photographed.

Two phases are covered. Before any script runs, the static `index.html` screen
reports the asset download; after the bundle loads, the React `BootScreen`
reports the server, session, ruleset and game-list requests. A first visit has
no session, so its game-list step is marked as not needed rather than waiting.
Holding a request past eight seconds adds the slow-response hint with a Refresh
control, and a failed request leaves the failed step and a reload notice.

| File | Locale | Viewport | State |
|---|---|---|---|
| `assets-downloading-1366x768-zh-Hant.png` | zh-Hant | 1366×768 | Static screen, bundle held: 20%, 下載遊戲程式 進行中, 已下載 1 個檔案 · 173 KB, later steps waiting |
| `assets-downloading-390x844-en.png` | en | 390×844 | The same static download step in the phone layout: 20%, Downloaded 1 files · 173 KB |
| `requests-waiting-1366x768-en.png` | en | 1366×768 | React screen, all API requests held: 40%, Downloading the game Done, Contacting the server In progress, rest Waiting |
| `session-pending-1366x768-zh-Hant.png` | zh-Hant | 1366×768 | Session request held: 70%, 確認玩家身分 進行中, 載入規則集 完成, 尋找進行中的對局 等待中 |
| `session-pending-390x844-en.png` | en | 390×844 | The same session step in the phone layout: 70%, Checking your session In progress |
| `games-pending-1366x768-en.png` | en | 1366×768 | Signed-in player, game list held: 85%, Looking for your games In progress, all earlier steps Done |
| `first-visit-games-skipped-390x844-zh-Hant.png` | zh-Hant | 390×844 | First visit, config held: 85%, 連線伺服器 進行中, 確認玩家身分 and 載入規則集 完成, 尋找進行中的對局 不需要 |
| `slow-hint-assets-1366x768-zh-Hant.png` | zh-Hant | 1366×768 | Bundle still held after 8 s: 比平常久，仍在等待回應… and a 重新整理 control under the 20% download step |
| `slow-hint-session-1366x768-en.png` | en | 1366×768 | Session held after 8 s: 70% with This is taking longer than usual; still waiting... and Refresh |
| `bundle-failed-1366x768-zh-Hant.png` | zh-Hant | 1366×768 | Bundle aborted: 20%, 下載遊戲程式 失敗, 遊戲程式下載失敗，請確認網路連線後重新整理。 and 重新整理 |
| `bundle-failed-390x844-en.png` | en | 390×844 | The same failed download in the phone layout: Failed step and Refresh |
| `stylesheet-failed-1366x768-en.png` | en | 1366×768 | Stylesheet aborted: the React screen stays at 100% with the download step Failed, later steps Done or Not needed, and the reload notice |

## Reproduce

After `pnpm build` (the output directory must be new and empty):

```sh
python3 scripts/boot-progress/capture.py --out test-results/boot-progress
```

The script starts its own temporary service and checks the visible step statuses
and percentage before each capture, including that the slow hint appears only
after about eight seconds. `report.json` in the output directory records the
held-request states and the expected console errors from the injected failures.

## Limitations

The delayed and failed requests are deliberately injected, so the timings show
the screen's own behaviour rather than a real slow network or outage. These are
desktop and phone headless-Chromium captures, not a human visual-acceptance
run; the 390×844 images use the same desktop build in the narrow layout.
