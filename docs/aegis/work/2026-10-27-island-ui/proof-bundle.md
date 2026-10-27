# Proof Bundle - 2026-10-27-island-ui

## Method Pack Boundary

This proof bundle is an advisory Aegis Method Pack record. It does not determine evidence sufficiency, produce authoritative `GateDecision`, or grant completion authority.

## Task Intent

- Requested outcome: 依使用者提供的橫向卡牌遊戲參考，將既有 Catan 遊戲桌重製為滿版／可全螢幕的沉浸式牌桌
- Scope: 遊戲舞台、玩家 HUD、資源卡手牌、右側行動、可收合工具、原生 fullscreen、雙語與響應式版面
- Non-goals: 規則、協定、server projection、身分、私有資料、命令確認、持久化、依賴、外部素材或擴充模式

## Impact

- Compatibility boundary: 既有命令、資料投影、身分、持久化、profile 能力與雙語功能保留；無新增 API 或依賴
- Canonical presentation owner: `GameScreen` + `GameTools`; `MobileDrawer` 不再由 runtime 遊戲畫面掛載
- Retention: 舊 reducer carrier 暫留於既有 state/test surface；如需刪除需另開 code-retirement slice，不在本次 UI 交付執行

## Terminal Evidence Refs

- `pnpm verify`: exit 0; 318 tests passed, 11 existing DB contract tests skipped, build and 13/13 smoke passed
- `docs/aegis/work/2026-10-27-island-ui/verify-card-table.py`: exit 0; 144 assertions, 20 screenshots, 0 browser runtime errors
- `docs/screenshots/card-table/browser-report.json`: final Chromium report across six viewports and two locales
- `docs/screenshots/card-table/README.md`: screenshot index and uncovered device/AT scope

## Formal Evidence

- Product acceptance: evidence is advisory and does not grant authoritative completion
- Browser acceptance: covered target UI flows, responsive composition, tool drafts, card inspection and native fullscreen lifecycle

## Terminal Non-Passed Evidence

- Physical mobile touch, Safari/Firefox, screen reader, full WCAG contrast and real user visual testing remain uncovered

## Legacy Unclassified Evidence

- none

## Superseded Evidence Count

- Prior panel-oriented browser evidence is historical and not reused as proof for this revision

## Drift Check

- Scope status: aligned
- Compatibility status: preserved; full regression and real browser seams verified
- Retirement status: old mobile drawer runtime owner retired by unmount; state carrier retained with explicit follow-up trigger
- Advisory decision: continue
