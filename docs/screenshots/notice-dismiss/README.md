# Transient notice dismissal

Captured from the production build with the deterministic four-seat `hex-r2`
fixture at 1366×768 in zh-Hant. The harness routes the next two `turn.end`
commands to a definite `E_NOT_YOUR_TURN` rejection, so the screen shows both a
toast and a rejected command receipt. Each transient surface has a depleting
strip along its lower edge; the strip pauses with the timer while the notice
contains focus.

| File | State |
|---|---|
| `01-rejected-and-toast-zh-Hant.png` | Rejection toast and rejected receipt visible with near-full countdown strips |
| `02-toast-gone-zh-Hant.png` | Toast gone after six seconds; the receipt strip is about a quarter full and retry/dismiss remain |
| `03-both-gone-zh-Hant.png` | Rejected receipt gone after eight seconds |
| `04-before-turn-change-zh-Hant.png` | A second rejection is visible with fresh strips before the fixture advances the turn |
| `05-after-turn-change-zh-Hant.png` | Turn change cleared both immediately |

The capture run measured:

- toast detached after **6.02 s**;
- rejected receipt detached after **8.48 s** (measured from the first capture,
  including the preceding wait and screenshot work);
- both detached **0.03 s** after the turn-changing snapshot;
- when the toast detached, the receipt strip measured **25%** of its width,
  matching the roughly two seconds left of its eight-second deadline.

Unknown and stale command outcomes are intentionally absent from this set: they
are recovery states and remain until the player resolves or dismisses them.

## Reproduce

```sh
pnpm build
python3 scripts/notice-dismiss/capture.py --out test-results/notice-dismiss
```

The script starts its own temporary service, asserts the two deadlines, both
countdown strips (duration and depletion), and the turn-change dismissal. It
fails on a page or console error. Copy the five PNGs from the output directory
into this one.

## Limitations

These are desktop headless-Chromium fixture captures, not a live multiplayer
server, physical-device, screen-reader or human visual-acceptance run. The
injected rejection is deliberate: it makes both notification surfaces appear
without depending on a real illegal move. The strip is hidden under reduced
motion; the notice still clears on its timer.
