# Island diorama implementation

Date: 2026-10-29. Status: implemented locally; user visual review and remote
publication remain open. See the [verification record](../work/2026-10-29-island-diorama.md).

## Intent and baseline

The user rejected the visual result of PR #8 and supplied Hearthsea video,
screenshots, and the heart-island site as references. The requested deliverable
is a modeled Catan board with distinct terrain, harbors, settlements and roads,
and usable camera movement and zoom. The user's instruction to continue
implementation authorizes this work; the previous proposal's fixed-camera
restriction is superseded by this request.

Follow-up scope: distinguish single-cottage villages from twin-tower cities;
enlarge and center the number tokens; enlarge explicit harbor ratios and add
resource icons/names; model a larger hooded robber; and expose a 25–80° camera
elevation slider in the game and preview. These use the same renderer,
viewport, projection and selection owners.

The next user correction restores native scenery scale and arranges complete
objects in a crescent around centered number tokens. Widen roads from .085
to .15 units. Held left drag controls azimuth/elevation; Shift-left/right drag
pans, with wheel zoom and one-/two-finger touch equivalents. Retain ordinary
clicks through the existing 6px drag threshold and shared input owner.

Baseline: local `feat/board-3d` at `4c84b15`, clean before this task. The primary
checkout's existing uncommitted planning documents remain untouched. Remote
PR status and fetch could not be verified: automatic escalation review denied
the credentialed GitHub read and fetch. Do not work around that denial.

ArchitectureReviewRequired: yes. TDD: off; add meaningful geometry and camera
regression tests and run the existing verification suite.

## Change necessity and boundaries

The existing cone trees, cone mountains, sphere sheep and plank harbors do not
provide the silhouettes or material detail requested. Reuse the existing R3F
renderer, world coordinates, target overlay, viewport owner, controller,
animation cursor, fallback and resource cleanup. Add baked, vertex-colored
procedural meshes rather than model downloads or a second renderer.

No rules, protocol, server, persistence or hidden-information changes. Keep
selection/confirmation and input ownership in BoardView/useBoardViewport.
Render scenery without pointer handlers. Every terrain and structure remains
deterministic and derived from the authorized public board.

## Visual direction

A hand-built maritime miniature: turquoise water, layered rocky shores,
warm directional light, soft shadows, matte painted wood and varied terrain.
Forest, hills, pasture, fields, mountains and desert get complete miniature
landscapes; gold and sea retain distinct models for supported display fixtures.
Reserve number-token clearance and all vertex/edge placement lanes.
Harbors include plank piers, pilings, cargo and small sailboats. Settlements
have walls, pitched colored roofs, chimneys and doors; cities have a different
multi-volume/tower silhouette. Roads remain strong player-color connections.

## Implementation ownership

- Primary agent: shared geometry baker and instancing primitive, SceneContent,
  resources, island water/coast, lighting, composition, preview and integration.
- Terrain agent: `three/diorama-terrain.ts`, `three/DioramaTerrain.tsx`,
  directly related new terrain tests.
- Structure agent: `three/diorama-structures.ts`,
  `three/DioramaStructures.tsx`, directly related new structure tests.
- Camera agent: BoardView, useBoardViewport, render-contract, three/camera,
  relevant i18n and camera tests. Coordinate bounds with primary agent.

Agents share the same worktree and must not revert one another's edits.
Geometry baking API is frozen before implementation tasks are dispatched.
Only the primary agent handles Git operations and final integration.

## Verification and evidence

1. Baseline web tests and production build; capture old 19/30-hex scenes.
2. Geometry tests: finite nonempty closed geometry, deterministic variants,
   reserved token clearance, distinctive structures, resource disposal.
3. Existing typecheck/tests/build/smoke, fallback and gesture regressions.
4. Real WebGL browser screenshots at desktop/mobile, both board topologies,
   terrain/building/harbor closeups; exercise zoom, pan, camera rotation and
   elevation, observing the actual matrix sent to WebGL and live game targets.
5. Record actual browser failures and device limits separately from passing
   engineering checks. Screenshots are reviewable art, not proof of user
   acceptance or native-device performance.

Keep a local preview available for the user to inspect. Publish only to the
feature branch and create/update a PR if authorization and credentials allow;
never merge automatically. If remote operations remain denied, report the
local deliverable and exact publishing blocker.
