# Board visual P1A — event lifecycle and coordinates

Date: 2026-10-28. Scope: [implementation plan P1A 1–6](../../plans/2026-10-28-board-visual-spike.md) and [acceptance cases](../../plans/2026-10-28-board-visual-spike-acceptance.md), with SPEC §8.8 updated to the approved history/reconnect behavior. Starting point: clean `feat/board-visual-spike` at `cbe920ef00e4645cf6d2a20cecf98ef391c38331`, in `D:/Workspace/Projects/katan/.worktrees/board-visual-spike`.

This is an engineering slice, not M1/M3/M4 or visual/device acceptance. P1B materials, particles, production/robber flight effects and renderer dependencies are outside this slice. No commit, push or PR was created by this implementation step.

## Owners and decisions

Baseline assessment: aligned with the approved P1A requirements and the existing server-authoritative projection architecture. No new state, rule, command or renderer owner is introduced.

- `state/table.ts` remains the authoritative client snapshot owner for both HTTP and socket input. Same-game snapshots with either an older revision or an older `view.seq` are rejected. An older sync generation cannot replace a newer open/recovery result. Local sync cause/generation metadata is additive; the server/protocol/wire schema is unchanged.
- `state/useTable.ts` tags open, normal socket snapshot, command refresh, manual refresh, resume, reconnect and gap refetch. Requests retain their starting generation/game ID; late responses for another generation/game are ignored. Recovery establishes one pending baseline, consumed by the first accepted projection regardless of whether HTTP or socket arrives first. Subsequent normal snapshots can animate.
- `board/animation.ts` owns only presentation decisions. Cursor fields are `gameId`, `revision`, `viewSeq`, `syncGeneration` and `consumedSeq`. The initial/recovery baseline always uses `view.seq`, including an empty or truncated event window. Normal input selects only greater seq values, deduplicates and sorts them, and requires complete continuity through the input's sequence. Missing events cause a direct rebase; no event/private-data fetch or inference occurs. Revision and event seq are never substituted for each other.
- Legacy `events` envelopes retain a separate consumed-event position until their authoritative snapshot catches up. An additional `eventFloor` records legacy log entries already present at a baseline, so the next streamed event cannot replay that retained log after background recovery or remount; `viewSeq` and the baseline `consumedSeq` still come from `view.seq`. Their optional revision is the supplied revision; their seq never becomes a revision, and events do not patch the board projection.
- `board/useBoardAnimation.ts` owns cancellation, listener and timeout lifecycle. At most eight groups including the active group can be retained; each lasts at most 800 ms. A normal authoritative delta is grouped together, splitting multiple rolls into distinct groups. Overflow drops presentation work immediately while retaining the already-current board. Mandatory actions, offline/recovery, hidden/visible transitions, reduced-motion changes and unmount cancel pending work. StrictMode cleanup is covered. There is no RAF/ticker loop. This slice renders only the existing dice presentation; the authorised event groups are available for P1B.
- `BoardView.tsx` consumes the hook instead of searching historical roll events. Initial history shows persistent `view.turn.dice` and text without central replay. Required prompts immediately suppress the central presentation. The existing central CSS arrival animation now fits its 800 ms group budget.
- `board/viewport.ts` owns an equivalent SVG viewBox/preserveAspectRatio matrix, including letterboxing, viewBox origins, zoom and pan. Screen coordinates and ambiguity thresholds use CSS px. BoardView measures the current SVG rectangle when selecting or panning, preserving the existing viewport across resize and resetting it only for fit. `HexGeometry.corners` adds numeric points while preserving its existing `points` string.
- Board pointer gestures support mouse, touch and pen. Pinch/drag/cancel/leave suppress placement; explicit capture begins only after movement to preserve native target clicks. The SVG owns these gestures through `touch-action: none`; controls outside the board retain their existing behavior. Textual picker choices select directly without re-entering ambiguity detection. Keyboard selection remains direct, with existing preview/cancel/confirm/command ownership.

## Automated acceptance coverage

The PASS status below applies to the stated automated evidence only. Native browser, physical touch/rotation, 200% text zoom, assistive technology and visual/performance acceptance remain NOT RUN for P1A.

| IDs | Automated evidence | Status |
| --- | --- | --- |
| E01 | Pure initial baseline with empty/recent history; App and table interaction tests retain final dice without replay | PASS |
| E02–E03 | Normal socket and command-refresh snapshots; sorted/deduplicated roll + production events; duplicate, reordered, same-revision and locale/panel changes do not replay or extend deadlines | PASS |
| E04 | Independent old revision/seq guards; old generations; normal socket board survives a delayed older HTTP response | PASS |
| E05 | Actual SocketClient reconnect and events-gap refetch paths; full, incomplete, empty and large-gap windows baseline; subsequent normal snapshot animates | PASS |
| E06 | Pure cursor resets on a smaller new-game seq/revision; its next event plays | PASS |
| E07 | Eight groups including active, overflow discard, 800 ms deadlines, multiple rolls in one delta, immediate mandatory interruption and operable prompt | PASS |
| E08 | Active dice identity survives locale, hand/tool, zoom and resize changes; no command is submitted by these changes | PASS |
| E09 / A01 (lifecycle portion) | Fake timers, StrictMode, unmount/remount, background/return, data received hidden, initial and changing reduced motion; exact owned listeners removed and timer count returns to zero | PASS |
| E10 (existing flow) | Existing rejected/unknown/retry/preview tests remain passing; animation receives confirmed projection/events only, never receipts or preview intent | PASS for existing automated flow; production receipt/browser replay NOT RUN |
| I01 | Pure projection round trips on hex-r2/hex-r56, six viewport sizes, zoom .7/1/3, pan, origins, letterbox and CSS/DPR-independent input; error ≤1 CSS px | PASS for mathematical projection |
| I02 | DOM pointer pinch, drag, cancel and leave; no selection/submission; following deliberate click works; capture starts only on movement | PASS for DOM simulation; native/physical input NOT RUN |
| I03 | Exactly 30 CSS px after projection; narrow letterboxed board opens textual picker, and list choice selects once | PASS for math and mocked-rectangle component evidence |
| I04 | Existing keyboard preview/confirm tests plus direct dense-target keyboard selection, cancel with zero submissions, and picker command index preserved | PASS |
| I05 | Resize retains zoom; current rectangle is remeasured for selection; explicit fit resets zoom; both board sizes covered mathematically | PASS for automated portion; orientation/text zoom/native layout NOT RUN |

The new tests are `board-animation.test.ts`, `board-animation-lifecycle.test.tsx`, `board-viewport.test.ts` and `board-visual.test.tsx`. The existing `app.test.tsx`, `table-interactions.test.tsx` and `resilience.test.tsx` were adjusted/extended directly for this behavior. No production, robber-flight or particle visual assertion is claimed.

## Commands and results

Commands ran from the task worktree with its existing dependencies. No dependencies or tool configuration were installed/changed. Git ownership was handled only by command-scoped `-c safe.directory=D:/Workspace/Projects/katan/.worktrees/board-visual-spike`.

| Command | Exit | Result |
| --- | --- | --- |
| `pnpm --filter @catan/web typecheck` | 0 | PASS, including final source and new tests |
| `pnpm --filter @catan/web test -- board-animation.test.ts board-animation-lifecycle.test.tsx board-viewport.test.ts app.test.tsx table-interactions.test.tsx resilience.test.tsx` | 0 | Initial focused verification: 6 files, 61 tests |
| `pnpm --filter @catan/web test` | 0 | Final full successful run: 19 files, 159 tests |
| `pnpm --filter @catan/web test -- board-animation-lifecycle.test.tsx board-visual.test.tsx` | 0 | Final lifecycle/socket/capture changes: 2 files, 15 tests |
| `pnpm --filter @catan/web test -- app.test.tsx table-interactions.test.tsx` | 0 | Final initial-history fixture correction: 2 files, 28 tests |
| `pnpm --filter @catan/web test -- board-animation.test.ts board-animation-lifecycle.test.tsx` | 0 | Legacy background/remount regression: 2 files, 21 tests |
| `pnpm build` | 0 | PASS; web and server production artifacts built |
| `pnpm smoke` | 0 | PASS; 13/13 checks, including real three-seat setup, roll acceptance, chat and other-seat hidden-resource privacy |
| `pnpm verify` | 1 | FAIL; existing Windows server vocabulary path defect, unchanged |
| `git -c safe.directory=D:/Workspace/Projects/katan/.worktrees/board-visual-spike diff --check` | 0 | PASS |

During development, one new test fixture omitted the required `moveRobber.cause`; typecheck failed with TS2322, then passed after the fixture was corrected. Two new component assertions initially mismatched the actual translated text and the correct unambiguous zoomed target distance; these assertions were corrected without changing the projection to fit them. A full web run also observed one `lobby.test.tsx` `findByTestId('board-svg')` timeout (1 failed / 157 passed); that unchanged file passed all seven tests alone and subsequent complete runs passed all 158 and, after the legacy recovery regression was added, all 159. This transient failure is retained here; no unrelated timeout/test configuration was changed.

`pnpm verify` passed all four workspace typechecks, rules 110 tests and protocol seven tests. Server results: 81 passed, 11 skipped, three failed in `packages/server/test/vocabulary.test.ts`. Its `new URL('../src', import.meta.url).pathname` resolves to `D:\D:\Workspace\Projects\katan\.worktrees\board-visual-spike\packages\server\src` on Windows and throws `ENOENT` in `serviceSources` at line 23. The aggregate gate stopped before its build/smoke stages; the explicit build and smoke results above are separate, not a claim that verify passed.

## Scope and remaining evidence

Changed owners are limited to the web board presentation/coordinates, local table sync metadata and directly related tests, SPEC §8.8, this report and the Aegis index. No lockfile, package manifest, server/protocol/rules source, generated artifact or tool configuration is part of the change. No test-results, temporary files, Python bytecode or cache files are included in the Git change set.

Remaining: the known full-verify failure is BLOCKED on an independently scoped Windows test-path fix. P1A browser/device/assistive-technology and visual/performance matrix evidence is NOT RUN; these unit/DOM tests are not native SVG or physical-device proof. Existing P0 browser evidence is not relabeled as P1A evidence. P1B and the later renderer decision remain outside this implementation and have not started.
