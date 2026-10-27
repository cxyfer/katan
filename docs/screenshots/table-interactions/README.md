# 牌桌互動更新截圖

本輪正式前端產物：`index-DIALwB7a.css`、`index-BN2uccZK.js`。

[六席密集狀態摘要、8 張截圖索引與重跑指令](../../aegis/work/2026-10-27-island-ui/table-interactions-evidence.md)；[完整 JSON 報告](../../aegis/work/2026-10-27-island-ui/table-interactions-report.json)：190/190 checks、12 組尺寸／語系、0 pageerrors。API／WebSocket 在瀏覽器中以固定資料攔截，僅證明前端呈現及互動。

[真實三人報告](real/browser-report.json)：144 assertions、20 screenshots、0 runtime errors；檔案位於同目錄的 [real captures](real/02-game-1366x768-zh-Hant.png)。重跑：

```sh
UI_EVIDENCE_DIR=docs/screenshots/table-interactions/real python3 docs/aegis/work/2026-10-27-island-ui/verify-card-table.py
```

兩種 runner 使用現有 `http://127.0.0.1:3000` 同源服務及正式前端，不另啟替代服務。完整測試、審查與未涵蓋範圍見 [本輪驗證證據](../../aegis/work/2026-10-27-island-ui/90-evidence.md)。
