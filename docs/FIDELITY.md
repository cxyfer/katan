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
| SF25 | CATAN – Seafarers, CN3083, 2025 (`v6.250401`), sha256 `a499abe2…b04b099` | ships, ship moves, pirate, gold, Longest Trade Route, Road Building/Knight changes (pp. 2–3); Heading for New Shores 3/4-player maps, tables, island bonus, 14 VP (pp. 4–5) |
| SF56-25 | CATAN – Seafarers 5–6, CN3084, 2025 (`v6.250401`), sha256 `746ac86e…bb0fe` | paired turns and Player 2 ship move (pp. 2–3); 5–6 New Shores layout, tables and setup (p. 4); extra 2:1 wool port (p. 1) |
| SF-FAQ | catan.com/faq/seafarers, accessed 2026-11-01, sha256 `91d8ad89…60d75` | clarifications compatible with SF25 (frame inner edge, Road Building order, pirate/coastal theft, moving keeps Longest Trade Route) |
| CK25 / CK56-25 | Cities & Knights, CN3087/CN3088, 2025 | registered target profiles, disabled |
| COMB | Seafarers + C&K guidance | registered target profile, disabled |

The rules are implemented from the specification's paraphrase and the
publisher's rulebooks. No official artwork or card text is copied.

## Enabled profiles

| Profile | Counts | Victory target | Status |
|---|---|---|---|
| `base-2025` | 3, 4 | 10 | **enabled** |
| `base-paired-2025` | 5, 6 | 10 | **enabled** |
| `sf-new-shores-2025` | 3, 4 | 14 | **enabled** (printed SF25 maps, fixed setup) |
| `sf-new-shores-paired-2025` | 5, 6 | 14 | **enabled** (SF56-25 map: fixed small islands, variable main island and ports) |

Every other row of the §5.7 matrix is registered with `enabled: false` and a
`unavailableReasonKey`; the lobby does not offer it and the server rejects a
modified client that requests it (`resolveCombination` → `disabled`).

The registry separates two questions:

- `implemented` — the engine can execute the profile's rules. `createGame`
  requires this, so fixtures can exercise a profile before it is advertised.
- `enabled` — the lobby advertises it and the service accepts it.

`base-paired-2025` is enabled after the B56-25 fixture set verifies the 30-hex topology, 11 harbors, 24/resource bank, 34-card development deck, setup order, and paired turns. The Heading for New Shores profiles are enabled after the R-SF fixtures below pass, the maps are transcribed from the printed SF25/SF56-25 pages (method and per-cell data in [the work record](aegis/work/2026-11-01-seafarers.md) and `packages/rules/src/seafarers-boards.ts`) and a whole game is playable from the browser in both renderers (`scripts/seafarers/capture.py`). Cities & Knights and the combined profiles remain closed.

Registry v2 (2026-11-01 expansion platform) adds per-profile `expansions`,
`scenario`, `variants`, `ruleVersion`, `sources` and display-only
`requiredBoxes`. Both base profiles use master's `ruleVersion` `base-2025.3`
(PR #60), so base snapshots keep their `engineVersion`. The platform adds no
rule: base topology indices, fixed/variable layouts, freshly created snapshots
and five whole simulated base/paired games are pinned by digests recorded from
master's own engine at `0815c76`
(`packages/rules/test/base-regression.test.ts`).

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
| R-PLATFORM | pending queue order/responders/continuations and old snapshots without a queue; rules-module hooks (setup, roll, discard limit, production, board change, commands, score, projection, hints) through a fixture module; layout registry; generic topologies (sea frame, several islands, marked harbours); base digests unchanged | `packages/rules/test/platform.test.ts`, `topology-generic.test.ts`, `base-regression.test.ts`, `message-ids.test.ts` | covered; the Seafarers module is the first real module |
| R-SF setup | New Shores 3/4 maps against the SF25 p. 4/5 component tables (35/42 cells, terrain, discs, ports, islands, robber on the 12 / desert, pirate on the frame); 5–6 fixed small islands + B56 main-island inventory + 11 ports with the extra wool 2:1 (SF56-25 pp. 1, 4); 14 VP, 15 ships, B25/B56-25 bank and deck; starting settlements on the main island; coastal setup ship instead of the road (SF25 pp. 3–4) | `packages/rules/test/seafarers-layout.test.ts` (5), `seafarers-ships.test.ts` setup block (3) | covered |
| R-SF ships | ships on sea edges and the frame's inner edge, never on land–land edges; roads never on sea–sea edges; a ship links to own ships/buildings, never to a road; no ship past an opponent building; one piece per coastal edge; lumber + wool and 15 pieces; no new ship next to the pirate (SF25 p. 2, SF-FAQ 5/6/15/17) | `seafarers-ships.test.ts` placement block (7); `seafarers-clauses.test.ts`: separate road/ship supplies (3), no road or ship past an opponent building (2), distance rule across a strait (SF-FAQ 11) | covered |
| R-SF moves | one move per action window; not a ship built this turn; open end only; closed route between own buildings immovable, also when an opponent building interrupts it; branch ship movable; no move from/to the pirate's hex; target must satisfy placement after lifting; awards and victory judged on the final board only (SF25 p. 2, SF-FAQ 12–14) | `seafarers-ships.test.ts` moves block (8); `seafarers-clauses.test.ts`: no move before the roll, loop back to one building | covered; ship circles and loops are open fixtures (below) |
| R-SF pirate | 7/Knight choose robber (land) or pirate (sea hex or frame); pirate must change place; theft only from players with a ship on the hex, never a coastal settlement owner (SF25 pp. 2–3, SF-FAQ 4/7) | `seafarers-rules.test.ts` pirate block (4); `seafarers-clauses.test.ts`: Knight sends the pirate to the frame, no theft from own ships or an empty hand | covered |
| R-SF gold | settlement 1 / city 2 resources of choice, in turn order from the roller, supply shortage, robber blocks gold (SF25 p. 2, SF-FAQ 2) | `seafarers-rules.test.ts` gold block (4); `seafarers-clauses.test.ts`: a 7 gives no gold, supply empty at creation, queued frame on an empty supply, 5–6 turn order from the roller | covered; ordering is a deliberate interpretation |
| R-SF routes | Road Building with road + ship and with two ships; Longest Trade Route joins roads and ships only at an own building; opponent buildings interrupt; trails/cycles as for roads (SF25 pp. 2–3, SF-FAQ 1/16) | `seafarers-rules.test.ts` (5); `seafarers-clauses.test.ts`: Road Building before the roll with a ship, free ship not movable that turn, ship supply exhausted mid-effect, ship loop length, road and ship meeting at an opponent building | covered |
| R-SF islands / victory | +2 per player per small island (also when others settled first), grouped 5–6 islands count once, no bonus for setup; 14 VP on the own turn (SF25 p. 4, SF56-25 p. 4) | `seafarers-rules.test.ts` (5) | covered |
| R-SF paired | Player 2 builds and moves a ship in their own window, no domestic trade; Player 2 moves after Player 1 moved; not a ship built in their own window; Player 2 wins at 14 in their window; a Player 1 win ends the turn before Player 2 (SF56-25 pp. 2–3) | `seafarers-rules.test.ts` paired block (1), `seafarers-clauses.test.ts` (4) | covered |
| R-SF games / VIS | simulated 3/4/5/6-player games finish with a 14-point winner, conserve the supply and keep pieces legal; module projection public only, pirate theft private | `seafarers-sim.test.ts` (5), `seafarers-rules.test.ts` privacy (1), `packages/server/test/seafarers.test.ts` (2) | covered |
| R-SF client | ship actions, two-step ship move, pirate targets, gold picker, SVG ships/pirate/tokens, sea targets at the water plane, event text; browser run of a live game (setup ship, ship build, ship move, island bonus, pirate, gold) and the 3/4/6-player maps in SVG and 3D | `packages/web/test/seafarers.test.tsx` (7), `scripts/seafarers/capture.py`, [captures](screenshots/seafarers/README.md) | covered in headless Chromium; no human playtest |
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

### Seafarers interpretations and open fixtures

- **Frame cells.** Each New Shores outline is a full hexagonal block of
  cells, but the corner frame pieces at both ends of the middle row carry a
  hex-shaped bump; those two cells are frame, which reconciles the outlines
  with the printed component tables (37 → 35, 44 → 42, 58 → 56 hexes). The
  pirate is printed on the right-hand bump, so it starts on the frame
  (`board.pirate = null`).
- **Frame edges are sea for ships.** The topology's boundary edges are the
  frame's inner edge; SF-FAQ 15 allows ships there.
- **Robber on land only.** B25 says "a new hex"; with sea hexes on the board
  the robber is limited to terrain hexes and sea hexes move the pirate.
- **Pirate must move.** It goes to a different sea hex or to the frame; the
  frame is one place, so the pirate cannot "move" from the frame to the frame.
- **Gold shortage ordering.** SF25 gives none: gold is resolved after normal
  production, and entitled players choose one after another in turn order
  from the roller, each taking from the remaining supply; a player facing an
  empty supply receives nothing (`gold.chosen` reports the shortfall).
- **5–6 island outlines.** The SF56-25 map outlines `6`+`12` and `3`+`10`
  with the sea hex between them as one area each; the bonus treats each area
  as one small island, as SF25 p. 4 defines small islands by their outline.
  The VP token count agrees: SF56-25 supplies 48 tokens = 4 small islands × 6
  players × 2, just as SF25's 18 (3 players) and 24 (4 players) are 3 small
  islands × 3 or 4 players × 2.
- **5–6 main island.** Built with the engine's CATAN 5–6 variable procedure
  (shuffled terrain, shuffled number discs on the non-desert hexes, robber on
  the first desert), the same simplification as gap 3 for the base board; the
  B56-25 A–Z disc order is not modelled. Ports are shuffled over the 11
  marked positions. Because the discs are shuffled, the red 6 and 8 may land
  on adjacent hexes; SF25 p. 5 forbids that only for its own variable setup,
  and B56-25 avoids it through the A–Z spiral, which the engine does not use.
- **Open fixture — ship circles (SF25 p. 2 vs SF-FAQ 18).** SF25 defines an
  open end as one not next to an own ship or building; SF-FAQ 18 calls every
  ship of a building-less circle open and lets the end ships of a loop back to
  one building move. The engine follows SF25 (no ship of a circle or loop
  moves). `seafarers-ships.test.ts` pins the circle and
  `seafarers-clauses.test.ts` the loop back to one building (FAQ 18 special
  case 1); flipping them needs a confirmed 2025 clarification.
- **Roads and ships keep separate supplies.** 15 roads and 15 ships per
  player; a ship never uses up a road piece or the reverse, also for Road
  Building (`seafarers-clauses.test.ts`).
- **A queued gold frame on an empty supply.** When a gold frame activates
  behind another frame and the supply is already empty, every entitled player
  is skipped with `gold.chosen` reporting the shortfall, exactly as when the
  frame is created on an empty supply.

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
12. **Seafarers scope.** Only Heading for New Shores is implemented. The
    SF25 p. 5 variable setup for 3/4 players is not offered (fixed maps
    only); the 5–6 board is always variable as SF56-25 prescribes. No human
    playtest of the expansion has been run (U-07/U-08), and the gold field
    keeps the platform's generic gold tile art.
13. **Open base item: the Road Building grant is fixed at play time.** The
    card grants `min(2, placements available when played)`. When only one
    road (or ship) target exists at play time but placing it opens a second,
    the player still gets one free piece; B25 promises two. This is base
    behaviour since `base-2025.1` (PR #60 lists it as a follow-up), so
    changing it is a base rule change that needs the maintainer's approval
    and a new base rule version. Seafarers inherits it unchanged.
