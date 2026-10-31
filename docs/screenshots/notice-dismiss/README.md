# Transient notice dismissal

Captured from the production build with the deterministic four-seat `hex-r2`
fixture at 1366×768 in zh-Hant. The harness routes `turn.end` commands to a
definite `E_NOT_YOUR_TURN` rejection (twice) and then to a transport failure.

Every notice is a card with a tone icon, its message and a close control. When
the notice closes on its own, a ring around the × depletes over the deadline;
the ring turns grey and stops while the notice is hovered or focused (or the
tab is hidden), and the notice fades out when its time is up or the turn moves
on. A rejection is reported once, in the command receipt, together with its
reason and retry; there is no duplicate toast.

| File | State |
|---|---|
| `01-rejected-receipt-zh-Hant.png` | Rejected receipt: reason, retry and the 8 s ring, about 1.5 s in; no toast |
| `02-hover-holds-zh-Hant.png` | Pointer over the receipt: the ring is grey and stopped, the receipt stays |
| `03-before-turn-change-zh-Hant.png` | A second rejection with a fresh ring before the fixture advances the turn |
| `04-after-turn-change-zh-Hant.png` | The turn change faded the receipt out |
| `05-network-toast-and-unknown-zh-Hant.png` | Transport failure: the network toast (top centre, 6 s ring) and the unknown-outcome receipt (× only, no ring) |
| `06-unknown-stays-zh-Hant.png` | The toast is gone after its deadline; the unknown-outcome receipt remains until it is resolved |

The capture run measured:

- with 1.89 s elapsed, a 3.22 s hover held the receipt, which then left
  **6.34 s** after the pointer moved away (expected 6.29 s: the remaining 6.11 s
  plus the 0.18 s fade), so the hover preserved the remaining time;
- the ring stayed in step with the timer: 80% left 1.5 s into the 8 s receipt,
  76% while held, and 74% left 1.5 s into the 6 s toast;
- the turn change removed the receipt **0.21 s** after the snapshot (fade
  included);
- the network toast detached after **6.61 s** (6 s deadline, 0.18 s fade, and
  polling/screenshot overhead).

## Reproduce

```sh
pnpm build
python3 scripts/notice-dismiss/capture.py --out test-results/notice-dismiss
```

The script starts its own temporary service and asserts: no toast for a
rejection, the retry control inside the visible message stack, ring durations,
the hover hold and the preserved remaining time, the turn-change fade, the
top-centre table toast, and that the unknown receipt has no ring and stays. It
fails on a page error; the expected `ERR_CONNECTION_FAILED` console entry from
the injected transport failure is recorded in `report.json`. Copy the six PNGs
from the output directory into this one.

## Limitations

These are desktop headless-Chromium fixture captures, not a live multiplayer
server, physical-device, screen-reader or human visual-acceptance run. The
rejection and transport failure are injected so each notice appears without
depending on a real illegal move or outage. Mobile (390×844), reduced-motion and
the home-screen (bottom-right) toast were checked in exploratory runs but are
not part of this set.
