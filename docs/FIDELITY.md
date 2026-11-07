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
| EP25 | CATAN – Explorers & Pirates, CN3085, 2025 rulebook (`v6.251001`), sha256 `3b337981…bc308dba` | turn phases, coins, harbour settlements, ships, cargo, movement, exploring, pirate ships, tribute, chase, lairs, fish, spices, victory (pp. 2–15) |
| EP25-M | CATAN – Explorers & Pirates, CN3085, 2025 Mission Guide (`v6.251001`), sha256 `6414208f…52f746` | scenario list and targets, kept components, common setup, the four mission maps and their setups (pp. 2–18) |
| CK25 | CATAN – Cities & Knights, CN3087, 2025 (`v6.250401`), sha256 `dac9f01a…c9a540` | event die, progress draws, production chart, commodities, walls, improvements, metropolises, knights, barbarian attack, 13 VP (pp. 2–11); progress decks (pp. 13–16) |
| CK56-25 | CATAN – Cities & Knights 5–6, CN3088, 2025 (`v6.250401`), sha256 `eab1b29e…36c9` | 18 extra commodities, paired turns (pp. 2–3) |
| CK-FAQ | catan.com/faq/cities-knights, accessed 2026-11-02, sha256 `47f50c96…3122` | clarifications compatible with CK25 only (affected player picks the pillaged city, displaced-knight retreat, promotion limits, progress shortage) |
| COMB | "Rules for Cities and Knights with the Seafarer Expansion", catan.com/seafarers (mirror on catan.com/cities-knights), accessed 2026-11-02, sha256 `8ce6618f…3c05d2`; with CK25 p. 12 "Combining with CATAN – Seafarers Expansion" | Heading for New Shores with Cities & Knights: 16 VP, knights on ships, pirate chase, pirate waits for the first attack, gold without commodities, no merchant on gold (clauses COMB-0…10 and CK12-0…6 quoted in [the P4 work record](aegis/work/2026-11-02-seafarers-cities-knights.md)) |
| TB25 | CATAN – Traders & Barbarians, CN3089, 2025 (`v6.250701`) | variants and five scenarios on the base board, 3–4 players (see [Traders & Barbarians](#traders--barbarians-tb25)) |

The rules are implemented from the specification's paraphrase and the
publisher's rulebooks. No official artwork or card text is copied.

## Enabled profiles

| Profile | Counts | Victory target | Status |
|---|---|---|---|
| `base-2025` | 3, 4 | 10 | **enabled** |
| `base-paired-2025` | 5, 6 | 10 | **enabled** |
| `sf-new-shores-2025` | 3, 4 | 14 | **enabled** (printed SF25 maps, fixed setup; easy and standard bot seats) |
| `sf-new-shores-paired-2025` | 5, 6 | 14 | **enabled** (SF56-25 map: fixed small islands, variable main island and ports; easy and standard bot seats) |
| `ep-land-ho-2025` | 3, 4 | 8 | **enabled** (EP25-M Land Ho! printed start) |
| `ep-pirate-lairs-2025` | 3, 4 | 12 | **enabled** (EP25-M Pirate Lairs printed start) |
| `ep-fish-2025` | 3, 4 | 15 | **enabled** (EP25-M Fish for Catan map, variable setup) |
| `ep-spices-2025` | 3, 4 | 15 | **enabled** (EP25-M Spices for Catan map, variable setup) |
| `ep-full-2025` | 3, 4 | 17 | **enabled** (EP25 full map, variable setup) |
| `ck-2025` | 3, 4 | 13 | **enabled** (core rules, the 23 playable progress cards and the merchant; no bot seats) |
| `ck-paired-2025` | 5, 6 | 13 | **enabled** (as above, CK56-25 paired turns; no bot seats) |
| `sf-ck-new-shores-2025` | 3, 4 | 16 | **enabled** (SF25 maps with the CK25 setup and the COMB rules; human seats only) |
| `sf-ck-new-shores-paired-2025` | 5, 6 | 16 | **enabled** (SF56-25 map with both 5–6 rulebooks and COMB; human seats only) |
| `tb-friendly-robber-2025` | 3, 4 | 10 | **enabled** |
| `tb-harbors-2025` | 3, 4 | 11 | **enabled** |
| `tb-friendly-robber-harbors-2025` | 3, 4 | 11 | **enabled** |
| `tb-fishing-2025` | 3, 4 | 10 (11 with the old boot) | **enabled** |
| `tb-rivers-2025` | 3, 4 | 10 | **enabled** |
| `tb-merchant-trains-2025` | 3, 4 | 12 | **enabled** |
| `tb-barbarian-attack-2025` | 3, 4 | 12 | **enabled** |
| `tb-traders-barbarians-2025` | 3, 4 | 13 | **enabled** |

Every row of the §5.7 matrix is now enabled. A profile registered with
`enabled: false` carries an `unavailableReasonKey`; the lobby does not offer
it and the server rejects a modified client that requests it
(`resolveCombination` → `disabled`).

The registry separates two questions:

- `implemented` — the engine can execute the profile's rules. `createGame`
  requires this, so fixtures can exercise a profile before it is advertised.
- `enabled` — the lobby advertises it and the service accepts it.

`base-paired-2025` is enabled after the B56-25 fixture set verifies the 30-hex topology, 11 harbors, 24/resource bank, 34-card development deck, setup order, and paired turns. The Heading for New Shores profiles are enabled after the R-SF fixtures below pass, the maps are transcribed from the printed SF25/SF56-25 pages (method and per-cell data in [the work record](aegis/work/2026-11-01-seafarers.md) and `packages/rules/src/seafarers-boards.ts`) and a whole game is playable from the browser in both renderers (`scripts/seafarers/capture.py`). Their easy and standard bot seats are offered after the bot gates pass: bot-only games with mixed levels finish with a winner at 3, 4, 5 and 6 players with no rejected or idle command (Q1); over 10 seeds the strategies build and move ships, settle islands and answer gold (Q2); and the service tests cover a whole HTTP game, a fallback answer, a gold frame shared by a person and bots, and a restart during that frame (R-SF bots below). Cities & Knights is enabled after the R-CK fixtures below (including every progress-card fixture PC-* and VIS-PC1–5) pass, the card transcription is recorded page by page in [the work record](aegis/work/2026-11-02-cities-knights-progress.md), and a whole game is playable from the browser: both profiles are created through the lobby, and `scripts/cities-knights/progress.py` plays all 23 playable card types through the UI in the SVG and 3D renderers on desktop and phone ([captures](screenshots/cities-knights/README.md)). Bot seats stay refused: `@catan/bots` has no bot module for C&K, so `botsCanPlay` rejects both profiles and `botSeats` is false.

The combined Heading for New Shores profiles are enabled (P4, 2026-11-02) after the R-COMB fixtures below pass with a citation per clause, simulated 3/4/5/6-player games reach 16 points with every supply conserved, and the browser run `scripts/seafarers-cities-knights/capture.py` creates a room through the lobby and plays the combined interactions on the 3-, 4- and 6-player maps in SVG and 3D, desktop and phone ([captures](screenshots/seafarers-cities-knights/README.md)). Every combined command other than `knight.chasePirate` is the Seafarers or Cities & Knights command already reachable in both renderers; the chase is new and reached in both. Bot seats are refused (`E_INVALID_BOT`) as for every expansion except New Shores.
The five Explorers & Pirates profiles are enabled one per mission set, in book order, after the R-EP fixtures below pass, the maps are transcribed from EP25/EP25-M (method, per-cell data and interpretations in [the work record](aegis/work/2026-11-02-explorers-pirates.md) and `packages/rules/src/explorers-pirates-boards.ts`) and each mission is played to its result in the browser with every command in play made through the UI in one renderer and reached in the other (`scripts/explorers-pirates/capture.py`, [captures](screenshots/explorers-pirates/README.md)). Explorers & Pirates is never combined with Seafarers; bots refuse E&P rooms.

Registry v2 (2026-11-01 expansion platform) adds per-profile `expansions`,
`scenario`, `variants`, `ruleVersion`, `sources` and display-only
`requiredBoxes`. Both base profiles use `ruleVersion` `base-2025.4`, and new
Seafarers and Traders & Barbarians games use `sf-2025.2` and `tb-2025.2` for
the Road Building grant fix. Existing games keep their recorded versions and
are not migrated. The five Explorers & Pirates profiles use `ep-2025.2` for
the #97 stranded-ship fix; unfinished `ep-2025.1` games run it too, under the
approved defect-fix exception (SPEC §7.3). The platform adds no rule: base topology indices and
fixed/variable layouts retain their baseline pins, while fresh snapshots and
six whole simulated base/paired games are pinned against the active
`base-2025.4` engine in `packages/rules/test/base-regression.test.ts`.

## Fixture → evidence map

| Fixture | Contract | Automated evidence | Status |
|---|---|---|---|
| R-B01 | setup order, distance rule, coastal vertices, no duplicate occupancy, one starting grant, city upgrade returns the settlement | `packages/rules/test/setup.test.ts` (9 cases) | covered |
| R-B02 | two independent dice, settlement 1 / city 2, finite supply, robber block, bank shortage rule | `packages/rules/test/production.test.ts` (10 cases), `packages/rules/test/costs.test.ts` (spent cards return to the bank) | covered |
| R-B03 | 7 → half rounded down, multi-responder discards, no trade before resolution, empty victim, no multiplied theft, desert, knight does not trigger discards | `packages/rules/test/seven.test.ts` (10 cases) | covered |
| R-B04 | domestic exchange legality, bank 4:1/3:1/2:1, stale/expired offers, consent, revision invalidates consent, one settlement | `packages/rules/test/trade.test.ts` (13 cases) | covered |
| R-B05 | cannot play a card the turn it is bought, one per turn, pre-roll knight, monopoly / year of plenty / road building, VP card victory, empty deck | `packages/rules/test/devcards.test.ts` (11 cases), `packages/rules/test/rule-gaps.test.ts` (older card after a same-type purchase; Road Building grants both roads when the first opens a second edge, has no grant without a legal edge, ends early when no edge remains, and is capped by road pieces; Year of Plenty capped by the bank) | covered |
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
| R-EP layout | 50/57/57/64/71 cells per mission map, parrot/goose regions, number discs and targets per mission, printed starting-island terrain (Land Ho!, Pirate Lairs) or the 14 CATAN hexes, region inventories against the hex tables, 14 harbour marks for variable setup, printed start pieces per colour, 2 gold (EP25 pp. 3, 6–7; EP25-M pp. 4, 8, 14, 16) | `packages/rules/test/ep-layout.test.ts` (11) | covered |
| R-EP turn / trade | production 1 per building, 1 gold for a player who received nothing; a 7 in Land Ho! is discards only; 3:1, 3 → 1 gold, 2 gold → 1 resource twice; coins in player trades; no building or trading in the Movement phase (EP25 pp. 8–9, EP25-M pp. 3, 5) | `ep-rules.test.ts` R-EP-01…04; `ep-clauses.test.ts` R-EP-49, R-EP-50 | covered |
| R-EP building | harbour settlement on an own coastal settlement (+1 VP, max 4); ship next to an own harbour, never on an unexplored hex's edge, replacing one when none is left; settlers and crews onto an empty slot, with a piece returned when every slot is full; no road or settlement touching an unexplored hex (EP25 pp. 9–10) | R-EP-05…07; `ep-clauses.test.ts` R-EP-25…28, R-EP-48, R-EP-51 | covered |
| R-EP movement / exploring | 4 MP, 6 with 1 wool; two ships per edge, passing but not stopping on a full edge, and a full edge only when a legal stop is still reachable with the MP the ship has; a stranded ship with no way out ends its movement there (interpretation 15); exploring flips the hex from its region's remaining inventory, pays 1 resource or 2 gold and ends that ship's move; land draws its disc; a settler ship founds a settlement and returns; victory on the own turn (EP25 pp. 10–12, 15) | R-EP-08…13; R-EP-29…35, R-EP-46, R-EP-57; `ep-strand.test.ts` (#97, every profile) | covered; stranded-ship rule is interpretation 15 |
| R-EP setup | variable setup: harbour on a mark, settlement on the starting island, then road and settler ship in snake order, starting resources from the settlement (EP25 p. 7, EP25-M p. 9) | R-EP-14 | covered |
| R-EP pirates | a 7 activates the roller's pirate ship (not next to the starting island, frame or Council), theft from a ship owner, gold from an empty hand; tribute once per ship per turn; chase on a 6 by an unmoved ship (EP25 pp. 8, 10–11; EP25-M pp. 9–10) | R-EP-15…18; R-EP-36…38, R-EP-47, R-EP-58 | covered |
| R-EP missions | lair capture by 3 crews (gold and track for each, hero roll-off, token sets the number); tracks with printed values and the bonus tile; fish roll, hauls, Council delivery, pirate scares a haul; spice farm crew, ability and one sack per player (EP25 pp. 13–14) | R-EP-19…24; R-EP-39…45, R-EP-52…56 | covered; lair numbers provisional (see below) |
| R-EP games / VIS | 10 simulated games (5 missions × 3/4 players) reach the target and conserve 19 per resource, 148 coins and 6 hauls; pieces within limits; projection public only (fog is public, unexplored contents are drawn at reveal), the pirate's stolen card private; each reveal pool equals the printed region list minus the draws named in public events (the view shows counts only); every draw is stored in the snapshot and its event, and a restored game draws nothing again; no event names a hex's identity before its `ep.explored`; receipts idempotent through the service; bots refused | `ep-sim.test.ts` (10), `ep-privacy.test.ts` (12), `packages/server/test/explorers-pirates.test.ts` (5: also fog, pools and a pirate frame across a restart, and a stranded `ep-2025.1` save rescued across restarts) | covered |
| R-EP client | E&P build actions, prompt (setup, pirate victim, coins, settler/crew holders, ship rebuild, extra move, per-ship Movement actions), ship moves carrying the ship id, fog, ships with cargo, harbours, sites and the pirate in SVG and 3D, setup labels, help, cues; browser run of every mission to its result (`report.json` lists the commands executed and reached per renderer) | `packages/web/test/explorers-pirates.test.tsx` (10), `scripts/explorers-pirates/capture.py` | covered in headless Chromium; no human playtest |
| R-SF routes | Road Building with road + ship and with two ships; in `sf-2025.2`, a legal ship target grants up to two remaining ships even when the first ship opens the second target, while `sf-2025.1` keeps the single-target grant; mixed routes and one remaining ship are capped, and pending snapshots use the same versioned capacity; Longest Trade Route joins roads and ships only at an own building; opponent buildings interrupt; trails/cycles as for roads (SF25 pp. 2–3, SF-FAQ 1/16) | `seafarers-rules.test.ts` (5); `seafarers-clauses.test.ts`: standalone ship grant across `sf-2025.1`/`.2`, mixed road + ship, one ship remaining, Road Building before the roll, free ship not movable that turn, ship supply exhausted mid-effect, ship loop length, road and ship meeting at an opponent building | covered |
| R-SF islands / victory | +2 per player per small island (also when others settled first), grouped 5–6 islands count once, no bonus for setup; 14 VP on the own turn (SF25 p. 4, SF56-25 p. 4) | `seafarers-rules.test.ts` (5) | covered |
| R-SF paired | Player 2 builds and moves a ship in their own window, no domestic trade; Player 2 moves after Player 1 moved; not a ship built in their own window; Player 2 wins at 14 in their window; a Player 1 win ends the turn before Player 2 (SF56-25 pp. 2–3) | `seafarers-rules.test.ts` paired block (1), `seafarers-clauses.test.ts` (4) | covered |
| R-SF games / VIS | simulated 3/4/5/6-player games finish with a 14-point winner, conserve the supply and keep pieces legal; module projection public only, pirate theft private | `seafarers-sim.test.ts` (5), `seafarers-rules.test.ts` privacy (1), `packages/server/test/seafarers.test.ts` (2) | covered |
| R-SF bots | easy and standard bots on both New Shores profiles. The strategies cover:<br>• building and moving ships, and setup ships;<br>• island settlements and the +2 bonus;<br>• gold answered in turn order;<br>• robber or pirate;<br>• the paired Player 2 window.<br>Fallbacks answer every Seafarers frame. In bot-only games with mixed levels, 3–6 players finish with a winner, with no rejected command, stall or idle duty, a conserved supply and at most 15 roads and 15 ships each (Q1). Over 10 seeds the release gate counts paid ships, island bonuses, gold answered by the strategy, and ship moves (Q2) | `packages/bots/test/sf-sea.test.ts`, `sf-duty.test.ts`, `sf-decisions.test.ts`, `sf-frames.test.ts`, `sf-game.test.ts`, `sf-fair.test.ts`, `sf-fuzz.test.ts`, `sf-fallback.test.ts`; `packages/server/test/seafarers-bots.test.ts`:<br>• a whole HTTP game;<br>• the fallback answering gold;<br>• a gold frame shared by a person and bots;<br>• a restart during a gold frame | covered; strategy strength is benchmarked (Q3), not gated |
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
| R-COMB bandits | before the first attack a 7 moves neither bandit and discards still apply; nothing moves the pirate before then; the printed robber hex produces until the attack places the robber; afterwards a 7 moves the robber or the pirate (COMB-10, CK12-2, SFCK-7); both steal resources and commodities, including commodity-only hands, with card-count weighting, private outcomes and no redraw after snapshot restore (SF25 p. 2, CK25 p. 7, CK-FAQ 34) | `sfck-clauses.test.ts` (COMB-10 ×3, SFCK-7 ×2, pirate/robber theft ×14) | covered |
| R-COMB chases | a robber chase moves the robber only; an active knight next to the pirate's sea hex chases the pirate (also to the frame), which robs as usual; a knight on a coastal intersection of that hex qualifies; the chase needs a knight that can act; Taxation moves the robber only (CK25 pp. 9–10, COMB-6, CK12-7/8, CK-FAQ 63, SFCK-4/8) | `sfck-clauses.test.ts` (SFCK-4, COMB-6 ×3, SFCK-8, CK-FAQ 63) | covered |
| R-COMB knights on routes | a knight crosses the sea along own ships and may end between three sea hexes; roads and ships join only at an own building or the knight's start; recruiting stays on land; a displaced knight retreats along ships; Intrigue reaches a knight touching an own ship (COMB-0/2/3, CK12-5, SFCK-1/2) | `sfck-clauses.test.ts` (COMB-2, SFCK-1, SFCK-2, CK12-5, COMB-0) | covered |
| R-COMB knights and ships | an opponent knight splits the Longest Trade Route and pins both ships; no ship past an opponent knight; an own knight at the last ship closes the route; Diplomacy removes an open ship and the owner re-places it as a ship that counts as built this turn; knight-held ships report `E_SHIP_PINNED_BY_KNIGHT`, building-closed routes `E_SHIP_NOT_MOVABLE`; Road Building places ships, including with no land edges, exhausted road pieces or one road piece left, and caps grants with zero or one ship piece left; snapshot restoration and automated forced placements complete under the same cap (COMB-4/5, CK12-6/9, SF-FAQ 18, CK-FAQ 64–66, SFCK-3/6) | `sfck-clauses.test.ts` (COMB-5 ×2, COMB-4, CK-FAQ 64–66, COMB-0 original case + 5 grant/supply regression cases) | covered |
| R-COMB barbarians / score / hooks | every city on every island counts, knights at sea defend (COMB-1, CK12-3); the score adds island bonus, metropolis, defender, merchant and Longest Trade Route (COMB-7); a VP progress card drawn on the roll wins at once at 16 and not at 13 (inherits R-CK-10a); overlapping `allowBuilding`, `bankRate` and `discardLimit` compose | `sfck-clauses.test.ts` (COMB-1, COMB-7 ×2, 3 overlap cases) | covered |
| R-COMB paired | Player 2 moves a ship, plays progress cards, trades with the supply only, has no Alchemy, and may chase the pirate (SF56-25 pp. 2–3, CK56-25 pp. 3–4) | `sfck-clauses.test.ts` paired block (2) | covered |
| R-COMB games / VIS | simulated 3/4/5/6-player games reach 16 points and conserve resources, commodities, the 54 progress cards, buildings, knights, 15 roads and 15 ships, every knight touching an own road or ship; across the four games gold, ship moves, the pirate, its chase, the merchant and island bonuses occur; pirate theft private, progress hands hidden, gold public | `packages/rules/test/sfck-sim.test.ts` (5), `sfck-clauses.test.ts` (VIS-COMB1/2) | covered |
| R-COMB service | lobby offers and resolves both profiles (either expansion order), bot seats refused; a game starts on `sf-ck-2025.1` with 16 VP and both bandits waiting; setup over the API; idempotent receipts; a catalogued, durable `E_PIRATE_INACTIVE`; private progress hands | `packages/server/test/seafarers-cities-knights.test.ts` (2), `rooms.test.ts`, `session.test.ts`, `packages/rules/test/profiles.test.ts` | covered |
| R-COMB client | pirate chase action and board arming, bandit targets narrowed to the chased bandit (prompt and selection name it), knight on a sea intersection in SVG and on the ship deck in 3D, pirate status in the C&K panel, score marks together, events and errors in both locales; browser run of a lobby-created game with the chase in SVG and 3D on desktop and phone (3, 4 and 6 players) | `packages/web/test/seafarers-cities-knights.test.tsx` (8), `scripts/seafarers-cities-knights/capture.py`, [captures](screenshots/seafarers-cities-knights/README.md) | covered in headless Chromium; no human playtest |
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

### Explorers & Pirates clause map

Every clause of the transcription ([work record, "Rule clauses"](aegis/work/2026-11-02-explorers-pirates.md#rule-clauses-paraphrased)) maps to at least one fixture. R-EP-01…24 are in `packages/rules/test/ep-rules.test.ts`, R-EP-25…58 in `ep-clauses.test.ts`, layout in `ep-layout.test.ts` and VIS in `ep-privacy.test.ts`.

| # | Clause | Source | Fixtures |
|---|---|---|---|
| 1 | Production, Action, Movement; no trading or building while moving | EP25-M p. 3, EP25 p. 8 | R-EP-04 |
| 2 | 2 gold at the start | EP25-M p. 3 | layout: pieces, resources and 2 gold |
| 3 | 1 resource per building; 1 gold to a player who receives nothing | EP25-M p. 5, EP25 p. 8 | R-EP-01 |
| 4 | 7: discards only; Land Ho! has no pirate and no theft | EP25-M p. 5 | R-EP-02 |
| 5 | Supply 3:1, 3 → 1 gold, twice 2 gold → 1 resource | EP25-M p. 5, EP25 p. 9 | R-EP-03 |
| 5a | Domestic trades may include coins | EP25 p. 9, EP25-M p. 5 | R-EP-49, R-EP-50; web: coins in an offer |
| 6 | No road or settlement touching an unexplored hex | EP25-M p. 5, EP25 p. 9 | R-EP-25 |
| 7 | Harbour settlement: own coastal settlement, 2 VP, at most 4, 1 large or 2 small | EP25-M p. 6, EP25 p. 9 | R-EP-05, R-EP-26, R-EP-48, R-EP-51 |
| 8 | Ship: empty sea edge at an own harbour, not next to fog; none left → return one with its cargo | EP25-M p. 6, EP25 p. 9 | R-EP-06, R-EP-27 |
| 9 | Settler and crew onto an empty slot; a piece returned only when every slot is full | EP25-M p. 6, EP25 p. 10 | R-EP-07, R-EP-28, R-EP-48 |
| 10 | 4 MP (6 with 1 wool); 2 ships per edge, passing allowed, and the movement must be able to end on a legal edge (interpretation 15); finish one ship before the next | EP25-M p. 6, EP25 p. 10 | R-EP-08, R-EP-12, R-EP-29, `ep-strand.test.ts` |
| 11 | Load, unload, swap: no MP, mid-move, own adjacent harbour; pieces to and from an explored hex | EP25-M p. 6, EP25 p. 11 | R-EP-30, R-EP-51, R-EP-24, R-EP-41 |
| 12 | Exploring flips the hex, ends the move; disc, lair, sacks or nothing; 1 resource or 2 gold | EP25-M p. 7, EP25 p. 12 | R-EP-09, R-EP-10, R-EP-31…34 |
| 13 | Settler ship founds a settlement, ship and settler return; distance rule | EP25-M p. 7, EP25 p. 12 | R-EP-11, R-EP-35, R-EP-39, R-EP-52 |
| 14 | Pirate: place, move or replace; not next to the starting island, frame or Council; theft with a choice; gold from an empty hand; scares a haul | EP25 p. 8, EP25-M pp. 9–10, 15 | R-EP-15, R-EP-16, R-EP-23, R-EP-36, R-EP-37 |
| 15 | Tribute 1 gold per ship once per turn; none for building | EP25 p. 10 | R-EP-17, R-EP-38 |
| 16 | Chase by an unmoved ship; a 6 activates the roller's pirate; the ship may move afterwards | EP25 p. 11 | R-EP-18, R-EP-47, R-EP-58 |
| 17 | Gold fields closed until captured, then 2 gold per building | EP25 pp. 8–9, 13 | R-EP-39, R-EP-19 |
| 18 | Lairs: 3 crews, rewards clockwise, hero roll-off (crews, then reroll), token number | EP25 p. 13, EP25-M pp. 11–12 | R-EP-19, R-EP-40…42, R-EP-53…56 |
| 19 | Fish roll once per Movement phase; no haul where one lies, at the pirate or from an empty supply; delivery | EP25 p. 14, EP25-M p. 15 | R-EP-21, R-EP-22, R-EP-23, R-EP-43, R-EP-44 |
| 20 | Spice farms: crew stays, 1 sack per player, delivery +1 per sack, the three abilities | EP25 p. 14, EP25-M pp. 17–18 | R-EP-24, R-EP-44, R-EP-45, R-EP-52, R-EP-57 |
| 21 | Council of Catan: anchors top and bottom, no pirate | EP25 pp. 4, 7, EP25-M p. 17 | R-EP-22, R-EP-36, R-EP-44, layout |
| 22 | Mission tracks: stacking, printed values, bonus tile, tie to the bottom marker | EP25 p. 13, EP25-M p. 9 | R-EP-20 |
| 23 | Variable setup order and starting resources | EP25 p. 7, EP25-M p. 9 | R-EP-14, layout: harbour marks |
| 24 | Victory: target on the own turn; reached on another's turn counts at the start of the own turn | EP25 p. 15 | R-EP-13, R-EP-46, R-EP-56, R-EP-57 |

Every clause above has a fixture; none is open.

### Explorers & Pirates interpretations and source notes

Each item is numbered as in [the work record](aegis/work/2026-11-02-explorers-pirates.md#contradictions-gaps-and-interpretations).

1. **Pirate lair numbers: provisional — maintainer decision 2026-11-03.**
   CN3085 does not print the six lair numbers. The only lair back shown
   is a "3" (EP25 p. 4). The engine uses 2, 3, 5, 6, 8, 11, taken from a
   secondary source for the 2013/2020 edition. The maintainer accepted the
   list as provisional, so Pirate Lairs, Fish for Catan and the full game
   are enabled. The values live in one constant (`LAIR_TOKENS` in
   `packages/rules/src/modules/explorersPirates/core.ts`, pinned by
   R-EP-42), so a correction changes one line.
2. **Resolved source note — Fish for Catan Council.** The Fish map
   (EP25-M p. 14) does not draw the Council of Catan, but the mission needs
   it for deliveries (EP25 p. 14; EP25-M p. 15). The Spices and full maps
   (EP25-M p. 16; EP25 pp. 6–7) both print it at `(0,0)`, the same cell on
   the shared grid, and the Fish table lists one sea hex fewer than Pirate
   Lairs, whose grid it reuses (19 against 20). That missing sea is the
   Council, so it is placed at `(0,0)`.
3. **Resolved source note — Spices parrot discs.** The Spices disc table reads
   "9: 2", yet its own total is 6 and the component list (EP25 p. 3) has
   one 9. The component list and the total agree, so the region uses one 9.
4. **No gold compensation on a 7** (EP25 silent; a 7 produces nothing).
5. **Gold from a gold field counts as receiving.**
6. **Several unexplored hexes at once** are all flipped, in hex order.
7. **No ship on an edge whose end touches an unexplored hex.**
8. **Track overflow** past the last space is lost; the bonus tile needs a
   marker off the start space.
9. **Tribute without gold** blocks that step.
10. **Empty supplies** pay nothing (resources, 148 coins, 6 hauls).
11. **Coins in player trades** (EP25 p. 9: "any combination of resources and
    coins") use the `tradeGoods` hook shared with Traders & Barbarians:
    offers carry `giveGoods` / `wantGoods`; the declaring module and current
    holdings are checked at proposal, revision, consent and settlement.
12. **Making room returns exactly one piece** (EP25 p. 10). The player names
    it. A settler needs an empty holder, so only a single large piece can
    make room for it; two small pieces cannot. Removal is allowed only when
    no holder has room for the new piece, and a piece must be in the supply
    to be built (the limit is checked before the removal).
13. **Extra move.** The tool card reads "+1-2 extra spaces" (EP25 p. 2,
    component overview); the text says 1 wool lets a ship move "up to six
    edges" (EP25 p. 10). The engine allows up to 6 (4 + 2), and the ship may
    stop earlier.
14. **Extra move with Swift Voyage.** EP25 gives no rule for combining
    them; the bonuses add (4 + 2 wool + 2 with both farms = up to 8).
    Unsourced; recorded as an interpretation.
15. **A movement must be able to end legally; a ship with no way out stops
    on the full edge** ([#97](https://github.com/cxyfer/katan/issues/97),
    `ep-2025.2`; unsourced interpretation, maintainer decision 2026-11-05).
    EP25 p. 10 lets a ship pass ships but end only on an edge with at most one
    other ship; it does not say what happens when a ship with MP left cannot
    reach such an edge. `ep-2025.1` checked one step ahead only, so a ship
    could sail onto a full edge with no step left, and `turn.end`, the ship
    switch and the fish roll were refused for good.
    - A step onto a full edge is offered and accepted only if, from there,
      the ship can still reach a legal stop with the MP it already has: a
      non-full edge (an exploring step always targets one and ends the move),
      or a site where its settler aboard can found (founding removes the
      ship). The search models fullness (the moving ship is not counted),
      tribute once per ship and turn (1 coin while unpaid) and the pirate's
      current hex. Otherwise `ep.moveShip` returns `E_EP_EDGE_FULL`;
      `E_EP_TRIBUTE` only when the step needs tribute the owner cannot pay.
    - An extra move not yet bought does not count as MP: to sail a longer
      route through full edges, buy the wool first. A settler that could still
      be loaded from a harbour on the way does not count either; only one
      already aboard does.
    - The ship in motion on an edge with two other ships must sail on while
      it has a way out: a step, a founding site, or a step that buying the
      extra move (1 wool, affordable and not yet bought) would open. The
      `stranded` hint means exactly this. With none of these, `turn.end`, a
      ship switch or the fish roll ends its movement where it is, leaving three
      ships on that edge. There is no deadline for the third ship to leave;
      other ships may pass that edge but not stop there, and the ships on it
      sail off normally in later turns.
    - The rescue is not only for old saves: a later legal command can also
      take the last exit away. Example (Land Ho!, issue map): p1 has four plain
      settlements and no wool; ship x with a settler sails 58 → 33 → 34 (full)
      → 2 (full), allowed because x can found at intersection 3; ship y with a
      settler on edge 83 then founds at 64, reaching the five-settlement
      limit, so x has no founding site left and may stop on edge 2 with three
      ships there. No new limit on `ep.found` is added for this.
    - Why: an unended movement must not freeze the table. Taking the ship back
      to its last legal stop would mirror the table, but a saved game does not
      record where the ship came from, so it could not free games already
      stuck. Unfinished `ep-2025.1` games run this behavior (SPEC §7.3).
      Pinned by `packages/rules/test/ep-strand.test.ts` (every profile) and the
      restart case in `packages/server/test/explorers-pirates.test.ts`.

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
| Science | Road Building (2) | PC-RB1 two roads, PC-RB2 no target, PC-RB3 newly opened second site and snapshot restore, PC-RB4 early completion, PC-RB5 piece supply, PC-RB6 recorded grant preserved |
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
11. **Rules-version dispatch remains single implementation.** The engine version
    is stored per game and unknown versions are refused at the schema level; the
    shipped engine still has one implementation, while the Road Building grant
    is explicitly dispatched by the stored version.
    The server does not yet compare `games.engine_version` before executing a
    command. The maintainer explicitly approved running unfinished
    `base-2025.1` and `base-2025.2` games on `base-2025.3` on 2026-11-02
    as the PR #60 defect-fix exception (SPEC §7.3).
    New Road Building grant behavior is versioned separately: new base,
    Seafarers and Traders & Barbarians games use `base-2025.4`, `sf-2025.2`
    and `tb-2025.2`; saved games at earlier versions are not migrated.
    New Explorers & Pirates games use `ep-2025.2`; the maintainer explicitly
    approved running unfinished `ep-2025.1` games on the same behavior on
    2026-11-05 as the #97 defect-fix exception (SPEC §7.3), so the engine does
    not branch on the two E&P versions (E&P interpretation 15).
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
13. **Road Building grant at play time (versioned).** Since `base-2025.4`,
    `sf-2025.2` and `tb-2025.2`, the development card grants up to two free
    pieces when at least one legal route is available, capped by remaining
    pieces; after each placement the effect checks the updated legal targets.
    In Seafarers this includes the available ship supply, so `sf-2025.2` new
    games receive the second piece when the first placement opens another site.
    Existing `base-2025.1`–`base-2025.3`, `sf-2025.1`
    and `tb-2025.1` games are not migrated and retain the grant behavior
    associated with their stored version. The separate C&K progress card
    already grants two roads when at least one legal road exists, capped by
    road pieces left (CK25 p. 14, PC-RB3–6). Recorded pending grants are
    preserved on snapshot restore.
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

Source conflict resolved by maintainer decision:

- **Swift Journey after entering a plaza.** TB25 p. 23 says a wagon that
  moves onto the center of a commodity hex "must end its movement for the
  turn"; the Swift Journey card says "After you take a 'Move your wagon'
  action this turn, take that action again." The maintainer decided on
  2026-11-03 that the card text wins: a plaza stop ends the current move
  action, and Swift Journey's second move action still follows (fixture
  `TR10b`). No official clarification was found; revisit if one appears.

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
