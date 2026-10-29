# Execution Checkpoint

- Completed: H0 contracts/dependencies and H1/H2 A/B/C implementation integrated on feat/board-3d, based on origin/master 7731743 (#7 merged). Main checkout's dirty documentation remains untouched. Final product source is cf290d4; b96c558 and 12860b3 repair only the evidence runner.
- Review: three-owner spec/quality cross-review and original-owner repairs completed. A's final verdict has no P0-P2 engineering blocker. B's stale CB-01 heading-focus assertion was corrected without weakening command/selection/privacy checks; the final full suite passes. See 40-review.md.
- Verification: frozen install and full pnpm verify PASS: rules 110, protocol 7, server 84 (11 skipped), web 227/27 files, production builds, smoke 13/13. Fixed-build Chromium standard/low/SVG reports have zero FAIL, with unexecuted gates explicit. Firefox (outside sandbox) and WebKit each captured four modeled views; auto fault checks and supplemental model closeup pass. See 90-evidence.md for hashes, scope and raw reports.
- Stop state: needs-verification for whole acceptance; engineering candidate ready for draft PR, not ready to change the default renderer. H3 captures followed review repairs; a runner-only video finalization failure and sandbox Firefox failure are retained alongside successful retests.
- Next: push the feature branch and open a draft PR against master; do not merge. Resume acceptance with physical mobile/assistive-technology/art review and the unexecuted interaction/event/lifecycle/performance cases.
- Blockers: no known source integration blocker; full R02, independent projection tolerance/native touch, G04/G05, calibrated active performance, screen reader and human art acceptance remain open. SVG stays default; r3f/auto require opt-in.
- Drift: aligned to parent intent, scope, compatibility, retirement and test obligations. Decision: continue.
- Resume: operate only in D:/Workspace/Projects/katan/.worktrees/board-3d. Main checkout and board-visual-spike are not task edit targets. Contract file is parent-owned.

## Review Repair Boundaries

- Change necessity: actual model continuity/material/fit/resource defects and stale measured rects violate the approved plan; fix locally in their original owners, not by weakening V/I/G acceptance thresholds.
- Parent authorized C's narrow extension into TargetPicker/SelectionPreview and direct tests for non-modal focus/announcement policy. Parent wires picker cancellation only. No gameplay or command owner changes.
- Removed obsolete SVG target CSS after replacing its interaction owner with the common DOM target overlay. SVG visual art remains intentionally retained for GPU-free compatibility; there is no retirement date until acceptance permits a new default.
- Complexity: BoardView is thinner after SVG extraction. Scene models/camera/resources stay separate. The runner is a cohesive but large test artifact; it reuses the existing fixture/service implementation, and uncovered cases remain explicit rather than expanding this slice into a second end-to-end framework.
- ADR action: skip a new accepted-default ADR. This opt-in experiment is reversible and the approved research/plan already owns the trade-off; SPEC/FIDELITY now describe the executed compatibility state. A later default change requires fresh device/art evidence and explicit user approval.
