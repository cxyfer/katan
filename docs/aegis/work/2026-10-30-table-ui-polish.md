# Table UI polish after PR #11

## Changes

- Map inspection delay is 1000 ms for pointer and keyboard focus; the spec and
  side-rail browser timing checks were aligned to the new contract.
- Domestic trade gives/receives are parallel columns. Bank/harbor exchange is
  a distinct Exchange tool. Compact headings and recipient selection fit the
  empty-offer desktop form without scrolling at 1366x768. Mobile preserves
  40px quantity buttons and natural vertical scrolling, without horizontal
  overflow. Drafts survive switching and closing tools.
- Own visible resource gains spawn bounded decorative cards that descend into
  the hand. Authoritative counts update immediately. Initial loads, recovery,
  hidden pages and reduced motion establish a baseline instead of replaying.
- Shared SVG pip faces replace numeric results and Unicode mini-dice in both
  compact and focused presentations; reveal timing and announcements remain.

## Verification

All commands ran in the task worktree on the final implementation:

| Check | Result |
| --- | --- |
| `pnpm typecheck` | All four packages passed |
| Web Vitest, `--maxWorkers=1 --testTimeout=15000` | 41 files, 404 tests passed |
| Rules tests | 12 files, 110 tests passed |
| Protocol tests | 1 file, 7 tests passed |
| Server tests | 10 files, 84 passed, 11 skipped (PostgreSQL not configured) |
| `pnpm build` | Web and server passed; existing large 3D chunk warning remains |
| `pnpm smoke` | 13/13 passed against temporary SQLite service |
| `scripts/table-ui-polish/verify.py` | 20/20 production browser scenarios passed |
| `git diff --check` | Passed |

The clean main checkout baseline separately passed 367 web tests. A concurrent
worktree baseline attempt overlapped implementation and is not baseline evidence.

Browser coverage: SVG/R3F, English/Traditional Chinese, 1366x768, 390x844,
320x720 and 844x390, plus normal/reduced-motion scenarios. It checks each map
element at 999/1000 ms, keyboard inspection, both trade columns, all 20 quantity
controls, independent exchange, retained drafts, focus restoration, six pip
patterns in both dice presentations, timed reveal/cleanup, resource gains and
duplicate/opponent suppression. Desktop trade content measured 488px client
height and 488px scroll height; total panel height was approximately 545px.

Reproduce after `pnpm build`:

```sh
python3 scripts/table-ui-polish/verify.py --out test-results/table-ui-polish-rerun \
  --executable-path /path/to/chrome
```

The retained browser report and selected captures are in
`docs/screenshots/table-ui-polish/`. Full local artifacts are under
`test-results/table-ui-polish-final-v2/` (ignored). Report sourceHead names the
base commit because verification preceded commit; its asset hashes identify
the tested production build, not the unmodified base assets.

## Independent review and boundaries

The reviewer found a legacy events-first cancellation bug: background events
could replay after the corresponding private projection caught up. The fix
preserves event floors, advances the suppressed resource baseline, and skips
ambiguous combined snapshots. Six added regression cases failed before the
fix and passed after it. Independent re-verification covered hidden, motion,
resize and fullscreen cancellation, then new and duplicate gains; the finding
is closed with no remaining must-fix findings.

Architecture review: game state and rate/command ownership remain unchanged;
the old inline bank form and numeric/Unicode dice rendering are removed, not
kept as competing owners. The resource helper reuses existing presentation
sequence decisions and reads only the current player's projected resources.
No dependencies, API, rules, persistence or deployment changes.

Limits: browser checks use deterministic API/WebSocket fixtures, Chromium,
software WebGL and emulated touch, not real multiplayer UI sessions, physical
phones or screen readers. Tiny phones and short landscape retain vertical
scrolling. Gain bursts are decorative (8 per batch, 12 concurrent), not an
exact transaction ledger; a recovery snapshot mixing old/new gains is not
animated. No production deployment or merge is part of this task.
