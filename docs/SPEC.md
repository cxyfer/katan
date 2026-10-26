# Browser-Based CATAN-Style Game: Design Specification

Date: 2026-10-26
Status: Revised design proposal for user review
Revision: 2026-10-26 — rule fidelity, interaction flows, recovery, and acceptance review incorporated
Scope: Product requirements, system design, implementation plan, and acceptance criteria

## 1. Summary

Build a browser-based, multiplayer hex-board trading game for friends and public-table play. The initial product target supports 3–6 players, private rooms, a public room browser, touch-capable responsive controls, and room-selected rule modules. The planned first full release targets the base game, the 5–6 player rules, Seafarers, and Cities & Knights, including only combinations and scenarios that have been implemented and verified.

Ship the web client and game service as a Docker image. Operators choose SQLite for a compact single-instance installation or PostgreSQL for a separately managed database. Players initially join using a nickname and a persistent browser guest identity; account login is deferred.

This is a proposal, not an implementation authorization or an accepted architecture decision record. Section 3 records user requirements. The user has requested incorporation of the review findings into this document; that request does not separately approve every newly proposed product default. Concrete recommendations and their decision deadlines are recorded in §14.1. Requirements written as “must” describe the proposed design once approved, not completed implementation.

The fidelity reference is the selected official physical tabletop rules, including their information boundaries and negotiation opportunities. Visual presentation may be original; rule shortcuts, automatic decisions, or convenience features must not remove a legal strategic choice. This revision contains no claim of a rendered UI, completed game, or verified implementation.

## 2. Goals and Non-Goals

### Goals

- Let 3–6 people play together in a browser, including friends joining via an invite and players joining listed public rooms.
- Let the host configure the supported expansion/rule set before a game starts.
- Make the game state authoritative on the server and restore active games after brief disconnects and normal container restarts.
- Keep the desktop experience primary while supporting usable tablet and mobile layouts and touch input.
- Provide one Docker image and documented SQLite/PostgreSQL configuration.
- Structure rules and board topology so the planned expansions do not require replacing the base game's core model.

### Non-Goals for the first release

- Ranked matchmaking, ratings, tournaments, voice/video chat, AI opponents, spectators, and public game replay sharing.
- User accounts, social graph, cross-device identity recovery, and password reset.
- Arbitrary community plugins or user-authored scenarios.
- Multiple concurrently active game-service replicas or automatic horizontal scaling.
- Automatic AI takeover of a disconnected player.
- Every published scenario or every possible expansion combination. The room may enable only combinations explicitly listed as supported.
- A companion app for physical-board play.

## 3. Confirmed Product Requirements

| ID | Requirement |
|---|---|
| P-01 | Support private rooms and a public room list. |
| P-02 | Prioritize desktop play; tablet and mobile compatibility must not be ignored. |
| P-03 | Target 5–6 players in addition to 3–4 player play. |
| P-04 | Plan for Seafarers and Cities & Knights, with further expansions possible later. |
| P-05 | The host can choose supported expansions for each game through room settings. |
| P-06 | Support both SQLite and PostgreSQL. |
| P-07 | Initially allow play by entering a nickname; preserve guest identity in the same browser. Login/authentication may be added later. |
| P-08 | Provide a deployable Docker image. |
| P-09 | Commit each completed implementation phase separately. |
| P-10 | Review and close rule/mechanism gaps, provide a complete web UI/UX, and keep play as close as practical to the selected original rules and tabletop experience. |

## 4. User Flows

### 4.1 Enter and identify

1. A new visitor enters a nickname and receives a server-issued guest identity stored in a secure, HTTP-only browser cookie.
2. The returning visitor in that browser is recognized without another account step and may change their display nickname.
3. The stable player ID, not the display nickname, identifies their seat, ownership, and reconnection eligibility.

Clearing browser storage or changing devices can lose access to a guest identity until account linking exists. The UI must not imply cross-device recovery.

### 4.2 Create or join a room

- Create a private room with an unguessable invite code/link, or create a public room discoverable in the room browser.
- Browse/filter public rooms by open seats, player count, expansion/rule set, and room status; do not reveal player hands or other private game state.
- Join by invite link/code or by selecting an open public room.
- In the lobby, select a color, inspect settings, and mark ready.
- Only the host may change settings or start the game. A settings change clears ready status for all players.
- Starting locks the rules, map/scenario, seats, and player count.

### 4.3 Play, disconnect, and recover

- The UI distinguishes the turn owner, the current action-window actor, and players with mandatory responses. Every player sees their own available actions, costs, disabled reasons, and required responses; a player with no current action sees whom the game is waiting for.
- The server validates each action and publishes the resulting authorized view to each player.
- On a temporary disconnect, retain the seat and show connection status. Rejoining with the same guest identity restores the seat, private player view, and any unresolved required choice.
- A disconnected player is not silently replaced by an AI, skipped, or assigned a random discard. The proposed presence/abandonment policy is specified in §4.6 and requires decision D-03 before multiplayer acceptance.
- On normal service/container restart, recover saved games and allow players to reconnect. If recovery is impossible or a save is corrupt, preserve the last recoverable data and show a clear failure rather than silently starting a new game.
- The home/room screen offers “Resume game” for the current identity's unfinished seats. Recovery explains missed public actions, the current required action, and whether an outstanding command committed. It never asks the player to guess whether to repeat a purchase or trade.

### 4.4 Turn windows and mandatory responses

The rules engine owns a phase/action-window contract: stable window/effect ID, turn owner, permitted actors, each actor's mandatory and optional actions, resolution order, completion condition, and next phase. A turn owner is not a universal authorization check. A pending effect stores the continuation needed to resume after its choices resolve; these fields are included in durable state.

| Window | Who acts and what the UI must communicate | Completion condition |
|---|---|---|
| Initial placement | The next player in the profile's setup order places the prescribed building and adjacent road/ship. Show remaining placements and distance/connection constraints. | The complete ordered setup and starting-resource grant finish exactly once. |
| Before production | The current production actor can use any rule-permitted pre-roll card/action, or explicitly roll. Do not auto-roll away this choice. | Resolve the chosen effect, then the production roll, or finish immediately if the profile's victory condition already holds. |
| Dice/event resolution | The engine resolves the selected profile's ordered effects. Production animation is informational and cannot change the order. | All resulting effects and required choices finish. |
| Discard | Every player over the profile's hand limit receives their own required count and private selection. Multiple players may submit without waiting for each other's UI. | All required discards are committed before robber/pirate resolution proceeds; completed players see the remaining wait list. |
| Robber/pirate, gold, or card choice | Only the effect's authorized chooser sees choices and private detail. Others see the effect and waiting player(s), without secret choices. | Validate the complete choice and resolve the continuation; apply any rule-defined ordering when a limited supply matters. |
| Trade/build/card action | The action-window actor can perform permitted actions in the selected edition's order; other players can respond to eligible trade proposals. | Explicitly end the window after required effects finish, or finish the game immediately on a qualifying victory. |
| Paired-player action | In a 2025 5–6 player profile, show Player 1 and Player 2 roles separately and the current actor's permitted action set. | Player 2 finishes, then both role markers advance as specified by the rulebook; Player 1 victory ends the game before Player 2 acts. |
| Expansion response | A displaced knight's owner, a player losing a city, or another effect-defined responder receives the required decision even outside their main turn. | Finish that effect before resuming the suspended action. |

Optional panels may be closed without abandoning a required response. The required-action prompt remains available until resolved. Each card/scenario effect must declare its actor, timing, cancellation boundary, information visibility, and continuation; there is no generic “skip unresolved effect” path.

### 4.5 Trading and negotiation

Proposed v1 interaction: public structured offers and counteroffers, without requiring voice or general-purpose text chat (D-04). Offers are negotiation, not proof of inventory. The engine enforces legal participants and actual inventory at settlement; the UI must not expose another player's hand through offer eligibility or inventory-specific errors.

1. During an eligible action window, the action actor creates an offer to one player or all eligible players. Others may propose a counteroffer to that actor. An offer states resource quantities given/received from a named player's perspective, audience, window ID, offer ID, and revision.
2. Recipients can decline, express interest, or consent to the exact displayed terms. A counteroffer is a new proposal/version requiring consent; it cannot silently rewrite an existing agreement. The action actor selects one consenting counterparty and confirms the final exchange.
3. Offers reserve no resources. Editing or withdrawing an offer invalidates consent to the previous revision. The server atomically rechecks both parties, terms, inventory, phase, and offer status when settling. Two simultaneous attempts to settle the same offer can produce only one completed exchange.
4. The observable lifecycle is `open → agreed → completed`, with `withdrawn` or `expired` terminal alternatives. A definitive settlement rejection leaves the offer and resource state unchanged and reports a useful private reason without revealing the counterparty's hidden inventory. While the window/consent is still valid, the actor may explicitly reconfirm using a new command ID after refreshing state, or withdraw/revise the offer; retrying the rejected command ID returns its original receipt. Withdrawal, revision, and expiry are separate accepted negotiation/system transitions, not side effects hidden in a rejected game command. Completed exchanges are final.
5. Unsettled offers expire at the end of their action window, a game pause/end, disconnection of a required party, or service restart. Expiration and its reason are visible. A committed exchange survives these events. Draft editing can be preserved locally during a retry, but resubmission must use current terms and state.
6. Executed domestic exchanges and their quantities are public. Bank/harbor exchange has a separate entry showing the player's applicable rate and available choices; it does not wait for another player. Paired Player 2 has no domestic-trade entry.

Acceptance: four clients exercise concurrent interest, counteroffers, term edits after consent, withdrawal, resource changes, phase changes, and connection loss before/after commit. Include definitive rejection followed by a new confirmation, replay of the rejected receipt, and expiry racing settlement. Old terms cannot settle; a completed trade deducts and grants resources once; everyone can distinguish negotiation, failure, expiration, and completion.

### 4.6 Presence, host transfer, pause, and abandonment

These are concrete proposed defaults under D-03, not rules of physical CATAN. They do not add a turn clock or alter game scoring. The proposed disconnect grace period is five minutes, measured from the server-observed loss of the seat's last authenticated live connection; it is a presence threshold, not a deadline for making a move. The server records `disconnected_at` after a transport close or expiry of its documented heartbeat-liveness deadline, not when the connection was created; successful seat reconnection clears it. After service restart, start a fresh recovery grace period before absence can authorize host transfer or abandonment; do not count server downtime as player inactivity.

| Situation | Proposed behavior | Authority and recovery |
|---|---|---|
| Host voluntarily leaves a lobby | Transfer host to the earliest-joined connected remaining member; close an empty lobby. | Publish the new host. No game has started and no seat receives a competitive advantage. |
| Lobby host disconnects | Retain the host during the grace period. After expiry, transfer to the earliest-joined connected member. | Reconnection before expiry retains the role; after transfer, the former host returns as an ordinary member. Host alone is insufficient to start: all occupied seats must be connected, ready, and match an eligible player count. |
| A seated player disconnects during play | Retain their seat. Unaffected legal actions may continue until that player must respond; then expose a persistent waiting state. | Never auto-discard, auto-roll, skip an actor, or replace them. End-of-game results take precedence if legally reached before a required response. |
| A player returns | Restore the same seat and authoritative state; clear the missing status. | Confirm command outcomes, expire obsolete negotiation, and resume their unresolved choice. A connection returning during an abandonment vote invalidates that vote. |
| Players want a break | Any seated player may propose pause; require consent from all seated players. On acceptance, freeze game commands and expire offers while retaining pending effects. | Resume requires all seats connected and explicit readiness. Presence/recovery remains available while paused. No strategic action is undone. |
| A player explicitly withdraws, or remains missing beyond the grace period | Mark the session interrupted. Any connected seated player may propose abandonment; all currently connected seated players must confirm the same proposal. | Verify the missing/withdrawn condition and voter membership again at commit; cancel the proposal if either changes. On agreement, save an `abandoned` result without a winner. Without agreement, retain the interrupted game for later resumption; participants can leave the page and find it through Resume game. |
| Game already started and host changes | A host change only affects room administration; it cannot kick a seated player, change rules, inspect hidden state, or decide their move. | Seat ownership and game-rule authority remain unchanged. |

`Interrupted` is a presence flag, not a pause of every action: unaffected legal play may continue, but an absent/withdrawn player's required response blocks progression. An abandonment proposal alone does not freeze the game. Serialize its final commit with all game commands and recheck that the game is nonterminal, the absence condition still holds, and the current connected voter set has consented. The first valid terminal transition wins: a committed normal victory cancels abandonment, while committed abandonment rejects later strategic commands. Reconnection clears the absence flag and invalidates the vote; an explicit withdrawal must be retracted before that seat may act. Explicit consensual `paused` state, unlike interruption, freezes all strategic commands until resume. Test vote + victory, vote + reconnect, and voter disconnect races.

The abandonment confirmation names the absent player(s), explains that it terminates the saved game without a winner, and is separate from closing the page. A player can retract an explicit withdrawal before abandonment commits, invalidating the proposal. This policy deliberately permits remaining connected players to end a table after prolonged absence; D-03 must explicitly resolve that trade-off before public tables ship. Interrupted games are not removed by stale-lobby cleanup; retention is an operator policy disclosed before deletion.

### 4.7 Game completion and another game

- Evaluate victory at every rule-required boundary, including the start of an eligible turn/window and after scoring effects. Persist one terminal result and reject further game mutations; cancel outstanding offers and stop action prompts.
- All clients, including later reconnects, receive the same winner, terminal reason, and permitted scoring breakdown. Show `completed`, `abandoned`, and `recovery-blocked` distinctly; an aborted game has no fabricated winner.
- Keep the final board inspectable. Reveal the winner's necessary victory-point cards according to the selected rules; do not automatically reveal other hidden hands or deck order.
- Offer return to lobby and another game. Reuse membership/settings as a proposal, allocate a new game ID, and require readiness again. The completed game remains immutable; invite links never let a new visitor occupy a seat in that completed game.

## 5. Room Settings and Rule Compatibility

Room configuration is validated as a complete ruleset, not as independent unchecked toggles.

### 5.1 Proposed settings

- Visibility: private or public.
- Player capacity: 3, 4, 5, or 6.
- Expansion modules: base rules are mandatory; Seafarers and Cities & Knights are optional selections.
- Scenario/map: choices depend on selected modules and player count.
- Victory target: derived from the selected official scenario/rule profile by default; custom targets are not in the first-release scope unless separately approved.
- Turn timer: off by default; whether to offer a timer remains a product decision for post-MVP.

### 5.2 Compatibility policy

- Each supported ruleset/scenario is an explicit registry entry with a stable identifier, rule-version identifier, eligible player counts, enabled modules, map generator/setup, scoring target, and validation rules.
- The lobby only offers valid combinations. Invalid combinations are rejected server-side even if a modified client submits them.
- A game stores a snapshot of its ruleset and rule version. Deploying a new rules version must not silently change an in-progress game's behavior.
- Start with the base game and the user-selected targets (5–6 players, Seafarers, Cities & Knights). Add scenarios/combinations only after rule implementation and tests pass.
- The official product family has multiple expansions and scenario-specific compatibility constraints; therefore “any combination of checkboxes” is explicitly not promised. For example, the official Seafarers guidance lists suitable Cities & Knights combinations and scenario limitations. See references.
- The proposed edition baseline is the 2025 English rulebook family in §5.3, including paired-player turns for 5–6 players. D-01 must confirm this fidelity target before implementing rule behavior. Historical special-building rules are a separate profile and are not silently mixed into this baseline.

### 5.3 Proposed rulebook baseline and source precedence

| Source ID | Proposed authoritative edition | Required coverage |
|---|---|---|
| B25 | CATAN – The Game, CN3081, 2025 | Base setup, supply, actions, cards, awards, scoring, and almanac exceptions. |
| B56-25 | CATAN – 5–6, CN3082, 2025 | Larger setup/supply and paired-player roles, action permissions, and victory timing. |
| SF25 | CATAN – Seafarers, CN3083, 2025 | Ships, pirate, gold, routes, and the exact selected scenario's map/setup/scoring. |
| SF56-25 | CATAN – Seafarers 5–6, CN3084, 2025 | Scenario layouts/supply for 5–6 and each paired actor's ship actions. |
| CK25 | CATAN – Cities & Knights, CN3087, 2025 | Replacement setup/production/cards, knights, events, city improvements, and victory. |
| CK56-25 | CATAN – Cities & Knights 5–6, CN3088, 2025 | 5–6 player supplies, paired-player permissions, event sequence, and scoring. |
| COMB | Official Seafarers/Cities & Knights combination guidance, reviewed 2026-10-26 | Scenario suitability and explicit interaction overrides. |

Direct source links are in §15. Before enabling a profile, record the exact downloaded edition, publication identifier, content hash, relevant pages/sections, and date for HTML guidance in its implementation evidence. A changing download URL alone is not a version lock. Scenario-specific rules override expansion general rules; expansion rules override base rules. Compatible official clarifications resolve ambiguities. An old FAQ's special-building answer cannot override B56-25. Conflicting sources remain an explicit unresolved fixture until reconciled; do not invent a house rule.

### 5.4 Base rules and acceptance fixtures

Each fixture must state its starting state, actor/window, command, expected resulting public/private state, and source clause. Test expectations are derived from the rulebook, not copied from the implementation. These are minimum boundary cases in addition to complete command/card coverage.

| ID | Rule contract | Minimum acceptance cases |
|---|---|---|
| R-B01 | Setup uses the selected profile's exact terrain/number/harbor inventory, layout constraints, and physical piece/card limits. Base players place settlement + adjacent road in forward then reverse order; starting resources come from the second settlement. | Three- and four-player setup order, distance rule including coastal vertices, no duplicate occupied edge/vertex, exactly one starting grant, no city placed directly on an empty vertex, city upgrade returns the settlement piece. Fixed and variable setup follow B25 rather than an unconstrained random hex shuffle. |
| R-B02 | Production uses two independent fair six-sided dice; settlements receive one and cities two resources from unblocked matching hexes. Supply is finite. | Verify all 36 ordered die pairs and their totals; do not sample totals 2–12 uniformly or rebalance streaks. Robber-blocked hex yields nothing. If a resource cannot satisfy multiple entitled players, none receives that resource; when only one player is entitled, they take the available amount. Other resource types still resolve. |
| R-B03 | On a 7, a base hand over seven resource cards discards half, rounded down, once. Then the actor moves the robber to a different hex and steals a random resource card from one eligible adjacent opponent, if any. | Hands of 7/8/9; multiple required responders; no trade before resolution; empty victim/no eligible victim; multiple buildings of one victim do not multiply theft; robber may move to desert, does not block harbor use/building, and cannot remain on its previous hex. Playing a knight does not trigger discards. |
| R-B04 | Domestic exchange includes the action actor and transfers resources both ways immediately; gifting, credit, and off-turn third-party exchange are illegal. Bank trades use the player's current 4:1, 3:1, or applicable 2:1 entitlement. | Reject B↔C on A's turn, zero-sided gifts, unavailable inventory, invalid harbor use, and stale offers. Test trade/build ordering and immediate use of a newly acquired harbor against B25. Preserve legitimate negotiation without exposing inventory. |
| R-B05 | Non-VP development cards cannot be played in the same turn in which bought; at most one is played per eligible turn. Rule-permitted cards can be played before rolling. Victory-point cards have their own reveal/win exception. | Old/new cards of the same type are distinguished; pre-roll knight consumes the turn's card allowance; purchased VP card can complete a qualifying victory; Monopoly, Year of Plenty, and Road Building each have full effect, supply/piece-limit, and completion tests. No other action interleaves an unresolved card effect unless the rule permits it. |
| R-B06 | Longest Road requires at least five connected road pieces along a legal trail, without counting a piece twice or summing independent branches. Opponent buildings interrupt the route. Largest Army starts at three played knights. | Branches, cycles, own buildings, opponent cuts, ties retaining the incumbent, loss/reassignment of an interrupted road award, and largest-army transfer only on exceeding the incumbent. Recompute scores after relevant topology/award changes. |
| R-B07 | A base game ends immediately when the eligible player has at least 10 points on their own turn, including hidden VP. Reaching 10 outside one's own turn does not by itself end the game. | Already at 10 at turn start: win before rolling; outside-turn road-award gain; loss of that award before the next turn; multiple VP cards revealed together; terminal state rejects further commands. Other players receive public score, not the holder's hidden VP total. |

### 5.5 Paired-player rules for 5–6 players

The proposed 2025 procedure replaces the historical special-building phase. Player 1 performs production and an action phase; Player 2 is the third player to Player 1's left in the official seating order and then performs an action phase without another production roll. After Player 2 finishes, both markers move to the next player to their left. Record seating orientation explicitly in the board/UI; verify both five- and six-seat cycles.

| Role | Permitted activity | Restrictions and victory |
|---|---|---|
| Player 1 | Production and the selected profile's normal actions, including domestic and maritime trade. | Victory immediately ends the game; Player 2 receives no further action. |
| Player 2 | Build, buy/play a development card under B56-25 timing, and trade with bank/harbors; expansion actions only when explicitly permitted by their 5–6 rules. | No production roll or domestic trade. Can win immediately during this action phase. |

R-56 fixtures cover the complete role cycle for five and six seats; resource production only on Player 1 rolls; bank/supply/deck differences; role-specific command rejection; and victory for either role. Card purchase/play eligibility and per-window allowances follow B56-25, including eligibility when the same player next acts in the other role. Do not model all eligibility using only the production-turn owner's ID. With Seafarers, each paired actor has the rule-permitted ship move; with Cities & Knights, use progress-card/knight rules rather than the base development-card allowance.

### 5.6 Expansion replacement and interaction contracts

| Mechanic | Seafarers profile | Cities & Knights profile |
|---|---|---|
| Initial setup | Scenario-specific islands, harbor/number layout, robber/pirate positions, and permitted road/ship starts. | First round: settlement + road in forward order; second round: city + road in reverse order. Starting resources are one resource per adjacent terrain hex at the city, not doubled and not commodities. Place the robber off-board as instructed by CK25 until its first legal deployment. |
| Production and supply | Gold grants the profile's resource choices; limited supply and choice ordering must resolve explicitly. | Forest/pasture/mountain cities produce one resource plus the corresponding commodity; hills/fields retain two resources. Resources and commodities have separate finite supplies. |
| Cards and army | Retain base development cards, with explicit ship interactions such as Road Building. | Remove the base development deck and Largest Army. Use three progress-card decks with their own acquisition, hand-limit, play/recycle, and immediately revealed VP-card rules. |
| Routes and units | Ships cost lumber + wool. Road/ship transitions count as one trade route only through the owner's settlement/city; they do not share an occupied edge. | Knights are board pieces with strength, activation, promotion, action eligibility, displacement, and route-blocking effects. Inactive enemy knights also interrupt routes. |
| Movement and blockade | Only eligible open ships may move; enforce the per-action-phase limit, no movement of ships newly built in that phase, closed-route restrictions, and pirate restrictions. Pirate theft eligibility is based on adjacent ships, not merely a coastal settlement. | Activation does not grant an immediate knight action in the same turn; promotion/action exceptions follow CK25. Displacement can create a mandatory response for another player. |
| Defense and development | Base robber behavior, modified by pirate/scenario rules. | City walls increase the 7-discard threshold but do not protect against barbarian city loss. City improvements, level-three abilities, metropolis ownership/transfer, and the merchant have explicit conditions and scoring. |
| Victory | Scenario-specific target and special island/scenario points; Longest Trade Route replaces the road-only interpretation. | Standalone C&K uses 13 points; combined scenarios use their explicit override. Defender/metropolis/merchant/progress VP are evaluated at the correct eligible window. |

R-SF fixtures must cover road/ship junctions with and without the owner's building; opponent interruption; open/closed/circular shipping routes; moving a ship without temporarily awarding victory from an intermediate board; new-ship and pirate restrictions; mixed road/ship Road Building; gold selection including supply shortage; and each selected scenario's special points/setup.

R-CK fixtures must cover every progress-card type's timing, legal targets, effect, information access, required responses, deck return, and cancellation boundary. Include Alchemist before the roll, progress-card limit handling outside the holder's turn, and VP cards' public treatment. Also cover all knight levels/piece limits, activation/promotion/movement, city walls, improvement abilities, metropolis tie/transfer/protection, merchant ownership, and commodity trading/discard/theft. A generic “progress cards implemented” assertion is insufficient.

C&K dice/event resolution follows CK25/CK56-25: resolve barbarian advancement/attack or progress-card acquisition as indicated by the event die before resource production or the 7. Pending choices and deck-shortage ordering complete before the next effect. A city lost to that attack produces as a settlement on that roll; a lost wall affects the ensuing discard threshold. Test attack + 7 on one roll, defense strength equal to attack, tied best defenders receiving progress cards instead of a Defender VP, tied eligible weakest defenders losing cities, metropolis-only protection, no spare settlement piece, and participating knights deactivating. Before the first barbarian arrival, apply the official robber protection; discards on 7 still apply.

For any approved Seafarers + Cities & Knights profile, R-COMB fixtures explicitly verify all of the following:

- Target = that Seafarers scenario's target + 2, not a universal 13.
- Gold fields produce resources only, not commodities; the merchant cannot occupy gold.
- First-barbarian-arrival protection also applies to the pirate when present.
- Knights may travel along eligible road/ship networks; knights can close a route and enemy knights can interrupt its longest-route count without making adjacent ships freely movable.
- Knight/pirate actions and progress-card ship interactions follow their specific clauses. Do not infer that every card mentioning the robber can move the pirate; Bishop remains robber-only.
- Both 5–6 expansion rulebooks apply when that player count is enabled; proving each expansion separately does not prove their combination.

### 5.7 Proposed first-release profile matrix

D-02 proposes **Heading for New Shores** as the first Seafarers scenario, including its explicitly tested C&K combination. These are target profiles, not currently supported features. Each row containing multiple counts is expanded to a separate registry entry and acceptance run for each count; fixed/variable setup modes also have distinct recorded setup descriptors. No unchecked combination is enabled.

| Profile family | Counts | Official setup source | Victory target | Required rules/fixtures |
|---|---|---|---|---|
| `base-2025` | 3, 4 | B25 fixed or variable setup, with exact layout/piece inventories | 10 | R-B, R-VIS, R-REC, U checks |
| `base-paired-2025` | 5, 6 | B56-25 setup/supply | 10 | R-B with overrides, R-56 |
| `sf-new-shores-2025` | 3, 4 | SF25 Heading for New Shores, count-specific maps | 14 | R-B, R-SF, scenario setup/island-scoring fixtures |
| `sf-new-shores-paired-2025` | 5, 6 | SF56-25 Heading for New Shores, shared 5–6 layout and its setup changes | 14 | R-B, R-SF, R-56 and SF56-25 overrides |
| `ck-2025` | 3, 4 | B25 board plus CK25 settlement/city setup | 13 | R-B where retained, R-CK |
| `ck-paired-2025` | 5, 6 | B56-25 board plus CK56-25 setup/supply | 13 | R-B where retained, R-CK, R-56 with CK56-25 permissions |
| `sf-ck-new-shores-2025` | 3, 4 | Respective SF25 map plus CK25 setup and COMB | 16 | R-SF, R-CK, R-COMB |
| `sf-ck-new-shores-paired-2025` | 5, 6 | SF56-25 map plus both 5–6 expansion rulebooks and COMB | 16 | R-SF, R-CK, R-56, R-COMB; verify the full combination rather than infer it |

Heading for New Shores starts on the main island. Its initial settlements/roads/ships follow the scenario's constraints; for C&K substitute the prescribed second city. Each player earns two additional special points for their first settlement on each small island, regardless of whether another player has already settled there. Implement the per-player/per-island claim once, not a global first-arrival bonus. SF25 pp.3–5 establish the three-/four-player layouts and 14-point target. SF56-25 pp.3–4 retain that scenario except for specified setup changes, with no target change; their common five-/six-player layout fixes the small islands but uses the prescribed variable main-island setup and random harbors at marked positions, not a fully fixed board. COMB adds two to that target.

The actual layout data must transcribe the source map's terrain, numbers, harbors, island IDs, robber/pirate positions, and inventory into reviewed fixtures for each supported count; do not generate a merely similar-looking island. Variable setup follows the source's constraints and uses recorded server randomness. Fog/exploration scenarios and other Seafarers scenarios are deferred; do not implement or expose their mechanics solely because the engine can represent hidden hexes. A combined 5–6 row remains disabled until all applicable clauses and fixtures pass; if a contradiction remains, revise the proposed release matrix visibly rather than silently advertising the row.

## 6. Proposed Architecture

### 6.1 Architecture options considered

| Option | Benefits | Costs / risks | Assessment |
|---|---|---|---|
| Single TypeScript app with managed game rooms, SQL persistence, and server-authoritative rules | One deployable image, shared language across UI/service/rules, direct fit for turn-based rooms and Docker hosting | Room lifecycle must be durably recovered; single live-room owner limits horizontal scaling | Recommended. Evaluate Colyseus against the room/reconnect requirements while keeping rules and persistence behind independent contracts. |
| React client plus custom WebSocket/HTTP room infrastructure | No room framework constraint; service and protocol can be tailored exactly | Must build and maintain reconnection, room listing, lifecycle, presence and synchronization behavior | Viable fallback if the framework cannot meet persistence/recovery or deployment requirements. |
| Peer-to-peer/browser-authoritative game state | Lowest server workload | Hard to enforce legal actions, protect hidden information, persist/recover games, and arbitrate simultaneous commands | Reject for this product because hidden hands and durable authoritative games are core requirements. |

External prior art supports treating rooms, reconnection, match discovery, state synchronization, and graceful shutdown as explicit server concerns; it does not establish Colyseus as the final choice. See the Colyseus references below.

### 6.2 Logical components

```text
Browser (React + TypeScript)
  ├─ lobby, public room browser, responsive game board, player hand
  └─ WebSocket/HTTP client
       │
       ▼
Single deployable application service (Node.js + TypeScript)
  ├─ HTTP/static web delivery and guest identity
  ├─ lobby/room lifecycle and public room listing
  ├─ authoritative game command handler and per-player projections
  ├─ isolated rules engine and ruleset registry
  └─ persistence interface
       │
       ├─ SQLite (single-instance default)
       └─ PostgreSQL (external or Compose-managed)
```

### 6.3 Responsibilities and invariants

- **Rules engine:** Pure, deterministic state transitions where possible. It receives a game state, actor, command, and random input; it returns a validated state change and events. It owns legality, resource accounting, turn phases, scoring, and expansion interactions.
- **Room service:** Owns room membership, host permissions, readiness, turn delivery, reconnection, and mapping authenticated sessions to stable player IDs. It delegates all game-rule decisions to the rules engine.
- **Persistence adapter:** A single repository contract backed by SQLite or PostgreSQL. Migrations and integration tests cover both engines. Use transactions for commands that update state and append an event/save record.
- **Client:** Renders authorized state and submits intents; it never decides whether an action is legal and never holds authoritative random outcomes.
- **Private data:** Server responses are player-specific projections. Other players' resource/development cards and unrevealed scenario information must never be sent and merely hidden with CSS.
- **Randomness:** Server-generated dice/deck outcomes use a cryptographically strong source. Persist outcomes/events before acknowledging the associated command.
- **Active rooms:** For the first deployment target, one application instance owns its live rooms. PostgreSQL improves database concurrency and operational durability but by itself does not coordinate rooms across application replicas.

### 6.4 Technology proposal (not yet approved)

- Monorepo/package manager: TypeScript with pnpm workspaces.
- Web: React, TypeScript, Vite; SVG for interactive board geometry.
- Service: Node.js and TypeScript; evaluate Colyseus for room/session and reconnect lifecycle. Keep rules engine framework-independent so it can be tested without a live room server.
- SQL: Kysely (or equivalent typed SQL layer) with explicit portable schema/migrations for SQLite and PostgreSQL. Avoid database-specific behavior in rules and application services.
- Validation/tests: unit/property-style rule tests, service integration tests against both database engines, and browser end-to-end tests for room flows.
- Container: multi-stage Docker build, non-root runtime, health endpoint, graceful shutdown, configurable port/database URL, persistent SQLite directory, and Compose examples for SQLite and PostgreSQL.

Technology selection should be confirmed against the repository/runtime environment when implementation begins; this workspace currently contains no existing application code or stack conventions.

## 7. Data and Persistence

### 7.1 Core records (logical model)

- Guest player: stable ID, display nickname, creation/update timestamps, optional future account link.
- Room: room ID/code, visibility, host player ID, settings/ruleset ID, lifecycle status, timestamps.
- Membership/seat: room ID, player ID, color, readiness, connection status, seat order.
- Game snapshot: game ID, ruleset/profile and immutable rules-engine version, board topology/state, turn owner/action window, pending effect/response state, public and private player state, random outcomes/remaining shuffled decks sufficient for deterministic recovery, and persistence revision. A seed is not exposed to clients and is not a substitute for already committed outcomes.
- Game event: ordered command/result metadata sufficient for audit/recovery, without exposing secret card identities to unauthorized clients.
- Command receipt: game ID, authenticated actor ID, command ID, canonical payload digest, accepted/rejected outcome, and committed revision. Receipts survive restart and remain available for at least the lifetime of a resumable game.
- Negotiation: offer ID/revision, originator, consenting parties, terms, action-window ID, and status. An offer is not a resource reservation; pending negotiation can expire on restart, but completed exchange and its receipt cannot disappear.

### 7.2 Commit/recovery boundary

For each accepted command: validate against current version, apply the transition, persist the new snapshot, ordered event, and command receipt atomically, then publish the state update. Rejected commands do not mutate game state. Serialize accepted state transitions per game and enforce a database revision check; a single service process does not prevent concurrent asynchronous handlers from racing.

- The command envelope identifies the game, command ID, expected revision, action-window/effect ID, and intent. The actor comes from the authenticated session, never a trusted client field.
- Check an existing receipt before stale-revision rejection. Repeating the same actor/game/command ID and payload returns the original outcome without redrawing dice, stealing another card, or settling twice. Reusing that ID with different payload is rejected.
- A stale or wrong-window intent receives a typed rejection and a current authorized projection. For simultaneous mandatory responses, clients retain a still-legal draft, refresh the revision, and deliberately resubmit after a definitive rejection; an unknown outcome is queried/retried with the original ID first. Never blindly replay queued strategic commands after reconnect.
- Commit failure leaves authoritative in-memory state unchanged. A crash after commit but before publication is recovered from the saved snapshot/receipt. Clients may miss events but must converge to the same revision through a full authorized snapshot; they do not reconstruct secret state from another player's event stream.
- Multi-step actions save pending effects and remaining choices. Cancelling a local preview is not undoing a committed effect. A transport/session reconnection feature alone does not establish durable room/game restoration.

SQLite mode requires a mounted persistent directory and a single application writer. PostgreSQL mode requires connection pooling limits, schema migrations, health checks, and documented backups. Both need backup/restore documentation and migration tests. Retention and deletion policy for finished games should be decided before public production launch.

### 7.3 Rules-version execution and upgrades

Proposed strategy D-05: retain the exact rules-engine implementations and compatible snapshot readers needed by unfinished games; new games use the release's selected default. The ruleset registry dispatches to the stored version. Merely storing a version string or settings snapshot is not sufficient.

- Before deployment or startup, inventory unfinished games and check availability of their engine/profile versions and schema readers. An incompatible release must refuse to take over those games, preserve data, and report the blocking versions; never silently route them to the newest engine.
- Old versions may be retired only when no unfinished game references them and the documented restore policy for retained backups is satisfied. Restoring an older backup may require its original compatible image and migration path.
- Do not automatically migrate an active game's rules. Any future rule migration requires a separately approved policy, fixtures proving intended outcomes, a recoverable backup, and explicit notice to affected players. Schema migration is not permission to change game rules.
- Test both ordinary restart and abrupt termination around validate/randomize/commit/publish boundaries. Acknowledged commands must survive; unacknowledged commands resolve as committed once or not committed, without inventing a second outcome.

R-REC acceptance: for each database, restart during initial placement, partial multi-player discard, robber victim selection, gold selection, a card's intermediate effect, knight displacement, and city-loss selection. Repeat trade/build commands across pre-commit and post-commit disconnects; inject database-write failure; test two simultaneous settlements of one offer; resume an old-version game after upgrading the service; and verify incompatible-image refusal plus documented backup rollback. States not used by a profile are marked inapplicable, not silently skipped.

## 8. UI/UX and Accessibility Requirements

### 8.1 Layout and shared-table context

- Desktop keeps the board primary, with stable locations for seat order/player status, own resources/cards, required actions, trade panel, and public event log. Show the last dice result, affected hexes, production summary, public score/awards, and current required responders. Preserve board orientation when the turn changes.
- Tablet reflows secondary panels. Mobile uses a compact status strip and one secondary drawer at a time; opening hand/trade/help must not hide the current mandatory action, connectivity, or the way back to the board. Preserve zoom/pan when switching panels.
- Use a coherent set of visual tokens, icons, spacing, typography, and interaction states across lobby, board, cards, and dialogs. Terrain, resources, player pieces, and progress-card categories need distinct labels/symbols as well as color. Build illustrations from licensed/original assets rather than copying the official art.
- Public room rows show human-readable rules/edition, scenario, player count, seat availability, and status. Lobby settings explain incompatible choices before start; the room code/invite and start blockers are visible. Long nicknames, duplicate display names, full six-seat tables, large hands, and dense expansion boards must be part of visual checks, not only empty demo screens.

### 8.2 Board selection, cancellation, and feedback

- Use explicit `browse → select → preview → submitting → confirmed/rejected` interaction states. Selecting a build/card/action shows its cost, legal targets, and the reason an action or candidate is unavailable. Local hints are advisory; the server remains authoritative.
- Pan/pinch gestures never commit a placement. Where nearby vertices/edges are ambiguous, offer a magnified selection view or a candidate list with textual board references. Include reset/fit-board controls and keyboard equivalents; do not require hover, precise dragging, or color recognition.
- Preview names the location/target, cost, and consequence; allow change or cancel without cost before submission. Apply proportionate confirmation to placement, discard, card play, and irreversible trade settlement. Do not impose a blocking confirmation on harmless navigation or every automatic production event.
- During submission, retain the pending command ID and show that the result is not yet known. Prevent accidental double submission. On a definitive rejection, explain the cause and keep valid draft input; on unknown outcome, resolve the receipt before offering another attempt.
- No unrestricted undo after dice, theft, card draw, trade, or another player's response reveals information. A local unsubmitted preview can always be cancelled. Committed effects follow their rules, not a client-side rollback.
- Motion/sound are optional cues with persistent equivalent text. Respect reduced-motion and mute preferences; animations cannot block required choices, auto-advance a strategic window, or be the only evidence that an action succeeded.

### 8.3 Information visibility contract

The server's player projection, event log, toasts, accessibility announcements, reconnect snapshot, error responses, and end-game summary all obey the same visibility rules. Host status grants no special game-information privileges.

| Information | Public to seated players | Private / restricted |
|---|---|---|
| Board and progress | Revealed terrain/numbers/harbors, pieces, public improvements/knight states, public awards, scenario markers, turn/phase and waiting/completed status. | Unrevealed scenario information and future random outcomes remain server-only. |
| Hand and score | Resource hand size; public awards/buildings/VP events; card counts/category information only as permitted by the selected rulebook. | Exact resource/commodity identities, unrevealed cards and base VP total belong to their holder. Never broadcast a hidden-inclusive score or a difference from which hidden VP can be directly recovered. |
| Production and domestic exchange | Dice, public production, completed domestic trade terms and quantities. | Do not expose an exact current hand merely because past public actions allow players to make estimates. No automatic opponent-hand inference assistant in v1. |
| Discard and theft | Who discarded how many; who stole from whom; effect completion. | Discard identities remain with the discarder/server. A stolen card identity is visible only to thief and victim, unless a selected rule explicitly says otherwise. |
| Card effects | Played cards and rule-required public outcomes; C&K public VP cards are not treated like hidden base VP cards. | Spy/inspection and similar effects grant only the specific temporary view authorized by that card; do not broadcast it or retain access after resolution. |
| Negotiation | Proposed structured terms and responses use the public negotiation design in §4.5. | Inventory checks and error detail cannot reveal another player's current cards. A valid proposal does not certify ownership. |
| Game over | Winner, terminal reason, final board, public score components and victory cards that must be revealed. | Other players' private cards and deck order are not automatically exposed. |

For each enabled card/scenario, document any exception in that profile's fixture. Public room discovery receives only lobby metadata, not this seated-player projection. R-VIS tests compare at least three identities plus an outsider for initial join, every sensitive event, reconnect, and game over. Legitimate deduction from public play is not a security failure; direct transmission or derived leakage of protected fields is.

### 8.4 Required actions, help, and recovery

- Persistently show “Your turn”, “Your response required”, or “Waiting for …” as distinct states. Discard shows required/selected counts; victim, gold, card, and expansion choices name the action and its completion condition. New required prompts are announced and reachable without losing valid unrelated drafts.
- Provide an in-game cost reference, terrain/resource/expansion legend, and contextual rule help. Disabled actions explain whether the obstacle is inventory, timing, connectivity, distance, piece supply, or permissions, without revealing another player's private state.
- Lobby rule summaries explain the edition and major departures from base, especially paired turns and C&K substitutions. Learning help is optional and dismissible; core play cannot require reading a full external tutorial.
- Cover loading, empty room list, invalid/expired invitation, full room, not-ready/start-blocked, submitting, declined/stale trade, offline, reconnecting, unknown command outcome, interrupted/paused, game over, recovery-blocked, and persistence failure states. Distinguish a retryable network issue from a rejected action or incompatible save.
- A same-identity second tab must not create a second seat or independent action authority. Proposed default: the newest authenticated connection controls the seat, the old tab shows “Active in another tab” and cannot mutate until control is deliberately reclaimed. Reject commands from superseded connections and test no duplicate seat or ambiguous command ownership.

### 8.5 Device, accessibility, and experience acceptance

Proposed baseline D-06: Traditional Chinese player-facing UI with consistent game terminology, English internal identifiers; additional localizations are deferred. Target WCAG 2.2 AA for applicable interface content/controls; this is a verification target, not a conformance claim. In particular, provide semantic names, visible focus, complete keyboard operation, dialog focus return, non-color status, readable contrast, text resizing, and target size/spacing or equivalent accessible alternatives. Board geometry does not exempt surrounding controls or remove the need for a non-precision way to choose a legal target.

| ID | Required check and acceptance |
|---|---|
| U-01 | Exercise 1366×768 desktop, 768×1024 tablet, and 360×640 / 390×844 mobile CSS viewports, including mobile landscape and browser text zoom. Core actions, required-action prompts, and recovery controls remain reachable without overlapping; board panning is deliberate, not accidental whole-page overflow. |
| U-02 | Test mouse, keyboard-only, and touch for setup → roll → trade → build → end turn, plus discard/robber and each enabled expansion response. A pan/pinch does not place a piece; adjacent targets are distinguishable; preview cancellation has no side effect. |
| U-03 | Use a real iOS Safari device and Android Chrome device for touch acceptance, plus desktop Chromium/Firefox/WebKit browser checks with versions recorded. Include rotation, software keyboard, background/resume, slow connection, reconnect, and six-player dense boards. Emulation supplements rather than replaces physical-device evidence. |
| U-04 | Automated accessibility checks plus manual keyboard/focus, 200% text zoom, reduced-motion, non-color identification, and a screen-reader walkthrough of required choices and trade completion. Document uncovered assistive technologies; no blanket accessibility claim from an automated scan. |
| U-05 | Representative content includes long Traditional Chinese nicknames, duplicate names, maximum selected pieces, many resource/progress cards, many log entries, disabled actions, and recovery errors. Critical text cannot be truncated without an accessible way to read it. |
| U-06 | Proposed initial responsiveness budget: visible local selection/submission feedback within 100 ms; committed-action acknowledgement p95 ≤1 s on the recorded reference device/server with six clients, 150 ms simulated RTT and no injected storage failure. Record at least 100 eligible commands and the workload. A result pending for 2 s shows an explicit waiting/recovery cue, never an assumed success. Measure production behavior; tune the budget only with recorded evidence, not by silently weakening it. |
| U-07 | A new player completes initial placement and a full turn with built-in help, can explain one blocked move, and can recover from a rejected trade. Observe at least one player unfamiliar with the interface; record assistance, errors, and unresolved friction rather than asserting “intuitive”. |
| U-08 | A group familiar with the selected tabletop edition completes a full four-player game; observe negotiation, waiting, information visibility, and rules disputes. Later repeat with six players and every released expansion/profile. Include at least one mobile participant. Any blocker, wrong rule outcome, hidden-data leak, or required developer intervention must be resolved/retested before that milestone passes. |

### 8.6 Prototype and visual evidence before expansion work

Before Phase 2 rules/UI breadth grows, review six connected prototype state groups: lobby/readiness/host departure; main board/hand/mandatory action/help; multi-party trade/counteroffer/expiration; narrow mobile selection/preview; unknown command outcome/reconnect/resume; and result/final board/new lobby. Use realistic six-seat/expansion-density fixtures even while only base is playable. Prototypes may simulate effects but are not evidence that the engine or persistence works.

Once the vertical slice runs, capture rendered states and exercise them. Keep accepted screenshots with their viewport, content and state as visual regression baselines; verify actual interactions separately. Phase 2 must already satisfy its core mobile/keyboard flows; Phase 7 is broad regression/hardening, not the first responsiveness review.

## 9. Security, Privacy, and Abuse Controls

- Guest credentials are random, revocable server-issued tokens stored in secure, HTTP-only, SameSite cookies in production. Never trust a client-supplied player ID or room role.
- Validate all commands and settings server-side; rate-limit nickname, room creation/join attempts, and public-list queries.
- Use unguessable private room codes; prevent private rooms and private game data from leaking into public listings.
- Bound nickname length and reject unsafe/control characters; encode user-provided text when rendered.
- Do not log guest credentials, complete private hands, or raw session tokens.
- Document that guest identity is browser-bound and not recoverable cross-device before account login is implemented.
- Use TLS at the public reverse proxy; document the required WebSocket upgrade headers.

## 10. Deployment and Operations

- Publish one versioned application image that serves the client and game service on one configured port and origin.
- SQLite deployment: one app container, mounted data volume, health check, restart policy, and documented backup/restore. The volume path must be configurable and clearly identified.
- PostgreSQL deployment: same image plus a PostgreSQL service or external connection string; include a Compose example, health/dependency handling, migrations, and backup notes.
- Run migrations as a controlled startup/release step; fail clearly on incompatible schema instead of silently starting with partial state.
- Handle SIGTERM: stop accepting new rooms/commands, persist active state, close connections cleanly, and exit within the configured container stop timeout.
- State the supported topology: single app replica for v1. Do not advertise horizontal scaling until live-room ownership, listing, reconnect routing, and cross-process coordination are implemented and tested.
- Provide environment variable reference, image tags, health/readiness semantics, and an upgrade/rollback procedure. Avoid requiring users to build the image to deploy a published release.

## 11. Implementation Plan

Each phase/subphase is a reviewable delivery slice and must be committed separately after its acceptance checks pass. The repository currently contains this specification but no application code; exact source-file owners will be established in Phase 1. This is a staged delivery plan, not authorization to start all phases. Decisions in §14.1 block the affected work at the stated gate; unrelated approved work need not wait.

### Test posture

- Current Aegis TDD mode: `off`. This corrects the previous proposal's automatic `strict` route; the user has not separately requested test-first development.
- Required rule, protocol, privacy, database, recovery, UI, and container tests remain mandatory. TDD mode changes workflow sequencing, not the evidence needed for acceptance. Do not claim a red/green sequence unless it was actually followed.
- Every slice records the requirement/fixture IDs covered, commands run, result, environment, and uncovered risks. Source-derived expected outcomes, not test-count or coverage percentage alone, establish fidelity.
- Run focused tests during each slice, then relevant package checks, both database integration suites, browser flows, and container tests at their milestones. No phase becomes complete merely because it compiles or one game reaches victory.

### Phase 0 — Revised design and decision baseline (this document)

- Deliver this specification with source-linked rules, profile matrix, interaction/visibility contracts, recovery policy, and observable acceptance IDs.
- Review D-01–D-06 at their gates; confirm the phase's requirements before dependent implementation. Approval of documentation edits does not silently approve a remaining product decision.
- Review the six prototype state groups in §8.6 before committing to the board/trade interaction structure. Prototype fidelity does not count as a working engine.
- Acceptance: no conflicting rule editions or unmarked proposed defaults; every review gap maps to a contract and verification case; residual choices have a recommendation, owner, and gate.

### Phase 1 — Foundation and bounded architecture proof

- Establish approved web/service/rules/protocol boundaries, workspace tooling, lint/typecheck/test scripts, and local documentation.
- Define board topology, finite supplies, player identity, per-player projection, action-window/pending-effect contracts, ruleset versions, command receipts, and deterministic test seams. The rules package has no networking or database dependency.
- Before adopting the room framework, prove guest-seat mapping, private projections, sequential command handling, reconnect after a committed command, and durable restoration in a bounded spike; document pass/fail against these contracts rather than assuming built-in reconnect restores the database.
- Implement one base setup/production path through a minimal client/service; include narrow-screen and keyboard selection. Add a baseline non-root Docker build/health endpoint once the path runs end-to-end.
- Acceptance: clean install/build/typecheck/test; isolated rules tests; prototype decisions reflected in the vertical slice; container serves client/service and a health check. Do not claim a complete base game yet.

### Phase 2A — Private lobby, seating, and initial placement

- Implement guest identity, private invites, unique seats/colors, readiness/start guards, settings lock, host-transfer policy, resume entry, and session-control policy.
- Implement R-B01 and the setup/action-window projection, with per-player authorization and negative payload tests.
- Establish the shared repository schema and SQLite/PostgreSQL migration/contract harness, including identity/seat/game IDs and initial snapshots. Durability edge coverage expands in 2C; do not defer the data boundary until after building the whole engine.
- Acceptance: three-/four-client lobby to completed setup; concurrent joins/settings/start attempts are resolved consistently; disconnected/unready seats cannot be silently started; initial placement works by touch and keyboard at U-01 viewports; unauthorized payloads contain no private state.

### Phase 2B — Complete base play and trading experience

- Complete R-B02–R-B07, finite bank/deck/piece accounting, all base card effects, awards, victory, and persistent pending choices.
- Implement §4.4–4.5 flows: mandatory actions, structured negotiation, bank/harbor trading, contextual help, pending-result feedback, final board, and new-game readiness. Apply §8.3 visibility to all events and errors.
- Acceptance: complete three- and four-player games plus source-derived boundary fixtures; four-client counteroffer/race tests; U-01/U-02/U-05/U-07; initial real-device keyboard/touch checks and R-VIS. New-player assistance and expert rule disputes are recorded, not hidden behind scripted success.

### Phase 2C — Durable recovery and base-play validation

- Complete atomic state/event/receipt persistence, per-game serialization, stale/duplicate command outcomes, interrupted/pause/abandon policy, process restoration, version dispatch and incompatible-image handling across both databases.
- Exercise R-REC for all base states, including abrupt termination, write failure, and lost acknowledgements; verify old-version behavior through an upgrade fixture.
- Acceptance: same database contract suite passes on SQLite and PostgreSQL; required choices resume without reroll/retheft; no hidden-data leak on reconnect; U-03/U-04 base flows; at least one full four-player expert-tabletop playtest under U-08 with a mobile participant. Address blocking fidelity/usability findings before expansion implementation. Record performance baseline under U-06.

### Phase 3 — Public room browser and operational Docker distributions

- Add public-room listing/filtering, room visibility enforcement, admission race handling, and stale-room cleanup.
- Publish/build the single image and SQLite/PostgreSQL Compose examples, migrations, health/readiness, graceful shutdown, and backup/restore/upgrade docs.
- Acceptance: public rooms are discoverable only while joinable; private rooms never appear; simultaneous joins cannot exceed capacity; both database deployment modes start, persist, restart, and recover from a documented backup.

### Phase 4 — 5–6 player rules

- Implement the approved B56-25 profile, enlarged setup/supply, paired-role scheduling, permission matrix, development-card timing, and immediate victory for either eligible role.
- Show both roles and current action window in the UI; keep non-actors' required responses usable. Historical special-building rules remain out of scope unless separately approved.
- Acceptance: R-56 for five and six seats, retained three-/four-player regression, six-client E2E, six-player U-08 playtest, and mid-role/mid-response restart with the same rules version.

### Phase 5 — Seafarers

- Implement the approved Heading for New Shores profiles in §5.7, including count-specific layouts, island IDs, ships/routes, pirate, gold, initial-placement constraints, and per-player island scoring. No fog/exploration scope unless the approved matrix changes.
- Implement ship selection/movement preview, gold-choice prompts, and route/score explanation with mobile/keyboard alternatives. Add fixture-backed SF56-25 permissions and supply/setup changes.
- Acceptance: complete R-SF and applicable R-56/R-REC/R-VIS; every declared player count plays to completion; U checks for new controls and six-seat dense board; all scenario targets match the source-derived fixture. Untested profiles remain disabled.

### Phase 6 — Cities & Knights and approved combinations

- Replace base setup, affected production, development deck, and Largest Army as specified in §5.6; implement commodities, improvements, city walls, knights, barbarian/event ordering, all progress cards, merchant/metropolis, and victory.
- First complete standalone C&K for three/four players, then its five/six-player procedure, then SF+C&K combinations as separately reviewed sub-deliveries. Do not enable combinations by merely enabling both modules.
- Acceptance: R-CK covers every progress-card type and exceptional response; R-COMB covers all explicit cross-expansion rules; every enabled row/count completes a game and the affected U/R-VIS/R-REC checks. A six-player C&K/SF game is verified as its own profile, not extrapolated from two separate suites.

### Phase 7 — Cross-profile hardening and release validation

- Re-run U-01–U-08 for the supported layouts/controls, supported browser/device conditions, and full six-player content. Responsive, accessibility, and playtest fixes already begin in Phase 2; this phase checks regressions and remaining breadth.
- Validate Docker instructions on clean SQLite/PostgreSQL deployments; perform backup restore, graceful and abrupt restart, rules-version upgrade/refusal, and schema rollback-path checks. Document exact supported profiles, engine/image versions, configuration, and limitations.
- Acceptance: fixture-to-test mapping is complete for released profiles; rules, privacy, both database suites, browser interactions and container recovery checks pass; tabletop playtest blockers are resolved/retested; measured responsiveness and manual accessibility gaps are disclosed. No unsupported combination appears in the lobby or release claims.

## 12. Test and Verification Strategy

- Rules engine: unit tests for each command/phase, invariant/property tests for resource conservation, piece limits, turn ownership, road/ship connectivity, and scoring; deterministic seeded scenarios for reproducible bugs.
- Compatibility matrix: ruleset registry tests enumerate allowed player count × expansion × scenario combinations and reject all others.
- Server: integration tests for concurrent joins/trades, duplicate/retried commands, reconnection, authorization, private projections, recovery and migrations.
- Database: same repository contract suite against SQLite and PostgreSQL, including transactions, constraint behavior, restart recovery, and schema upgrades.
- Browser: multi-client end-to-end paths for private invite, public discovery, readiness/start, trade, expansion configuration, disconnect/reconnect, and game completion.
- UI: screenshot/viewport verification at desktop, tablet, and mobile sizes, plus keyboard and touch interaction checks. A screenshot alone does not prove task completion.
- Container: build image, run as non-root, verify health/readiness, volume persistence, SIGTERM handling, and clean restore using both database modes.

### 12.1 Traceability and falsifying scenarios

Each enabled profile has a compact fixture index mapping official source/page → rule/override → fixture ID → automated test or manual evidence → covered player counts. Fixture inputs are deterministic and include expected bank, pieces, cards, scores, phase/actor, and visibility where affected. Use independent source-derived expected results; engine replay agreeing with itself is not a rule oracle. Check conservation only where that edition/scenario actually conserves the counted object, including explicit replacement-piece exceptions rather than forcing an invalid generic invariant.

| Coverage family | Required evidence before applicable milestone |
|---|---|
| R-B / R-56 | All §5.4 base cases and §5.5 role/permission cases, positive and negative commands; source-accurate setup/deck/piece inventories; reject unsupported player counts. |
| R-SF / R-CK / R-COMB | Each enabled scenario's layout/scoring; every relevant card's legal and invalid targets; mandatory response/continuation; explicit replacement rules; cross-expansion overrides and paired-player timing. |
| R-TRADE | Concurrent responses/settlements, changed terms after consent, inventory changes, withdrawals, role restrictions, window expiry, disconnect and restart; no double resource transfer or inventory leak. |
| R-VIS | Compare authorized payloads/logs/notifications/errors across three seats and an outsider. Include new join, targeted card inspection, private scoring, theft/discard, reconnect, final board and public-list endpoints. |
| R-REC | Same transaction/receipt/recovery assertions on SQLite and PostgreSQL at each named crash/choice boundary in §7.3; old-version games use the old engine; absent engine versions fail visibly without state mutation. |
| R-ROOM | Join/start/settings races, last seat, not-ready/disconnected start, host transfer, same-identity second tab, pause/resume, reconnection during abandonment vote, absent-player recovery and immutable terminal games. |
| U-01–U-08 | Rendered interactions, viewport/device/browser records, visual baselines with realistic data, manual accessibility, responsiveness measurement and observed novice/expert complete-game evidence. |

Automated tests must include impossible/unauthorized moves, not only successful paths. Game completion alone cannot prove edge cases; screenshot stability cannot prove task success. For every failed case retain the starting fixture and trace needed to reproduce it, while excluding credentials/private hands from ordinary operational logs. Before enabling public rooms, test that abuse controls and expired invitations do not leak private room/seat information.

### 12.2 Playtest and release evidence

- Base milestone: at least one full four-player game with players familiar with the chosen physical edition, including a mobile participant, plus the novice-task observation. This is a minimum qualitative check, not statistical proof of usability.
- Expansion milestones: complete games across every declared profile/count, with automated coverage and human tabletop-fidelity checks of newly introduced mechanics. Include a full six-player expert session; do not substitute six background bots for negotiation/UX evidence.
- Record rule disagreements, confusing waits, mistaken targets, recovery failures, assistance required, game duration, and device/network conditions. Classify findings as rule defect, missing interaction, usability friction, or deliberate approved difference. Correct blockers and repeat the affected scenario before sign-off.
- A release evidence index lists profile/engine/image versions, source hashes, passed fixture IDs, commands and results, observed sessions, unresolved limitations, and the decisions approved. Coverage not exercised stays unverified; do not infer all combinations from shared components.

## 13. Acceptance Criteria for the First Full Release

1. A new player can enter a nickname, create/join a private or public room, play, disconnect, and resume in the same browser without an account.
2. Public room data exposes only lobby/game metadata intended for discovery; private rooms and hidden game information remain private.
3. Host can select every supported target ruleset/scenario; the server rejects unsupported combinations and locks settings after start.
4. The release supports base, 5–6 player rules, Seafarers, and Cities & Knights for each explicitly declared compatible scenario/player-count combination.
5. Games can finish under supported rule sets and report the correct winner/score.
6. SQLite and PostgreSQL modes pass the same core persistence contract suite and recover after application restart.
7. The versioned Docker image runs with documented configuration and persistent data; a user can deploy without building source.
8. Core flows work on desktop and remain operable on tablet/mobile with touch, keyboard alternatives, and visible recovery/error feedback.
9. Phase commits exist with verification recorded, and no implementation phase is represented as complete without fresh evidence.
10. The approved §5.7 profile/count matrix has exact source/layout/scoring fixtures; every rule replacement and supported combination passes its mapped cases. Proposed or unverified combinations are not presented as supported.
11. Players can negotiate, identify and finish out-of-turn required actions, resolve uncertain command outcomes, resume interrupted games, and distinguish abandonment from victory using the approved §4 policies.
12. Rendered/device/manual accessibility and playtest evidence covers U-01–U-08 at the relevant milestones; remaining limitations are disclosed. No critical action depends on hover, precision dragging, color alone, or a development operator's intervention.
13. Upgrade/recovery tests prove that an unfinished game retains its actual executable rules version, pending effects, committed randomness, private view and idempotent command results. Unsupported-image recovery fails explicitly and preserves data.

## 14. Risks and Open Items

- **Rules and fidelity:** §5 pins a concrete proposed edition family and named scenario matrix; D-01/D-02 still need acceptance. Source-map coordinates and every card/scenario clause must be transcribed and independently checked before enabling a profile. This document is not a replacement for the official rulebooks.
- **Rights and assets:** Product name, logo, illustrations, card text, and commercial/public distribution may have intellectual-property constraints. Do not copy official assets or text without permission; obtain appropriate legal review/licensing before a public branded release. This is a risk note, not legal advice. Fidelity means mechanics and information/decision opportunities, not an unauthorized visual clone.
- **Expansion scope:** Each expansion has multiple scenarios and not all combinations are compatible. §5.7 is the bounded proposed first-release matrix; additional scenarios, exploration, community maps and historical rule profiles require an explicit scope change.
- **Guest identity loss:** Browser-bound identity cannot recover across devices/storage loss. Warn before reliance on a long saved game; host powers cannot reassign a lost guest's active seat. Future account linking should preserve the stable player ID.
- **Operations and data:** One application replica is supported. Both database modes need bounded resource use, migration/backup/restore evidence, interrupted-game retention policy and deletion notice. PostgreSQL alone does not solve live-room ownership.
- **Recovery and version retention:** §7.3 preserves active behavior but adds maintenance cost for referenced engine versions. A rejected alternative is silently applying new rules; any future migration/retirement requires its own evidence and approval.
- **Presence and public play:** D-03's no-clock/no-AI policy protects strategic choices but may leave tables interrupted. Its explicit abandonment option sacrifices eventual recovery for a deliberate no-winner termination. Neither policy prevents all griefing; do not claim a moderated competitive service.
- **Evidence gap:** No application, rendered prototype, physical-device test, complete-game observation, or production performance result exists at this revision. Proposed UX budgets and verification methods are targets, not measured outcomes.

### 14.1 Decisions required before dependent implementation

All rows are **proposed, awaiting user confirmation**. The current request authorizes specification updates, not automatic acceptance of new defaults. A rejected recommendation is revised here before dependent code; do not silently fill a pending choice while claiming the design is accepted.

| ID | Decision / recommended concrete default | Alternative and trade-off | Owner and latest gate |
|---|---|---|---|
| D-01 | Adopt the 2025 English rulebook family and paired 5–6 turns in §5.3; preserve the same mechanical meaning in Traditional Chinese UI. | Target a specific older/localized edition instead; record differences as a separate baseline, never combine versions ad hoc. | User; before rule-behavior implementation in Phase 1. |
| D-02 | First Seafarers scenario is Heading for New Shores; proposed first full release includes the explicit standalone/combined rows and counts in §5.7. | A narrower first release can defer combination rows; a different scenario changes maps, scoring and required effects. Do not remove already confirmed expansion goals without approval. | User; before scenario implementation/claims, with matrix agreed before expansion scheduling. |
| D-03 | No turn timer/AI; five-minute disconnect grace, deterministic lobby host transfer, consensual pause, and explicit no-winner abandonment by all currently connected seats under §4.6. | Indefinite recoverable suspension avoids ending an absent player's game but leaves public tables unresolved; timed auto-actions change play and are not implied. Confirm the connected-player abandonment authority specifically. | User; before Phase 2A host lifecycle and Phase 2C interruption acceptance; mandatory before public tables. |
| D-04 | Structured public offer/counteroffer/consent flows and limited negotiation responses; no general text/voice chat required in v1. | Text chat better supports free-form negotiation and table talk but adds abuse/privacy/UI scope; decide from prototype/playtest evidence if structured negotiation is insufficient. | User; before trading interaction implementation in Phase 2B. |
| D-05 | Single replica, retain rules engines/readers required by unfinished games, and block incompatible takeover as in §7.3. Select React/Node/room framework/SQL layer only after the bounded proof. | Drain all games before incompatible upgrades is simpler but operationally restrictive; active-rule migration needs a separate policy and evidence. Custom WebSocket infrastructure remains an architecture alternative, not a second simultaneous owner. | User for upgrade/deployment behavior; implementation lead for evidence-backed library choice; before Phase 2C persistence/upgrade acceptance. |
| D-06 | Traditional Chinese UI; §8.5 viewports/browser/device/accessibility scope and proposed responsiveness budget; original readable tabletop-style visuals. Newest same-identity connection owns seat control, with explicit reclaim. | Other language/visual direction, device floor or multi-tab policy changes UI acceptance; tune provisional performance thresholds only from documented measurement. | User for product scope/seat-control behavior; implementation lead records environment and evidence; before prototype acceptance and Phase 2A–2B UI baseline. |

Operational values such as public rate limits, room caps, interrupted/finished-game retention, backup frequency, and reference deployment resources must be documented and tested before Phase 3/public launch. They are not substitutes for D-03's game behavior and must not delete active games as ordinary stale lobbies.

## 15. Decision and Evidence Ledger

### User-confirmed

- Private rooms plus a public room list.
- Desktop-first responsive web experience, with tablet/mobile compatibility.
- Target 5–6 players and future-compatible expansion support, specifically Seafarers and Cities & Knights.
- Expansion selection per room/game.
- SQLite and PostgreSQL options.
- Nickname-based guest access with same-browser identity; authentication later.
- Deploy via Docker image.
- Commit each completed implementation phase.
- Audit design, UI/UX and mechanics for gaps and fidelity; incorporate that review into this specification before implementation.

### Proposed, pending confirmation at the named gate

- D-01–D-06 in §14.1 are the decision source for newly specified defaults. Do not promote this list into “user-confirmed” because the documentation was edited or committed.
- Technical choices remain React/TypeScript/Vite, Node.js, Colyseus as a candidate, SVG board, and Kysely or equivalent, subject to the architecture proof; no framework adoption is claimed.
- The revised plan replaces the previous automatic strict-TDD proposal with the current `off` workflow setting while retaining all required acceptance tests.

### Review evidence and limits

- Read the existing specification and reviewed official product/combination pages, base/SF/CK FAQs, 2025 5–6 rulebooks, and selected 2025 base/SF/CK source sections.
- Heading for New Shores 3/4-player targets/setup and 5/6-player setup were checked against SF25 pp.3–5 and SF56-25 pp.3–4. The 5/6-player 14-point target follows that book's explicit inheritance of the scenario without a target override; combined 16 points is derived from COMB's +2 rule.
- Base production shortage was checked against B25 p.6; C&K replacement components/initial setup against CK25 pp.3–5 and CK56-25 p.2. These checks do not constitute full card-by-card conformance or verified map-coordinate transcription.
- No application tests or playtests have run. Future implementation must produce the fixture/evidence index in §12 rather than treating these document references as passing tests.

### External references

- Official base game overview and rulebook download: [CATAN](https://www.catan.com/catan)
- Official 5–6 player expansion overview: [Play CATAN with 5 to 6 Players](https://www.catan.com/explore-catan/catan-basegame-expansions/play-catan-5-6-players)
- Official Seafarers overview, rules, and player-count information: [Seafarers](https://www.catan.com/seafarers)
- Official Cities & Knights overview and Seafarers combination notes: [Cities & Knights](https://www.catan.com/cities-knights)
- Official expansion family and scenario compatibility overview: [CATAN Basegame + Expansions](https://www.catan.com/explore-catan/catan-core-family-games)
- Colyseus rooms and lifecycle: [Rooms](https://docs.colyseus.io/room)
- Colyseus graceful shutdown guidance: [Graceful Shutdown](https://docs.colyseus.io/server/graceful-shutdown)
- CATAN intellectual-property policy: [Guidelines Dealing with Intellectual Property](https://www.catan.com/guidelines-dealing-intellectual-property-catan)

#### Edition-specific rule sources

- **B25:** [CATAN – The Game, CN3081 (2025)](https://www.catan.com/sites/default/files/2025-03/CN3081%20CATAN%E2%80%93The%20Game%20Rulebook%20secure%20%281%29.pdf).
- **B56-25:** [CATAN – 5–6, CN3082 (2025)](https://www.catan.com/sites/default/files/2025-03/CN3082%20CATAN%20%E2%80%93%205-6%20Rulebook%202025%20reduced.pdf), especially p.3 paired turns, card timing and victory.
- **SF25:** [Seafarers, CN3083 (2025)](https://www.catan.com/sites/default/files/2025-03/CN3083%20CATAN%E2%80%93Seafarers%20Rulebook%202025%20secured%20reduced.pdf), pp.2–5 general rules and Heading for New Shores.
- **SF56-25:** [Seafarers 5–6, CN3084 (2025)](https://www.catan.com/sites/default/files/2025-03/CN3084%20CATAN%20%E2%80%93%20Seafarers_%205-6%20Player_%20Rulebook.pdf), pp.2–4 paired roles, scenario inheritance and Heading for New Shores.
- **CK25:** [Cities & Knights, CN3087 (2025)](https://www.catan.com/sites/default/files/2025-03/CN3087%20CATAN%E2%80%93Cities%26Knights_%20Rulebook.pdf).
- **CK56-25:** [Cities & Knights 5–6, CN3088 (2025)](https://www.catan.com/sites/default/files/2025-03/CN3088%20CATAN%E2%80%93Cities%20%26%20Knights%205-6_%20Rulebook.pdf), pp.2–3 replacement components, player aid and paired rules.
- **COMB:** [Seafarers — Rules for Cities and Knights with the Seafarer Expansion](https://www.catan.com/seafarers), reviewed 2026-10-26; mirrored context on [Cities & Knights](https://www.catan.com/cities-knights).
- Official clarifications: [Basegame FAQ](https://www.catan.com/faq/basegame), [Seafarers FAQ](https://www.catan.com/faq/seafarers), [Cities & Knights FAQ](https://www.catan.com/faq/cities-knights). Apply only entries compatible with the chosen edition; these pages also contain historical and variant rules.
- Accessibility reference: [WCAG 2.2](https://www.w3.org/TR/WCAG22/) and [Target Size (Minimum), including exceptions and equivalent controls](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html).

This is a paraphrased implementation specification, not a reproduction of official card text or artwork. The review checked the stated high-risk clauses, not every rule/card/layout. Implementation must capture edition hashes, cite source clauses, resolve any conflict, and test the exact profile it enables.
