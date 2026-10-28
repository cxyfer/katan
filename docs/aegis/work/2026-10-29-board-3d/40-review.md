# Cross-Review And Repair

The planned three owners reviewed one another in two passes (spec compliance,
then code quality). Reviews happened before the final H3 source freeze so fixes
would not invalidate the final captures. No fourth implementation owner was added.

## A Reviews B

- Found roof/body gaps caused by centered box geometry versus grounded roof geometry. B aligned composed world bounds and added continuity assertions.
- Found unused tile-side material. B split cap/wall geometry into separate single-material instanced draws after the material-array path rendered empty in native Chromium.
- Found fixed fog washed out the larger topology and atlas. B removed fog.
- Found robber top outside the declared fit bound. B corrected the transformed maximum to 0.575 and tested it.
- Found instance-buffer ownership not covered by shared resource leases. B now disposes released instance-owned buffers with a deferred StrictMode-safe check; shared geometry/material disposal remains lease-owned.
- Parent also found atlas labels covered by token bodies. B separated body/label heights, verified native Chrome rendering, and added the inert Canvas fallback regression.
- Road/building presentation remains within the existing event owner, with separate 240/290ms transforms.

## B Reviews C

- Found stage-contained endpoints could still be below the viewport. C now filters seat, aggregate and production-source centers against both stage and viewport, with partial-stage/below-fold tests and text fallback.
- Reviewed non-modal TargetPicker focus/escape/opener restoration, SelectionPreview heading focus and target/cost status, repeated cancel, invalidation, and renderer-switch focus preservation.
- Found stale CB-01/L02 expectations after the explicit heading-focus policy. Tests now capture the post-selection node, verify it is the heading, then require that identical node to survive renderer fallback/switch. Command/selection/privacy assertions remain intact.
- Final spec review passed. Quality has no product-source blocker after those repairs; caching a few repeated seat-coordinate calculations is optional, not an acceptance gate.

## C Reviews A And Parent Test Configuration

- Found same-sized layout/scroll offset could leave global target rects stale. A added capture scroll, visualViewport, ancestor-size, stage-layout mutation and font-ready invalidation; rect updates are deduplicated and listeners/observers are cleaned up.
- A's focused suites passed 26/26 after the fix. C's final spec and quality re-review passed for covered engineering behavior.
- Reviewed four-worker jsdom cap against measured contention evidence, not relaxed assertions. Parent still owns the full final verify.
- Independent browser projection error <=2 CSS px, native multitouch and a real screen-reader walkthrough remain NOT RUN; focused tests are not promoted into those acceptance cases.

## Frozen Evidence Boundary

No review declares user art acceptance, physical-device performance, authenticated
multi-seat R02 completion, or twenty-cycle GPU lifecycle acceptance. Final source,
build, fixture and browser results belong in `90-evidence.md` and raw reports.

Architecture alignment is retained: one controller, selection owner, gesture
surface and animation cursor; renderer inputs use only the authorized public
projection; no rules/protocol/server/save/identity changes. SVG remains default.
