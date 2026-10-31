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
  the hover footprint. The 3D model placement and the label position now read
  these values instead of repeating the 0.38 / 0.285 / 0.205 constants.
- In 3D, project a flat footprint polygon over the pier and its seaward boat at
  plaque height and use it as the harbour's single inspection target. The
  seaward side widens over the boat; SVG keeps its compact token.
- Keep `describeTarget` and `inspectDescription` unchanged: the public text,
  ownership, endpoint list and related hexes are the same. No rule, wire,
  privacy or command behaviour changes.

The hit target remains one focusable element per harbour, so keyboard focus
and `aria-describedby` keep their existing semantics. The footprint starts at
the coastal edge and stays seaward of the adjacent vertices, so coastal builds
and roads keep their own targets.

## Verification

- `pnpm typecheck`: all packages passed.
- `pnpm verify`: passed. Rules 138, protocol 7, server 99 passed / 11 skipped
  without PostgreSQL, web 533 passed in 51 files, build passed, smoke 13/13 and
  the compiled development-runner test passed.
- Browser matrix: 4/4 passed with production build and deterministic fixtures
  (`svg`/`r3f` at 1366×900 and 390×844). Each case hovers a point near the
  boat end, waits for the one-second tooltip, checks the title, bounded
  placement, `aria-describedby`, the element under the pointer and Escape.
  Source and build digests are compared before and after the run.
- Regression coverage: `board-inspection.test.tsx` now asserts the 3D harbour
  is one five-corner polygon and that the projected plaque, dock end, boat
  centre and outer boat edge fall inside it; it also asserts SVG remains a
  rect.
- Screenshots: [3D desktop detail](../../screenshots/harbor-hover/r3f-desktop-detail.png),
  [3D desktop context](../../screenshots/harbor-hover/r3f-desktop.png),
  [SVG desktop detail](../../screenshots/harbor-hover/svg-desktop-detail.png),
  [3D phone detail](../../screenshots/harbor-hover/r3f-mobile-detail.png).

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
