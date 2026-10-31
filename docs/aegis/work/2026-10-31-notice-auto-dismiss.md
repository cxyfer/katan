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

| Surface | Auto-dismiss | Clears on turn change | Dismiss control |
|---|---|---|---|
| Toast | 6 s | yes | retained |
| Accepted command receipt | 4 s (unchanged) | yes | none |
| Rejected command receipt | 8 s | yes | retained, with retry |
| Unknown / stale receipt | never | no | retained |

`useTransientNotice` owns the timer and turn-boundary rules. The toast's identity
is the notice object and a receipt's identity is its command id, so a repeated
message gets a fresh deadline and an old timer cannot hide it. Dismissing a
receipt does not clear `state.command`; the previous accepted-receipt behaviour
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
  PostgreSQL-only skips, web 458, production build, smoke 13/13, dev harness 1/1.
- Focused production-browser capture and assertions
  (`python3 scripts/notice-dismiss/capture.py --out test-results/notice-dismiss`):
  toast detached after 6.02 s, rejected receipt after 8.00 s, both detached
  0.03 s after a turn-changing snapshot; no page or console errors.
- `python3 scripts/side-rails/verify.py --renderer svg --viewport desktop --board
  hex-r2`: PASS, including unknown-receipt resolution and the unchanged accepted
  receipt dismissal.
- Review captures: [`docs/screenshots/notice-dismiss/`](../../screenshots/notice-dismiss/README.md).

## Limitations

The browser run uses deterministic API/WebSocket fixtures and headless Chromium
at one desktop viewport in zh-Hant. It is not a live multiplayer session,
physical-device, screen-reader or human visual-acceptance run. The injected
rejection is deliberate so both notification surfaces appear without depending
on a real illegal move.
