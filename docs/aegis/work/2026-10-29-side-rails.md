# Side rail follow-up to PR #9

## Scope and plan

User-authorized direct implementation; no rules, protocol, persistence, or deployment changes.
Baseline: `e970fbf`, PR #9; existing GameScreen, PlayersPanel, ActionBar,
BoardView and CommandStatus remain the data/interaction owners.

1. Replace vertical scoreboard expansion with fixed-row horizontal disclosure;
   keep seat order, private-score boundaries and current-turn marker visible.
2. Mirror disclosure on the build rail, center both rails, and overlay compact
   camera controls and side notifications without reserving board-top rows.
3. Auto-hide accepted receipts after four seconds without clearing command
   state or auto-hiding unknown/rejected/stale outcomes.
4. Run regression checks and production-browser geometry/interaction checks;
   independently review, push feature branch and open a PR (no merge).

TDD route: verification after implementation; add targeted timer and interaction
regressions. Architecture review: component/layout seam only, no domain change.
Task worktree: `.worktrees/side-rails`, branch `codex/side-rails`; coordinator owns
handoff, preserve until PR delivery and do not remove unrelated worktrees.

## Acceptance

- Fixed scoreboard width and row geometry across expansion; details reveal right.
- Collapsed scoreboard has no surrounding deck; turn flag remains on inner edge.
- Mirrored right rail exposes build/development actions through hover/focus/tap.
- Camera controls no longer reduce board height; names remain accessible.
- Accepted receipt disappears automatically; recovery actions remain available.
- Desktop/mobile geometry, no horizontal page overflow, keyboard focus/Escape,
  public-only opponent information and existing gameplay tests are checked.

## Verification

- `pnpm typecheck`: passed.
- Rules 110, protocol 7, server 84, web 361 tests passed (562 total).
  Server's 11 PostgreSQL-dependent tests remain skipped in this environment.
  Web ran with `--maxWorkers=1 --testTimeout=15000`; the normal parallel
  verification run hit timing limits, so this is serial-suite evidence.
- `pnpm smoke`: 13/13 passed.
- Production build passed; the existing large 3D bundle warning remains.
- Independent static review completed; focus reopening after Escape and
  touch-first disclosure have regression tests.

Browser verification exercises production assets with deterministic fixtures,
SVG and R3F renderers, 4/6 seats, desktop/portrait/short-landscape viewports.
The initial runs caught mobile row-height drift, camera/score overlap, and
transparent board inspection layers intercepting build actions. These were
corrected before final acceptance. Real touch event ordering also exposed an
initial toggle tap being undone by compatibility mouse focus; the fix has a
regression test covering both first and second taps. Command recovery notices stay
in the scrollable side-message area while successful receipts let clicks pass through.

Final browser matrix: **12/12 passed**, with matching before/after source digests
and verified production asset hashes. Coverage includes fixed rail geometry,
seat order, turn flags, hover/pin/keyboard/Escape/touch, scroll reachability,
target-picker hit testing, unknown-command resolution using the original command
ID, and accepted-receipt automatic dismissal after four seconds. Short landscape
recovery buttons are reachable by scrolling the side-message area.

Reproduce after `pnpm build`:

```sh
python3 scripts/side-rails/verify.py --out test-results/side-rails-recheck
```

- Browser evidence: [report.json](2026-10-29-side-rails/report.json)
- Frontend test evidence: [web-tests.txt](2026-10-29-side-rails/web-tests.txt)
- [Desktop collapsed](../../screenshots/side-rails/desktop-collapsed.png)
- [Desktop expanded](../../screenshots/side-rails/desktop-expanded.png)
- [Mobile collapsed](../../screenshots/side-rails/mobile-collapsed.png)
- [Short landscape expanded](../../screenshots/side-rails/landscape-expanded.png)

The fixtures mock API/WebSocket responses; this does not prove live-server
command processing. Chromium touch emulation and software WebGL do not establish
physical-device, screen-reader, Firefox, or WebKit coverage. The report's
`sourceHead` is the pre-commit base; source and asset digests identify the tested
working tree. No production deployment or automatic merge is part of this task.
