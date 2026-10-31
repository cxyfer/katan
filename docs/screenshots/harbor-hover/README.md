# Harbour hover captures

Focused review captures for the 2026-11-01 harbour hover fix. The 3D harbour
hit target used to cover only the floating plaque; the pier and moored boat
showed no tooltip. The captures hover the far end of the rendered footprint.

| File | Renderer | Viewport | State |
|---|---|---|---|
| `r3f-desktop.png` | 3D | 1366×900 | zh-Hant table with the harbour 34 tooltip open |
| `r3f-desktop-detail.png` | 3D | 1366×900 | crop of the same harbour and tooltip |
| `svg-desktop-detail.png` | SVG | 1366×900 | harbour token and tooltip |
| `r3f-mobile-detail.png` | 3D | 390×844 | phone crop with harbour 34 and tooltip |
| `svg-mobile-detail.png` | SVG | 390×844 | phone crop with harbour 34 and tooltip |

Captured on 2026-11-01 from the `fix/harbor-hover-info` working tree using the
production build and deterministic API/WebSocket fixtures. Desktop captures
hover the projected boat hull for all nine harbours. Mobile captures focus
every plaque; all cases check the one-second delay, tooltip title, viewport
bounds, `aria-describedby` where applicable and Escape. Camera-angle coverage
is in the deterministic projection test. Every capture is at device scale
factor 1.

The aggregate is [report.json](report.json). Regenerate with:

```sh
pnpm build
python3 scripts/harbor-hover/verify.py \
  --renderer all --viewport all --out test-results/harbor-hover-all
```

Chromium software WebGL and synthetic pointer input only; no physical device,
Safari/Firefox or screen-reader run exists. The served `index.html` differs
from `dist/index.html` by the OG-image origin placeholder, which the runner
ignores while checking JS/CSS and runtime errors.
