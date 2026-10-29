# Modeled Board Execution

User approved execution of the three supplied plans on 2026-10-29.
ArchitectureReviewRequired: yes. TDD Route: off; add regression verification.

## Execution Readiness View

- Intent lock: modeled hexes, buildings, roads, robber and terrain with readable fixed orthographic presentation.
- Scope fence: web presentation only; no rules, protocol, server, identity, private data or command ownership changes.
- Baseline lock: fetched origin/master 773174332437554c3371deac197dccc9f6b82567; #7 MERGED, head b44e517. Provider verified using user-environment gh.
- Worktree: .worktrees/board-3d, feat/board-3d. Main checkout research files remain untouched; approved inputs copied, not moved.
- Owners: parent owns contracts, BoardView/SvgBoard, hook reset, dependencies and integration; A projection/input; B three/; C effects/evidence/runner. Only parent mutates Git.
- Compatibility: SVG stays default until ALL acceptance gates and user visual approval. Explicit r3f/auto opt-in, same controller and selection owner.
- Retirement: remove old SVG target gesture owner after DOM overlay integration; retain SVG as intentional GPU-free compatibility path.
- Verification: frozen install, typecheck/test/build, verify, fixed-build browser captures, three-way spec then quality review.
- External gates: real Android/iOS, assistive technology and user visual approval must not be fabricated.
- Drift rule: contract changes require parent approval and notification; pause for rules/private data changes.

## Change Necessity And Complexity

CSS/SVG-only cannot meet approved true-volume/depth requirements. Code change required, bounded to board presentation. BoardView is already mixed/large: extract SVG art first, delegate new responsibilities to explicit modules; keep integration wiring-only. No renderer plugin registry or second event queue.

## Baseline Read Set

Supplied research, plan, acceptance; docs/SPEC.md section 8; BASELINE-GOVERNANCE; #7 geometry/intent/viewport/animation/effects and fixture generator. Seven architecture review dimensions apply at integration. No missing baseline preventing S1.
