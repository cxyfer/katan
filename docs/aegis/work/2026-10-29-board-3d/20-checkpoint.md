# Execution Checkpoint

- Completed: approved inputs read; main dirty documentation preserved; fetched base; verified #7 MERGED; isolated task worktree created. H0 e3ecfe8 includes SVG extraction/reset and exact dependencies; frozen install, 168 tests and production build passed. Contract v1.1 corrects player color to the existing public projection type, synchronized to A/B/C.
- Active: H4 cross-review repair before H3 source freeze. A reviewed B model composition/materials/bounds/disposal; B reviews C effects/lifecycle; C reviewed A projection/input/focus. Parent integration keeps one controller/selection/gesture owner and one event cursor. R3F inert Canvas fallback repair is verified in a real browser diagnostic, not yet frozen evidence.
- Verification: frozen install passed. Full pnpm verify passed with 110 rules, 7 protocol, 84 server (11 skipped), 215 web tests, production builds and 13/13 service smoke checks before review repairs. The unconstrained jsdom suite had a 5s timeout; a measured four-worker rerun passed 215/215 and reduced total environment creation time from about 260s to 78s. Web maxWorkers is now four; assertions were not removed. All repairs require a fresh final verify.
- Next: finish review repair/re-review; commit source; fresh full verify/build; H3 fixed-build browser evidence; H5 draft PR while external acceptance gates remain.
- Blockers: none for engineering. Device/art acceptance not available yet; keep SVG default.
- Drift: aligned to parent intent, scope, compatibility, retirement and test obligations. Decision: continue.
- Resume: operate only in D:/Workspace/Projects/katan/.worktrees/board-3d. Main checkout and board-visual-spike are not task edit targets. Contract file is parent-owned.

## Review Repair Boundaries

- Change necessity: actual model continuity/material/fit/resource defects and stale measured rects violate the approved plan; fix locally in their original owners, not by weakening V/I/G acceptance thresholds.
- Parent authorized C's narrow extension into TargetPicker/SelectionPreview and direct tests for non-modal focus/announcement policy. Parent wires picker cancellation only. No gameplay or command owner changes.
- Removed obsolete SVG target CSS after replacing its interaction owner with the common DOM target overlay. SVG visual art remains intentionally retained for GPU-free compatibility; there is no retirement date until acceptance permits a new default.
- Complexity: BoardView is thinner after SVG extraction. Scene models/camera/resources stay separate. The runner is a cohesive but large test artifact; it reuses the existing fixture/service implementation, and uncovered cases remain explicit rather than expanding this slice into a second end-to-end framework.
- ADR action: skip a new accepted-default ADR. This opt-in experiment is reversible and the approved research/plan already owns the trade-off; SPEC/FIDELITY now describe the executed compatibility state. A later default change requires fresh device/art evidence and explicit user approval.
