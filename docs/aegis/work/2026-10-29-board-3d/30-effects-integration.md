# Effects and fallback test API (C)

## `BoardEffects` integration

```tsx
import { createPortal } from 'react-dom';
import { BoardEffects } from './BoardEffects.tsx';
import type { BoardEffectAnchors } from '../board/render-contract.ts';

createPortal(
  <BoardEffects group={animation.active} geometry={geometry} view={view} anchors={anchors} />,
  stageElement,
)
```

- `stageElement` is `[data-testid="game-stage"][data-board-stage]` and must be the portal parent.
- `anchors.stage`, `anchors.seats`, and `anchors.aggregate` are global `getBoundingClientRect()` values.
- `anchors.targets` are A's projected global CSS anchors. Production source rings use `kind="hex"`, `visible`, the current public number, and robber exclusion.
- Only positive, finite seat/stage rects whose centers are inside the stage produce flights. Hidden, collapsed, off-screen, or unmatched seat ids do not get synthetic positions.
- Without an aggregate rect or usable destination, `[data-testid="production-aggregate"][data-anchor="text-fallback"]` and `[data-testid="production-fallback"]` preserve the actual public aggregate text without a flight.
- `aria-hidden="true"` and pointer-event isolation are unconditional. Theft markup remains the common neutral card back and is capped together with production at 24.
- Parent imports `src/styles/board-3d-effects.css` from `styles.css`. The older unscoped effects/animations can then be removed from `board-visual.css` to avoid duplicate rules.

## Renderer fallback tests

Mock the exact lazy target:

```ts
vi.mock('../src/board/three/BoardScene3D.tsx', () => ({
  default: (props: BoardSceneProps) => {
    // Invoke only the contract callback under test, return an inert scene marker.
    return null;
  },
}));
```

- Default export receives `BoardSceneProps` from `board/render-contract.ts`.
- `onUnavailable('webgl-context-lost')` is a mocked renderer contract event, proving BoardView returns to SVG and preserves selection/draft/focus. It is not evidence of a native `WEBGL_lose_context` loss.
- Native loss/restore remains a real-browser case. When the extension or automation hook is absent, record it `BLOCKED` or `NOT RUN`.
- Required selectors: `[data-testid="renderer-select"]`, `[data-testid="quality-select"]`, `[data-testid="renderer-retry"]`.
- Required board attributes: `data-requested-renderer`, `data-effective-renderer`, `data-quality`, `data-renderer-status`, `data-fallback-reason` when fallback is active.
- Explicit `r3f` may report PASS only when the same browser run reads effective renderer `r3f` and a successful WebGL 2 context/effective readback. A mock, an SVG fallback, or a successful process exit is not a GPU PASS.
