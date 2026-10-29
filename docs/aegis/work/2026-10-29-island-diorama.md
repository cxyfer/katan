# Island diorama verification

Date: 2026-10-29. Initial diorama: `57e8ef7`; readability/elevation: `f332fee`;
native-scale crescent, wider roads and drag orbit:
`a26c65612d192788d946abb84d60d596b80d07e0`
on the existing `feat/board-3d` worktree. This record covers local
implementation and verification, not user art acceptance or remote delivery.

## Delivered behavior

The [replacement plan](../plans/2026-10-29-island-diorama.md) is implemented in
the existing R3F renderer. Original procedural models distinguish six base
terrains, with separate gold/sea variants for display fixtures. Timber-framed
settlements, tower cities, player-colored roads, piers, cargo and sailboats
share a miniature maritime style. Layered rocky/sandy shores meet turquoise
water; the water shader is static and does not schedule idle animation frames.

The five requested refinements are included:

1. Single-cottage villages are about .33 units high; cities have a gated,
   twin-tower silhouette about .78 units high, with a wider footprint.
2. Number labels increased from .42 to .62 world units, with larger glyphs.
   Tokens occupy exact hex centers; scenery reserves a .30-radius clearing.
   Labels rotate with camera azimuth to keep digits upright.
3. Harbor label planes increased to .68 x .39, about 2.47 times the previous
   area. Near-full-cell artwork shows large 3:1 ANY / 2:1 ratios, resource icons
   and WOOD, BRICK, WOOL, GRAIN or ORE, replacing single-letter abbreviations.
4. The centered robber is a .90-unit hooded figure with a face, eye mask,
   cloak folds, belt, hands, boots, satchel and staff. The old three primitive
   robber helpers and their unused live resources were removed.
5. Game and preview expose a 25-80 degree viewing-angle slider, sharing the
   actual camera, viewport and target projection owner.

The latest three corrections are included:

1. Native-size trees, sheep, complete wheat plants and rocks form a crescent
   around the centered token. Whole objects move or rotate without the earlier
   global .8/.5 horizontal compression. Closed crescent ground banks preserve
   the .30-radius token clearing and .86 pointy-hex construction boundary.
   Geometry tests check original crown/body/grain dimensions, volumes and counts.
2. Roads widen from .085 to .15 units (about 76%), with .055-unit height.
   Endpoints, player colors and seat markings remain; the conservative half-width
   bound is .075 and triangle counts do not increase.
3. Held left drag rotates horizontally and changes elevation vertically, after
   the existing 6px threshold. Shift-left or right drag pans, wheel zooms.
   Single-touch drag orbits; two fingers zoom and pan. SVG retains left-drag pan.

The existing viewport owns these gestures, keyboard pan, rotation buttons
and `[` / `]`. Fit/Home restores the initial orientation and responsive
50-degree desktop / 60-degree narrow elevation. Model-envelope
fitting reserves tall scenery, rotated cities and coastal harbors. Rotation
uses the same projection in the Three camera and DOM target overlay, and
keyboard pan follows the screen axes after rotation.

Games start in `auto`, retaining playable SVG until 3D is ready or if it fails.
Selection, focus and command confirmation remain with the original controller.
The standalone `/?preview=island` route offers 19/30-tile layouts and quality
selection without requesting an identity or game API. The 30-tile preview does
not enable expansion rules.

## Executed checks

| Check | Result and scope |
| --- | --- |
| `pnpm verify` | PASS: all package typechecks; rules 110, protocol 7, server 84 and web 306 tests passed (507 total); 11 server tests skipped; production build and 13/13 service smoke checks passed. Vite still reports the existing large 3D chunk warning. |
| Preview browser runner | PASS at 1600x1000 and 390x844: 19/30 tiles, zoom, left-drag orbit on both axes with unchanged center, Shift-left/right-drag pan with unchanged angles, 30-degree rotation, real pointer/keyboard operation of the elevation slider, actual WebGL view-matrix changes at 25/80 degrees and during orbit, keyboard/Home, low quality, no horizontal overflow, live WebGL2 and no browser errors or API calls. |
| Game fixture runner, auto/standard/Chromium/all | 30 PASS, 14 NOT RUN, 6 BLOCKED, zero FAIL. Overall status is **BLOCKED** because the runner includes human/device gates. This is not an all-gates-pass claim. |
| Source/build provenance | H3 and T01 PASS: committed source, matching served production assets, source hash `646eb1e63118e7a6b1d0fac56c1a613d62d0261cbeafeb2600e2909a102d0b21`, build hash `01278cbdf6fd1b74e30677b15f13b83308a4adacc3c20365169874635cca2af9`. |
| Game interaction and faults | Elevation slider changes live construction-target positions and fit restores 50 degrees. Mouse drag and Chromium synthetic touch beginning on a legal target change azimuth/elevation without selecting; the latter records actual bubbling capture transfer. Target activation/hit areas, keyboard selection/cancel, blocked scene load, GPU unavailable, explicit SVG without scene loading, native context loss, renderer switching/resize, reduced motion and four-viewer neutral theft checks passed. |
| Demand rendering | PASS: zero GPU draw calls and zero page rAF callbacks during the measured 30-second idle window. |
| Draw budget, 30-tile fixture sequence | Standard: 112 peak calls, 144,026 peak triangles/frame including shadows, below 250 / 150,000 limits. Supplemental low: 65 calls, 72,356 triangles, below 150 / 100,000 limits. |
| Independent final source review | Earlier review found pinch projection drift and release-outside cleanup defects; both were repaired, and a narrow read-only re-review found no concrete regression. This supplements executed regression and browser checks. |
| Persistent local service | Bound to `127.0.0.1:3000` with a new task-specific SQLite database. Health/readiness checked; native browser opened the built preview with ready WebGL and no API requests, and the real game entry rendered without alerts. |
| Aegis workspace structure | `aegis-workspace.py check` PASS after retaining the three expected empty workspace directories in Git. `bundle --work 2026-10-29-island-diorama` returned "work directory does not exist": this record is a narrative Markdown file, not a generated work directory. No generated proof bundle is claimed. The passing check covers structure and index references only. |

Evidence is retained in
[`docs/screenshots/island-diorama`](../../screenshots/island-diorama/README.md).
The fixture is byte-identical to the existing
[`fixtures-final.json`](2026-10-29-board-3d/evidence/fixtures-final.json)
(SHA256 `d03eb8bd0e97a2d016460de06894f91883f1f23dfff931333ca03464e39caa55`).
The reports preserve their original local artifact paths; selected images and
the full reports are copied into the retained directory.

## Failures investigated and repaired

The first new game diagnostic exceeded the triangle budget: 272,722
triangles/frame. Per-family measurement identified tiny repeated geometry as
the dominant cost. Lower subdivision and minimally triangulated closed solids
retain object counts, volumes and silhouette details:

| Model | Before | After, triangles per model |
| --- | ---: | ---: |
| Fields | 7,616 | 2,296 |
| Forest | 3,416 | 1,336 |
| Pasture | 3,388 | 1,416 |
| Harbor | 1,612 | 980 |

The terrain tests independently check finite geometry, token/placement
clearance, deterministic colors, family budgets, retained detail counts,
closed edges and positive volumes. Structure tests check closed geometry,
topology orientations and boat hull/sea intersection. No object count or
shadow removal was used to meet the draw budget.

The old privacy runner read a transient overlay again after a screenshot;
the normal effect lifetime could expire during capture on a software GPU.
It now samples markup and text atomically while the neutral theft exists,
then takes the screenshot. All four viewer samples and equality checks pass;
screenshots alone are not promoted to privacy proof.

Earlier diagnostics remain locally under `.tmp/island-diorama-game-final`
and `.tmp/island-diorama-events-recheck`. Their failures are not final
evidence. The final retained game report is from committed refinement `a26c656`.

The first elevation-browser diagnostic could not read `canvas.__r3f`, which is
not exposed on this version's canvas. The corrected runner observes the real
`viewMatrix` uniform uploaded to WebGL instead of treating UI state as camera
proof. The preview label's pointer events were enabled through its
non-interactive navigation container; real pointer and keyboard checks pass.
The robber grounding assertion allows a 1e-6 floating-point tolerance around
zero rather than rejecting a computed -1.86e-10 base vertex.

Orbit review found that a touch target's implicit capture loss bubbles when
capture transfers to the board surface. Only the surface's own loss now
cancels its gesture; real Chromium synthetic touch records the transfer and
keeps orbit active until release. The existing click threshold still avoids
capturing ordinary target taps.

Two additional input defects were repaired. Pinch translation now freezes the
gesture-start projection and uses its actual cameraZoom metadata, avoiding
over-translation or a jump when the next projection arrives. Regression tests
project a world point and assert exactly 20 CSS pixels of movement, including
a stale zoom-1 snapshot while UI zoom is already 2. Pending pre-capture gestures
receive outside pointerup/cancel through temporary window listeners; mouse
buttons=0 also clears a missed release without moving the camera.

## Boundaries and remaining review

- The browser renderer is SwiftShader. Viewport emulation, idle scheduling and
  triangle counts do not establish active-workload frame time, physical phone
  GPU performance, thermal behavior or user art acceptance.
- The game runner explicitly leaves projection pixel tolerance, physical
  multi-touch/capture loss, ambiguity-picker flow, full event recovery,
  repeated GPU lifecycle stress, cold-cache timings, full create/play/save/
  resume, screen reader and physical-device/browser acceptance unexecuted.
  Component/service tests and the new Chromium single-touch capture-transfer
  check are supplementary and do not close these gates.
- The shared controller, authorized projection, animation cursor, fallback
  and disposal owners remain. Rules, protocol, server and persistence source
  were not changed.
- `SceneContent` now wires dedicated model owners instead of retaining the
  old primitive render components. Unused old live geometry/material
  allocations were removed, including the superseded three-part robber.
  Other standalone primitive helpers remain for prior geometry-contract
  tests; they are not an alternative scene
  path and can be retired with those contracts in a separate cleanup.
- Complexity remains bounded to model factories, instancing, the existing
  viewport and one preview route. No new dependency, renderer, camera-input
  owner or command path was introduced.
- Main checkout preexisting changes were preserved. The task worktree is
  retained for review. Credentialed GitHub read/fetch was rejected by
  automatic approval review earlier in the task; no alternate remote
  mechanism, push, PR update or merge was attempted.

Local engineering delivery is complete at the scope above. Human visual
review, device/accessibility evidence and remote publication remain open.
