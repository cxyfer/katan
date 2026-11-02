# Automatic decline for unaffordable trade offers

## Scope

The trade panel listed every open offer with Decline / Interested / Consent
buttons, so a player who could not cover an offer still had to answer it
manually or leave it open until the action window expired. This adds an opt-in
checkbox, `play.tradeAutoDecline`, that lets the client answer those offers for
them.

The option is a viewer-local convenience, not a rule change: it submits the
same `trade.respond` command (`response: 'declined'`) a manual decline sends,
and the server still validates window, participant and offer status. No
protocol, engine, persistence-schema or privacy boundary changed.

## Implementation boundary

- `packages/web/src/components/useAutoDeclineTrades.ts` owns the decision
  (`autoDeclineTargets`) and the effect. It targets only `open` offers in the
  current window that are addressed to the viewer (or to everyone), that the
  viewer has not answered yet, and whose required `want` terms exceed the
  visible hand. Offers the viewer proposed themselves are excluded — those can
  only be withdrawn or revised.
- The effect is mounted on `GameScreen`, not inside `TradePanel`, so the
  preference keeps working when the mobile drawer is closed.
- Declines are sent one at a time: every accepted command advances the
  revision, so parallel submissions would race and one would be rejected as
  stale. A per-game/offer/revision set prevents resending while the projection
  catches up; a revision invalidates responses, so a revised offer is
  re-evaluated and declined again if it is still unaffordable.
- While the hand is hidden (spectator), during the dice presentation, while
  the projection lags behind known events, while another tab holds the seat, or
  while a command is in flight, the target list is empty and the effect waits
  for the next state instead of acting on stale information.
- The preference persists per browser as `catan.trade.autoDecline` next to the
  locale, nickname and mute keys; an unreadable value means "off".

## Verification

- `packages/web/test/trade.test.tsx` adds five cases: an unaffordable offer is
  declined when the stored preference is on, nothing is sent while it is off,
  toggling the checkbox writes `catan.trade.autoDecline`, the target selector
  covers the exclusion and waiting rules, and revised terms are targeted
  again.
- `pnpm typecheck`, `pnpm -r --workspace-concurrency=1 test`, `pnpm build`,
  `pnpm smoke` and `pnpm test:dev` passed: rules 158, bots 43, protocol 7,
  server 136 (+15 skipped without PostgreSQL), web 571 in 54 files, smoke
  13/13, compiled development runner green.
- Plain `pnpm verify` ran the four package test suites concurrently on this
  6-core host and twice hit a different 5 s jsdom timeout in a board test
  (`board-visual`, then `board-3d-lifecycle`); each file passes alone and the
  serialized run above is green, so the timeouts are worker contention rather
  than a deterministic failure from this change.
- Browser check, production build + SQLite service, headless Chromium:
  [verify.py](../../../scripts/trade-auto-decline/verify.py) seats three
  players, starts the recipient with `catan.trade.autoDecline` already stored
  and the trade panel closed, and proposes five ore through the API. The
  recipient's client answered `declined` without any input (2.13 s in the
  recorded run); an affordable offer stayed unanswered; the checkbox read as
  checked, wrote `true`/`false` back to `localStorage`, and stayed inside the
  390 px layout. No page errors. Report:
  [report.json](../../screenshots/trade-auto-decline/report.json).

## Limitations

The checkbox only covers incoming offers. An offer the viewer already
proposed, or one they already answered, stays under manual control. Browser
evidence is headless Chromium with synthetic pointer/state input: no physical
touch device, Safari, Firefox or screen reader was run, and the fixture room is
driven through the API rather than by clicking a full game.
