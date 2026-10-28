# P0 control group

Scope: the [P0 plan](../../plans/2026-10-28-board-visual-spike.md) and [acceptance method](../../plans/2026-10-28-board-visual-spike-acceptance.md). Fixture generation, a portable production browser runner, evidence, Python cache ignore rules and the workspace index are updated. No game UI, rules, protocol, dependency manifest, lockfile, or canonical screenshot changes.

## Reproduce

Run from the `feat/board-visual-spike` worktree. Python and browsers are isolated under `.tmp/`; evidence goes under `test-results/`. Use a new output directory for each run: the runner refuses to overwrite evidence.

```powershell
pnpm install --frozen-lockfile
python -m venv .tmp/board-visual-venv
.\.tmp\board-visual-venv\Scripts\python.exe -m pip install playwright==1.64.1
$env:PLAYWRIGHT_BROWSERS_PATH = Join-Path (Get-Location) '.tmp/board-visual-browsers'
.\.tmp\board-visual-venv\Scripts\python.exe -m playwright install chromium firefox webkit
pnpm build
node scripts/board-visual/fixtures.mjs --out test-results/board-visual/fixtures.json
.\.tmp\board-visual-venv\Scripts\python.exe scripts/board-visual/verify.py --renderer svg --fixture test-results/board-visual/fixtures.json --out test-results/board-visual/before-svg-control --browser chromium
```

The initial pip 22.2.1 install downloaded Playwright but then consumed CPU without making observable progress for several minutes; it was interrupted (exit 1). The existing `uv` executable was used successfully with a worktree-local cache, after its default cache was denied by the sandbox:

```powershell
uv --cache-dir .tmp/board-visual-uv-cache pip install --python .tmp/board-visual-venv/Scripts/python.exe playwright==1.64.1
```

Installed versions: Python 3.10.6; Playwright 1.64.1; greenlet 3.5.6; pyee 13.0.1; typing-extensions 4.16.0. Managed browser install exited 0: Chromium/CfT 156.0.8078.4 r1248, Firefox 157.0 r1555, WebKit 27.2 r2370, FFmpeg r1013, Winldd r1007. The browser runs below use Chromium; installing Firefox/WebKit does not count as testing them.

## Verification results

The completed control below was regenerated and run to normal process exit. Installation, product typecheck/test/build/smoke and the existing project gate failure were recorded earlier in the same P0 worktree; product code and tests remain unchanged. Python/JS syntax, ignore coverage and `git diff --check` were checked again during this completion pass.

| Command / check | Exit | Result |
| --- | --- | --- |
| `pnpm install --frozen-lockfile` | 0 | PASS; pnpm 10.28.0, Node v24.12.0; lockfile resolution skipped and 116 packages installed |
| `pnpm --filter @catan/web typecheck` | 0 | PASS |
| `pnpm --filter @catan/web test` | 0 | PASS; 15 files, 123 tests |
| `pnpm build` | 0 | PASS; web and server production artifacts |
| `pnpm verify` | 1 | FAIL; existing Windows server vocabulary path defect, described below |
| `pnpm smoke` | 0 | PASS; 13 checks, including real three-seat setup, dice command, chat and other-seat resource privacy |
| Fixture generation and repeated generation | 0 | PASS; identical SHA-256 `0f5de2162c1db41f375c35dd1ad4f455d3e37fefc9f159bb93b4c6b111c147ed` |
| Fixture privacy/topology assertions | 0 | PASS; only p1 receives private player fields; no private event envelope exported; 19/30 hex counts |
| Wrong external artifact probe | 0 (probe), 1 (runner) | PASS; runner rejects mismatched bytes before browser launch, leaving external HTTP service running |
| Chromium `before-svg-control` | 0 | PASS overall; 37 cases PASS, 0 FAIL, 0 BLOCKED, 2 NOT RUN; 24 static captures, 6 event videos/traces and 6 performance windows complete |
| Python compile / JS `node --check` | 0 / 0 | PASS; no bytecode emitted by the syntax check |
| `git diff --check` | 0 | PASS |
| `git check-ignore -v` for cache / local outputs | 0 | PASS; `__pycache__/`, `*.py[cod]`, `.tmp/` and `test-results/` are excluded |

The full verify log is `test-results/board-visual/pnpm-verify.log`. All workspace typechecks passed; rules passed 110 tests and protocol passed 7 tests. Server tests had 81 passes, 11 skips and 3 failures in `packages/server/test/vocabulary.test.ts`: `new URL('../src', import.meta.url).pathname` produces a path that resolves to `D:\D:\Workspace\Projects\katan\.worktrees\board-visual-spike\packages\server\src` on Windows, causing `ENOENT`. This existing test is outside P0 ownership and remains unchanged. Build and smoke were run separately because `pnpm verify` stopped before those stages. Do not report the full verification gate as passing.

## Runner and fixture behavior

- `fixtures.mjs` loads the existing web fixture helpers and rules via esbuild's JS API in a unique `os.tmpdir()` directory, cleans that directory in `finally`, and writes only to the requested `test-results/` path. It does not spawn pnpm or assume a Linux temp path.
- Seed 7 creates actual four-seat / six-seat rules games, completes validated setup, provisions p1's synthetic test resource balance, and validates a roll (2 + 4), city upgrade and road build with the engine. Only `projectGame(..., 'p1')` snapshots are exported. Static boards have 9/11 harbors, 8/12 buildings (including one city), and 9/13 roads. The six-seat production event contains the actual aggregate grants for p1, p3 and p5.
- Static snapshots omit event history intentionally so P0 can capture an animation-free control without changing existing UI. `historySnapshot` preserves authorized historical events; `baseline` and the timed `sequence` preserve full snapshots for subsequent replay. At the original P0 control date, initial historical dice replay was existing behavior and static capture did not prove E01. P1A subsequently fixed baseline/recovery replay; the current runner now tests full history without replay in its P1B suite. The original P0 evidence and hashes remain historical control data.
- Without `--base-url`, the runner starts this worktree's bundled server with a free localhost port, a unique temporary SQLite directory, an explicit `WEB_DIST_PATH`, and cleared PostgreSQL environment overrides. `finally` terminates only its own child, waits for it, and removes only its temporary database directory. Browser API/WebSocket fixtures never reach the DB.
- External origins are never stopped by the runner. Before browser execution it fetches every local dist HTML/JS/CSS path and compares SHA-256 bytes, then checks actual browser response bytes again. Commit and dirty state are observed through a command-scoped Git ownership exception, without changing global Git configuration.
- The 24 static captures use DPR 1 and reduced motion. Six 10-second event videos replay authorized full snapshots over the mocked WebSocket on desktop, mobile portrait and landscape for both boards. Chromium performance capture warms the roll first, then records three 30-second windows on desktop and emulated mobile, saving active CSS animation rAF intervals, Playwright traces and Chromium timeline traces. Idle gaps are excluded. These are scheduling proxies and fixture evidence, not physical mobile or GPU render measurements.

## Limitations

No human visual acceptance, physical mobile, screen reader, server acknowledgement latency, input latency, memory/GPU leak proof, Firefox, or WebKit runtime acceptance is claimed. Hardware inventory via CIM is denied in this sandbox; the runner records the query error, CPU string/logical count where available, and explicitly unknown RAM/GPU/power/refresh fields.

The current application renders translated English text but leaves `document.documentElement.lang` at the static `zh-Hant` value from `packages/web/index.html`. The runner records both the selected UI locale and HTML language. This existing accessibility gap is preserved, not silently fixed by P0.

Canonical `docs/screenshots/` captures are unchanged. All generated full reports, screenshots, videos, traces and logs remain ignored under `test-results/board-visual/`. This document and the curated P0 evidence in this directory are reviewable work evidence, not accepted visual baselines.

## Completed control

The sole completed control source for this report and [curated evidence](p0-evidence.json) is `test-results/board-visual/before-svg-control/report.json`. It ran from **2026-10-28 12:32:43 UTC to 12:38:19 UTC**, exited **0**, and reported overall **PASS**. Commit: `25e97f335ed5741f9475e2ab4911c2100cadef66`; dirty: `true`. The report records the observed dirty paths, fixture SHA-256, worktree dist/served asset hashes, executable hash, Python/Playwright/browser versions and limitations.

All **24/24 static captures**, **6/6 ten-second snapshot replay videos and Playwright traces**, and **6/6 thirty-second performance windows** completed. Each performance window has raw active intervals, a Playwright trace and a Chromium timeline. The following values summarize the raw samples; they do not establish reference hardware performance acceptance.

| Device | Repetition | Active samples | p95 interval (ms) | Max interval (ms) |
| --- | --- | --- | --- | --- |
| Desktop 1366×768 | 1 | 1,192 | 8.5 | 19.5 |
| Desktop 1366×768 | 2 | 1,196 | 8.5 | 15.1 |
| Desktop 1366×768 | 3 | 1,193 | 8.5 | 16.6 |
| Emulated mobile 390×844 | 1 | 1,197 | 8.5 | 12.9 |
| Emulated mobile 390×844 | 2 | 1,197 | 8.5 | 14.2 |
| Emulated mobile 390×844 | 3 | 1,196 | 8.5 | 13.9 |

The two NOT RUN cases are human visual acceptance and calibrated reference hardware targets. There are no failed or blocked capture cases. P0 does not promote emulated touch to real-device acceptance or rAF intervals to GPU render time.

Normal `finally` cleanup completed: the runner waited for its own server child to exit and removed its unique temporary SQLite directory. The recorded Windows child termination code is 1; the runner itself exited 0. The curated evidence retains that cleanup result and verifies that the temporary directory no longer exists.

The curated JSON retains the completed source report hash, current script hashes, complete case summaries, performance summaries and each selected screenshot's source path/hash. Full raw intervals, all images/videos and Chromium timelines stay under the ignored control run directory. Earlier partial development captures are not used for the completion conclusion.

Selected captured states, all pending human visual acceptance:

- [19 hexes / English / desktop](before-hex-r2-en-desktop.png)
- [30 hexes / Traditional Chinese / desktop](before-hex-r56-zh-Hant-desktop.png)
- [30 hexes / English / mobile portrait](before-hex-r56-en-mobile.png)
- [30 hexes / Traditional Chinese / mobile landscape](before-hex-r56-zh-Hant-landscape.png)

Overall: **P0 control capture PASS / M0 comparison method established; full `pnpm verify` remains FAIL on an existing Windows test defect.** Human visual acceptance, physical-device and other listed product acceptance items remain NOT RUN. No P1 behavior or renderer dependency was added, and no commit or push was made.
