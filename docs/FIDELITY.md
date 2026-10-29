# Fidelity and evidence index

This file records what is actually implemented and verified, mapped to the
fixture families in SPEC §12.1, plus the known gaps. It is deliberately
conservative: **unlisted evidence is unverified**, and no profile is advertised
before its fixtures pass.

## Source baseline

| Source | Edition | Used for |
|---|---|---|
| B25 | CATAN – The Game, CN3081, 2025 | board inventory, setup, production, 7-handling, trade, cards, awards, victory |
| B56-25 | CATAN – 5–6, CN3082, 2025 | 30-hex paired board, expanded supply/development deck, paired-player roles |
| SF25 / SF56-25 | Seafarers, CN3083/CN3084, 2025 | registered target profiles, disabled |
| CK25 / CK56-25 | Cities & Knights, CN3087/CN3088, 2025 | registered target profiles, disabled |
| COMB | Seafarers + C&K guidance | registered target profile, disabled |

The rules are implemented from the specification's paraphrase and the
publisher's rulebooks. No official artwork or card text is copied.

## Enabled profiles

| Profile | Counts | Victory target | Status |
|---|---|---|---|
| `base-2025` | 3, 4 | 10 | **enabled** |
| `base-paired-2025` | 5, 6 | 10 | **enabled** |

Every other row of the §5.7 matrix is registered with `enabled: false` and a
`unavailableReasonKey`; the lobby does not offer it and the server rejects a
modified client that requests it (`resolveCombination` → `disabled`).

The registry separates two questions:

- `implemented` — the engine can execute the profile's rules. `createGame`
  requires this, so fixtures can exercise a profile before it is advertised.
- `enabled` — the lobby advertises it and the service accepts it.

`base-paired-2025` is enabled after the B56-25 fixture set verifies the 30-hex topology, 11 harbors, 24/resource bank, 34-card development deck, setup order, and paired turns. Expansion profiles remain closed pending their own source transcription.

## Fixture → evidence map

| Fixture | Contract | Automated evidence | Status |
|---|---|---|---|
| R-B01 | setup order, distance rule, coastal vertices, no duplicate occupancy, one starting grant, city upgrade returns the settlement | `packages/rules/test/setup.test.ts` (9 cases) | covered |
| R-B02 | two independent dice, settlement 1 / city 2, finite supply, robber block, bank shortage rule | `packages/rules/test/production.test.ts` (10 cases) | covered |
| R-B03 | 7 → half rounded down, multi-responder discards, no trade before resolution, empty victim, no multiplied theft, desert, knight does not trigger discards | `packages/rules/test/seven.test.ts` (10 cases) | covered |
| R-B04 | domestic exchange legality, bank 4:1/3:1/2:1, stale/expired offers, consent, revision invalidates consent, one settlement | `packages/rules/test/trade.test.ts` (13 cases) | covered |
| R-B05 | cannot play a card the turn it is bought, one per turn, pre-roll knight, monopoly / year of plenty / road building, VP card victory, empty deck | `packages/rules/test/devcards.test.ts` (11 cases) | covered |
| R-B06 | Longest Road ≥ 5 along a trail, branches, loops, opponent cuts, incumbent tie retention, award reassignment, Largest Army transfer | `packages/rules/test/awards.test.ts` (10 cases) | covered; see the tie-break note below |
| R-B07 | win at own turn start, no win from an outside-turn gain, several VP cards together, award loss before the next turn, terminal state rejects commands | `packages/rules/test/victory.test.ts` (7 cases) | covered |
| R-VIS | per-player projection, hidden hands/cards/deck, private event parameters, room-discovery metadata | `packages/rules/test/privacy.test.ts` (7), `packages/server/test/game.test.ts` (HTTP) | covered |
| R-ROOM | join/start/settings races, full room, not-ready/disconnected start, host transfer, seats kept in a running game | `packages/server/test/rooms.test.ts` | covered |
| R-ROOM (abandonment) | absent-seat requirement, every connected seat confirms, reconnect cancels the vote, policy opt-out, explicit withdrawal and retraction, no-winner terminal result | `packages/server/test/abandonment.test.ts` (7 cases) | covered |
| R-POLICY | pre-start host edit clears readiness, bounds, host-only rejection, all-seat consent, rejection leaves policy, host transfer cancels | `packages/server/test/rooms.test.ts` | covered |
| R-SAVE | save barrier acknowledgement, idempotent request id, no table-wide pause, all-seat suspension, readiness-gated resume, rejection | `packages/server/test/recovery.test.ts` | covered |
| R-REC | restart restores revision/seat/receipts; terminal result persists; repository contract on SQLite **and** PostgreSQL | `packages/server/test/recovery.test.ts`, `packages/server/test/db-contract.test.ts` | covered (SQLite + PostgreSQL 16) |
| R-56 | 30-hex/11-harbor B56 board, 24/resource bank, 34-card deck, setup order, partner = third seat to the left, five- and six-seat pair cycles, production only on Player 1, no domestic trade for Player 2, build/bank/card actions for Player 2, card carry between roles, either role may win | `packages/rules/test/paired.test.ts` (12 cases) and `packages/server/test/rooms.test.ts` | covered at engine and room lifecycle level |
| R-CHAT | audience, deduplication, length/rate limits, mute isolation, epoch isolation, paging, verbatim markup | `packages/server/test/chat.test.ts` | covered |
| R-TRADE | concurrent responses, revised terms, inventory changes, withdrawal, expiry, counteroffer settlement | `packages/rules/test/trade.test.ts` (engine) | covered at engine level; multi-client browser race not yet observed |
| U-01, U-02, U-05 | rendered layout, mouse/keyboard/touch selection, dense content | `packages/web/test/*.test.tsx` (jsdom), `docs/screenshots/`, and the P1B headless Chromium captures below | **partially covered** — captured layouts and DOM pointer/keyboard contracts; no physical touch, rotation or pointer-device acceptance |
| U-03, U-04, U-06, U-07, U-08 | devices, assistive technology, measured responsiveness, novice/expert playtests | – | **not covered** |
| U-I18N | both locales for every flow, draft-safe switching, catalog parity | `packages/web/test/i18n.test.ts` and the protocol-list coverage test | **partially covered** — no IME or mixed-locale session |
| Container | image builds, runs non-root, health, volume persistence, SIGTERM, PostgreSQL mode | `docker build`, `docker run`, `docker compose -f docker-compose.postgres.yml`, `scripts/smoke.mjs` | covered (see `docs/EVIDENCE.md`) |

## Board visual spike evidence — 2026-10-28

The [P1A report](aegis/work/2026-10-28-board-visual-spike/p1a-report.md),
[P1B report](aegis/work/2026-10-28-board-visual-spike/p1b-report.md) and
[curated source metadata](aegis/work/2026-10-28-board-visual-spike/p1b-evidence.json)
record unit/DOM tests and the final P1B production build in headless Chromium.
The capture run completed 47 PASS, 0 FAIL, 0 BLOCKED and 3 NOT RUN cases:
24 static states (19/30 hexes, zh-Hant/en, six viewports, DPR 1), six event
videos/traces, six 30-second active-frame windows, reduced-motion/idle checks,
and engine-projected theft views for three seats plus an outsider. Captures
are review candidates, not accepted visual baselines; canonical screenshots
were not replaced. The [D1 decision](aegis/work/2026-10-28-board-visual-spike/d1-decision.md)
retains SVG provisionally and leaves the conditional GPU comparison unstarted.

| Acceptance family | Evidence covered | Remaining scope / status |
| --- | --- | --- |
| E01–E10 | Cursor/baseline, ordering, stale responses, recovery, new-game reset, bounded queue, cancellation, lifecycle and rejected/unknown/preview contracts in unit/DOM tests; production history baseline and new roll/build/production capture | **partially covered** — native recovery/receipt races and complete real-client flow are not established by fixture replay |
| I01–I07 | CSS-pixel projection math, DOM drag/pinch/cancel, ambiguity picker, keyboard preview/confirm, resize/fit and non-interactive overlay | **partially covered** — native touch/pinch/rotation, 200% text zoom and full browser input matrix remain unverified; I06 GPU comparison NOT RUN |
| V01–V07 | 24 static captures, building/road/production middle frames, aggregate/empty-grant and neutral-theft tests, selected before/after videos | **partially covered** — human judgment of thickness, causality, receipt readability, dense/zoomed-board clarity and interference remains NOT RUN |
| A01 / A05 | Initial/changing reduce in Chromium, lifecycle cancellation, no-focus/no-pointer overlay, authorized projections and identical neutral theft overlay across three seats/outsider | **covered in the stated automated scope** — complete keyboard journey, 200% text zoom, screen reader and accessibility scan/manual acceptance remain NOT RUN; English still retains static HTML `lang=zh-Hant` |
| P01–P07 | Six local active-window captures; idle/reduce application RAF delta zero; 24 flight cap and zero particles in DOM; no GPU dependency | **partially covered** — reference hardware, true background 30 s, registry/heap/GPU trends, three cold-cache loads, 100-input paint, six-client RTT/ack and DPR 2/3 acceptance remain NOT RUN |

Local active rAF interval p95 was 8.6–8.9 ms, with maxima 58.4–108.2 ms
(P0 control p95 8.5 ms). These scheduling proxies use different presentation
windows from P0 and are not GPU render time. Reference mobile hardware,
60 Hz/power calibration and full hardware inventory were unavailable; no
performance acceptance or absence of stutter is claimed. See the
[P3 record](aegis/work/2026-10-28-board-visual-spike/p3-acceptance.md) for the
final integration gate and explicit M0–M4 status.

## Test commands

```bash
pnpm --filter @catan/rules test        # 93 rules fixtures
pnpm --filter @catan/server test       # 73 service fixtures (SQLite)
pnpm --filter @catan/protocol test
pnpm --filter @catan/web test          # client component tests

# Replay the whole service suite against PostgreSQL
TEST_POSTGRES_URL=postgres://user:pass@host:5432/db pnpm --filter @catan/server test
```

## Deliberate interpretations

These are decisions the source material leaves open; they are recorded so a
reviewer can challenge them rather than discover them by accident.

- **Longest Road is a trail, not a simple path.** The specification says "along
  a legal trail, without counting a piece twice or summing independent
  branches", so a closed loop counts its full length and a branch contributes
  only its two longest arms. `longestRouteLength` implements exactly that.
- **Award ties with no incumbent go to the earliest seat.** A tie while an
  award is held keeps it with the incumbent (source-derived). When the
  incumbent has lost eligibility and two players tie at the same new value, the
  lowest seat index takes the award, because the snapshot does not record which
  player reached the value first.
- **Setup order starts play with the first placer.** Round 1 runs forward and
  round 2 runs in reverse, so the player who placed the first settlement is also
  the last to place in round 2; play then begins with that seat.
- **Bank shortage** follows B25 p.6: when the bank cannot pay every entitled
  player, nobody receives that resource; when exactly one player is entitled,
  they receive whatever remains.

## Known gaps and unresolved items

These are recorded rather than hidden. None of them is presented as verified.

1. **Harbor positions are approximated.** The nine harbor *positions* are
   derived from the coastal-edge ring with a documented spacing pattern
   (`pickHarborSlots` in `packages/rules/src/topology.ts`); the physical board's
   exact frame positions still need transcription and review. The harbor
   *inventory* (four 3:1 plus one 2:1 per resource) is exact and tested.
2. **Fixed-board transcription is unverified against the physical board.** The
   terrain/number arrangement in `FIXED_BASE_TERRAIN`/`FIXED_BASE_NUMBERS` and
   the fixed harbor token order follow the published first-game setup, but no
   page-level source citation has been recorded for the exact token order.
3. **Variable setup follows the spiral procedure, not a per-scenario
   transcription.** The number tokens are laid in the printed spiral order; the
   6/8-adjacency restriction is not applied because it is not part of the base
   B25 procedure.
4. **Only the base row is advertised.** 5–6 players, Seafarers, Cities &
   Knights and their combination remain `enabled: false`. The paired-turn
   procedure for 5–6 is implemented and tested, but the row stays closed until
   B56-25 setup, supply and deck contents are transcribed and verified, and
   until R-SF/R-CK/R-COMB fixtures exist for the other rows. The 5-player pair
   cycle is derived from the specification's wording ("the third player to
   Player 1's left", "both markers move to the next player to their left")
   rather than transcribed page-by-page from B56-25.
5. **No real-device or screen-reader evidence.** The 2026-10-29 [island diorama replacement](aegis/plans/2026-10-29-island-diorama.md) starts in auto 3D with SVG loading/failure compatibility and an explicit `?renderer=svg` option. Its [verification record](aegis/work/2026-10-29-island-diorama.md) separates model and camera tests, production WebGL captures and open human/device checks. The original candidate's [acceptance matrix](aegis/plans/2026-10-29-board-3d-acceptance.md) and [execution checkpoint](aegis/work/2026-10-29-board-3d/20-checkpoint.md) are historical; no prior SVG capture proves modeled 3D quality. U-03 (physical iOS/Android),
   U-04 (manual assistive-technology walkthrough), U-06 (measured
   responsiveness), U-07 (novice observation) and U-08 (expert playtest) have
   not been performed. Automated coverage includes jsdom tests, the prior
   headless-Chromium lobby/setup interaction run and the P1B production
   captures above. Screenshots and videos exist; accepted visual baselines,
   physical touch/rotation, 200% text zoom, IME, screen-reader, Firefox/WebKit
   runtime and reference-hardware evidence remain absent. Chromium viewport
   emulation does not close the physical-device gap.
6. **Multi-client browser races are unverified.** R-TRADE concurrency and
   R-ROOM admission races are exercised through the service API, not through
   several real browsers.
7. **Presence timing is exercised through the API only.** The host-succession
   grace timer is implemented, but no test waits out a real grace period, and
   the client's second-tab "active elsewhere" state is display-only — the
   newest-connection seat control is enforced by the service but not yet
   surfaced as a reclaim action in the client.
8. **Abandonment is implemented but not yet exercised with real presence
   timing.** The vote, its invalidation on reconnection and the no-winner
   terminal transition are covered through the API with an injected
   disconnection; no test waits out a real grace period or closes a real
   WebSocket to produce the absence.
9. **Advisory turn clock is stored, not enforced.** The value is validated and
   displayed; no timer drives an overdue cue yet.
10. **Stale-lobby cleanup is scheduled but coarse.** A background sweep runs
    at least once a minute and removes idle pre-game lobbies only; presence is
    decided by live sockets, so a lobby whose members never opened a socket is
    reclaimed once its TTL elapses. No test waits out the real interval.
11. **Rules-version dispatch is single-version.** The engine version is stored
    per game and unknown versions are refused at the schema level, but only one
    engine implementation ships, so no old-version fixture exists yet.
