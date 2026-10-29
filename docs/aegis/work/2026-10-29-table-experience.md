# Table interaction improvements

## Task start and delivery scope

- Requested baseline: PR #8, merged into `master` at
  `080fcbdc764a3ee87c12b4695d7b17bf5c9afa38`. A final fetch confirmed that
  `origin/master` still names that commit.
- Remote: `https://github.com/cxyfer/katan`; integration branch:
  `codex/table-experience`; delivery: one PR against `master`, without merging.
- Integration checkout:
  `C:/Users/shene/.codex/worktrees/table-experience/katan`.
- The main checkout at `D:/Workspace/Projects/katan` already contained changes
  to `docs/aegis/INDEX.md` and three board-3d plan files. They were left alone.
- The user explicitly authorized frozen dependency installation with
  `--ignore-scripts` in the five dedicated worktrees.
- Existing maritime styling, public board projection, server commands, required
  action priority, renderer choice, and private information ownership remain
  the integration baseline.

## Delegated implementation

Each requirement was assigned to one subagent with its own feature branch and
worktree. Their commits were cherry-picked into the integration branch.

| Requirement | Feature branch | Final implementation commit |
| --- | --- | --- |
| Inspect and focus map elements | `codex/map-inspection` | `ebe40cf098c1e94d2967648b468c9d45b30637c4` |
| Center and pace dice | `codex/dice-presentation` | `5b1695da08bc416a895916da642d7588e0e36e0c` |
| Held-card fan | `codex/hand-fan` | `cf4d569246c3af93651f477d3a7ac46f8641f38d` |
| Hover scores and PIN | `codex/scoreboard-hover` | `540a5b58d6d65eada90aca86f7c303499b837c89` |

The last hand-fan commit's mobile spread change was incorporated in the
coordinator's integration patch rather than a separate cherry-pick.

## Resulting behavior

Map elements use the same viewport projection as legal targets. Clicking or
activating a terrain tile, occupied building, occupied road, or harbor focuses
the camera at a minimum zoom of 2.2 and shows public details. Tiles expose
resource, roll probability, blocking, and neighboring production; buildings
show owner, points, and yield; roads and harbors show ownership or exchange
access. Related-tile links and a select menu provide alternate navigation.
Fit restores the full board and dismisses inspection. Dragging does not inspect
or send a build command; legal construction still requires confirmation.

Fresh authoritative rolls receive a viewport-centered 1500 ms rolling phase,
followed by 1000 ms of result display. The toolbar does not disclose the result
during the rolling phase. Snapshot replay does not replay dice. Reconnect,
background, offline, reduced motion, and subsequent required actions cancel
presentations. A seven may still animate alongside its own required prompt,
which remains immediately usable.

Resource groups and the local player's development cards form one fan at the
bottom center. Collapsed cards show a small peek; pointer hover or keyboard
focus expands them, and individual cards rise for inspection. Touch first
expands the fan; development-card inspection and playing remain distinct
actions. Fresh cards join the fan with their unavailable state. Escape and a
small close control collapse the fan. The old DECK header and hand PIN/toggle
controls are removed.

The collapsed left scoreboard retains name, color, current-turn marker, and
score. Hover or focus reveals buildings, awards, and score details without
resizing the board. PIN is the only persistent expansion state; unpinning
allows collapse after pointer/focus departure. Opponents retain public scores;
only the local player sees their private victory-point breakdown and own total.

## Integration repairs and review

- Import the base stylesheet before component imports so the declared
  `base, pregame, table` layer order takes effect in production.
- Constrain the playfield grid column to `minmax(0, 1fr)`; the mobile toolbar
  scrolls horizontally rather than expanding the board outside the viewport.
- Put turn prompts and the map in separate grid rows, keeping map controls
  reachable under required-action messages.
- Keep ordinary map controls below the expanded scoreboard, but raise an open
  display-settings menu above inspection details.
- Keep PIN within the reserved left rail and the fan above the scoreboard's
  lower edge. Account for rotated mobile cards in the fan's horizontal bounds.
- Scale dense-map hit areas and limit building padding by incident road
  length, preserving direct access to road midpoints.
- An independent subagent review found stale inspection focus ownership.
  The map owner reproduced it, added a regression, and corrected focus
  restoration so an external control retains focus.

## Verification

The retained browser report is
`2026-10-29-table-experience/evidence/browser-report.json`. It records the
pre-integration-commit HEAD, source digest, fixture digest, production asset
hashes, browser version, individual checks, and measured roll duration. Source
and runner files were unchanged after that capture; the final commit packages
the already-verified working-tree changes and evidence.

Commands:

```powershell
pnpm verify
python scripts/table-experience/verify.py --out test-results/table-experience-review --executable-path 'C:/Program Files/Google/Chrome/Application/chrome.exe'
```

The browser runner requires Python, the Python Playwright package, and a
Chromium executable. It reuses PR #8's server and deterministic fixture helpers,
starts an isolated SQLite server, routes fixture API/WebSocket responses, and
cleans up its server and temporary database. It does not send gameplay commands
to a live deployment.

- Browser matrix: **8/8 PASS** across 19- and 30-tile boards, SVG and R3F,
  desktop 1366 x 900 English, and mobile 390 x 844 Traditional Chinese.
- Each case checks bounded map layout, usable Fit/display controls, scoreboard
  hover/PIN/privacy, centered card peek and full fan, card lift and bounds,
  fresh cards, Escape, all four map element types, keyboard activation, drag
  suppression, centered dice, delayed authoritative result, and no replay.
- Measured rolling duration: **1.531-1.563 seconds**.
- Runtime errors: **0**. Unexpected API calls: **0**.
- `pnpm verify`: **PASS**, including type checking, **542 passing tests**
  (rules 110, protocol 7, server 84, web 341), **11 skipped PostgreSQL tests**,
  production web/server builds, and **13/13 smoke checks**.
- Final repository verification is retained as
  `2026-10-29-table-experience/evidence/verify.log`.
- Selected captures are in `docs/screenshots/table-experience/`.

## Evidence boundaries

Confidence: B. The browser checks use Chromium with software WebGL, emulated
viewports, and synthetic pointer/keyboard input. Physical touch devices,
screen readers, Firefox/WebKit, reference-hardware performance, and human
visual acceptance were not run for these interaction changes. The existing
large 3D bundle warning remains a build warning.

The four delegated feature branches are retained for provenance. Their clean
temporary worktrees were archived using the native managed-worktree lifecycle;
artifact readback, Git registration, and exact path checks confirmed all four
archives completed. The integration worktree remains available for PR review.
The main checkout's pre-existing documentation changes remain untouched.
