# Modeled Board Evidence

Date: 2026-10-29 (Asia/Taipei; raw report timestamps use UTC).

## Decision And Scope

Engineering candidate implemented and cross-reviewed. **Whole acceptance remains
needs-verification; SVG stays the default.** `?renderer=r3f` and
`?renderer=auto` opt into the lazy modeled path. No human art approval, physical
mobile acceptance, or screen-reader acceptance was obtained. The PR must remain
draft and must not be interpreted as authorization to change the default.

Implemented: thick tile cap/wall, terrain meshes, settlement/city/solid roads,
volumetric robber, number/harbor atlas, orthographic fit/pan/zoom, DOM legal-target
overlay, keyboard/picker/confirmation focus, stage-local effects, demand rendering,
shared resource cleanup and SVG failure recovery. One controller, selection owner,
gesture surface and event cursor remain. No rules/protocol/server/save/identity
source changes were made.

## Provenance

- Worktree: `D:/Workspace/Projects/katan/.worktrees/board-3d`, branch `feat/board-3d`.
- Base: `origin/master` `773174332437554c3371deac197dccc9f6b82567`, merged #7; fetched again before publication.
- Contract/dependencies: `e3ecfe8`. Product implementation: `cf290d43196a4683d34c96a5889633271fd9ff7c`.
- Runner-only video fix: `b96c558ffec11ee8f5ce5b01cf12c4f914b7faaf`.
- Runner-only bounded clips / SVG scope fix: `12860b332e8069b08f12f188435877d96f9aa212`.
- Standard all-suite source is `b96c558`; low/SVG, supplemental standard events, auto faults, Firefox/WebKit and closeup source is `12860b3`. These revisions share the same product build below. Documentation/evidence additions do not change product source.
- Build manifest SHA256: `5a384b3c525d1536139fb45a7c5c15ea91a31c71730de273c07ccba1038189e1`. Raw reports contain individual built and served asset hashes; T01 verified byte identity.
- Fixture SHA256: `d03eb8bd0e97a2d016460de06894f91883f1f23dfff931333ca03464e39caa55`. Retained at `evidence/fixtures-final.json`; generator is `scripts/board-3d/fixtures.mjs`, seed 7.
- `hex-r2`: 19 hexes / 54 vertices / 72 edges, four players, eight buildings / nine roads. `hex-r56`: 30 / 83 / 112, six players, twelve buildings / thirteen roads. These are representative synthetic fixtures, **not fully populated dense endgames or authenticated real games**.

## Full Repository Verification

`pnpm install --frozen-lockfile` and `pnpm verify` completed with exit 0.

| Gate | Result |
| --- | --- |
| Rules | 110 passed |
| Protocol | 7 passed |
| Server | 84 passed, 11 skipped |
| Web | 227 passed, 27 files |
| Typecheck / production web and server build | PASS |
| Service smoke | 13/13 PASS |

Raw log: [verify.log](evidence/verify.log), SHA256
`9cf2bb2ef42fd0e6232223757203585e18fe581c569d351ac8883bb307bf42fa`.
PowerShell's stderr wrapper labels Vite's chunk-size warning `NativeCommandError`;
the build and enclosing verify still exited 0. The lazy GPU chunk remains a
known cost, not a cold-load acceptance pass:

| Asset | Bytes (build display) | Gzip |
| --- | --- | --- |
| Entry `index-DeF8S8Wj.js` | 448.89 kB | 134.99 kB |
| GPU `BoardScene3D-DYeWSKad.js` | 935.51 kB | 249.25 kB |
| CSS `index-DGT5H3u5.css` | 80.27 kB | 18.20 kB |
| Atlas `board-atlas-gwoo0gAO.svg` | 6.55 kB | 0.84 kB |

The four-worker jsdom cap addresses measured environment contention. No test
assertion was removed to make the full suite pass. jsdom tests are supplementary
and do not establish GPU/browser/device acceptance.

## Browser Runs

Counts are raw case statuses, not a count of accepted requirements. `PASS` for a
selected suite does not accept its report's manualAcceptance matrix. Each all
suite has six external BLOCKED cases, hence exit 2 despite zero FAIL.

| Report under `evidence/` | Scope | PASS | FAIL | BLOCKED | NOT RUN | Aggregate |
| --- | --- | ---: | ---: | ---: | ---: | --- |
| [r3f-standard-final/report.json](evidence/r3f-standard-final/report.json) | Chromium standard all | 27 | 0 | 6 | 14 | BLOCKED |
| [r3f-low-final/report.json](evidence/r3f-low-final/report.json) | Chromium low all | 27 | 0 | 6 | 14 | BLOCKED |
| [svg-final/report.json](evidence/svg-final/report.json) | Chromium SVG all | 22 | 0 | 6 | 19 | BLOCKED |
| [r3f-standard-events-final/report.json](evidence/r3f-standard-events-final/report.json) | Standard events + bounded video | 9 | 0 | 0 | 5 | PASS |
| [auto-faults-final/report.json](evidence/auto-faults-final/report.json) | Auto no-GPU / chunk / native loss / switch | 7 | 0 | 0 | 2 | PASS |
| [firefox-visual-unsandboxed/report.json](evidence/firefox-visual-unsandboxed/report.json) | Firefox visual only | 7 | 0 | 0 | 1 | PASS |
| [webkit-visual/report.json](evidence/webkit-visual/report.json) | WebKit visual only | 7 | 0 | 0 | 1 | PASS |
| [closeup-final/report.json](evidence/closeup-final/report.json) | Supplemental model closeup | T01 + GPU/capture checks | 0 | 0 | n/a | PASS |

Chromium is installed Chrome `155.0.8059.86`, headless on Windows, with live WebGL2
and `ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Laptop GPU ... Direct3D11 ...)` from the
actual context. This is not SwiftShader, but is still not calibrated reference
hardware, an active mobile workload, or thermal/power evidence. Playwright is
`1.64.1`, Python `3.10.6`, Node `v24.12.0`, pnpm `10.28.0`.

Firefox is Playwright `157.0`; WebKit is Playwright `27.2`, both headless Windows
builds, not installed Safari/iOS. Their renderer strings may be privacy-normalized
(`GTX 980 ... or similar`, `Apple GPU`) and are **not physical GPU identification**.
WebKit's actual CSS viewport/DPR differs from the nominal requested screenshot
size on this Windows host; raw `actual.viewport`, canvas rect and drawing buffer
are authoritative. Do not use these visual captures to certify exact viewport
projection or physical device performance.

Covered browser behavior: legal target activation without implicit submit, 44px
targets, keyboard select/cancel, roll overlay lifecycle, neutral theft markup for
three players and outsider, reduced motion, simulated unavailable WebGL/chunk
failure, real `WEBGL_lose_context` loss with SVG fallback/retry, explicit SVG with
no GPU chunk fetch, and renderer-switch/resize. This is fixture transport, not R02.

## Performance Boundary

| Measure | Standard | Low | Meaning |
| --- | ---: | ---: | --- |
| P02 30-second stable foreground idle GPU draws | 0 | 0 | Observed WebGL draw calls |
| P02 board/page scheduled RAF callbacks | 0 | 0 | During the same stable window |
| P03 peak per-frame draw calls | 124 | 79 | Includes observed draw APIs/passes in fixture sequence |
| P03 peak submitted triangles | 14,714 | 7,797 | Fixture sequence, not a dense-endgame maximum |

P03 limits remained 250 / 150k standard and 150 / 100k low. Instrumentation
intercepts draw APIs and records resources; no inferred renderer.info values were
invented when the R3F root was unavailable. A viewport DPR around 1 is not DPR 2/3
acceptance. Background/reduce 30-second P02 variants and 20-cycle resource trends
remain unmeasured. P01 raw interval files are retained in each all-suite directory
but are explicitly **idle scheduling proxies**, not active pan/build/production
frame-time evidence or GPU render time. P01 active/reference-device acceptance,
P04 cold-cache transfer/parse/ready timing and P05 command-latency workload are open.

## Images, Before/After And Video

- Each all-suite report lists four full-board captures: 19/30 hexes, nominal desktop `1366x768` / mobile `390x844`, English / Traditional Chinese. Matching SVG captures in `svg-final/` are the current compatibility-path comparison, not a historical pre-change build.
- [Model closeup](evidence/closeup-final/modeled-pieces-closeup-r3f-standard-1366x768-en.png) is a real r3f city/terrain/road/robber candidate at 244% zoom, not an accepted art reference. Its [reproducer](evidence/capture-closeup.py) records script/build/source/fixture hashes and unchanged checks.
- The 30-hex mobile fit capture has small number labels; human readability acceptance V07 remains open. Zoom and engineering capture success do not waive that gate.
- Final standard [event video](evidence/r3f-standard-events-final/events-sequence.webm): WebM duration metadata `00:00:10.920000000`.
- Low [event video](evidence/r3f-low-final/events-sequence.webm): `00:00:11.320000000`.
- SVG [event video](evidence/svg-final/events-sequence.webm): `00:00:11.360000000`.
- All three satisfy the 10-15-second artifact duration. The earlier standard all-suite clip is 4.60s; its event behavior result is retained, but the supplemental standard event report/video supersedes its short artifact for duration compliance.

## Failures Retained, Not Rewritten

1. [r3f-standard-chromium/report.json](evidence/r3f-standard-chromium/report.json), source `cf290d4`: 26 PASS / 1 FAIL / 6 BLOCKED / 14 NOT RUN. Only E01 failed with `Page is not yet closed. Close the page prior to calling save_as`. Runner-only fix `b96c558` closes page/context before saving. The standard final retest removes that failure; `12860b3` adds explicit clip bounds and correct SVG NOT RUN cases.
2. [firefox-visual/report.json](evidence/firefox-visual/report.json): 2 PASS / 5 FAIL / 1 NOT RUN. `BrowserContext.new_page: Target crashed` occurred before application navigation. Same source/build passed outside the sandbox. This supports an environment-dependent launch limitation, not an identified Firefox internals root cause. Do not erase the original failure or call the sandbox run PASS.

## Open Acceptance Matrix

- V01-V07 / K3: human visual/art approval NOT RUN. Model shape, mobile readability and non-color cues are candidates, not accepted design.
- I02: independent browser <=2 CSS px projection oracle NOT RUN. I04 native pinch/wheel/capture-loss, I05 ambiguity browser flow, I06 full fit/zoom renderer parity NOT RUN; focused unit tests do not replace them.
- E02/E03/E04/full E06: browser receipt/placement timing, ghost depth, aggregate cap, full event recovery and background/reconnect sequences NOT RUN. Existing lifecycle/privacy tests remain useful but bounded.
- G04/G05: twenty enter/exit/retry cycles with resource trends and new snapshot during fault NOT RUN.
- P01/P02 variants/P03 dense lifecycle/P04/P05: missing measurements listed above; no mobile FPS, VRAM, cold-cache or command-latency claim.
- A01 screen-reader walkthrough BLOCKED; A02 200% text zoom/high contrast/gray, native assistive flow and complete A03 multi-seat scene metadata audit are not accepted. Synthetic theft DOM equality is narrower.
- R02 full authenticated multi-seat create/play/trade/save/resume/reconnect BLOCKED. Smoke's setup/roll/privacy checks do not establish full R02.
- R03 physical iOS/Android BLOCKED. Desktop Firefox/WebKit visual evidence is now present, but complete interaction/fault/device matrix remains open. The earlier all-suite `R03-all-browsers` BLOCKED case is not edited retroactively.

## Reproduction And Publication Safety

Use the isolated worktree and its own build/cache; do not reuse another checkout's
dist. Regenerate the fixture and check its hash, then run one performance suite
at a time (no competing browser workloads):

```powershell
pnpm install --frozen-lockfile
pnpm verify
node scripts/board-3d/fixtures.mjs --out .tmp/board-3d-fixtures-final.json
$env:PYTHONDONTWRITEBYTECODE='1'
.tmp/board-3d-venv/Scripts/python.exe scripts/board-3d/verify.py --fixture .tmp/board-3d-fixtures-final.json --out .tmp/board-3d-retest --renderer r3f --quality standard --suite all --browser chromium --executable-path 'C:/Program Files/Google/Chrome/Application/chrome.exe'
```

Change renderer/quality/suite/browser and choose a fresh output directory for
each run; the runner refuses nonempty output and enforces workspace containment.
Firefox needed an unsandboxed launch here. Python/Playwright and browser cache
remain worktree-local under ignored `.tmp`, not product dependencies.

Artifacts contain deterministic fixture names/hands, loopback routes and local
environment paths, not real accounts or captured auth tokens/cookies. API evidence
records method/path, not credentials. No `.tmp`, browser cache, DB or `__pycache__`
is staged. `evidence/manifest.json` records SHA256/size for retained evidence files.
Source/build are frozen for these captures; the final docs commit changes only
records/artifacts. Confidence: **B for covered engineering; C for whole acceptance**.

Final local artifact audit passed: current source hash equals the `12860b3`
report's source hash, current build manifest equals every report's build hash,
fixture/log/screenshot hashes match, final report cases have no FAIL, three final
WebM durations are bounded, closeup AST and local evidence Markdown links resolve.
`git diff --check` passes. The manifest inventories all retained evidence files
(excluding itself); no DB/cache/pycache is included. Evidence-local `.gitattributes`
disables text conversion so Git preserves the raw hashed bytes across platforms.
CRLF is recognized as an end-of-line for whitespace checks; raw console logs
are exempt from whitespace lint rather than edited after capture.
This is a bounded local
structure/integrity check, not an Aegis helper authority or acceptance decision.
