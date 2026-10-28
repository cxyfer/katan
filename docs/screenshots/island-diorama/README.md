# Island diorama review images

Production source: `a26c65612d192788d946abb84d60d596b80d07e0`.
Captured on 2026-10-29 with headless Chromium / SwiftShader.
These are rendered review artifacts, not accepted visual baselines.

| Image | View |
| --- | --- |
| [Classic island](island-19-1600x1000.png) | 19 tiles, desktop, fitted camera |
| [Extended island](island-30-1600x1000.png) | 30 tiles, desktop, fitted camera |
| [Model details](island-detail.png) | Desktop at 156% zoom |
| [Low-angle view](island-low-angle-1600x1000.png) | 25-degree elevation |
| [Overhead view](island-overhead-1600x1000.png) | 80-degree elevation |
| [Classic mobile](island-19-390x844.png) | 19 tiles, 390x844 viewport |
| [Extended mobile](island-30-390x844.png) | 30 tiles, 390x844 viewport |
| [Game desktop](game-desktop.png) | Actual game surface with deterministic authorized fixture |
| [Game mobile](game-mobile.png) | Actual game surface, Traditional Chinese |

Reports: [preview](preview-report.json), [game](game-report.json),
[supplemental standard/low draw budget](budget-report.json) and
[repository verification log](verify.log).

The game runner has 30 passing checks and zero failures, but its overall
status remains BLOCKED for explicit human/device gates; 14 checks were not run.
See the [verification record](../../aegis/work/2026-10-29-island-diorama.md)
for scope, failures repaired and limitations.

The latest captures show native-size scenery in a crescent around centered
tokens and .15-unit roads. Left drag now orbits both axes, Shift-left/right
drag pans, and wheel zooms. Preview checks observe actual GPU camera matrices;
game checks also drag from a construction target with mouse and Chromium
synthetic touch. These do not replace physical-device input checks.

To reproduce from the repository root after `pnpm build`, using the existing
runner's Python/Playwright environment and a new empty output directory:

```bash
python scripts/board-3d/verify-diorama.py --out test-results/island-review
python scripts/board-3d/verify.py \
  --fixture docs/aegis/work/2026-10-29-board-3d/evidence/fixtures-final.json \
  --out test-results/island-game --renderer auto --quality standard \
  --suite all --browser chromium
```

The preview runner serves the built client in an isolated temporary service;
the game runner uses deterministic fixture API/WebSocket routes. Neither is a
physical-device or complete multiplayer playtest.
