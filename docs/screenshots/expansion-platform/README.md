# Expansion platform captures

Review captures for the 2026-11-01 expansion platform (P0). The renderers now
draw any topology: a scenario map's sea hexes stay open water, the shoreline
runs between land and sea, every island gets its own beach, and harbours face
the sea. The base 19- and 30-hex boards must not change.

| File | Renderer | Viewport | State |
|---|---|---|---|
| `game-hex-r2-r3f-desktop.png` | 3D | 1366×900 | base board in a zh-Hant table (unchanged) |
| `game-hex-r2-svg-desktop.png` | SVG | 1366×900 | base board (unchanged) |
| `game-hex-r56-r3f-desktop.png` | 3D | 1366×900 | 30-hex 5–6 player board (unchanged) |
| `game-hex-r56-svg-mobile.png` | SVG | 390×844 | 30-hex board on a phone (unchanged) |
| `game-sample-archipelago-r3f-desktop.png` | 3D | 1366×900 | sample archipelago: sea frame, four islands, gold, five harbours |
| `game-sample-archipelago-svg-desktop.png` | SVG | 1366×900 | the same board with its sea cells outlined |
| `game-sample-archipelago-r3f-mobile.png` | 3D | 390×844 | phone fit of the archipelago |
| `game-sample-archipelago-svg-mobile.png` | SVG | 390×844 | phone fit of the archipelago |
| `preview-archipelago-default-desktop.png` | 3D | 1366×900 | `?preview=archipelago` model display (no room) |

The sample archipelago is the rules package's synthetic `sample-archipelago`
board (`packages/rules/src/sample-boards.ts`); it is not a rulebook map and no
profile uses it.

## Base boards unchanged

The harness captured the base boards (hex-r2 and hex-r56, SVG and 3D, desktop
and phone) and the `?preview=island` displays on `ce57dce`, whose board
rendering code is identical to `master` (`7decd81`), then again after the
renderer change. All eight in-game base captures are **byte-identical**
(`report.json` → `comparison`). The only differing pixels are in the two
desktop island previews (≈1,500 px), inside the preview's topology `<select>`,
which grew to fit the new "示範群島" option; the island itself is identical.
Two consecutive runs of the same build were also byte-identical, so the
harness is deterministic.

The aggregate is [report.json](report.json). Regenerate with:

```sh
pnpm build
python3 scripts/expansion-platform/capture.py --out test-results/expansion-platform-after \
  --compare test-results/expansion-platform-before
```

where `test-results/expansion-platform-before` is an earlier
`--cases base` run of the build to compare against.

Chromium software WebGL (`--enable-unsafe-swiftshader`) and deterministic
API/WebSocket fixtures only; no physical device, Safari/Firefox or
screen-reader run exists. Sea-hex interaction targets (robber/pirate on water)
are not exercised: no enabled profile has sea hexes yet.
