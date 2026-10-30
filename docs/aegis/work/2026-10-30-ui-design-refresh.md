# Frontend design and usability refresh

## Scope and preserved decisions

The user asked for a review and refinement of frontend appearance and
usability. Changes must not alter the decisions the user made earlier.
Base: `origin/master` at `e242bf9`; branch `claude/ui-design-refresh`.

These decisions are preserved: the island-exploration visual direction
(SPEC §8.8). Inspection opens after a 1000 ms delay and does not move the
camera. Rails disclose horizontally with fixed row geometry. The collapsed
score rail has no surrounding deck and stays 68/60 px wide. The bottom-centre
hand fan has no DECK header and no pin. Score breakdowns use icons and medals.
The dice and resource-gain presentation are unchanged, and trade and exchange
stay separate tools. Rules, protocol, projection and command ownership are
unchanged.

## Findings and changes

| Area | Finding | Change |
| --- | --- | --- |
| Stylesheet | `table.css` was a 10-line minified restored artifact. | Formatted it in a separate commit. Re-minifying with esbuild produces byte-identical output. |
| Legend | The summary sat at `left: -30px` behind the camera toolbar, which clipped it. | It is now a toolbar-styled chip above the controls. When open, it stacks above the toolbar. |
| Turn prompt | It used a muddy olive gradient, and "mine" and "waiting" looked alike. | "Waiting" uses a cool glass card. "Mine" uses a gold outline with a light band and a full-width action. |
| Build rail | Reasons, costs and counts used 7–8 px type, and reasons floated between cards. | Each row is one card with readable type. Row height is unchanged in both states. The roll/end-turn highlight keeps its specificity. |
| Score rail | Expanded stats clipped and names truncated early. Collapsed scores were hard to read on the sea. | The expanded width changes from 216/196 to 244/208 px; the collapsed width is unchanged. Collapsed scores sit on small pills, with no whole-rail deck. |
| Tool panels | The close button showed a long sentence, the log repeated its title, and tabs used 10 px type. | The close button is icon-only and keeps its name in `aria-label`/`title`. The log heading is only visually hidden. Desktop tabs are larger. |
| Narrow table | The hand fan sat behind the five tool icons. | Below 650 px the dock sits above the tool bar, and the dependent rail and receipt offsets move with it. |
| Home (mobile) | The create button was hidden inside a clipped inner scroll area. | Pages at or below 700 px scroll naturally. On desktop, cards no longer stretch to full height. |
| Lobby (mobile) | Room policy and leave controls were clipped, the invite code wrapped, and seat status overlapped. | The page scrolls naturally, the side column stacks, the code stays on one line, and status wraps. |
| Disabled primary | It looked like a dim but active gold button. | It now uses neutral styling. |

## Verification

- `pnpm typecheck`: passed.
- Web Vitest (`--maxWorkers=1 --testTimeout=15000`): 404 passed.
- Rules 110, protocol 7, server 84 passed. 11 PostgreSQL tests skipped because no PostgreSQL is configured.
- `pnpm build`: passed. The existing large 3D chunk warning remains.
- `pnpm smoke`: 13/13 passed.
- `scripts/table-ui-polish/verify.py`: 20/20 production-browser cases passed.
- `scripts/side-rails/verify.py` with `hex-r2`: desktop and landscape passed for both renderers. Mobile passed for `r3f`.
  - `svg-mobile` fails in `reviewCollisions` with "turn flag right edge is clipped or covered". A stale map tooltip covers the flag during the touch step.
  - A fresh `origin/master` build fails identically with the same runner. This failure existed before this change.
- The runner's keyboard "too early" assertion still waited 1100 ms, from the old 1500 ms delay. It now waits 900 ms to match the current 1000 ms contract.

Review images, before and after, are in `../../screenshots/ui-refresh/`. To
reproduce the captures after `pnpm build`:

```sh
python3 scripts/ui-refresh/capture.py --out .tmp/ui-refresh-rerun
```

Limits: deterministic fixtures, Chromium with software WebGL and emulated
touch. There is no physical-device, screen-reader, Firefox or WebKit evidence.
On short landscape screens (≥650 px wide) the collapsed hand can still meet the
last tool tab. This is unchanged from the base and was left alone, because
lifting it would take scarce board height.
