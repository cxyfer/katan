# Modeled Board Reflection

## Result And Completion Boundary

The three-owner implementation is integrated, full repository verification
passes, and fixed-build GPU/SVG evidence is retained. This is an experimental
engineering delivery, not acceptance of all supplied V/I/E/G/P/A/R criteria.
Stop state is needs-verification; open a draft PR without merging or changing
the SVG default. Physical devices, assistive technology, real multi-seat flows,
independent interaction oracles and human art feedback are the next gates.

## What Changed The Outcome

- Freeze numeric/public contracts before delegation; keep commands and event cursor outside renderers. This allowed recovery without replacing controller/selection or replaying history.
- Inspect the real native WebGL path: a mounted Canvas fallback side effect, covered atlas labels, roof gaps, unused wall material and fixed fog were actual rendered defects, not matters to paper over with test mocks.
- Original owners repaired findings before final source freeze. Cross-review caught disposal ownership, offscreen anchors and stale same-size rects; full verification caught the stale heading-focus assertion.
- Separate product defects from harness/environment failures. Video finalization and Firefox sandbox startup were retained with precise errors, narrow fixes/retests and unchanged product build hashes.
- Report measurement scope honestly. Idle RAF intervals, representative fixtures and headless native GPU are useful evidence, but not active workloads, dense-endgame maxima, calibrated mobile performance or art approval.

## Complexity And Retention

BoardView no longer owns inline SVG artwork. Numeric projection/input, scene
models/resources and stage-local effects have explicit modules and one owner
each. The browser runner is large but cohesive and reuses existing service and
fixture helpers rather than creating a second protocol/game implementation.
Future extensions should preserve that boundary rather than add renderer-specific
command callbacks or duplicate queues.

Old SVG target gesture/CSS logic was removed. SVG art is deliberately retained
as the GPU-free/default path, not obsolete compatibility debt: retirement or a
new default requires explicit approval after the open acceptance gates pass.
No persisted-data migration or rollback is needed; renderer choice is reversible.

Architecture baseline result: aligned within the approved opt-in experiment.
No accepted-default ADR is added because that decision has not been made. A
default switch requires its own accepted evidence/decision record. Confidence
remains B for measured engineering and C for complete product acceptance.
