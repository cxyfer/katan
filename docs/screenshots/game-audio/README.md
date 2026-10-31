# Game audio

Captured on 2026-10-31 from the `feat/game-audio` branch with headless Chromium
(Playwright). Sound cannot be shown in a still image, so these cover the
controls and the offline-rendered waveforms; the audible behaviour is measured
by the scripts below and recorded in
[`docs/aegis/work/2026-10-31-game-audio/`](../../aegis/work/2026-10-31-game-audio/).

| File | State | Producer |
|---|---|---|
| `01-sound-palette.png` | `?preview=sounds`: every cue with its offline waveform and peak level, plus the two music themes | `scripts/audio/verify.py` (Vite dev server) |
| `02-lobby-sound-settings-zh-Hant.png` | Lobby, sound panel open after the music was turned down | `scripts/audio/live.py` (built bundle + live service) |
| `03-table-sound-settings-zh-Hant.png` | Table during setup round 2, panel open above the board and the action prompt | `scripts/audio/live.py` |
| `04-table-sound-settings-en.png` | Same table after the host's roll, English | `scripts/audio/live.py` |
| `05-table-sound-settings-mobile-en.png` | 390 × 844, panel spanning the viewport under the status strip | `scripts/audio/live.py` |

Reproduce (build first, choose new empty output directories):

```bash
pnpm build
VITE_PORT=5191 pnpm --filter @catan/web dev &   # serves ?preview=sounds from source
python3 scripts/audio/verify.py http://127.0.0.1:5191 test-results/audio-palette
python3 scripts/audio/live.py test-results/audio-live
```
