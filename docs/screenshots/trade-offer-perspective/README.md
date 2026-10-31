# Trade offer perspective captures

Captured from the built client with headless Chromium and a live service. The
three-player room finishes initial placement through the HTTP API, rolls once,
and then the turn player proposes the same table-wide offer.

The point of the pair is that the stored offer is identical while each seat sees
its own direction:

| File | Seat | Card terms |
|---|---|---|
| `trade-offer-card-proposer-zh-Hant.png` | proposer | you give 1 wool, you receive 1 ore |
| `trade-offer-card-recipient-zh-Hant.png` | recipient | you give 1 ore, you receive 1 wool |

The `*-1366x768-zh-Hant.png` files show the same two states in the full table
viewport. Reproduce with `scripts/trade-offer-perspective/capture.py` against a
freshly built service; see the script header for the server command.
