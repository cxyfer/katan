# Board 3D runner status (C)

## Environment

- Python venv: `.tmp/board-3d-venv`
- Playwright: `1.64.1` (Python)
- Supporting packages installed with it: `pyee 13.0.1`, `greenlet 3.5.6`, `typing-extensions 4.16.0`
- Browser cache: `.tmp/board-3d-browsers`
- Chromium, Firefox, WebKit, FFmpeg, and Winldd downloads completed into that worktree-local cache.

The acceptance text suggested placing browsers below `.tmp/board-3d-venv`. The completed cache is instead a sibling under this worktree's `.tmp`; it is still local to the task, ignored by source control, and does not alter a global install. The runner records this deviation and does not copy previous-worktree evidence.

## Commands

```powershell
.tmp/board-3d-venv/Scripts/python.exe -m pip install --disable-pip-version-check --only-binary=:all: playwright==1.64.1
node scripts/board-3d/fixtures.mjs --out .tmp/board-3d-fixtures.json
.tmp/board-3d-venv/Scripts/python.exe scripts/board-3d/verify.py --fixture .tmp/board-3d-fixtures.json --out .tmp/board-3d-smoke --renderer r3f --quality standard --suite faults --browser chromium
```

## GPU evidence boundary

The runner injects before page code a WebGL API observer for `drawArrays`, `drawElements`, their instanced forms, and resource create/delete calls. P02/P03 use those measured calls and per-frame buckets; it does not infer draw totals from screenshots. Effective WebGL 2 context/version/lost state and drawing-buffer size are read from the rendered canvas. The optional `canvas.__r3f.root` field is recorded only if the runtime actually exposes it, never assumed.

Headless software rendering remains a functional smoke only. It cannot establish physical-device frame rate, thermal behavior, memory limits, or user art acceptance.
