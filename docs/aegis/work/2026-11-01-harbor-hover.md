# Harbour hover covers the whole 3D port

## Scope and cause

Hovering a harbour on the 3D board showed no information over most of its
visible pier and moored boat. `inspectionElements` projected the harbour from
the coastal edge and gave it the same small square hit area as a vertex: a
44 px box centred on the floating plaque. The diorama pier runs from the
coastline to about 0.58 world units and the boat sits near 0.63, so the far
end projected outside that square. The SVG token was already fully covered;
the missing behaviour was specific to the default 3D renderer.

Reproduction before the change: at 1366×900, hovering the far end of harbour
34's pier or its boat produced no tooltip, while the plaque and the middle of
the dock did. Other boards and camera fits left different harbours partly
outside the same square.

## Implementation boundary

- Add `packages/web/src/board/harbor.ts` as the shared owner of the harbour
  frame (midpoint, outward normal, tangent, rotation), the plaque position and
  the hover footprint and the camera-fit envelope. The 3D model placement,
  label position and fit bounds now read these values instead of repeating the
  pier, plaque and envelope constants.
- In 3D, project the pier and boat corners at their real model heights and take
  the screen-space convex hull. The boat contributes corners at both visible
  rim heights and at the ocean-clipped waterline, not one intermediate height.
  The hull is a pointer-only target below roads
  and buildings, so a settlement at a harbour endpoint and a road along the
  coast stay hoverable. The existing plaque-sized rect remains the focusable
  harbour target above both. SVG keeps its compact token.
- Keep `describeTarget` and `inspectDescription` unchanged: the public text,
  ownership, endpoint list and related hexes are the same. No rule, wire,
  privacy or command behaviour changes.

The hit target remains one focusable element per harbour, so keyboard focus
and `aria-describedby` keep their existing semantics. The new pointer footprint
is `aria-hidden` and not in the tab order; the focusable plaque keeps the same
label. Because the footprint sits below roads and buildings, their hit areas
keep priority wherever they cross it.

## Merge with the remodelled harbour (#44)

Merging `master` brought the remodelled diorama harbour: a dressed-stone
abutment at the shore, cross bracing under the pier, a framed sign deck, a
lantern on the seaward piling, per-trade cargo, a wider lofted boat hull with a
gunwale cap and a pennant on the mast. The vertex coverage test failed on the
abutment, bracing and lantern, so `HARBOR_HIT_POINTS` now also carries the
abutment footing and caps, the bracing feet, the shore piling caps, the sign
frame, the lantern head, the wider hull and gunwale and the pennant tip. The
test builds `createHarborModel(type)` for each harbour's own trade instead of
only the generic model. With the point-in-hull tolerance temporarily reduced
from 0.75 px to 0.01 px every visible vertex still passed, so the footprint does
not rely on that slack. The browser matrix and review captures were re-run at
the merge commit `a0c6f23` against the remodelled harbour.

## Verification

- `pnpm typecheck`: all packages passed.
- `pnpm verify`: passed. Rules 138, protocol 7, server 99 passed / 11 skipped
  without PostgreSQL, web 542 passed in 53 files after merging `master`,
  build passed, smoke 13/13 and the compiled development-runner test passed.
- Browser matrix: 4/4 passed with production build and deterministic fixtures
  (`svg`/`r3f` at 1366×900 and 390×844). Desktop cases wait until the exact
  projected boat probe is exposed (no plaque fallback), hover it for all nine
  harbours, check the tooltip title, bounded placement and the element under
  the pointer. Mobile cases focus every plaque and check the delayed tooltip,
  `aria-describedby` and Escape. Camera-angle coverage lives in the
  deterministic projection test, not a flaky orbiting browser loop. Source and
  build digests are compared before and after the run.
- Regression coverage: `board-inspection.test.tsx` asserts the 3D harbour
  includes one pointer-only screen-space hull over the pier and boat, that the
  focusable plaque remains a rect, and that every visible vertex of
  `createHarborModel` (the ocean clips below -0.285) plus the plaque corners
  projects inside the hull for all nine fixed harbours at
  25°/50°/60°/80° elevation, three azimuths and zoom 1/2. It also asserts the
  footprint sits below a harbour road and endpoint building, while the plaque
  stays above them.
- Screenshots: [3D desktop detail](../../screenshots/harbor-hover/r3f-desktop-detail.png),
  [3D desktop context](../../screenshots/harbor-hover/r3f-desktop.png),
  [SVG desktop detail](../../screenshots/harbor-hover/svg-desktop-detail.png),
  [3D phone detail](../../screenshots/harbor-hover/r3f-mobile-detail.png),
  [SVG phone detail](../../screenshots/harbor-hover/svg-mobile-detail.png).

The aggregate is [report.json](2026-11-01-harbor-hover/report.json). Reproduce
after `pnpm build`:

```sh
python3 scripts/harbor-hover/verify.py \
  --renderer all --viewport all --out test-results/harbor-hover-all
```

## Limitations

Chromium with software WebGL and synthetic pointer input; no physical touch
device, Safari/Firefox or screen reader was run. The fixture API and WebSocket
are deterministic and the game server is not exercised. The served
`index.html` differs from `dist/index.html` only by the OG-image origin
placeholder, so the runner ignores that one harness hash while still checking
JS/CSS and runtime errors. Confidence: B.

## Review images

- [3D desktop, full board](../../screenshots/harbor-hover/r3f-desktop.png)
- [3D desktop, harbour and tooltip](../../screenshots/harbor-hover/r3f-desktop-detail.png)
- [SVG desktop, harbour and tooltip](../../screenshots/harbor-hover/svg-desktop-detail.png)
- [3D phone, harbour and tooltip](../../screenshots/harbor-hover/r3f-mobile-detail.png)
- [SVG phone, harbour and tooltip](../../screenshots/harbor-hover/svg-mobile-detail.png)
