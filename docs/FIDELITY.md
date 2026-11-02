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
| TB25 | CATAN – Traders & Barbarians, CN3089, 2025 (`v6.250701`) | variants and five scenarios on the base board, 3–4 players (see [Traders & Barbarians](#traders--barbarians-tb25)) |

The rules are implemented from the specification's paraphrase and the
publisher's rulebooks. No official artwork or card text is copied.

## Enabled profiles

| Profile | Counts | Victory target | Status |
|---|---|---|---|
| `base-2025` | 3, 4 | 10 | **enabled** |
| `base-paired-2025` | 5, 6 | 10 | **enabled** |
| `tb-friendly-robber-2025` | 3, 4 | 10 | **enabled** |
| `tb-harbors-2025` | 3, 4 | 11 | **enabled** |
| `tb-friendly-robber-harbors-2025` | 3, 4 | 11 | **enabled** |
| `tb-fishing-2025` | 3, 4 | 10 (11 with the old boot) | **enabled** |
| `tb-rivers-2025` | 3, 4 | 10 | **enabled** |
| `tb-merchant-trains-2025` | 3, 4 | 12 | **enabled** |
| `tb-barbarian-attack-2025` | 3, 4 | 12 | **enabled** |
| `tb-traders-barbarians-2025` | 3, 4 | 13 | **enabled** |

Every other row of the §5.7 matrix is registered with `enabled: false` and a
`unavailableReasonKey`; the lobby does not offer it and the server rejects a
modified client that requests it (`resolveCombination` → `disabled`).

The registry separates two questions:

- `implemented` — the engine can execute the profile's rules. `createGame`
  requires this, so fixtures can exercise a profile before it is advertised.
- `enabled` — the lobby advertises it and the service accepts it.

`base-paired-2025` is enabled after the B56-25 fixture set verifies the 30-hex topology, 11 harbors, 24/resource bank, 34-card development deck, setup order, and paired turns. Expansion profiles remain closed pending their own source transcription.

Registry v2 (2026-11-01 expansion platform) adds per-profile `expansions`,
`scenario`, `variants`, `ruleVersion`, `sources` and display-only
`requiredBoxes`. Both base profiles use master's `ruleVersion` `base-2025.3`
(PR #60), so base snapshots keep their `engineVersion`. The platform adds no
rule: base topology indices, fixed/variable layouts, freshly created snapshots
and five whole simulated base/paired games are pinned by digests recorded from
master's own engine at `0815c76`
(`packages/rules/test/base-regression.test.ts`).

## Fixture → evidence map

| Fixture | Contract | Automated evidence | Status |
|---|---|---|---|
| R-B01 | setup order, distance rule, coastal vertices, no duplicate occupancy, one starting grant, city upgrade returns the settlement | `packages/rules/test/setup.test.ts` (9 cases) | covered |
| R-B02 | two independent dice, settlement 1 / city 2, finite supply, robber block, bank shortage rule | `packages/rules/test/production.test.ts` (10 cases), `packages/rules/test/costs.test.ts` (spent cards return to the bank) | covered |
| R-B03 | 7 → half rounded down, multi-responder discards, no trade before resolution, empty victim, no multiplied theft, desert, knight does not trigger discards | `packages/rules/test/seven.test.ts` (10 cases) | covered |
| R-B04 | domestic exchange legality, bank 4:1/3:1/2:1, stale/expired offers, consent, revision invalidates consent, one settlement | `packages/rules/test/trade.test.ts` (13 cases) | covered |
| R-B05 | cannot play a card the turn it is bought, one per turn, pre-roll knight, monopoly / year of plenty / road building, VP card victory, empty deck | `packages/rules/test/devcards.test.ts` (11 cases), `packages/rules/test/rule-gaps.test.ts` (older card after a same-type purchase; Road Building capped by road pieces; Year of Plenty capped by the bank) | covered |
| R-B06 | Longest Road ≥ 5 along a trail, branches, loops, opponent cuts, incumbent tie retention, award reassignment, Largest Army transfer | `packages/rules/test/awards.test.ts` (10 cases), `packages/rules/test/rule-gaps.test.ts` (roads stop at an opponent building and continue from the player's own side) | covered; see the tie-break note below |
| R-B07 | win at own turn start, no win from an outside-turn gain, several VP cards together, award loss before the next turn, terminal state rejects commands | `packages/rules/test/victory.test.ts` (7 cases) | covered |
| R-VIS | per-player projection, hidden hands/cards/deck, private event parameters, room-discovery metadata | `packages/rules/test/privacy.test.ts` (7), `packages/server/test/game.test.ts` (HTTP) | covered |
| R-ROOM | join/start/settings races, full room, not-ready/disconnected start, host transfer, seats kept in a running game | `packages/server/test/rooms.test.ts` | covered |
| R-ROOM (abandonment) | absent-seat requirement, every connected seat confirms, reconnect cancels the vote, policy opt-out, explicit withdrawal and retraction, no-winner terminal result | `packages/server/test/abandonment.test.ts` (7 cases) | covered |
| R-POLICY | pre-start host edit clears readiness, bounds, host-only rejection, all-seat consent, rejection leaves policy, host transfer cancels | `packages/server/test/rooms.test.ts` | covered |
| R-SAVE | save barrier acknowledgement, idempotent request id, no table-wide pause, all-seat suspension, readiness-gated resume, rejection | `packages/server/test/recovery.test.ts` | covered |
| R-REC | restart restores revision/seat/receipts; terminal result persists; repository contract on SQLite **and** PostgreSQL | `packages/server/test/recovery.test.ts`, `packages/server/test/db-contract.test.ts` | covered (SQLite + PostgreSQL 16) |
| R-56 | 30-hex/11-harbor B56 board, 24/resource bank, 34-card deck, setup order, partner = third seat to the left, five- and six-seat pair cycles, production only on Player 1, no domestic trade for Player 2, build/bank/card actions for Player 2, card carry between roles, either role may win | `packages/rules/test/paired.test.ts` (12 cases) and `packages/server/test/rooms.test.ts` | covered at engine and room lifecycle level |
| R-COMPAT | registry v2 metadata; exact, order-insensitive expansion/scenario/variant matching with no transitive inference; full count × expansion × scenario matrix; profile id or `{ ruleset }` room requests; fixture profiles never resolvable | `packages/rules/test/profiles.test.ts`, `packages/server/test/rooms.test.ts`, `packages/web/test/rulesets.test.ts` | covered |
| R-PLATFORM | pending queue order/responders/continuations and old snapshots without a queue; rules-module hooks (setup, roll, discard limit, production, board change, commands, score, projection, hints) through a fixture module; layout registry; generic topologies (sea frame, several islands, marked harbours); base digests unchanged | `packages/rules/test/platform.test.ts`, `topology-generic.test.ts`, `base-regression.test.ts`, `message-ids.test.ts` | covered at engine level; no real expansion module exists yet |
| R-TB-FR / R-TB-HB | Friendly Robber (TB25 p. 4): protected 2-VP players, desert fallback, Knight; Harbors of Catan: Strongest Ports award, 11 VP | `packages/rules/test/tb-variants.test.ts` (10 fixtures + 6 simulated games) | covered |
| R-TB-FI | Fishing on Catan (pp. 9–10): lake in the inner area, six grounds on the printed frame valleys, 29 tokens + boot, setup fish, production order, 7-token swap, refill, boot transfer and +1 VP, five fish actions, privacy | `packages/rules/test/tb-fishing.test.ts` (20 + 2 simulated games), `packages/web/test/tb-fishing.test.tsx` (5) | covered |
| R-TB-RV | Rivers of Catan (pp. 11–12): fixed river tiles, 2 sharing the 12 hex, robber on a swamp, 7 bridge sites, setup/bridge gold, bridge limits, coins (buy/sell/trade), wealth tiles | `packages/rules/test/tb-rivers.test.ts` (18 + 2), `packages/web/test/tb-rivers.test.tsx` (3) | covered |
| R-TB-MT | Merchant Trains (pp. 13–14): watering hole and starts, wagon collection, ordered public bids, majority / most-voted / top bidder / active player, no branching, merging, +1 VP between wagons, wagon road weight | `packages/rules/test/tb-trains.test.ts` (14 + 2), `packages/web/test/tb-trains.test.tsx` (2) | covered |
| R-TB-BA | Barbarian Attack (pp. 15–19): printed numbers and areas, city setup, barbarian landing, conquest (production, building, VP, ports), 7 steal, four cards, knight moves, expel / prisoners / dice ties / knight losses | `packages/rules/test/tb-barbarians.test.ts` (22 + 2), `packages/web/test/tb-barbarians.test.tsx` (3) | covered |
| R-TB-TR | Traders & Barbarians (pp. 20–24): interior paths, X sides, sites and stacks, 5 gold, wagon on the setup city, 2/12 reroll, 7 barbarian move and robbery, Knight / Swift Journey, upgrades, movement costs, deliveries, drive-off | `packages/rules/test/tb-traders.test.ts` (18 + 2), `packages/web/test/tb-traders.test.tsx` (4) | covered |
| R-TB-SRV | ruleset resolution by parts, setup over the API for every scenario, module receipts, projection privacy | `packages/server/test/traders-barbarians.test.ts` (7) | covered (SQLite) |
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
- **Year of Plenty on a short bank** grants only what the bank holds: one pick
  when a single card remains, and the card cannot be played while the bank is
  empty (it stays in hand). The rulebook assumes a stocked bank; this keeps the
  effect from waiting forever on cards that do not exist.

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
4. **The base and paired-base rows are advertised.** 5–6 uses
   `base-paired-2025`, whose B56-25 setup, supply and deck contents are
   transcribed and verified. Seafarers, Cities & Knights and their combination
   remain `enabled: false` until R-SF/R-CK/R-COMB fixtures exist. The 5-player
   pair cycle is derived from the specification's wording ("the third player to
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
    engine implementation ships; historical-version dispatch is not implemented.
    The server does not yet compare `games.engine_version` before executing a
    command. The maintainer explicitly approved running unfinished
    `base-2025.1` and `base-2025.2` games on `base-2025.3` on 2026-11-02
    as the PR #60 defect-fix exception (SPEC §7.3).
    Already-pending Road Building and Year of Plenty effects are capped to the
    remaining pieces or bank cards in projections, hints and execution;
    exhausted effects no longer block the next legal command.
    `base-2025.1` banks stay short by the cards already lost, and a road a
    `base-2025.2` game let through an opponent's building stays on the board.

## Traders & Barbarians (TB25)

Source: CATAN – Traders & Barbarians Expansion, 2025 English rulebook,
CN3089, page footers `v6.250701`, 24 pages, 27,843,748 bytes, SHA-256
`7c4938dc45480ed28fde1fccbeca450c815b36ee2f4ed57107650013313acaaf`,
downloaded from catan.com (SPEC §15) on 2026-11-01. The transcription with
page references is in
[the P5 work record](aegis/work/2026-11-01-traders-barbarians.md). Rule texts
in both locales are paraphrases; artwork is original (procedural SVG and
three.js).

Registered and enabled: the Friendly Robber and Harbors of Catan variants
(alone and together) on the base board, and the five scenarios. The event-card
rows (`tb-event-cards*`, alone and with the other variants) are registered
with `implemented: false, enabled: false` and
`profile.unavailable.tbEventDeck`: TB25 lists the thirteen events' effects but
not how many cards carry each event nor the number disc printed on each card,
so the deck cannot be transcribed from the source. Catan for Two, 5–6 players
and every combination with Seafarers, Cities & Knights or between scenarios
are out of scope (roadmap P5).

Transcribed from printed maps (no rule text gives them):

- Scenario frame (`tb-r2`): the nine harbours where the T&B maps draw their
  piers — `(0,-2)` side 2, `(1,-2)` 1, `(2,-1)` 1, `(2,0)` 0, `(1,1)` 5,
  `(-1,2)` 5, `(-2,2)` 4, `(-2,1)` 3, `(-1,-1)` 3. The base board's own
  approximated slots (gap 1) would put three harbours on fishing grounds.
  Harbour types are shuffled over these positions as in the base variable
  setup.
- Fishing grounds: the six coastal valleys between `(0,-2)|(1,-2)`,
  `(2,-1)|(2,0)`, `(2,0)|(1,1)`, `(-2,2)|(-1,2)`, `(-2,1)|(-2,2)`,
  `(-1,-1)|(0,-2)`; a ground touches its valley and the two neighbouring
  corners.
- River courses and bridge sites (river tile art), Barbarian Attack numbers,
  the train starts at the watering hole, the T&B scenario's sites, paths and
  barbarian edges (setup maps and diagrams).

Deliberate interpretations (open to challenge, not house rules):

- **Friendly Robber** uses public VP (hidden VP cards are invisible to the
  robber's mover) and reads "only 2 VP" as at most 2; with no valid hex the
  robber may stay on a desert it already occupies.
- **Fish and old-boot actions** are action-phase actions: TB25 grants a
  pre-roll window only to Catan for Two's trade tokens. Declining the 7-token
  swap also uses that turn's swap (only one production happens per turn).
- **Gold supply** is the 100 gold of the 40 coins; when it runs short a player
  receives what is left (TB25 is silent).
- **Rivers**: the setup draw chooses the robber's swamp ("either of the 2
  swamps").
- **Merchant Trains** (p. 14, fig. 1 and 2): trains never branch. A front that
  touches another train's body or tail has run into it and the train ends
  (fig. 1). Two fronts that meet at one intersection merge (fig. 2); the merged
  train may continue along the remaining free edge, and that wagon joins the
  train with the lower start index. The other front stays on the meeting
  intersection, which has no free edge left. A front touching a lone start
  wagon (its tail) at the watering hole also ends.
- **Barbarian Attack**: barbarians land only for buildings placed in the
  action phase (the rule sits under "Action phase updates"), city upgrades
  included; Knighthood / Swift Knight without a knight or a free edge have no
  effect; Treason destinations differ from both sources and from each other.
- **Traders & Barbarians**: a wanted commodity is delivered automatically
  (delivering is never worse); commodity-hex corners reachable only by X edges
  are not settlement sites, since setup could not place their road.

Clause fixtures: every clause transcribed in the work record has a fixture
whose comment names the page (`// TB25 p.N: …`), its start state, window,
command and expected result. The review-tb list was closed with
`FI14`–`FI21` (Fishing), `RV9`–`RV19` (Rivers), `MT8`–`MT15` (Trains),
`BA13`–`BA23` (Barbarian Attack), `TR11b`, `TR12`–`TR18` (Traders &
Barbarians) and `FRHB1`–`FRHB2` (variants combined); existing fixtures cover
the rest (robber staying on the desert `FR3`, harbour city and tile transfer
`HB1`/`HB2`, Wealthiest tie `RV8`/`RV13`, Treason from the supply `BA8`/`BA17`,
unneeded commodity kept `TR9`, non-active majority returning bids `MT3`,
three-wagon junction `MT8`).

Deliberately untested (no fixture; each is either a physical-component
detail, a UI-only choice or already covered by the generic engine tests):

- Wagon, knight and barbarian piece limits beyond the supplies the engine
  counts (24 knights, 36 barbarians, 22 wagons): the physical box limits are
  conserved by the simulated games' supply totals only.
- The Barbarian Attack and Traders & Barbarians development card decks
  reshuffle rules other than the BA discard shuffle (`BA22`).
- Hiding Victory Point cards from players who could not win with them (p. 22):
  the engine counts hidden cards for the owner's own check and never
  serialises them to others (privacy test), but "reveal only if it wins" is
  not a separate step.
- Human-readable rule text and card art in both locales (catalog parity
  tests check the keys, not the wording).

Merchant Trains merging (p. 14, fig. 1 and 2) has fixtures `MT8`–`MT10`;
the earlier behaviour (a front touched by any other wagon ended its train, so
two meeting fronts never merged) was a defect found by review and fixed.

Known T&B gaps:

1. Event cards: mechanics not implemented and rows closed until the card list
   is transcribed from the physical deck.
2. Combinations of a variant with a scenario are not registered, although
   TB25 permits them (p. 2); the Friendly Robber's desert rule has no desert in
   four scenarios and Harbors' "VP in buildings on ports" meets scenario VP
   (wagons, conquest) — these need explicit decisions first.
3. No physical-table playtest; the rules were checked against the rulebook,
   fixtures and simulated games, and the UI in headless Chromium. Every enabled
   profile's own action is played through the UI in SVG and 3D by
   `scripts/traders-barbarians/live.py` (a test-only fixture patch reaches the
   situation; the action itself runs through the UI against the built
   service).

