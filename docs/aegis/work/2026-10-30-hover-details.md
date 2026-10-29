# Delayed element information and compact player rail

## Scope and cause

The user rejected click-to-focus and the fixed-width left rail introduced before
or in PR #10. Starting snapshot: clean detached worktree at `c723698`, matching
`origin/master`. The existing worktree is reused on
`codex/hover-details-compact-rail`.

`BoardView` called the same inspection/camera-focus path for public elements and
legal target selection. `useBoardViewport` also retained an inspection-only pan
exception. The score rail explicitly gave both disclosure states the same width.
These are independent presentation choices, not rule or server defects.

## Implementation boundary and acceptance

- Remove the inspection panel, click-to-focus callback, viewport focus API and
  inspection-only pan exception together. Keep manual pan/orbit/zoom/fit.
- Reuse public inspection descriptions and the projected hit layer. Show a
  tooltip after 1500 ms on mouse/pen hover or keyboard focus, including legal
  targets above the inspection layer. Keep camera and command selection intact.
- Cancel pending information on leaving, pointer press, gestures, camera changes,
  focus moving outside the board, Escape and unmount. Let users move into and
  read the tooltip; use space above/below when neither side fits, bound its
  placement to the viewport and preserve fullscreen.
- Collapse the left rail to 68 px on desktop or 60 px on narrow screens; expand
  to 216/196 px. Keep initials/color, score and turn indication in the compact
  state; disclose names, breakdown and pinning on expansion. Keep board geometry
  stable and retain existing keyboard/touch/rail coordination.

Decision: code-change at the existing presentation owners. Internal code
retirement uses delete-first; no storage, wire protocol, identity or persistence
changes. TDD route: off; add focused regression coverage and production-browser
checks for the changed behavior. Architecture review is limited to removing the
camera side effect and keeping the existing selection/privacy owners.

## Verification

- `pnpm typecheck`: all packages passed.
- `pnpm --filter @catan/web exec vitest run --maxWorkers=1 --testTimeout=15000`:
  367 tests passed in 38 files, including 13 public-map inspection regressions.
- `pnpm --filter '!@catan/web' -r test`: rules 110, protocol 7 and server 84
  passed. Eleven PostgreSQL-dependent server tests skipped without a configured
  PostgreSQL test database. Total: 568 passed, 11 skipped.
- `pnpm build`: passed. The existing large Three.js chunk warning remains.
- `pnpm smoke`: 13/13 passed against the built server and client.
- Production browser matrix: 12/12 passed across SVG/R3F, 1366x900 desktop,
  390x844 portrait, 844x390 landscape, and four/six-player public fixtures.
  All six bounded runs have identical source/build digests; each run verifies
  unchanged source and build state before completion.
- Browser checks include a closed explorer, 1100 ms without a tooltip, delayed
  mouse/keyboard information, all four element kinds, Escape, reading the
  tooltip, no click/hover zoom, viewport bounds, avoiding the inspected element
  when space permits, fullscreen, compact/expanded width, unchanged board
  geometry, pinning, touch, rail exclusivity, turn flags and expanded hands.
- Static diff review confirms no remaining inspection camera API, obsolete panel
  or panel-only translation keys. Existing legal target picking, confirmation,
  public description and private scoring owners are preserved. Geometry and
  disclosure checks run at their existing owners; no compatibility path remains.

The final aggregate is [report.json](2026-10-30-hover-details/report.json).
To reproduce, build first and run each viewport/board pair with a fresh output
directory; each command covers both renderers:

```bash
for viewport in desktop mobile landscape; do
  for board in hex-r2 hex-r56; do
    python3 scripts/side-rails/verify.py \
      --viewport "$viewport" --board "$board" \
      --out "test-results/hover-details-$viewport-$board"
  done
done
```

The older table-experience runner now reuses the same hover check and expects a
changing rail width; the complete older runner was not rerun. Browser coverage
uses Chromium software WebGL, emulated touch and deterministic API fixtures.
It does not establish physical-device performance, Firefox/WebKit behavior,
screen-reader acceptance or a live production deployment. Confidence: B.

## Review images

- [Desktop collapsed](../../screenshots/hover-details/desktop-collapsed.png),
  [expanded](../../screenshots/hover-details/desktop-expanded.png),
  [tooltip](../../screenshots/hover-details/desktop-tooltip.png).
- [Mobile collapsed](../../screenshots/hover-details/mobile-collapsed.png),
  [expanded](../../screenshots/hover-details/mobile-expanded.png),
  [tooltip](../../screenshots/hover-details/mobile-tooltip.png).
