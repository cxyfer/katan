# Transient notice auto-dismissal

## Scope and plan

User request: notifications that currently need a manual "Dismiss" click should
disappear after a turn switch or a fixed interval. Starting point:
`91086e3` (`origin/master`). Worktree `.worktrees/notice-auto-dismiss`, branch
`feat/notice-auto-dismiss`.

The change is presentation-only. It covers the global toast and accepted/rejected
command receipts. Unknown and stale command outcomes intentionally remain until
the player resolves or dismisses them, because hiding them would remove the only
way to reconcile an action that may already have committed. No rules, protocol,
persistence, identity or deployment changes.

## Behaviour

| Surface | Auto-dismiss | Countdown strip | Clears on turn change | Dismiss control |
|---|---|---|---|---|
| Toast | 6 s | 6 s, pauses on focus | yes | retained |
| Accepted command receipt | 4 s (unchanged) | 4 s, pauses on focus | yes | none |
| Rejected command receipt | 8 s | 8 s, pauses on focus | yes | retained, with retry |
| Unknown / stale receipt | never | none | no | retained |

`useTransientNotice` owns the timer and turn-boundary rules. It preserves the
remaining deadline across a focus pause, and `NoticeProgress` mirrors that run
with a depleting strip; `toastId` gives a repeated toast a fresh strip. The
toast's identity is `toastId`; a receipt's identity is its command id plus
status. A repeated message therefore gets a fresh deadline and an old timer
cannot hide it. Dismissing a receipt does not clear `state.command`; the previous accepted-receipt behaviour
is preserved.

## Turn boundary

`activeTurnKey` is `gameId:windowId:setup round:remaining` (or `...:play` outside
setup), not the acting player alone. `windowId` advances on every normal action
window, including a paired actor and a reconnect that skipped a complete round.
Setup does not open an action window, so its decreasing remaining-step count
supplies the boundary; this covers the same seat placing forward and then first
in reverse, and the final setup seat becoming the first normal turn.

This replaced an earlier monotonic counter keyed on actor identity after the
Codex review found the same-actor setup/reconnect cases (P2). A regression test
now covers the setup same-seat boundary and an advancing window.

## Verification

- `pnpm verify`: typecheck clean; rules 138, protocol 7, server 96 passed with 11
  PostgreSQL-only skips, web 469, production build, smoke 13/13, dev harness 1/1.
- Focused production-browser capture and assertions
  (`python3 scripts/notice-dismiss/capture.py --out test-results/notice-dismiss`):
  toast detached after 6.02 s, rejected receipt after 8.48 s, both detached
  0.03 s after a turn-changing snapshot. When the toast detached, the receipt
  strip measured 25% of its width (two of eight seconds left). No page or
  console errors.
- `python3 scripts/side-rails/verify.py --renderer svg --viewport desktop --board
  hex-r2`: PASS, including unknown-receipt resolution and the unchanged accepted
  receipt dismissal.
- Review captures: [`docs/screenshots/notice-dismiss/`](../../screenshots/notice-dismiss/README.md).

## Review follow-up

- Codex found that an actor-only turn key missed same-actor boundaries; the
  window/setup key replaced it. A later Codex pass found that removing a focused
  Retry/Resolve/Refresh button did not emit a blur, so the replacement receipt
  kept the focus pause and never started its deadline; `2f00f64` checks the new
  root for focus and a regression test covers rejected → submitting → rejected.
  Both threads are resolved. Final Codex re-review of `2f00f64` completed with no
  findings.
- The independent subagent review found no blocker in the main flow but asked for
  tighter hook identity and focus handling. The follow-up:
  - resets a dismissed identity when the notice key becomes null;
  - guards a late timer with the scheduled key so it cannot hide a newer notice;
  - includes the command status in a receipt's identity, so a changed outcome
    with the same command id is visible;
  - reads the turn key through a ref instead of omitting it from the timer
    effect's dependencies;
  - pauses the timer while the toast or receipt contains focus, so a focused
    Dismiss/retry control does not disappear;
  - drops that pause when a status update replaces the focused control without
    a blur, so the replacement receipt still gets its deadline;
  - proves the real three-player setup sequence (including the same-seat forward
    to reverse pivot) and the final setup-to-play key change;
  - asserts that a rejected receipt does not gate a new command.
- Residual limits: dismissal is component-local, so a remount can show an
  accepted/rejected receipt again; the reason text of a rejection is gone after
  its 8 s window even though the original action remains available. The receipt
  is a live region and focus pauses the timer; hover does not.

## Countdown strip follow-up

The user asked for a visible countdown in addition to automatic dismissal.
`NoticeProgress` renders a 3 px strip along the lower edge of the toast and
accepted/rejected receipts. Its CSS animation duration equals the notice
deadline and its play state follows focus; the timer now keeps the remaining
time instead of restarting a full interval after focus. A repeated toast gets a
new `toastId` and a fresh strip. The strip is `aria-hidden` (the receipt remains
a live region) and hidden under reduced motion, while the timer still clears the
notice. The browser capture asserts both strip durations, their presence and
depletion, and their removal with the notice.

## Limitations

The browser run uses deterministic API/WebSocket fixtures and headless Chromium
at one desktop viewport in zh-Hant. It is not a live multiplayer session,
physical-device, screen-reader or human visual-acceptance run. The injected
rejection is deliberate so both notification surfaces appear without depending
on a real illegal move.
