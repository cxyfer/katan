# Action rail

Review captures for the regrouped action rail on the right of the table. They
were rendered from commit `3ce2779` on 2026-11-12 by
[`scripts/action-rail/capture.py`](../../../scripts/action-rail/capture.py).

The rail holds the optional actions, grouped as build, sea and knights. Roll
and end turn stay in the turn prompt above it. One two-column grid is used in
both states: collapsed, every action is an icon tile, and expanded, the same
buttons grow into cards with cost and reason, so no button moves when the rail
opens. Knight and ship actions share a base icon and carry a corner badge for
the verb. The toggle shows how many optional actions are available and, when
expanded, the current phase. A reason shared by every action is shown once at
the top of the rail.

Captured from the production build (`pnpm build`) in headless Chromium with
device scale factor 1 and reduced motion, on the SVG board. For each rule set a
real four-player game is set up over the API until player 1's action phase. A
test-only fixture then adds four of each resource to player 1's hand, so most
actions are available. Player 1's view is captured with the rail collapsed and
expanded (opened with the toggle), and so is the view from another seat. The
phone is emulated with touch, and so is the 844×390 landscape, which uses the
compact-landscape layout. `report.json` lists every case with the rail's box,
its scroll and client height and the number of visible actions.

| File | Locale | Viewport | State |
|---|---|---|---|
| `base-collapsed-1366x768-zh-Hant.png` | zh-Hant | 1366×768 | Base game, own action phase: two rows of build tiles; the toggle counts the available actions |
| `base-expanded-1366x768-zh-Hant.png` | zh-Hant | 1366×768 | The same rail expanded into cards with cost and reason |
| `ck-collapsed-1366x768-zh-Hant.png` | zh-Hant | 1366×768 | Cities & Knights: build and knights groups, knight verbs as badges on the shield |
| `ck-expanded-1366x768-zh-Hant.png` | zh-Hant | 1366×768 | Cities & Knights expanded with group headings |
| `ck-expanded-1366x768-en.png` | en | 1366×768 | The same in English, where the labels are longer |
| `sfck-collapsed-1366x768-zh-Hant.png` | zh-Hant | 1366×768 | Seafarers + Cities & Knights, 13 optional actions in seven rows, no scrolling |
| `sfck-expanded-1366x768-zh-Hant.png` | zh-Hant | 1366×768 | All three groups expanded, fitting the 1366×768 table without scrolling |
| `sfck-waiting-expanded-1366x768-zh-Hant.png` | zh-Hant | 1366×768 | Another seat's view: "目前不是你的回合。" shown once at the top instead of on every card |
| `sfck-collapsed-390x844-zh-Hant.png` | zh-Hant | 390×844 | Phone: smaller tiles, both columns inside the rail |
| `sfck-expanded-390x844-zh-Hant.png` | zh-Hant | 390×844 | Phone, expanded over the board |
| `ck-collapsed-844x390-zh-Hant.png` | zh-Hant | 844×390 | Phone landscape (touch): the rail sits under the turn prompt and scrolls, fading at the end that still has actions |
| `ck-expanded-844x390-zh-Hant.png` | zh-Hant | 844×390 | Phone landscape, expanded above the hand dock |

The script also saves the other combinations (base on phone and landscape,
the collapsed views from another seat, and so on). Only the files above are
kept. The rest of the table is owned by `current/` and the expansion sets.
Those were captured before this change and still show the old rail: one tall
column of single icons, with roll or end turn at the bottom.
