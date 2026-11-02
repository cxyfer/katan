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
| CK25 | CATAN – Cities & Knights, CN3087, 2025 (`v6.250401`), sha256 `dac9f01a…c9a540` | event die, progress draws, production chart, commodities, walls, improvements, metropolises, knights, barbarian attack, 13 VP (pp. 2–11); progress decks (pp. 13–16) |
| CK56-25 | CATAN – Cities & Knights 5–6, CN3088, 2025 (`v6.250401`), sha256 `eab1b29e…36c9` | 18 extra commodities, paired turns (pp. 2–3) |
| CK-FAQ | catan.com/faq/cities-knights, accessed 2026-11-02, sha256 `47f50c96…3122` | clarifications compatible with CK25 only (affected player picks the pillaged city, displaced-knight retreat, promotion limits, progress shortage) |
| COMB | "Rules for Cities and Knights with the Seafarer Expansion", catan.com/seafarers (mirror on catan.com/cities-knights), accessed 2026-11-02, sha256 `8ce6618f…3c05d2`; with CK25 p. 12 "Combining with CATAN – Seafarers Expansion" | Heading for New Shores with Cities & Knights: 16 VP, knights on ships, pirate chase, pirate waits for the first attack, gold without commodities, no merchant on gold (clauses COMB-0…10 and CK12-0…6 quoted in [the P4 work record](aegis/work/2026-11-02-seafarers-cities-knights.md)) |

The rules are implemented from the specification's paraphrase and the
publisher's rulebooks. No official artwork or card text is copied.

## Enabled profiles

| Profile | Counts | Victory target | Status |
|---|---|---|---|
| `base-2025` | 3, 4 | 10 | **enabled** |
| `base-paired-2025` | 5, 6 | 10 | **enabled** |
| `sf-new-shores-2025` | 3, 4 | 14 | **enabled** (printed SF25 maps, fixed setup) |
| `sf-new-shores-paired-2025` | 5, 6 | 14 | **enabled** (SF56-25 map: fixed small islands, variable main island and ports) |
| `ck-2025` | 3, 4 | 13 | **enabled** (core rules, the 23 playable progress cards and the merchant; no bot seats) |
| `ck-paired-2025` | 5, 6 | 13 | **enabled** (as above, CK56-25 paired turns; no bot seats) |
| `sf-ck-new-shores-2025` | 3, 4 | 16 | **enabled** (SF25 maps with the CK25 setup and the COMB rules; human seats only) |
| `sf-ck-new-shores-paired-2025` | 5, 6 | 16 | **enabled** (SF56-25 map with both 5–6 rulebooks and COMB; human seats only) |

Every row of the §5.7 matrix is now enabled. A profile registered with
`enabled: false` carries an `unavailableReasonKey`; the lobby does not offer
it and the server rejects a modified client that requests it
(`resolveCombination` → `disabled`).

The registry separates two questions:

- `implemented` — the engine can execute the profile's rules. `createGame`
  requires this, so fixtures can exercise a profile before it is advertised.
- `enabled` — the lobby advertises it and the service accepts it.

`base-paired-2025` is enabled after the B56-25 fixture set verifies the 30-hex topology, 11 harbors, 24/resource bank, 34-card development deck, setup order, and paired turns. The Heading for New Shores profiles are enabled after the R-SF fixtures below pass, the maps are transcribed from the printed SF25/SF56-25 pages (method and per-cell data in [the work record](aegis/work/2026-11-01-seafarers.md) and `packages/rules/src/seafarers-boards.ts`) and a whole game is playable from the browser in both renderers (`scripts/seafarers/capture.py`). Cities & Knights is enabled after the R-CK fixtures below (including every progress-card fixture PC-* and VIS-PC1–5) pass, the card transcription is recorded page by page in [the work record](aegis/work/2026-11-02-cities-knights-progress.md), and a whole game is playable from the browser: both profiles are created through the lobby, and `scripts/cities-knights/progress.py` plays all 23 playable card types through the UI in the SVG and 3D renderers on desktop and phone ([captures](screenshots/cities-knights/README.md)). Bot seats stay refused: `@catan/bots` has no rule module for C&K (`BOT_RULE_MODULES` is unchanged), so `botSeats` is false for both profiles.

The combined Heading for New Shores profiles are enabled (P4, 2026-11-02) after the R-COMB fixtures below pass with a citation per clause, simulated 3/4/5/6-player games reach 16 points with every supply conserved, and the browser run `scripts/seafarers-cities-knights/capture.py` creates a room through the lobby and plays the combined interactions on the 3-, 4- and 6-player maps in SVG and 3D, desktop and phone ([captures](screenshots/seafarers-cities-knights/README.md)). Every combined command other than `knight.chasePirate` is the Seafarers or Cities & Knights command already reachable in both renderers; the chase is new and reached in both. Bot seats are refused (`E_INVALID_BOT`) as for the other expansions.

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
| R-CK dice / draws | setup settlement + city (city takes the start grant), no development cards or Largest Army, three dice with the event before production, city/settlement production chart, robber hex blocks commodities, commodity shortage, idle robber before the first attack, attack before a 7, gate draws in turn order, VP cards at once, empty decks, off-turn and on-turn hand limits, no play command, science level 3 | `packages/rules/test/ck-dice.test.ts` (R-CK-01…15) | covered |
| R-CK barbarians | strength (metropolis city once), defenders win with ties, defender VP, tied defenders draw (and discard off turn before production), no reward without a defender, weakest group loses a city and its wall, choice of city, metropolis immunity, next group, toppled city, reset and robber entry | `packages/rules/test/ck-barbarians.test.ts` (R-CK-16…25, 51) | covered |
| R-CK knights | recruit, action phase only, activate (cost, freshness), act/reactivate, promote (once per turn, politics 3, supply), move, displace and retreat or removal, chase the robber, knights block roads, sites and routes; an opponent knight closes an open road end like an opponent building (the base connectivity rule of #60), never for its owner | `packages/rules/test/ck-knights.test.ts` (R-CK-26…36) | covered |
| R-CK cities | walls (cost, limit, +2 hand limit), improvement costs and limits, trade level 3 rates, metropolis award/transfer/permanence and free-site rule, commodity theft, domestic commodity trade, 13 VP, paired Player 2 builds and supply trade without domestic trade, 18-per-type paired commodity bank, progress-hand privacy | `packages/rules/test/ck-cities.test.ts` (R-CK-37…50) | covered |
| R-CK games / VIS | simulated 3/4/5/6-player games finish with a 13-point winner; resources, commodities, the 54 progress cards and pieces are conserved; across seeds metropolises, walls, pillage and knight actions occur; every playable progress card is played in the simulated games; profiles implemented and enabled | `packages/rules/test/ck-sim.test.ts`, `packages/rules/test/profiles.test.ts` | covered |
| R-CK progress cards | see the card-by-card map below | `packages/rules/test/ck-progress-{science,trade,politics,privacy}.test.ts` | covered |
| R-CK service | test-only start of a C&K room, `ck-2025.1` engine, idempotent module receipts, catalogued rejection of development cards, private progress hands; the lobby offers both profiles and the room starts through it; bot seats refused | `packages/server/test/cities-knights.test.ts` | covered |
| R-CK client | knight/wall actions, two-step knight move, pillage/retreat board arming, SVG knights/walls/metropolises/toppled cities and idle robber, 3D models, prompts (progress discard, aqueduct, defender deck), panel (chart, buy, metropolis site), commodity discard, score points, every event in both locales, sound cues; progress hand (playable, unplayable with reason, direct / target / form plays), the Alchemy, Invention, Crane and Smithing forms, every responder prompt and its privacy, board intents, the merchant piece in SVG and 3D, card faces and strings in both locales | `packages/web/test/cities-knights.test.tsx`, `packages/web/test/cities-knights-progress.test.tsx`; browser runs `scripts/cities-knights/capture.py` and `scripts/cities-knights/progress.py` ([captures](screenshots/cities-knights/README.md)) | covered in headless Chromium; no human playtest |
| R-SF client | ship actions, two-step ship move, pirate targets, gold picker, SVG ships/pirate/tokens, sea targets at the water plane, event text; browser run of a live game (setup ship, ship build, ship move, island bonus, pirate, gold) and the 3/4/6-player maps in SVG and 3D | `packages/web/test/seafarers.test.tsx` (7), `scripts/seafarers/capture.py`, [captures](screenshots/seafarers/README.md) | covered in headless Chromium; no human playtest |
| R-COMB setup / victory | both combined profiles run `['seafarersCitiesKnights','seafarers','citiesKnights']`; 16 VP (COMB-7); the progress decks replace the development cards; 15 roads and 15 ships, 6 knights, 3 walls, 12/18 commodities and 19/24 resources per kind; settlement then city on the main island, the city takes one card per terrain (CK25 pp. 3, 5; SF25 pp. 2–5) | `packages/rules/test/sfck-clauses.test.ts` (SFCK-P1…P3) | covered |
| R-COMB gold / merchant | a city at gold takes resources only (COMB-8); gold counts as production for the aqueduct and its choice precedes the bonus (SFCK-5); the merchant never stands on gold (COMB-9, CK12-4) | `sfck-clauses.test.ts` (COMB-8, SFCK-5 ×2, COMB-9) | covered |
| R-COMB bandits | before the first attack a 7 moves neither bandit and discards still apply; nothing moves the pirate before then; the printed robber hex produces until the attack places the robber; afterwards a 7 moves the robber or the pirate (COMB-10, CK12-2, SFCK-7) | `sfck-clauses.test.ts` (COMB-10 ×3, SFCK-7 ×2) | covered |
| R-COMB chases | a robber chase moves the robber only; an active knight next to the pirate's sea hex chases the pirate (also to the frame), which robs as usual; a knight on a coastal intersection of that hex qualifies; the chase needs a knight that can act; Taxation moves the robber only (CK25 pp. 9–10, COMB-6, CK12-7/8, CK-FAQ 63, SFCK-4/8) | `sfck-clauses.test.ts` (SFCK-4, COMB-6 ×3, SFCK-8, CK-FAQ 63) | covered |
| R-COMB knights on routes | a knight crosses the sea along own ships and may end between three sea hexes; roads and ships join only at an own building or the knight's start; recruiting stays on land; a displaced knight retreats along ships; Intrigue reaches a knight touching an own ship (COMB-0/2/3, CK12-5, SFCK-1/2) | `sfck-clauses.test.ts` (COMB-2, SFCK-1, SFCK-2, CK12-5, COMB-0) | covered |
| R-COMB knights and ships | an opponent knight splits the Longest Trade Route and pins both ships; no ship past an opponent knight; an own knight at the last ship closes the route; Diplomacy removes an open ship and the owner re-places it as a ship that counts as built this turn; knight-held ships report `E_SHIP_PINNED_BY_KNIGHT`, building-closed routes `E_SHIP_NOT_MOVABLE`; Road Building places ships (COMB-4/5, CK12-6/9, SF-FAQ 18, CK-FAQ 64–66, SFCK-3/6) | `sfck-clauses.test.ts` (COMB-5 ×2, COMB-4, CK-FAQ 64–66, COMB-0) | covered |
| R-COMB barbarians / score / hooks | every city on every island counts, knights at sea defend (COMB-1, CK12-3); the score adds island bonus, metropolis, defender, merchant and Longest Trade Route (COMB-7); overlapping `allowBuilding`, `bankRate` and `discardLimit` compose | `sfck-clauses.test.ts` (COMB-1, COMB-7, 3 overlap cases) | covered |
| R-COMB paired | Player 2 moves a ship, plays progress cards, trades with the supply only, has no Alchemy, and may chase the pirate (SF56-25 pp. 2–3, CK56-25 pp. 3–4) | `sfck-clauses.test.ts` paired block (2) | covered |
| R-COMB games / VIS | simulated 3/4/5/6-player games reach 16 points and conserve resources, commodities, the 54 progress cards, buildings, knights, 15 roads and 15 ships, every knight touching an own road or ship; across the four games gold, ship moves, the pirate, its chase, the merchant and island bonuses occur; pirate theft private, progress hands hidden, gold public | `packages/rules/test/sfck-sim.test.ts` (5), `sfck-clauses.test.ts` (VIS-COMB1/2) | covered |
| R-COMB service | lobby offers and resolves both profiles (either expansion order), bot seats refused; a game starts on `sf-ck-2025.1` with 16 VP and both bandits waiting; setup over the API; idempotent receipts; a catalogued, durable `E_PIRATE_INACTIVE`; private progress hands | `packages/server/test/seafarers-cities-knights.test.ts` (2), `rooms.test.ts`, `session.test.ts`, `packages/rules/test/profiles.test.ts` | covered |
| R-COMB client | pirate chase action and board arming, bandit targets narrowed to the chased bandit (prompt and selection name it), knight on a sea intersection in SVG and on the ship deck in 3D, pirate status in the C&K panel, score marks together, events and errors in both locales; browser run of a lobby-created game with the chase in SVG and 3D on desktop and phone (3, 4 and 6 players) | `packages/web/test/seafarers-cities-knights.test.tsx` (8), `scripts/seafarers-cities-knights/capture.py`, [captures](screenshots/seafarers-cities-knights/README.md) | covered in headless Chromium; no human playtest |
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

### Cities & Knights interpretations and open fixtures

- **Barbarian strength (CK25 p. 11 vs CK-FAQ).** The FAQ writes b = s + m
  (cities plus metropolises); CK25 counts cities "including metropolis
  cities" and its worked example counts a metropolis city once. The engine
  follows CK25 (R-CK-16). CK25 p. 8 also says "each metropolis on the board
  adds to the barbarians' strength"; this **resolved** as the metropolis city
  being counted as a city, not as an extra point. The p. 11 example figure
  shows blue 2 cities + 1 basic knight, red 2 cities + 1 basic knight, white
  1 city carrying the green metropolis, and orange no city + 1 strong knight:
  5 cities in all, matching the caption "total strength is 5 (5 cities)". An
  extra +1 per metropolis would give 6. The engine is correct as is.
- **Tied loss pillages only who can lose a city.** When the weakest group is
  tied, only players who have a city that can be pillaged lose one; a player
  with only settlements, or whose city is a protected metropolis, is skipped
  (R-CK-22, R-CK-23).
- **Promoting is once per knight per turn.** A knight promoted in this window
  cannot be promoted again until the next one (R-CK-30; `E_KNIGHT_PROMOTED`).
- **Event die faces are a source gap.** CK25 shows the die but does not list
  its faces; the engine uses the C&K component die (three ship faces, one
  city gate per track) and records each roll in the snapshot.
- **No reward without a defender.** When the defenders hold but no player
  contributed an active knight (only possible with no city on the board), no
  Defender of Catan is named and nobody draws (R-CK-19).
- **Metropolis site check.** A level-4/5 purchase needs a free own city only
  when it would award the metropolis; a later level 4 that awards nothing is
  allowed without one (R-CK-43).
- **Draws before discards.** On a city gate all entitled players draw in turn
  order from the roller first; off-turn players then discard down to four
  before production continues (R-CK-12, R-CK-51).
- **Hand limit for 5–6.** CK56-25 does not change the progress hand limit, so
  it stays at 4 (the roadmap draft assumed 5).
- **Aqueduct.** "Receives no cards" includes commodities; it does not apply on
  a 7, and later players facing an empty supply are skipped (R-CK-15).
- **Merchant piece.** CK25 p. 7 mentions the merchant's VP; the piece enters
  only through the Merchant progress card (P3, below).

#### Progress cards and the merchant (P3)

Card text is paraphrased from CK25 pp. 6–7 and 10–16 (names follow CK25;
the older FAQ names Bishop, Deserter and Diplomat map to Taxation, Treason and
Diplomacy). Page numbers, FAQ entries used and unused are in
[the work record](aegis/work/2026-11-02-cities-knights-progress.md). The
fixtures are in `packages/rules/test/ck-progress-science.test.ts` (science),
`-trade.test.ts` (trade), `-politics.test.ts` (politics, timing) and
`-privacy.test.ts` (VIS-PC); the 3/4/5/6-player simulated games play every
card type (`ck-sim.test.ts`).

| Deck | Card (copies) | Fixtures |
|---|---|---|
| Science | Alchemy (2) | PC-AL1 dice and event die, PC-AL2 red die drives the draws, PC-AL3 timing and validation, PC-AL4 no Alchemy for paired player 2 |
| Science | Crane (2) | PC-CR1 one commodity less, PC-CR2 refusals, PC-CR3 metropolis |
| Science | Engineering (1) | PC-EN1, PC-EN2 |
| Science | Invention (2) | PC-IN1 swap, PC-IN2 forbidden numbers |
| Science | Irrigation (2), Mining (2) | PC-IR1, PC-MI1 |
| Science | Medicine (2) | PC-ME1, PC-ME2 |
| Science | Road Building (2) | PC-RB1, PC-RB2 |
| Science | Smithing (2) | PC-SM1, PC-SM2 |
| Science | Printing (1) | VIS-PC1 / `ck-dice` (revealed when drawn, off turn too, outside the hand limit) |
| Trade | Commercial Harbor (2) | PC-CH1, PC-CH2, VIS-PC4 |
| Trade | Guild Dues (2) | PC-GD1, PC-GD2, VIS-PC3 |
| Trade | Merchant (6) | PC-MC1 placement, rate and VP, PC-MC2 control and robber, PC-MC3 desert and victory |
| Trade | Merchant Fleet (2) | PC-MF1 |
| Trade | Resource Monopoly (4), Trade Monopoly (2) | PC-RM1, PC-RM2, PC-TM1 |
| Politics | Constitution (1) | VIS-PC1 / `ck-dice` (as Printing) |
| Politics | Diplomacy (2) | PC-DI1 opponent road, PC-DI2 open roads, PC-DI3 own road rebuilt |
| Politics | Encouragement (2) | PC-EC1 |
| Politics | Espionage (3) | PC-ES1, PC-ES2, PC-ES3, VIS-PC2 |
| Politics | Intrigue (2) | PC-IT1, PC-IT2 |
| Politics | Sabotage (2) | PC-SA1, PC-SA2, VIS-PC5 |
| Politics | Taxation (2) | PC-TX1 after the first attack, PC-TX2 steal, PC-TX3 empty hex |
| Politics | Treason (2) | PC-TR1, PC-TR2 |
| Politics | Wedding (2) | PC-WE1, PC-WE2, VIS-PC5 |
| Timing (all) | – | PC-TI1 own action phase with nothing pending, PC-TI2 paired player 2, PC-TI3 a card drawn this turn |

Interpretations P3-1…P3-9 (targets needed only where the effect names one;
forced answers without a prompt; Commercial Harbor as a turn-long ability;
paired player 2 and Commercial Harbor; any land hex for the merchant; Irrigation
and Mining not production; Encouragement does not let the knight act; Diplomacy
rebuild optional; public scores for Guild Dues, Sabotage and Wedding) are
recorded in the work record. Two further client-side choices:

- **Hand shows every held card.** The hand lists each held kind with a reason
  when it cannot be played now (`not-your-turn`, `pending`, `before-roll`,
  `after-roll`, `no-target`, `cost`, `robber-inactive`, `alchemy-set`). The
  server's `hints` are advisory; the engine re-checks every play.
- **Card faces are original.** Each card has a track-coloured face with an
  original emblem drawn by `SvgProgressArt.tsx`; the effect text is a
  paraphrase in both locales and no official artwork or wording is used.

Interpretations and accepted disclosures for the progress cards:

- **5–6 player 2 and Commercial Harbor (P3-4, open interpretation).** CK56-25
  p. 3 says the paired Player 2 may not trade with other players, yet player 2
  may play Commercial Harbor (CK25 p. 14), whose offers exchange a resource
  for a commodity with other players. The engine treats the card as an
  effect, not as a trade, and allows it; a stricter reading would forbid it
  for player 2. No printed clause settles it, so this stays open.
- **Commercial Harbor discloses commodity information (accepted).**
  `ck.harborReturned` and `ck.harborExchanged`, and whether the answer frame
  appears at all, reveal what the offered player holds (no commodity, one
  kind, several kinds). This is accepted because it mirrors table talk, where
  the offer and the reply are spoken aloud (CK25 p. 14); the resource and the
  commodity given back are visible only to the two players.
- **Encouragement and knights (interpretation).** Knights activated by
  Encouragement (CK25 p. 15) cannot act on the turn they were activated. The
  card says to activate all knights; CK25 p. 9 says an activated knight cannot
  act in the turn it was activated, so the card is read as the Activate action
  without the cost (P3-7). The pages do not say it outright.
- **5–6 discard timing (interpretation).** During Player 1's roll in a paired
  game, Player 2 is not on turn for that roll, so a Player 2 above four
  progress cards discards at once as an off-turn player (CK25 p. 6), before
  production. CK56-25 does not say whether Player 2 counts as on turn during
  Player 1's part.

Open fixtures for the progress cards:

- No scripted multi-client browser run of the paired (5–6) responder prompts;
  paired turns are covered at engine level (PC-TI2, PC-AL4) and in simulation.
- Diplomacy on ships, Knight/pirate card interactions and the SF + C&K
  combinations are P4 (R-COMB).
- Sound cues, card faces and prompts have jsdom and headless-Chromium evidence
  only; no screen-reader, touch-device or human playtest.

### Seafarers + Cities & Knights interpretations and open fixtures

The COMB clauses and CK25 p. 12 (CK12-0…10 in the work record) agree
wherever they overlap except for the pirate chase's wording (SFCK-8); the
points below are what they leave open.

- **SFCK-1 Road/ship junctions for knights.** A knight's move follows own
  roads and ships, and a road continues a ship only at an own building, as
  for the Longest Trade Route (SF25 p. 2), or at the vertex where the knight
  starts (COMB-2 "via roads and ships").
- **SFCK-2 Recruiting stays on land.** COMB-3 lets an active knight *move*
  onto an intersection of three sea hexes; it says nothing about recruiting,
  so recruiting (and Treason's placement) needs a vertex touching land. A
  coastal vertex touching an own ship is fine.
- **SFCK-3 Knights close and pin ships.** COMB-4 makes a knight at the last
  ship close that route for its owner, and COMB-5 pins the ships bordering an
  opponent's knight; together with CK12-6 no ship move may leave any knight
  without its route (`shipMoveBlocked`).
- **SFCK-4 One bandit per chase.** CK25 has a knight chase the robber; COMB-6
  adds the pirate as a separate action. A robber chase therefore moves only
  the robber and a pirate chase only the pirate (to a sea hex or the frame);
  a 7 after the first attack still offers both (SF25 p. 2).
- **SFCK-5 Gold is production.** A player who takes gold received cards on
  that roll, so the science level-3 aqueduct does not apply; the gold frame
  is queued before the aqueduct frame. A gold field under the robber yields
  nothing, so the aqueduct then applies.
- **SFCK-6 Diplomacy and ships.** CK-FAQ 64–66: Diplomacy may remove an open
  ship; when the player removes their own ship, they re-place it as a ship
  (CK25 p. 12: "you may only then build a new ship"). The re-placed ship is
  built, so it counts as built this turn and may not move until the next
  turn (SF25 p. 2; `E_SHIP_BUILT_THIS_TURN`). C&K reports the placement
  through `kit.shipPlaced`; Seafarers records it. (Until the #81 review the
  re-placed ship could move again in the same turn.)
- **SFCK-7 Bandit start.** Both bandits start off the board (robber `-1`,
  pirate on the frame) and the printed robber hex produces until the first
  attack; that attack puts the robber on the scenario's robber hex, while the
  pirate stays on the frame until a 7 or a chase moves it (COMB-10, CK12-2).
- **SFCK-8 Who may chase the pirate.** COMB-6 (catan.com/seafarers): "If you
  deactivate an active knight adjacent to the sea hex occupied by the pirate,
  you may move the pirate." CK25 p. 12: "Knights on a sea hex intersection
  may chase away the pirate just like knights on land chase away the robber."
  The engine follows COMB-6, the clause written for the combination: any of
  the six intersections of the pirate's hex qualifies, including a coastal
  one that also touches land. Read with CK25's analogy, those intersections
  are on a sea hex too, so the two agree for every vertex the engine accepts;
  CK25 alone could be read more narrowly as all-sea intersections only.
- **Knight-held ships report their own error.** A ship that is open but held
  by a knight (COMB-4/5, SFCK-3) is refused with `E_SHIP_PINNED_BY_KNIGHT`;
  a route closed by buildings keeps the Seafarers `E_SHIP_NOT_MOVABLE`.

Open fixtures: every COMB-0…10 and CK12-1…10 clause has a fixture above.
Not covered: Through the Desert, which COMB also lists as suitable, is not
implemented, so no other scenario is combined with C&K; bots cannot take a
combined seat; and no human has played a whole combined game (the browser
run drives the other seats through the API).

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
   transcribed and verified. Heading for New Shores, Cities & Knights and the combined New Shores profiles (P4, after their R-COMB fixtures) are enabled. The 5-player
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
14. **Cities & Knights scope.** The core rules and all 54 progress cards
    (23 playable types plus the two scored when drawn) and the merchant are
    implemented and the profiles are enabled. Bot seats are refused (no
    `@catan/bots` rule module). Browser evidence is Chromium with software
    WebGL; the lobby creates the rooms, the fixtures that put particular
    cards in hands are written into a private SQLite file while the service is
    stopped. No human playtest (U-07/U-08).
15. **Seafarers + Cities & Knights scope.** Only Heading for New Shores is
    combined, with human seats only. Browser evidence is headless Chromium
    with software WebGL; other seats and filler turns are driven through the
    API, and the score-breakdown and knight positions are test-only fixtures
    written while the service is stopped. No human playtest (U-07/U-08).
