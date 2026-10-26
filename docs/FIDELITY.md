# Fidelity and evidence index

This file records what is actually implemented and verified, mapped to the
fixture families in SPEC §12.1, plus the known gaps. It is deliberately
conservative: **unlisted evidence is unverified**, and no profile is advertised
before its fixtures pass.

## Source baseline

| Source | Edition | Used for |
|---|---|---|
| B25 | CATAN – The Game, CN3081, 2025 | board inventory, setup, production, 7-handling, trade, cards, awards, victory |
| B56-25 | CATAN – 5–6, CN3082, 2025 | paired-player roles (profile registered, disabled) |
| SF25 / SF56-25 | Seafarers, CN3083/CN3084, 2025 | registered target profiles, disabled |
| CK25 / CK56-25 | Cities & Knights, CN3087/CN3088, 2025 | registered target profiles, disabled |
| COMB | Seafarers + C&K guidance | registered target profile, disabled |

The rules are implemented from the specification's paraphrase and the
publisher's rulebooks. No official artwork or card text is copied.

## Enabled profiles

| Profile | Counts | Victory target | Status |
|---|---|---|---|
| `base-2025` | 3, 4 | 10 | **enabled** |

Every other row of the §5.7 matrix is registered with `enabled: false` and a
`unavailableReasonKey`; the lobby does not offer it and the server rejects a
modified client that requests it (`resolveCombination` → `disabled`).

The registry separates two questions:

- `implemented` — the engine can execute the profile's rules. `createGame`
  requires this, so fixtures can exercise a profile before it is advertised.
- `enabled` — the lobby advertises it and the service accepts it.

`base-paired-2025` (5–6 players) is `implemented: true`, `enabled: false`: the
paired-turn procedure is implemented and fixture-tested, while the 5–6
setup/supply and development-deck transcription still needs source
verification before the row may be offered.

## Fixture → evidence map

| Fixture | Contract | Automated evidence | Status |
|---|---|---|---|
| R-B01 | setup order, distance rule, coastal vertices, no duplicate occupancy, one starting grant, city upgrade returns the settlement | `packages/rules/test/setup.test.ts` (9 cases) | covered |
| R-B02 | two independent dice, settlement 1 / city 2, finite supply, robber block, bank shortage rule | `packages/rules/test/production.test.ts` (10 cases) | covered |
| R-B03 | 7 → half rounded down, multi-responder discards, no trade before resolution, empty victim, no multiplied theft, desert, knight does not trigger discards | `packages/rules/test/seven.test.ts` (10 cases) | covered |
| R-B04 | domestic exchange legality, bank 4:1/3:1/2:1, stale/expired offers, consent, revision invalidates consent, one settlement | `packages/rules/test/trade.test.ts` (13 cases) | covered |
| R-B05 | cannot play a card the turn it is bought, one per turn, pre-roll knight, monopoly / year of plenty / road building, VP card victory, empty deck | `packages/rules/test/devcards.test.ts` (11 cases) | covered |
| R-B06 | Longest Road ≥ 5 along a trail, branches, loops, opponent cuts, incumbent tie retention, award reassignment, Largest Army transfer | `packages/rules/test/awards.test.ts` (10 cases) | covered |
| R-B07 | win at own turn start, no win from an outside-turn gain, several VP cards together, award loss before the next turn, terminal state rejects commands | `packages/rules/test/victory.test.ts` (7 cases) | covered |
| R-VIS | per-player projection, hidden hands/cards/deck, private event parameters, room-discovery metadata | `packages/rules/test/privacy.test.ts` (7), `packages/server/test/game.test.ts` (HTTP) | covered |
| R-ROOM | join/start/settings races, full room, not-ready/disconnected start, host transfer, seats kept in a running game | `packages/server/test/rooms.test.ts` | covered |
| R-POLICY | pre-start host edit clears readiness, bounds, host-only rejection, all-seat consent, rejection leaves policy, host transfer cancels | `packages/server/test/rooms.test.ts` | covered |
| R-SAVE | save barrier acknowledgement, idempotent request id, no table-wide pause, all-seat suspension, readiness-gated resume, rejection | `packages/server/test/recovery.test.ts` | covered |
| R-REC | restart restores revision/seat/receipts; terminal result persists; repository contract on SQLite **and** PostgreSQL | `packages/server/test/recovery.test.ts`, `packages/server/test/db-contract.test.ts` | covered (SQLite + PostgreSQL 16) |
| R-56 | partner = third seat to the left, five- and six-seat pair cycles, production only on Player 1, no domestic trade for Player 2, build/bank/card actions for Player 2, card carry between roles, either role may win | `packages/rules/test/paired.test.ts` (11 cases) | covered at engine level; profile stays disabled |
| R-CHAT | audience, deduplication, length/rate limits, mute isolation, epoch isolation, paging, verbatim markup | `packages/server/test/chat.test.ts` | covered |
| R-TRADE | concurrent responses, revised terms, inventory changes, withdrawal, expiry, counteroffer settlement | `packages/rules/test/trade.test.ts` (engine) | covered at engine level; multi-client browser race not yet observed |
| U-01…U-08, U-I18N | rendered interactions, devices, accessibility, playtests | `packages/web` component tests only | **partially covered — see gaps** |

## Test commands

```bash
pnpm --filter @catan/rules test        # 93 rules fixtures
pnpm --filter @catan/server test       # 73 service fixtures (SQLite)
pnpm --filter @catan/protocol test
pnpm --filter @catan/web test          # client component tests

# Replay the whole service suite against PostgreSQL
TEST_POSTGRES_URL=postgres://user:pass@host:5432/db pnpm --filter @catan/server test
```

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
5. **No real-device or screen-reader evidence.** U-03 (physical iOS/Android),
   U-04 (manual assistive-technology walkthrough), U-06 (measured
   responsiveness), U-07 (novice observation) and U-08 (expert playtest) have
   not been performed. Only automated component tests exist.
6. **Multi-client browser races are unverified.** R-TRADE concurrency and
   R-ROOM admission races are exercised through the service API, not through
   several real browsers.
7. **Presence timing is exercised through the API only.** The host-succession
   grace timer is implemented, but no test waits out a real grace period.
8. **Abandonment of an interrupted table is not implemented.** §4.6's
   unanimous-currently-connected abandonment vote is described in the policy
   model but no endpoint or engine transition exists yet; the room policy
   records the operator's intent only.
9. **Advisory turn clock is stored, not enforced.** The value is validated and
   displayed; no timer drives an overdue cue yet.
10. **Stale-lobby cleanup is not scheduled.** The TTL is documented and the
    sweep excludes resumable games by design, but no background job runs it.
11. **Rules-version dispatch is single-version.** The engine version is stored
    per game and unknown versions are refused at the schema level, but only one
    engine implementation ships, so no old-version fixture exists yet.
