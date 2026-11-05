# Compact target picker

Review captures for the compact target picker (#85). They were rendered from
commit `a200840` on 2026-11-04.

Captured from the production build (`pnpm build`) in headless Chromium at device
scale factor 1 with reduced motion. The script starts a disposable service on a
temporary SQLite database, plays a four-seat base game to the first initial
placement (the host places first, so all 54 intersections are legal), and opens
the picker from the board toolbar's "List targets" button. The overlapping
target shots zoom out to the 0.7 minimum and click an intersection whose
neighbours sit within the 44 px hit target, then dismiss the picker by clicking
an empty part of the board.

At 1366×768 the board keeps at least 51.5 CSS px between neighbouring
intersections even at the minimum zoom, so the picker never opens there. The
overlapping-target shots therefore use a 1366×640 window (42.9 px at minimum
zoom) and touch-emulated phones.

| File | Locale | Viewport | State |
|---|---|---|---|
| `01-target-list-1366x768-en.png` | en | 1366×768 | "List targets" popover with 54 legal intersections, anchored below the toolbar |
| `02-ambiguous-picker-1366x640-en.png` | en | 1366×640 | Three legal targets within one touch target; picker lists all three |
| `03-dismissed-by-outside-click-1366x640-en.png` | en | 1366×640 | Picker dismissed by an empty-board click, nothing selected |
| `04-ambiguous-picker-1366x640-zh-Hant.png` | zh-Hant | 1366×640 | The same three-target picker in Traditional Chinese |
| `05-ambiguous-picker-844x390-en.png` | en | 844×390 | Four-target picker on a touch-emulated short landscape phone |
| `06-ambiguous-picker-390x844-zh-Hant.png` | zh-Hant | 390×844 | Four-target picker on a touch-emulated portrait phone |

The script asserts the picker stays inside the viewport, has a close button, and
that an outside click closes it without selecting a target or forwarding the
click. Since the #103 fix it also asserts the picker is at most 281×401 CSS px,
that a list of up to four targets fits without scrolling, that a clipped list
shows the scroll cue, and that no row is covered by the resource strip or other
HUD layers. The captures above predate that fix (they were taken at 281×261).

## Reproduce

```sh
pnpm build
python3 scripts/target-picker/capture.py --out test-results/target-picker
```

The output directory must be new and empty. Copy the PNGs from there into this
one.
