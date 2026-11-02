# Browser-Based CATAN-Style Game: Design Specification

Date: 2026-10-26
Status: Product decisions D-01–D-06 confirmed; implementation and technical validation pending
Revision: 2026-10-26 — approved rules/scope, configurable room policies, server saves, text chat, and bilingual UI incorporated
Scope: Product requirements, system design, implementation plan, and acceptance criteria

## 1. Summary

Build a browser-based, multiplayer hex-board trading game for friends and public-table play. The initial product target supports 3–6 players, private rooms, a public room browser, touch-capable responsive controls, and room-selected rule modules. The confirmed final first-release target is the full §5.7 base/5–6/Seafarers/Cities & Knights matrix. Deliver a playable base game first, then enable expansions/combinations only after verification. Room text chat, Traditional Chinese/English UI, and server-side save/resume are part of the first release.

Ship the web client and game service as a Docker image. Operators choose SQLite for a compact single-instance installation or PostgreSQL for a separately managed database. Players initially join using a nickname and a persistent browser guest identity; account login is deferred.

The user confirmed D-01–D-06 on 2026-10-26, including the follow-up choices on mid-game policy changes and server-side saves; §14.1 is the decision record. Section 3 records user requirements. These approvals establish the product baseline, not completed implementation, test evidence, an architecture decision record, or authorization to begin coding in this documentation task. Technology candidates still require their planned proof; remaining operational details are listed separately and do not reopen the confirmed product choices.

The fidelity reference is the selected official physical tabletop rules, including their information boundaries and negotiation opportunities. Visual presentation may be original; rule shortcuts, automatic decisions, or convenience features must not remove a legal strategic choice. This revision contains no claim of a rendered UI, completed game, or verified implementation.

## 2. Goals and Non-Goals

### Goals

- Let 3–6 people play together in a browser, including friends joining via an invite and players joining listed public rooms.
- Let the host configure the supported expansion/rule set before a game starts.
- Make the game state authoritative on the server and restore active games after brief disconnects and normal container restarts.
- Keep the desktop experience primary while supporting usable tablet and mobile layouts and touch input.
- Provide one Docker image and documented SQLite/PostgreSQL configuration.
- Structure rules and board topology so the planned expansions do not require replacing the base game's core model.
- Let a host fill open seats with built-in computer opponents, so a table can start without enough people (§4.9).

### Non-Goals for the first release

- Ranked matchmaking, ratings, tournaments, voice/video chat, spectators, and public game replay sharing.
- User accounts, social graph, cross-device identity recovery, and password reset.
- Arbitrary community plugins or user-authored scenarios.
- Multiple concurrently active game-service replicas or automatic horizontal scaling.
- Silent or automatic AI takeover of a disconnected player. A later opt-in, disclosed takeover policy may be added under §4.9; it never replaces a connected person.
- Computer opponents that use an LLM, a network service or another external decision source.
- Every published scenario or every possible expansion combination. The room may enable only combinations explicitly listed as supported.
- A companion app for physical-board play.
- Downloadable/importable player saves, historical-state rollback, and cloned/forked games. Operator backup/restore remains separate from a player-facing save feature.

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
| P-11 | Use the 2025 official rule family, retain the full §5.7 matrix as the final target, and deliver a playable base game before expansions. |
| P-12 | Configure room policies at creation or by the host before start; after start, policy changes require every seated player's consent. Transfer host authority when the host leaves. |
| P-13 | Automatically persist games and provide explicit server-side save-and-leave/resume; no downloadable/importable save, fork, or rollback to an older state in v1. |
| P-14 | Provide structured trading plus room text chat for negotiation, discussion, reminders, and social interaction. |
| P-15 | Initially deploy one application instance; retain the executable rule versions required by unfinished games. |
| P-16 | Provide Traditional Chinese and English in the first release, with the approved desktop/mobile/accessibility and seat-control behavior. |
| P-17 | Provide built-in computer opponents that the host can add to a room's open seats. Bots decide locally from their own seat's projection, without an LLM, network call or external service (§4.9). |

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
- Before start, only the host may change validated settings or start the game; settings changes clear readiness. The host may change the room capacity down to, but never below, the number of seated players. After start, immutable game rules stay locked, while room-policy changes follow the all-seat approval contract in §5.8.
- A lobby may start with any player count its ruleset profile supports, up to the room capacity; it does not need to be full. Starting locks the rules, map/scenario, seats, and actual player count.
- Before start, the host chooses how the game order is decided: `join` keeps the current seat/join order (default), while `random` draws a fresh complete order once at start with the server-side generator.
- Before start, the host may add or remove computer-opponent (bot) seats in the lobby, or request bots when creating the room (§4.9). Bot seats count toward the capacity and the started player count; at least one seat is always a person.

### 4.3 Play, disconnect, and recover

- The UI distinguishes the turn owner, the current action-window actor, and players with mandatory responses. Every player sees their own available actions, costs, disabled reasons, and required responses; a player with no current action sees whom the game is waiting for.
- The server validates each action and publishes the resulting authorized view to each player.
- On a temporary disconnect, retain the seat and show connection status. Rejoining with the same guest identity restores the seat, private player view, and any unresolved required choice.
- A disconnected player is not silently replaced by an AI, skipped, or assigned a random discard. Bot seats (§4.9) are separate seats chosen before start, never a replacement for a person's seat. Apply the confirmed room policy and safeguards in §4.6/§5.8. A host cannot unilaterally change an active game's policy, and manually saving is not a withdrawal or a request to abandon.
- On normal service/container restart, recover saved games and allow players to reconnect. If recovery is impossible or a save is corrupt, preserve the last recoverable data and show a clear failure rather than silently starting a new game.
- The home/room screen offers “Resume game” for the current identity's unfinished seats. Recovery explains missed public actions, the current required action, and whether an outstanding command committed. It never asks the player to guess whether to repeat a purchase or trade.

### 4.4 Turn windows and mandatory responses

The rules engine owns a phase/action-window contract: stable window/effect ID, turn owner, permitted actors, each actor's mandatory and optional actions, resolution order, completion condition, and next phase. A turn owner is not a universal authorization check. A pending effect stores the continuation needed to resume after its choices resolve; these fields are included in durable state. Pending effects form an ordered queue: one roll or card may enqueue several mandatory choices, each with explicit responders, and each resolves completely before the next becomes active; a choice-free continuation step (for example production after a Cities & Knights barbarian attack) resolves as soon as it is reached. The base game never has more than one pending effect.

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

Confirmed v1 interaction (D-04): public structured offers and counteroffers **plus room text chat**. Chat supports free-form negotiation, discussion, reminders, and social conversation without requiring external voice; only a structured transaction can transfer cards. A chat promise or “yes” is not transaction consent. Offers are negotiation, not proof of inventory. The engine enforces legal participants and actual inventory at settlement; the UI must not expose another player's hand through offer eligibility or inventory-specific errors.

1. During an eligible action window, the action actor creates an offer to one player or all eligible players. Others may propose a counteroffer to that actor. An offer states resource quantities given/received from a named player's perspective, audience, window ID, offer ID, and revision.
2. Recipients can decline, express interest, or consent to the exact displayed terms. A counteroffer is a new proposal/version requiring consent; it cannot silently rewrite an existing agreement. The action actor selects one consenting counterparty and confirms the final exchange.
3. Offers reserve no resources. Editing or withdrawing an offer invalidates consent to the previous revision. The server atomically rechecks both parties, terms, inventory, phase, and offer status when settling. Two simultaneous attempts to settle the same offer can produce only one completed exchange.
4. The observable lifecycle is `open → agreed → completed`, with `withdrawn` or `expired` terminal alternatives. A definitive settlement rejection leaves the offer and resource state unchanged and reports a useful private reason without revealing the counterparty's hidden inventory. While the window/consent is still valid, the actor may explicitly reconfirm using a new command ID after refreshing state, or withdraw/revise the offer; retrying the rejected command ID returns its original receipt. Withdrawal, revision, and expiry are separate accepted negotiation/system transitions, not side effects hidden in a rejected game command. Completed exchanges are final.
5. Unsettled offers expire at the end of their action window, a game pause/end, disconnection of a required party, or service restart. Expiration and its reason are visible. A committed exchange survives these events. Draft editing can be preserved locally during a retry, but resubmission must use current terms and state.
6. Executed domestic exchanges and their quantities are public. Bank/harbor exchange has a separate entry showing the player's applicable rate and available choices; it does not wait for another player. Paired Player 2 has no domestic-trade entry.

Acceptance: four clients exercise concurrent interest, counteroffers, term edits after consent, withdrawal, resource changes, phase changes, and connection loss before/after commit. Include definitive rejection followed by a new confirmation, replay of the rejected receipt, and expiry racing settlement. Old terms cannot settle; a completed trade deducts and grants resources once; everyone can distinguish negotiation, failure, expiration, and completion. A chat message alone can never settle an offer.

#### Room text chat contract

- Provide one room-wide plain-text channel available in the lobby, game, pause/save coordination, and result view to authenticated members of that room. No direct messages, attachments, executable markup, external spectators, or automatic translation in v1. During play, the audience is the seated players; later membership in a new game grants no access to the previous game's private channel history.
- Clearly separate player-authored chat from authoritative game events, rule notices, trade terms, and policy-vote controls. Show stable sender identity/seat/color-label plus nickname, server timestamp, and message status; changing a nickname cannot impersonate another seat or a system notification.
- Allow conversation outside the sender's action window, but do not expand their legal actions. Player 2 can talk while domestic trades remain disabled. Chat claims about cards are user-authored statements, not server-certified inventory; never automatically append private hands, debug state, or card-effect inspection data.
- Enforce authenticated room membership, bounded message length/history pages, per-sender and per-room rate limits, and safe plain-text rendering server-side. Exact operational limits are documented before public deployment. Reject HTML/script execution; display links as inert text in v1. Room codes, credentials, and protected state are never added automatically to chat.
- Use client message IDs with durable acknowledgement/deduplication and server ordering. Distinguish sending, sent, rejected/rate-limited, and unknown outcome; retry an unknown send with the same ID. Preserve an unsent local draft where safe and fetch authorized recent history after reconnect without duplicate messages. Chat does not advance the strategic game revision or invalidate a player's move merely because someone typed.
- Provide per-user mute and visible rate-limit/rejection feedback for immediate abuse control. Muting affects that viewer's chat only: it cannot hide game events/required-action prompts, remove a seat, or prevent voting. Host status alone does not grant a new power to silence the table, delete others' history, or bypass all-seat policy consent. Broader room-wide moderation/reporting powers require a separately agreed policy and are outside v1 scope.
- Keep an unread indicator when the panel is closed, do not steal focus or scroll away from a player reading earlier messages, and do not announce every message over a mandatory action. On mobile, chat uses the secondary drawer and must not cover the board's required controls. User-authored text is shown verbatim in either UI locale; system notices are localized separately.
- Bind saved chat history to its room/game membership epoch. While a game remains resumable, its participants can recover authorized recent/history pages under the disclosed retention policy. New-game members cannot inherit that history; chat retention/deletion is documented alongside game retention. A personal mute does not delete shared history.

R-CHAT acceptance: mixed-locale clients negotiate in text then confirm a structured trade; messages during another player's turn cannot execute a move; identical nicknames remain distinguishable; injection/rate-limit attempts fail safely; personal mute does not suppress mandatory actions or policy votes; send-ack loss/reconnect does not duplicate messages; unauthorized/new-game members cannot fetch old history; narrow-screen chat and soft keyboard do not block required gameplay.

### 4.6 Presence, host transfer, pause, and abandonment

D-03 is confirmed with configurable room policies and the fixed safeguards in §5.8; these are online room behaviors, not changes to physical CATAN scoring. Defaults are no turn clock/AI, a five-minute disconnect grace period, all-seat consent for pause/resume, and the defined connected-player abandonment option. If enabled, a turn clock is advisory only: expiry prompts players but never chooses a move, discards, skips, or awards a win. The room's disconnect grace period is measured from the server-observed loss of the seat's last authenticated live connection; it is a presence threshold, not a move deadline. The server records `disconnected_at` after a transport close or expiry of its documented heartbeat-liveness deadline, not when the connection was created; successful seat reconnection clears it. After service restart, start a fresh recovery grace period before absence can authorize host transfer or abandonment; do not count server downtime as player inactivity.

| Situation | Confirmed/default behavior | Authority and recovery |
|---|---|---|
| Host deliberately leaves a room, including Save and leave | Transfer room administration to the earliest-joined connected remaining member; close only a genuinely empty pre-game lobby. | Active/saved seats are not removed. If nobody remains online, retain the room/game; elect the earliest-joined connected member when members return. Returning former hosts do not displace a valid successor. |
| Host unexpectedly disconnects | Retain the role during the applicable grace period. After expiry, transfer to the earliest-joined connected member, or elect on a later member's return if none is online. | Reconnection before expiry retains the role; after transfer, the former host returns without reclaiming it. Host status cannot bypass readiness: all occupied seats must be connected, ready, and match an eligible count to start. |
| A seated player disconnects during play | Retain their seat. Unaffected legal actions may continue until that player must respond; then expose a persistent waiting state. | Never auto-discard, auto-roll, skip an actor, or replace them. End-of-game results take precedence if legally reached before a required response. |
| A player returns | Restore the same seat and authoritative state; clear the missing status. | Confirm command outcomes, expire obsolete negotiation, and resume their unresolved choice. A connection returning during an abandonment vote invalidates that vote. |
| Players want a break | Any seated player may propose pause; require consent from all seated players. On acceptance, freeze game commands and expire offers while retaining pending effects. | Resume requires all seats connected and explicit readiness. Presence/recovery remains available while paused. No strategic action is undone. |
| A player explicitly withdraws, or remains missing beyond the grace period | Mark the session interrupted. If the selected policy permits abandonment, any connected seated player may propose it; all currently connected seated players must confirm the same proposal. | Verify policy, absence, and voter membership again at commit; cancel the proposal if eligibility changes. On agreement, save an `abandoned` result without a winner. If abandonment is disabled or no agreement exists, retain the interrupted game for later resumption. A deliberately saved/suspended table does not count expected absence as an abandonment trigger. |
| Game already started and host changes | A host change only affects room administration; it cannot kick a seated player, change rules, inspect hidden state, or decide their move. | Seat ownership and game-rule authority remain unchanged. |

`Interrupted` is a presence flag, not a pause of every action: unaffected legal play may continue, but an absent/withdrawn player's required response blocks progression. An abandonment proposal alone does not freeze the game. Serialize its final commit with all game commands and recheck that the game is nonterminal, the absence condition still holds, and the current connected voter set has consented. The first valid terminal transition wins: a committed normal victory cancels abandonment, while committed abandonment rejects later strategic commands. Reconnection clears the absence flag and invalidates the vote; an explicit withdrawal must be retracted before that seat may act. Explicit consensual `paused` state, unlike interruption, freezes all strategic commands until resume. Test vote + victory, vote + reconnect, and voter disconnect races.

The abandonment confirmation names the absent player(s), explains that it terminates the saved game without a winner, and is separate from closing the page. A player can retract an explicit withdrawal before abandonment commits, invalidating the proposal. The confirmed default permits remaining connected players to end an interrupted table after prolonged absence, but the host can disable this option before play or propose a change requiring all-seat consent after start. Never treat a Save and leave request as explicit withdrawal; a player leaving alone still follows the room's disclosed absence policy unless the whole table has agreed to suspend. Interrupted games are not removed by stale-lobby cleanup; retention is an operator policy disclosed before deletion.

Bot seats (§4.9) are never absent, never vote and never hold host authority. Host succession, pause/save consent, resume readiness, the abandonment absence condition and its voters, and post-start policy consent (§5.8) consider human seats only. When every other seat is a bot, the only human seat may end the game without an absence condition; the confirmation still states that the game ends without a winner.

### 4.7 Game completion and another game

- Evaluate victory at every rule-required boundary, including the start of an eligible turn/window and after scoring effects. Persist one terminal result and reject further game mutations; cancel outstanding offers and stop action prompts.
- All clients, including later reconnects, receive the same winner, terminal reason, and permitted scoring breakdown. Show `completed`, `abandoned`, and `recovery-blocked` distinctly; an aborted game has no fabricated winner.
- Keep the final board inspectable. Reveal the winner's necessary victory-point cards according to the selected rules; do not automatically reveal other hidden hands or deck order.
- The user requested a post-game statistics screen in the style of an RTS result screen. The engine accumulates per-player counters inside the snapshot (the public log is capped, so totals are not rebuilt from events): resources by source and sink (dice production, setup, Year of Plenty, Monopoly, steals, bank and player trades, building, discards), development cards drawn by type and played, knights, robber moves, steals and thefts suffered, rolls blocked by the robber and the production they withheld, bank-shortage losses, peak hand size, dice distribution and per-turn victory points including hidden points. Because these counters disclose drawn card types and stolen resource identities, they are published only in projections of a game that already has a result (`completed` or `abandoned`); deck order stays hidden. Snapshots written before statistics existed start zeroed counters on their next transition and the result screen marks them as partial.
- Offer return to lobby and another game. Reuse membership/settings as a proposal, allocate a new game ID, and require readiness again. The completed game remains immutable; invite links never let a new visitor occupy a seat in that completed game.

### 4.8 Automatic save, Save and leave, and resume

Confirmed D-03 save mode: server-side automatic persistence plus an explicit save-and-leave action. A save records the continuing game, not a new copy or a selectable historical checkpoint. The UI's `suspended` label means the existing authoritative paused state with `pauseReason=saved`; it does not introduce a second pause engine or independent recovery owner. The same browser-bound identity owns the same seat on return; there is no download/import, rollback, branch, or cross-device seat-recovery feature in v1.

- **Automatic save:** every accepted game transition uses §7.2's durable boundary. Show the most recent acknowledged save time/revision and a clear unavailable/pending state on storage failure. Saving does not expose private cards or change a random result.
- **Save and leave (one player):** any seated player may request a server save barrier with a unique request ID. After all earlier accepted game commands commit, durably acknowledge the recorded revision, seat, and save time; only then confirm successful save and leave the live connection while retaining membership. This does not pause everyone else or mark the player as withdrawn. Warn that others may continue and that the room's ordinary absence/abandonment policy still applies. On return, resume the latest state, not necessarily the revision at departure.
- **Save and suspend table:** any seated player may propose a shared save/pause. All seated players must consent; an absent player is not treated as consenting. Atomically checkpoint and mark the game `suspended` before declaring it safe for everyone to leave. Cancel negotiation and pending room-policy proposals, preserve strategic pending effects, and freeze moves/advisory clocks. Once suspended, expected offline time cannot authorize abandonment or ordinary stale-lobby deletion; only the separately disclosed operator retention process can retire a saved game, with prior notice and the stated recovery policy. Host administration can still transfer without changing seats or unpausing the game.
- **Resume suspended table:** reconnect using original identities, load the same game/version and authorized views, and collect all-seat readiness. Only then resume the pending phase/choice. Host presence alone is insufficient. Restarting the service or opening the saved-game entry never automatically resumes play or starts absence/advisory deadlines while suspended.
- **Failure/unknown outcome:** a save acknowledgement lost in transit is resolved by its request ID and existing receipt before retry. A failed manual checkpoint does not erase prior autosaves; keep the user on a retry/recovery screen rather than claiming a successful save. Browser closure before acknowledgement cannot be prevented, so recovery uses the last committed server state and visibly reports it.
- **Save discovery and lifecycle:** the home screen lists the identity's ongoing/suspended games, ruleset, participants, last activity/save time, and whether all seats are needed. Only original members can resume; knowing an invite/game ID is not enough. Completed/abandoned games are inspectable results, not resumable saves. Recovered private state and chat obey their original audience boundaries.

R-SAVE acceptance: autosave plus save-and-leave in an ordinary turn and during a required choice; one person leaving versus a fully suspended table; host transfer when the host leaves after saving; all players offline across a restart; unanimous suspend/resume; save commit racing a trade or victory; acknowledgement loss and duplicate save requests; storage failure; same-identity seat restoration without replaying dice/cards; refusal of a historical-revision resume or unauthorized seat claim. A terminal result wins over a later suspend/save request; no save operation can resurrect an ended game.

### 4.9 Computer opponents (bots)

A bot seat is a seat played by the service's built-in strategy. The design and delivery plan are recorded in `docs/aegis/specs/2026-11-01-bot-opponents.md`; the requirements below are normative.

- **Seats and labeling:** before start, the host adds bots to open seats or removes them; bot seats are ready by definition and are labeled as computer opponents, with their difficulty, wherever seats are shown. A bot has no login credential, cannot be host and does not chat. Bots cannot be added or removed after start.
- **Information:** a bot decides only from its own seat's authorized projection (§8.3), public board topology and rules constants. It never reads authoritative hidden state, and no other seat gains information from it.
- **Locality:** decisions run inside the service with no LLM, network call, model file or other external service, so a bot table works offline.
- **Commands:** bots submit through the same validated command path as people, with stable command IDs; every §7.2 durability and receipt rule applies. A decision is deterministic for a given projection and seed.
- **Pacing and presence:** bots wait a short, action-dependent delay so people can follow the table, including the dice presentation. They act only while at least one human seat has a live connection, so a table that everyone left does not play itself.
- **Trading:** bots answer offers addressed to them and use bank/harbor rates. During their own action window they may propose a bounded number of domestic offers; they wait a collection window before choosing a partner and withdraw an offer nobody accepts within a timeout.
- **Rulesets:** bots play only rulesets whose every rules module the built-in strategies support; today that is the base game, including paired 5–6 player turns. The service refuses bot seats in any other profile and blocks start while one is seated, and the lobby says why in both languages. A module joins the supported list only once the strategies issue its commands and answer its pending frames.
- **Difficulty:** this release provides `easy` and `standard`. Difficulty changes strategy quality only, never information access.
- **Safeguards:** a bot never blocks the table indefinitely. If its strategy produces a rejected command, it falls back to a minimal legal action; a persistent failure is logged and retried with backoff. A bot seat never replaces, takes over or acts for a human seat. Any future takeover requires an opt-in room policy approved under §5.8, visible labeling and immediate return of control on reconnection.

R-BOT acceptance: bot moves are always legal and deterministic for a seed; bot-only simulated games terminate with a winner across every enabled profile that offers bot seats and every player count; two states that differ only in hidden information produce the same bot decision; bots pause without a connected person and continue on reconnection; restart recovery continues a bot table from the committed state; a person and a bot racing on one revision commit exactly once; host succession, pause, resume, abandonment and policy votes follow the human-seat rules in §4.6.

## 5. Room Settings and Rule Compatibility

Room configuration is validated as a complete ruleset, not as independent unchecked toggles.

### 5.1 Room settings

- Visibility: private or public.
- Player capacity: 3, 4, 5, or 6. The host may change it before start, but not below the seated players and only to a count the selected profile supports. A game starts with any supported seated count up to that capacity, so a four-seat base room may start with three and a six-seat paired room with five.
- Expansion set: base rules are mandatory; the lobby offers only expansion sets that some enabled registry profile has (today: the base game and Seafarers — Heading for New Shores). Seafarers, Cities & Knights, Traders & Barbarians and Explorers & Pirates are registry vocabulary, not free toggles.
- Scenario/map: choices depend on the selected expansion set and player count. The host picks expansion set → scenario (with its variants) → player count, and that choice resolves to exactly one registry profile; the profile name and the boxes it needs are shown before the room is created.
- Victory target: derived from the selected official scenario/rule profile by default; custom targets are not in the first-release scope unless separately approved.
- Room policies: advisory turn clock off by default, disconnect grace five minutes, and the absence/pause/save behavior in §5.8. The host configures them before start; approved post-start changes require all seats. No setting enables AI or automatic strategic decisions.

### 5.2 Compatibility policy

- Each supported ruleset/scenario is an explicit registry entry with a stable identifier, rule-version identifier (`ruleVersion`), eligible player counts, expansion set (`expansions`), `scenario`, `variants`, rules modules, layout builder (`layoutId`) and default topology, scoring target, rulebook sources (source id + pages) and display-only `requiredBoxes`. An entry may be `implemented` (fixtures can run it) without being `enabled` (offered and accepted).
- The lobby only offers valid combinations. Invalid combinations are rejected server-side even if a modified client submits them. The server resolves a request — a profile id, or `{ expansions, scenario, variants }` plus player count and setup mode — by exact, order-insensitive match against one enabled profile; it never infers a combination transitively (SF+CK and CK+T&B being registered says nothing about SF+CK+T&B).
- A game stores a snapshot of its ruleset and rule version: the snapshot's `engineVersion` is the profile's `ruleVersion` at creation (`base-2025.3` for both base profiles). Deploying a new rules version must not silently change an in-progress game's behavior.
- Start with the base game and the user-selected targets (5–6 players, Seafarers, Cities & Knights). Add scenarios/combinations only after rule implementation and tests pass.
- The official product family has multiple expansions and scenario-specific compatibility constraints; therefore “any combination of checkboxes” is explicitly not promised. For example, the official Seafarers guidance lists suitable Cities & Knights combinations and scenario limitations. See references.
- Confirmed D-01 baseline: the 2025 English rulebook family in §5.3, including paired-player turns for 5–6 players. Both UI languages implement this same rule meaning. Historical special-building rules are a separate profile and are not silently mixed into this baseline.

### 5.3 Confirmed rulebook baseline and source precedence

| Source ID | Confirmed authoritative edition | Required coverage |
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

The confirmed 2025 procedure replaces the historical special-building phase. Player 1 performs production and an action phase; Player 2 is the third player to Player 1's left in the official seating order and then performs an action phase without another production roll. After Player 2 finishes, both markers move to the next player to their left. Record seating orientation explicitly in the board/UI; verify both five- and six-seat cycles.

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

Implemented Seafarers contract (P1, 2026-11-01; evidence and fixture map in `docs/FIDELITY.md`): ships occupy sea edges and the frame's inner edge (topology boundary edges), never land–land edges; roads occupy land edges and only roads extend roads; a road and a ship continue each other only at the owner's building, for placement and for the Longest Trade Route. A ship moves at most once per action window (each paired actor has its own window), only from an open end, never when built in that window or next to the pirate; the move is one transition, so awards and victory are judged on the final board only. On a 7 or a Knight the actor names one target: a land hex moves the robber, a sea hex or `null` (the frame) moves the pirate, which then robs only players with a ship on that hex. Gold is resolved after ordinary production through a pending frame in turn order from the roller, each choice paid from the remaining supply. The island bonus is tracked per player and island, earned by the first own settlement there and kept. The pirate starts on the frame in all three New Shores maps.

R-CK fixtures must cover every progress-card type's timing, legal targets, effect, information access, required responses, deck return, and cancellation boundary. Include Alchemist before the roll, progress-card limit handling outside the holder's turn, and VP cards' public treatment. Also cover all knight levels/piece limits, activation/promotion/movement, city walls, improvement abilities, metropolis tie/transfer/protection, merchant ownership, and commodity trading/discard/theft. A generic “progress cards implemented” assertion is insufficient.

C&K dice/event resolution follows CK25/CK56-25: resolve barbarian advancement/attack or progress-card acquisition as indicated by the event die before resource production or the 7. Pending choices and deck-shortage ordering complete before the next effect. A city lost to that attack produces as a settlement on that roll; a lost wall affects the ensuing discard threshold. Test attack + 7 on one roll, defense strength equal to attack, tied best defenders receiving progress cards instead of a Defender VP, tied eligible weakest defenders losing cities, metropolis-only protection, no spare settlement piece, and participating knights deactivating. Before the first barbarian arrival, apply the official robber protection; discards on 7 still apply.

Implemented Cities & Knights core contract (P2, 2026-11-02; evidence and fixture map in `docs/FIDELITY.md`): setup places a settlement and road, then a city and road in reverse order, and the city yields one resource per adjacent hex. A roll is yellow + red + the event die. The event resolves first: a ship advances the barbarians (attack on the 7th space), and a city gate lets every player whose level on that track covers the red die draw from that deck, in turn order from the roller. Off-turn players then discard to 4 progress cards before production continues. The roller has until the end of their turn. VP cards are revealed at once and do not count toward the hand limit. An attack compares the number of cities (a metropolis city counts once) with the active knights' strength. If the barbarians are stronger, the weakest eligible contributors each choose a city to lose; metropolises are protected, and a city with no settlement piece left is toppled until rebuilt. If the defenders hold, the single best contributor takes 1 VP; on a tie, the tied players each choose a deck to draw from. After an attack, all knights become inactive. The robber does not move or steal until the first attack places it on the desert, while discards on a 7 still apply. The production loop then resumes from a continuation frame. Cities on forest, pasture and mountains produce one resource and one commodity. Walls (at most 3) add 2 each to the discard limit. Improvements cost *n* commodities for level *n*. Level 3 unlocks the track's ability: science gives a resource when a player received nothing, trade gives 2:1 commodity trades, politics allows mighty knights. Metropolises go to the first player at level 4 (temporary) or level 5 (permanent), each on a different own city. Knights (2 per strength, recruited inactive on own routes) block roads and building sites. A knight may activate, promote once per turn, and move, displace or chase the robber (once per activation, not in the window it was activated). A displaced knight's owner retreats it or loses it. Base development cards and Largest Army are disabled. Progress-card effects and the merchant are specified in the next paragraph.

Implemented Cities & Knights progress contract (P3, 2026-11-02; profiles `ck-2025` and `ck-paired-2025` enabled; card map, interpretations P3-1…P3-9 and evidence in `docs/FIDELITY.md` and the P3 work record): 54 progress cards in three decks. Printing and Constitution are VP cards revealed at once; the other 23 types are played by `progress.play` in the holder's own Action phase with nothing pending, on the turn they are drawn too, and Alchemy only in the Roll Dice phase before the roll (so never for paired Player 2, who still plays every other card). The card's effect is a paraphrase of CK25 pp. 13–16 and each effect that names a board or player target needs a legal one; a card that cannot benefit anybody is still played. A played card goes face down under its own deck. A response with exactly one possible answer resolves without a prompt (P3-2); other responses use module frames with responders (`citiesKnights.harborExchange`, `.guildDues`, `.espionage`, `.sabotage`, `.wedding`, `.treasonRemove`, `.treasonPlace`, `.diplomacyRoad`). Hands, taken cards and the cards named in an event reach only the players involved. The merchant is one piece controlled by whoever played the latest Merchant card: 1 VP, and a 2:1 supply rate for the resource of its hex while the controller holds it; Merchant Fleet and the merchant raise the controller's rate for the turn. Colours, emblems and card wording are original; no official artwork or text is used.

For any approved Seafarers + Cities & Knights profile, R-COMB fixtures explicitly verify all of the following:

- Target = that Seafarers scenario's target + 2, not a universal 13.
- Gold fields produce resources only, not commodities; the merchant cannot occupy gold.
- First-barbarian-arrival protection also applies to the pirate when present.
- Knights may travel along eligible road/ship networks; knights can close a route and enemy knights can interrupt its longest-route count without making adjacent ships freely movable.
- Knight/pirate actions and progress-card ship interactions follow their specific clauses. Do not infer that every card mentioning the robber can move the pirate; Bishop remains robber-only.
- Both 5–6 expansion rulebooks apply when that player count is enabled; proving each expansion separately does not prove their combination.

Implemented Seafarers + Cities & Knights contract (P4, 2026-11-02; profiles `sf-ck-new-shores-2025` and `sf-ck-new-shores-paired-2025`, engine `sf-ck-2025.1`, enabled for human seats; COMB clauses, interpretations SFCK-1…7 and the fixture map in `docs/FIDELITY.md`): the profiles run the rules modules `['seafarersCitiesKnights', 'seafarers', 'citiesKnights']`, where the first is a small combination layer holding only the rules that exist because both expansions are present. The board, ships, gold, island bonus and Longest Trade Route are Seafarers'; setup (settlement, then city), the event die, commodities, walls, improvements, metropolises, knights, barbarians, the progress decks and the merchant are Cities & Knights'. The target is 14 + 2 = 16. Both bandits wait off the board until the first barbarian attack (robber `-1`, pirate on the frame; the printed robber hex produces until then); the attack puts the robber on the scenario's robber hex, and from then on a 7 moves either bandit. A knight chasing the robber moves the robber only; an active knight on any intersection of the pirate's sea hex may chase the pirate (`knight.chasePirate`) to another sea hex or the frame, after which the pirate robs as usual. Knights move along own roads and ships (road and ship meet only at an own building or the knight's start) and may end on an intersection of three sea hexes next to an own ship, but are recruited only on land. A knight at the last ship closes that route; an opponent's knight interrupts the Longest Trade Route and pins the ships next to it, and no ship move may leave a knight without its route. Gold yields resources only, counts as production for the aqueduct and is chosen before the aqueduct bonus; the merchant never stands on gold. Road Building, Diplomacy and Intrigue treat ships as they treat roads; a ship re-placed by Diplomacy counts as built that turn and may not move in it. The 5–6 profile combines both paired rulebooks: Player 2 builds, trades with the supply, moves one ship, plays progress cards except Alchemy and takes knight actions, including the pirate chase.

### 5.7 Confirmed final release target matrix

Confirmed D-02 selects **Heading for New Shores** as the first Seafarers scenario and retains the full matrix, including its C&K combination, as the final target. Deliver base first, then expansion milestones; these are target profiles, not currently supported features. Each row containing multiple counts is expanded to a separate registry entry and acceptance run for each count; fixed/variable setup modes also have distinct recorded setup descriptors. No unchecked combination is enabled.

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

The actual layout data must transcribe the source map's terrain, numbers, harbors, island IDs, robber/pirate positions, and inventory into reviewed fixtures for each supported count; do not generate a merely similar-looking island. Variable setup follows the source's constraints and uses recorded server randomness. Fog/exploration scenarios and other Seafarers scenarios are deferred; do not implement or expose their mechanics solely because the engine can represent hidden hexes. A combined 5–6 row remains disabled until all applicable clauses and fixtures pass; if a contradiction remains, seek approval to revise the confirmed release target visibly rather than silently advertising the row.

As built (2026-11-02): every row of the matrix above is implemented and enabled. The combined 3/4 and 5/6 rows passed their R-COMB fixtures, simulated games and a browser run before `enabled: true`; like the Cities & Knights rows they accept human seats only (bot seats are refused).

### 5.8 Room-policy settings and post-start approval

Room policy is separate from the immutable game profile. The host may set validated policy values when creating a room and change them before start; changes clear readiness and show an updated human-readable summary. Once play begins, the host may **propose**, but not unilaterally apply, a policy change. Every original seated player, including the host, must consent to the exact proposal. A missing player cannot be skipped or represented by the host. Bot seats do not vote (§4.9).

| Setting | Confirmed default and allowed v1 variation | Fixed safeguard |
|---|---|---|
| Turn clock | Off; optionally enable an advisory clock with a positive duration from validated server limits. | Expiry shows an overdue cue only. No forced end turn, random move/discard, AI, or automatic win/loss; a required responder still chooses. |
| Disconnect grace | Five minutes by default; host selects another positive duration within documented server bounds. | Use server-detected disconnection; restart recovery gets a fresh grace period. Changing the duration cannot retroactively make an existing absence expire. |
| Long absence / explicit withdrawal | Allow §4.6's unanimous-currently-connected abandonment by default; alternatively retain the interrupted game without that option. | Never reinterpret ordinary Save and leave as withdrawal. An ended game has no winner unless normal victory committed first; suspended-table absences do not trigger abandonment. |
| Host succession | Automatic transfer to the earliest-joined eligible connected member. | Always enabled; applies when a host deliberately leaves and after the applicable unexpected-disconnect grace. Authority is administrative only. |
| Pause / save / resume | All-seat consent for a table-wide pause/save; all-seat readiness to resume. Individual Save and leave is always available. | These consent/privacy/no-rollback safeguards cannot be weakened by room settings. |

Rules edition, enabled expansions/scenario, actual player count/seat ownership, victory target and map remain locked after start even with a policy vote; changing them requires a new game. Room capacity is a pre-start setting; the started game's actual seated count is immutable. Language is a per-user preference, not a host-controlled game policy.

A policy proposal contains its own ID, base policy revision, exact before/after values and consent per stable player ID. Show it in both locales and keep ordinary legal play available while it is pending. Bind consent to that proposal, not to the strategic game revision: a normal move/chat must not silently change the proposed terms. Editing terms, host transfer, a voter's disconnect, entering pause/suspension, restart, or terminal completion cancels pending consent; publish the cancellation. A rejection leaves existing settings unchanged.

Once all seats consent, serialize acceptance with game/room lifecycle transitions, recheck host/seat authority and the current policy revision, and persist the new policy version/audit event atomically. New time budgets apply at the next eligible action window or newly detected absence; existing windows, absences, and abandonment eligibility keep the policy version with which they began. Display the effective boundary. No update can shorten a currently running clock, revive an ended game, or bypass an already required response. On resume, start fresh windows/grace timing under the latest accepted policy rather than charging paused time.

R-POLICY acceptance: creation/pre-game edits clear readiness; a host-only post-start write is rejected; all original seats must consent; edited proposals require fresh consent; mixed-locale users see identical terms; missing seats block approval; host succession and disconnect cancel pending votes; restart preserves accepted policy but cancels pending proposals; new settings do not retroactively expire a current wait; policy commit racing suspension/victory produces one valid ordered outcome.

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
  ├─ built-in bot driver and strategies (submit through the command handler from bot-seat projections)
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
- Web: React, TypeScript, Vite; DOM target controls over a lazy Three.js / React Three Fiber modeled board with SVG compatibility during loading or GPU failure.
- Service: Node.js and TypeScript; evaluate Colyseus for room/session and reconnect lifecycle. Keep rules engine framework-independent so it can be tested without a live room server.
- SQL: Kysely (or equivalent typed SQL layer) with explicit portable schema/migrations for SQLite and PostgreSQL. Avoid database-specific behavior in rules and application services.
- Validation/tests: unit/property-style rule tests, service integration tests against both database engines, and browser end-to-end tests for room flows.
- Container: multi-stage Docker build, non-root runtime, health endpoint, graceful shutdown, configurable port/database URL, persistent SQLite directory, and Compose examples for SQLite and PostgreSQL.

Technology selection should be confirmed against the repository/runtime environment when implementation begins; this workspace currently contains no existing application code or stack conventions.

## 7. Data and Persistence

### 7.1 Core records (logical model)

- Guest player: stable ID, display nickname, creation/update timestamps, optional future account link.
- Room: room ID/code, visibility, host player ID, immutable game-profile reference, accepted room-policy values/revision, lifecycle status, and timestamps. Store policy-change proposals/consents separately from accepted policy; they are cancelled, not applied, on the invalidation boundaries in §5.8.
- Membership/seat: room ID, player ID, color, readiness, connection status, seat order.
- Game snapshot: game ID, ruleset/profile and immutable rules-engine version, board topology/state, turn owner/action window, pending effect/response state, public and private player state, random outcomes/remaining shuffled decks sufficient for deterministic recovery, and persistence revision. A seed is not exposed to clients and is not a substitute for already committed outcomes.
- Game event: ordered command/result metadata sufficient for audit/recovery, without exposing secret card identities to unauthorized clients.
- Command receipt: game ID, authenticated actor ID, command ID, canonical payload digest, accepted/rejected outcome, and committed revision. Receipts survive restart and remain available for at least the lifetime of a resumable game.
- Negotiation: offer ID/revision, originator, consenting parties, terms, action-window ID, and status. An offer is not a resource reservation; pending negotiation can expire on restart, but completed exchange and its receipt cannot disappear.
- Save receipt/checkpoint marker: save-request ID, actor/game ID, acknowledged authoritative revision/time, and result. It references the same canonical game state as autosave, not a second independent save engine or historical restore branch. Suspension state and all-seat readiness are durable game/session metadata.
- Chat: stable message ID and client-send ID, room/game membership epoch, sender ID, text, server ordering/time, moderation status and deduplication receipt. Use a separate chat sequence; do not reuse strategic game revisions for message traffic. Room/member authorization applies to live and history fetches.
- Locale preference: per-user supported locale (`zh-Hant` or `en`), separate from game rules/state. Commands, receipts, saves, policies and events use stable IDs/canonical values so either locale can resume the same game.

### 7.2 Commit/recovery boundary

For each accepted command: validate against current version, apply the transition, persist the new snapshot, ordered event, and command receipt atomically, then publish the state update. Rejected commands do not mutate game state. Serialize accepted state transitions per game and enforce a database revision check; a single service process does not prevent concurrent asynchronous handlers from racing.

- The command envelope identifies the game, command ID, expected revision, action-window/effect ID, and intent. The actor comes from the authenticated session, never a trusted client field.
- Check an existing receipt before stale-revision rejection. Repeating the same actor/game/command ID and payload returns the original outcome without redrawing dice, stealing another card, or settling twice. Reusing that ID with different payload is rejected.
- A stale or wrong-window intent receives a typed rejection and a current authorized projection. For simultaneous mandatory responses, clients retain a still-legal draft, refresh the revision, and deliberately resubmit after a definitive rejection; an unknown outcome is queried/retried with the original ID first. Never blindly replay queued strategic commands after reconnect.
- Commit failure leaves authoritative in-memory state unchanged. A crash after commit but before publication is recovered from the saved snapshot/receipt. Clients may miss events but must converge to the same revision through a full authorized snapshot; they do not reconstruct secret state from another player's event stream.
- Multi-step actions save pending effects and remaining choices. Cancelling a local preview is not undoing a committed effect. A transport/session reconnection feature alone does not establish durable room/game restoration.

SQLite mode requires a mounted persistent directory and a single application writer. PostgreSQL mode requires connection pooling limits, schema migrations, health checks, and documented backups. Both need backup/restore documentation and migration tests. Retention and deletion policy for finished games should be decided before public production launch.

### 7.3 Rules-version execution and upgrades

Confirmed strategy D-05: retain the exact rules-engine implementations and compatible snapshot readers needed by unfinished games; new games use the release's selected default. The ruleset registry dispatches to the stored version. Merely storing a version string or settings snapshot is not sufficient.

- Before deployment or startup, inventory unfinished games and check availability of their engine/profile versions and schema readers. An incompatible release must refuse to take over those games, preserve data, and report the blocking versions; never silently route them to the newest engine.
- Old versions may be retired only when no unfinished game references them and the documented restore policy for retained backups is satisfied. Restoring an older backup may require its original compatible image and migration path.
- Do not automatically migrate an active game's rules. Any future rule migration requires a separately approved policy, fixtures proving intended outcomes, a recoverable backup, and explicit notice to affected players. Schema migration is not permission to change game rules.
- Approved defect-fix exception: `base-2025.1` did not return building and development-card costs to the bank, so the finite supply drained until production and bank trades stalled (PR #19). Unfinished `base-2025.1` games continue on `base-2025.2`, which only restores the B25 rule that spent cards return to the supply. Cards already lost are not restored.
- Approved defect-fix exception (PR #60; explicitly approved by the maintainer on 2026-11-02): `base-2025.2` let a road extend through an opponent's building while refusing an extension from the player's own side of a cut, could stall the table when Road Building was played with fewer than two road pieces left or Year of Plenty with fewer than two cards in the bank, and refused an older Road Building, Year of Plenty or Monopoly card after another of the same type was bought that turn. Unfinished `base-2025.1` and `base-2025.2` games continue on `base-2025.3`; already-pending card effects are capped to the pieces or bank cards still available, including completing exhausted effects. Roads already built through an opponent's building stay on the board. This approval is limited to these defect fixes; other rules migrations still require separate approval.
- Test both ordinary restart and abrupt termination around validate/randomize/commit/publish boundaries. Acknowledged commands must survive; unacknowledged commands resolve as committed once or not committed, without inventing a second outcome.

R-REC acceptance: for each database, restart during initial placement, partial multi-player discard, robber victim selection, gold selection, a card's intermediate effect, knight displacement, and city-loss selection. Repeat trade/build commands across pre-commit and post-commit disconnects; inject database-write failure; test two simultaneous settlements of one offer; resume an old-version game after upgrading the service; and verify incompatible-image refusal plus documented backup rollback. States not used by a profile are marked inapplicable, not silently skipped.

## 8. UI/UX and Accessibility Requirements

### 8.1 Layout and shared-table context

- Desktop keeps the board primary, with stable locations for seat order/player status, own resources/cards, required actions, trade panel, and public event log. Show the last dice result, affected hexes, production summary, public score/awards, and current required responders. Preserve board orientation when the turn changes.
- Tablet reflows secondary panels. Mobile uses a compact status strip and one secondary drawer at a time; opening hand/trade/chat/help must not hide the current mandatory action, connectivity, or the way back to the board. Preserve zoom/pan when switching panels.
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
| Negotiation | Offered structured terms and responses use the public negotiation design in §4.5. | Inventory checks and error detail cannot reveal another player's current cards. A valid proposal does not certify ownership. |
| Room chat | Player-authored messages to the authorized room/game audience; distinguish them from engine-confirmed events. | Never append private state automatically. User-chosen disclosures are not an engine hand projection; old-game history is not exposed to new-game members or public discovery. |
| Game over | Winner, terminal reason, final board, public score components and victory cards that must be revealed. | Other players' private cards and deck order are not automatically exposed. |

For each enabled card/scenario, document any exception in that profile's fixture. Public room discovery receives only lobby metadata, not this seated-player projection. A bot strategy (§4.9) receives exactly its own seat's projection, the same payload a client in that seat would receive. R-VIS tests compare at least three identities plus an outsider for initial join, every sensitive event, reconnect, and game over. Legitimate deduction from public play is not a security failure; direct transmission or derived leakage of protected fields is.

### 8.4 Required actions, help, and recovery

- Persistently show “Your turn”, “Your response required”, or “Waiting for …” as distinct states. Discard shows required/selected counts; victim, gold, card, and expansion choices name the action and its completion condition. New required prompts are announced and reachable without losing valid unrelated drafts.
- Provide an in-game cost reference, terrain/resource/expansion legend, and contextual rule help. Disabled actions explain whether the obstacle is inventory, timing, connectivity, distance, piece supply, or permissions, without revealing another player's private state.
- Lobby rule summaries explain the edition and major departures from base, especially paired turns and C&K substitutions. Learning help is optional and dismissible; core play cannot require reading a full external tutorial.
- Cover loading, empty room list, invalid/expired invitation, full room, not-ready/start-blocked, submitting, declined/stale trade, offline, reconnecting, unknown command outcome, policy vote, save pending/failed, suspended/resume readiness, interrupted/paused, game over, recovery-blocked, and persistence failure states. Distinguish a retryable network issue from a rejected action or incompatible save.
- A same-identity second tab must not create a second seat or independent action authority. Confirmed default: the newest authenticated connection controls the seat, the old tab shows “Active in another tab” and cannot mutate until control is deliberately reclaimed. Reject commands from superseded connections and test no duplicate seat or ambiguous command ownership.

### 8.5 Device, accessibility, and experience acceptance

Confirmed D-06 baseline: **Traditional Chinese (`zh-Hant`) and English (`en`)** player-facing UI from the first release, with consistent mapped game terminology and English internal identifiers. Both locales cover the same complete functionality; additional languages are deferred. Target WCAG 2.2 AA for applicable interface content/controls; this is a verification target, not a conformance claim. In particular, provide semantic names, visible focus, complete keyboard operation, dialog focus return, non-color status, readable contrast, text resizing, and target size/spacing or equivalent accessible alternatives. Board geometry does not exempt surrounding controls or remove the need for a non-precision way to choose a legal target.

| ID | Required check and acceptance |
|---|---|
| U-01 | Exercise 1366×768 desktop, 768×1024 tablet, and 360×640 / 390×844 mobile CSS viewports, including mobile landscape and browser text zoom. Core actions, required-action prompts, and recovery controls remain reachable without overlapping; board panning is deliberate, not accidental whole-page overflow. |
| U-02 | Test mouse, keyboard-only, and touch for setup → roll → trade → build → end turn, plus discard/robber and each enabled expansion response. A pan/pinch does not place a piece; adjacent targets are distinguishable; preview cancellation has no side effect. |
| U-03 | Use a real iOS Safari device and Android Chrome device for touch acceptance, plus desktop Chromium/Firefox/WebKit browser checks with versions recorded. Include rotation, software keyboard, background/resume, slow connection, reconnect, and six-player dense boards. Emulation supplements rather than replaces physical-device evidence. |
| U-04 | Automated accessibility checks plus manual keyboard/focus, 200% text zoom, reduced-motion, non-color identification, and a screen-reader walkthrough of required choices and trade completion. Document uncovered assistive technologies; no blanket accessibility claim from an automated scan. |
| U-05 | Representative content includes long Traditional Chinese and English nicknames/text, duplicate names, maximum selected pieces, many resource/progress cards, many log entries, disabled actions, and recovery errors. Critical text cannot be truncated without an accessible way to read it. |
| U-06 | Accepted initial responsiveness target (measurement pending): visible local selection/submission feedback within 100 ms; committed-action acknowledgement p95 ≤1 s on the recorded reference device/server with six clients, 150 ms simulated RTT and no injected storage failure. Record at least 100 eligible commands and the workload. A result pending for 2 s shows an explicit waiting/recovery cue, never an assumed success. Measure production behavior; tune the budget only with recorded evidence, not by silently weakening it. |
| U-07 | A new player completes initial placement and a full turn with built-in help, can explain one blocked move, and can recover from a rejected trade. Observe at least one player unfamiliar with the interface; record assistance, errors, and unresolved friction rather than asserting “intuitive”. |
| U-08 | A group familiar with the selected tabletop edition completes a full four-player game; observe negotiation, waiting, information visibility, and rules disputes. Later repeat with six players and every released expansion/profile. Include at least one mobile participant. Any blocker, wrong rule outcome, hidden-data leak, or required developer intervention must be resolved/retested before that milestone passes. |

### 8.6 Prototype and visual evidence before expansion work

Before Phase 2 rules/UI breadth grows, review six connected prototype state groups: bilingual lobby/readiness/policy vote/host departure; main board/hand/mandatory action/help; text-chat-assisted trade/counteroffer/expiration; narrow mobile selection/preview; unknown command outcome/save/suspend/reconnect/resume; and result/final board/new lobby. Use realistic six-seat/expansion-density fixtures even while only base is playable. Prototypes may simulate effects but are not evidence that the engine or persistence works.

Once the vertical slice runs, capture rendered states and exercise them. Keep accepted screenshots with their locale, viewport, content and state as visual regression baselines; verify actual interactions separately. Phase 2 must already satisfy its core mobile/keyboard flows; Phase 7 is broad regression/hardening, not the first responsiveness review.

### 8.7 Traditional Chinese / English parity

- Provide a language switch from first entry, lobby and in-game settings; persist the player's explicit choice in the same browser. Initial selection uses supported browser preferences, falling back to Traditional Chinese for unsupported languages. Different players in the same room may use different locales. Do not reload the game or discard a draft/choice when switching.
- All player-facing navigation, room policies/votes, action labels, card explanations, costs, tooltips, legal-action errors, help, notifications, chat statuses, save/recovery flows, end-game summaries and accessible names must exist in both languages. Unsupported internal keys/raw server errors are not a user-facing fallback.
- Use stable message IDs/error codes and typed parameters rather than server-authored sentences as the protocol. Localize public game events and system/admin notices on each client, including historical/reconnected events. Store resource/card/scenario IDs and canonical numeric values, never translated text as rules/save identity. Policy consent binds to the same values regardless of display language.
- Maintain a reviewed terminology map between the official English baseline and Traditional Chinese names for terrain, resources, commodities, cards, actions and expansions. Translation must not change timing, costs, target eligibility or win conditions. Explain card effects in original wording consistent with the source rather than copying unlicensed card artwork/text wholesale.
- Format counts, dates/times and pluralization per locale without changing canonical data. Use fonts that support both scripts; test English expansion/wrapping, long Chinese names, IME composition, and mixed-script chat. Enter during IME composition cannot accidentally send a message or confirm a move.
- Chat and nicknames remain player-authored text; no implicit translation, inventory certification or language restriction. The UI can localize their labels/status, not rewrite the message. Changing locale preserves mute preferences, board position, selected targets and pending command IDs.
- U-I18N acceptance: translation-key completeness for both locales; mixed-locale clients complete setup, required responses, chat-assisted trade, policy vote, save/suspend/reconnect and result; switching locale during a draft or pending response preserves intent; rule/cost/consent values are identical; screen-reader names and narrow-screen layout work in both; original chat survives IME/reconnect unchanged. A passing English path does not imply Chinese parity or vice versa.

### 8.8 Approved visual direction — 2026-10-27

The user approved an island-exploration browser-game redesign: deep-ocean blue, warm gold and parchment, original local SVG island/terrain/card artwork, and consistent typography, surfaces, controls and status treatments. Entry/home present a game identity and clear create/join/resume paths; the lobby uses player seat cards, prominent invitation/readiness and explicit start blockers; play keeps the island board primary with stable player/hand/action regions and secondary-panel navigation. Mobile retains connectivity and mandatory controls outside secondary panels. Results inherit the same theme. Preserve all existing rules, protocol, identity, confirmations, recovery, information visibility and bilingual functionality. Do not imply unsupported expansions, fake activity statistics or official artwork. This approval selects a visual direction; rendered capture, interaction and device evidence remain separate verification obligations.

#### Follow-up visual revision — 2026-10-27

The user requested a second pass after the first panel-oriented game layout did not match the supplied landscape card-game reference. The play surface presents the same board-first game as a viewport-filling table, with contextual turn/build controls at the right and a collapsible secondary tool dock. In the subsequently approved interaction revision, every seat's public score and current actor remain in a compact left rail; expanding it shows full player details and the viewer's private score, reserving board space on desktop and overlaying from the left on narrow screens. The duplicate bottom score HUD is removed. Both rails start collapsed at every viewport size and open on hover, focus or their toggles. The entry, home, lobby and result screens fit one landscape viewport (at least 600 CSS px wide) without page scrolling, with overflowing lists scrolling inside their own panel; portrait viewports fall back to a single scrolling column. The private hand defaults to a persistent count/handle: mouse or pen hover expands it, leaving collapses after roughly 300 ms unless focused or pinned, and touch/keyboard have explicit controls. Mounted resource and development-card rows scroll locally without overlap; bought-this-turn cards remain visible and unplayable. New authoritative roll events briefly display enlarged dice at the screen centre before retaining the toolbar result, with reduced-motion support. Initial load, resume and reconnect display the current authoritative board and persistent dice result without replaying history. Only new authorised events received during a normal connection and continuously covered from the presentation cursor may animate; an insufficient event window rebases directly to the current state without fetching or replaying missing events. Effects never block required actions and are interrupted when a mandatory action appears. Only accepted-command feedback moves to the lower corner above the hand. Accepted and rejected feedback and toasts clear automatically after a short interval or when the turn changes, fading out rather than vanishing; a self-closing notice shows its remaining time as a ring around its close control, and the countdown holds while the notice is hovered or focused or the tab is hidden. A rejected command is reported once, in its receipt with the reason and retry, not again as a toast. Required actions and unknown/stale recovery remain prominent and stay until resolved or dismissed. Fullscreen is user-triggered and reversible; portrait layouts use the same owners and remain operable. This is a presentation revision only: rules, projections, private information boundaries, command preview/confirmation, recovery, identity and bilingual parity remain unchanged. Browser captures and interaction evidence are tracked separately from this requirement.

#### Board visual engineering candidate — 2026-10-28

The SVG candidate adds local terrain bottom faces, side edges and contact shadows, road contact lines, and building side faces, roof highlights and grounding shadows while retaining the existing geometry, number tokens, pips, harbors and player distinctions. Selection shows a translucent preview ghost. New confirmed authoritative events may play a 290 ms building drop or 240 ms road reveal only when their owner, target and piece match the current projection; authoritative results remain immediately available. Cancelled, rejected or unknown commands do not produce success effects. No camera shake or board tilt is introduced.

Production effects consume only positive integer aggregate grants from the viewer-authorized `production.resolved` projection. Flights show resource and `+amount`, from an aggregate allocation marker to temporary seat-marked receipt areas; eligible producing hexes are hints, not claims of payment from a particular hex. Empty or invalid grants generate no flights, and shortages are never inferred into payments. Persistent hand/seat counts and bilingual event text remain authoritative. Robber position follows the projection; theft always uses an identical neutral card back, with no resource identity in color, text, tooltip, aria or particles, even for an authorized participant.

Production and theft share a maximum of 24 flight icons; overflow retains complete aggregate receipt text and the authoritative record. Particle count is zero. Effects are non-interactive and hidden from accessibility navigation; no continuous RAF/ticker or Canvas context is added. The existing limit of eight presentation groups, each at most 800 ms, applies. Reduced motion, background transitions, mandatory actions, offline/recovery and unmount cancel pending effects without delaying results or responses.

The original SVG candidate and [D1 decision](aegis/work/2026-10-28-board-visual-spike/d1-decision.md) remain historical evidence, not proof of modeled 3D quality. The first 2026-10-29 [modeled board plan](aegis/plans/2026-10-29-board-3d-plan.md) introduced fixed orthographic Three.js / React Three Fiber rendering with real tile sides, buildings, roads, robber and terrain. That candidate kept SVG as the default and required opt-in for 3D.

#### Island diorama replacement — 2026-10-29

The user subsequently rejected PR #8's visual result and requested a detailed island based on the supplied Hearthsea footage, screenshots and heart-island reference, including camera movement and zoom. The [replacement plan](aegis/plans/2026-10-29-island-diorama.md) supersedes the candidate's fixed-camera and opt-in presentation choices. Original procedural models distinguish forests, clay quarries, sheep pastures, wheat fields, mountain ridges and desert dunes; harbors have piers and sailboats, settlements have pitched roofs and timber framing, cities have towers, and roads retain visible player colors. Layered shores, turquoise water and directional shadows form one miniature island. Merged vertex-colored geometry and instancing reuse the existing renderer.

The game now starts in `auto`: playable SVG remains visible until 3D is ready and on loading or GPU failure. `?renderer=svg` explicitly selects GPU-free compatibility, while `?renderer=r3f` explicitly requests 3D; unknown values normalize to auto. `?quality=low` reduces shadows and DPR rather than removing model volume. The same topology IDs, controller, confirmation, animation cursor and public projection remain authoritative. DOM controls own input; models cannot submit commands. Selection/drafts survive renderer fallback, and context restoration does not silently retry. Renderer changes rebase the existing presentation cursor without replaying history. Actual DOM seats anchor stage-local aggregate effects; absent or hidden anchors produce text rather than invented flight endpoints.

The shared viewport uses held left drag to rotate horizontally and change elevation vertically. Shift-left drag or right drag pans; wheel zooms. Single-touch drag orbits, while two fingers pinch to zoom and translate to pan. The existing SVG path retains left-drag pan. Keyboard pan, 30-degree rotation controls and `[` / `]`, plus a visible 25–80° viewing-angle slider remain available in both game and preview. Home/fit restores the initial orientation, elevation (50° desktop / 60° narrow) and extent. Fit projects a conservative model-envelope point cloud so coastal harbors and tall scenery fit at supported rotations, elevations and viewport sizes. `/?preview=island` provides a standalone 19/30-tile model review using the same renderer and camera; it does not request an identity or game API or enable expansion rules.

The user's subsequent readability refinements distinguish low single-cottage settlements from tall twin-tower gated cities. Enlarged number tokens sit at exact hex centers with a reserved scenery clearing; their digits face the camera's azimuth. Larger harbor plaques show explicit 3:1 ANY or resource-specific 2:1 ratios with resource icons and full names. The centered robber is an enlarged hooded figure with a face/mask, folded cloak, boots, satchel and walking staff. Camera elevation shares the existing viewport and projection owners, so target overlays and gestures follow the rendered camera.

The user's next correction preserves native scenery dimensions: complete trees, sheep, wheat plants and rocks form a crescent around the enlarged central token rather than being globally compressed. Ground banks follow the same opening, and placement lanes remain clear. Road width increases from .085 to .15 world units, with a slightly raised .055-unit profile and unchanged endpoints and player markings. Camera orbit begins after the existing 6 CSS-pixel drag threshold, so ordinary target clicks retain selection behavior.

The prior [3D acceptance matrix](aegis/plans/2026-10-29-board-3d-acceptance.md) remains a record of that candidate's engineering, art, reference-device and physical-device/accessibility gates. This replacement's implementation and browser checks do not establish user visual acceptance or phone GPU performance. Those human/device checks remain open; changing the local renderer default does not close them. This presentation work changes no rules, wire schema, identity, privacy or command ownership and does not claim M1/M3/M4 completion.

#### Hover information and compact score rail correction — 2026-10-30

The follow-up to PR #10 removes click-to-center/zoom and the map-element explorer panel. Hovering a terrain tile, building, road, harbor or legal action target for 1 second displays public information beside that element without changing the camera or selecting an action. Keyboard focus provides the same delayed information; Escape dismisses it. Brief passes, touch taps, dragging and camera changes do not open stale information. The floating information remains readable while hovered and stays within the viewport, including fullscreen. The 3D harbour hover region follows the rendered pier and moored boat rather than only its plaque; the SVG token keeps its compact hit target. Hovering the far end of a port shows the same public exchange rate, endpoints and adjacent tiles as the plaque.

The follow-up to PR #11 places the trade builder's give and receive selectors side by side. Bank and harbor exchange use a separate Exchange tool, displaying the server-provided rates rather than duplicating exchange inside domestic trade. Fresh gains in the local player's visible resource hand receive a decorative card-drop animation; initial loads, recovery and reduced-motion use do not replay it. Counts remain authoritative and update immediately. Both compact and focused dice use full-face pip patterns by default, while accessible descriptions retain the numeric results.

The left score rail now changes width: collapsed it retains player color/initials, authoritative totals and the turn flag; expanded it also shows names, score breakdowns and the pin control. Expansion overlays to the right without moving the board. Existing pointer, keyboard, touch, pinning and narrow-screen mutual exclusion remain. This revision supersedes the fixed-width disclosure from PR #10; rules, private information and explicit action confirmation retain their existing owners.

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
- Run focused tests during each slice, then relevant package checks, both database integration suites, both-locale browser flows, and container tests at their milestones. No phase becomes complete merely because it compiles or one game reaches victory.

### Phase 0 — Revised design and decision baseline (this document)

- Deliver this specification with source-linked rules, profile matrix, interaction/visibility contracts, recovery policy, and observable acceptance IDs.
- Apply confirmed D-01–D-06 without re-requesting their approval. Review remaining technical proof and operational values at the relevant milestone; any new product-scope change requires explicit approval.
- Review the six prototype state groups in §8.6 before committing to the board/trade interaction structure. Prototype fidelity does not count as a working engine.
- Acceptance: no conflicting rule editions or unmarked proposed defaults; every review gap maps to a contract and verification case; residual choices have a recommendation, owner, and gate.

### Phase 1 — Foundation and bounded architecture proof

- Establish approved web/service/rules/protocol boundaries, workspace tooling, lint/typecheck/test scripts, both locale catalogs/stable message IDs, and local documentation.
- Define board topology, finite supplies, player identity, per-player projection, action-window/pending-effect contracts, ruleset versions, command receipts, and deterministic test seams. The rules package has no networking or database dependency.
- Before adopting the room framework, prove guest-seat mapping, private projections, sequential command handling, reconnect after a committed command, and durable restoration in a bounded spike; document pass/fail against these contracts rather than assuming built-in reconnect restores the database.
- Implement one base setup/production path through a minimal client/service; include narrow-screen and keyboard selection. Add a baseline non-root Docker build/health endpoint once the path runs end-to-end.
- Acceptance: clean install/build/typecheck/test; isolated rules tests; prototype decisions reflected in the vertical slice; container serves client/service and a health check. Do not claim a complete base game yet.

### Phase 2A — Private lobby, seating, and initial placement

- Implement guest identity, private invites, unique seats/colors, readiness/start guards, immutable-rules lock, configurable room policies, unanimous post-start policy approval, host transfer, resume entry and session-control policy. Establish both locale catalogs and entry/lobby/settings language switching.
- Implement R-B01 and the setup/action-window projection, with per-player authorization and negative payload tests.
- Establish the shared repository schema and SQLite/PostgreSQL migration/contract harness, including identity/seat/game IDs and initial snapshots. Durability edge coverage expands in 2C; do not defer the data boundary until after building the whole engine.
- Acceptance: three-/four-client lobby to completed setup; concurrent joins/settings/start attempts are resolved consistently; disconnected/unready seats cannot be silently started; initial placement works by touch and keyboard at U-01 viewports; unauthorized payloads contain no private state.

### Phase 2B — Complete base play and trading experience

- Complete R-B02–R-B07, finite bank/deck/piece accounting, all base card effects, awards, victory, and persistent pending choices.
- Implement §4.4–4.5 flows: mandatory actions, structured negotiation plus room text chat, bank/harbor trading, contextual help, pending-result feedback, final board, and new-game readiness. Include chat permissions/personal mute/deduplication and both UI locales; apply §8.3 visibility to all events, histories and errors.
- Acceptance: complete three- and four-player games plus source-derived boundary fixtures; four-client counteroffer/race tests; R-CHAT and mixed-locale U-I18N; U-01/U-02/U-05/U-07; initial real-device keyboard/touch checks and R-VIS. New-player assistance and expert rule disputes are recorded, not hidden behind scripted success.

### Phase 2C — Durable recovery and base-play validation

- Complete atomic state/event/receipt persistence, per-game serialization, stale/duplicate command outcomes, approved policy revisions, interrupted/pause/abandon behavior, manual save barriers, all-seat save/suspend/resume, process restoration, version dispatch and incompatible-image handling across both databases.
- Exercise R-REC, R-SAVE and R-POLICY for all base states, including abrupt termination, write failure, lost acknowledgements, host departure, all-offline suspended recovery, and vote/save/victory races; verify old-version behavior through an upgrade fixture.
- Acceptance: same database contract suite passes on SQLite and PostgreSQL; required choices resume without reroll/retheft; no hidden-data leak on reconnect; U-03/U-04 base flows; at least one full four-player expert-tabletop playtest under U-08 with a mobile participant. Address blocking fidelity/usability findings before expansion implementation. Record performance baseline under U-06.

### Phase 3 — Public room browser and operational Docker distributions

- Add public-room listing/filtering, room visibility enforcement, admission race handling, public chat abuse limits, and stale-lobby cleanup that excludes resumable/suspended games. Document game/chat retention and operator backup policies.
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

- Re-run U-01–U-08 and U-I18N in both locales for supported layouts/controls, browser/device conditions and full six-player content; include policy approval, chat, and save/resume alongside game actions. Responsive, accessibility, bilingual, and playtest fixes already begin in Phase 2; this phase checks regressions and remaining breadth.
- Validate Docker instructions on clean SQLite/PostgreSQL deployments; perform backup restore, graceful and abrupt restart, rules-version upgrade/refusal, and schema rollback-path checks. Document exact supported profiles, engine/image versions, configuration, and limitations.
- Acceptance: fixture-to-test mapping is complete for released profiles; rules, privacy, both database suites, browser interactions and container recovery checks pass; tabletop playtest blockers are resolved/retested; measured responsiveness and manual accessibility gaps are disclosed. No unsupported combination appears in the lobby or release claims.

## 12. Test and Verification Strategy

- Rules engine: unit tests for each command/phase, invariant/property tests for resource conservation, piece limits, turn ownership, road/ship connectivity, and scoring; deterministic seeded scenarios for reproducible bugs.
- Compatibility matrix: ruleset registry tests enumerate allowed player count × expansion × scenario combinations and reject all others.
- Server: integration tests for concurrent joins/trades, duplicate/retried commands, reconnection, authorization, private projections, recovery and migrations.
- Database: same repository contract suite against SQLite and PostgreSQL, including transactions, constraint behavior, restart recovery, and schema upgrades.
- Browser: multi-client and mixed-locale end-to-end paths for private invite, public discovery, readiness/start, structured trade plus text chat, room-policy approval, expansion configuration, save/suspend/resume, disconnect/reconnect, and game completion.
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
| R-ROOM | Join/start/settings races, last seat, capacity changes above/below seated players, short-handed start at the profile minimum, not-ready/disconnected start, host transfer, same-identity second tab, pause/resume, reconnection during abandonment vote, absent-player recovery and immutable terminal games. |
| R-POLICY | Exact all-seat consent, host-only rejection, pre-start readiness reset, proposal invalidation, versioned safe effective boundaries, restart and concurrent terminal/suspend behavior under §5.8. |
| R-SAVE | Individual save/leave versus all-seat suspension; durable acknowledgements; latest-state/same-seat restore; all-offline restart; failed/duplicate requests; immutable terminal games and no historical rollback under §4.8. |
| R-CHAT | Room/audience authorization, structured-trade separation, safe rendering/rate limits/personal mute, durable send deduplication and reconnect history isolation under §4.5. |
| U-01–U-08 / U-I18N | Rendered interactions in both locales, mixed-locale rooms/votes, translation completeness, draft-safe switching, IME behavior, device/keyboard/screen-reader evidence, measured responsiveness and novice/expert playtests. |

Automated tests must include impossible/unauthorized moves, not only successful paths. Game completion alone cannot prove edge cases; screenshot stability cannot prove task success. For every failed case retain the starting fixture and trace needed to reproduce it, while excluding credentials/private hands from ordinary operational logs. Before enabling public rooms, test that abuse controls and expired invitations do not leak private room/seat information.

### 12.2 Playtest and release evidence

- Base milestone: at least one full four-player game with players familiar with the chosen physical edition, including a mobile participant, plus the novice-task observation. This is a minimum qualitative check, not statistical proof of usability.
- Expansion milestones: complete games across every declared profile/count, with automated coverage and human tabletop-fidelity checks of newly introduced mechanics. Include a full six-player expert session; do not substitute six background bots for negotiation/UX evidence.
- Record rule disagreements, confusing waits, mistaken targets, recovery failures, assistance required, game duration, and device/network conditions. Classify findings as rule defect, missing interaction, usability friction, or deliberate approved difference. Correct blockers and repeat the affected scenario before sign-off.
- A release evidence index lists profile/engine/image versions, source hashes, passed fixture IDs, commands and results, observed sessions, unresolved limitations, and the decisions approved. Coverage not exercised stays unverified; do not infer all combinations from shared components.

## 13. Acceptance Criteria for the First Full Release

1. A new player can enter a nickname, create/join a private or public room, play, disconnect, and resume in the same browser without an account.
2. Public room data exposes only lobby/game metadata intended for discovery; private rooms and hidden game information remain private.
3. Host can select every supported target ruleset/scenario; the server rejects unsupported combinations and locks game rules after start. Room-policy changes require every original seat's consent and take effect only at the specified safe boundary.
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
14. Configurable room policies use all-seat approval after start, never unilateral host edits; agreed updates cannot retroactively shorten a current wait or alter the immutable game profile.
15. Autosave and manual Save and leave show acknowledged persistence and restore the latest game with original seats. All-seat save/suspend survives all players going offline and a server restart; no historical rollback, export/import, or unauthorized seat claim is possible.
16. Room text chat supports negotiation alongside structured trading, with authorized history, safe rendering, rate limits, mute, deduplication and mobile usability. Chat messages cannot move cards or impersonate authoritative game events.
17. Traditional Chinese and English cover every player-facing flow from entry through recovery/result. Mixed-locale players share identical rules, terms, policy votes and saved state; switching language preserves intent and does not reveal private information.

## 14. Risks and Open Items

- **Rules and fidelity:** D-01/D-02 confirm §5's 2025 edition family and full named target matrix, delivered in stages with base first. Source-map coordinates and every card/scenario clause must be transcribed and independently checked before enabling a profile. This document is not a replacement for the official rulebooks.
- **Rights and assets:** Product name, logo, illustrations, card text, and commercial/public distribution may have intellectual-property constraints. Do not copy official assets or text without permission; obtain appropriate legal review/licensing before a public branded release. This is a risk note, not legal advice. Fidelity means mechanics and information/decision opportunities, not an unauthorized visual clone.
- **Expansion scope:** Each expansion has multiple scenarios and not all combinations are compatible. §5.7 is the confirmed bounded final first-release target matrix; additional scenarios, exploration, community maps and historical rule profiles require an explicit scope change.
- **Guest identity loss:** Browser-bound identity cannot recover across devices/storage loss. Warn before reliance on a long saved game; host powers cannot reassign a lost guest's active seat. Future account linking should preserve the stable player ID.
- **Operations and data:** One application replica is supported. Both database modes need bounded resource use, migration/backup/restore evidence, interrupted-game retention policy and deletion notice. PostgreSQL alone does not solve live-room ownership.
- **Recovery and version retention:** §7.3 preserves active behavior but adds maintenance cost for referenced engine versions. A rejected alternative is silently applying new rules; any future migration/retirement requires its own evidence and approval.
- **Presence and public play:** D-03's configurable advisory-clock/absence policy and no-AI/no-forced-action safeguards protect strategic choices but may leave tables interrupted. Its explicit abandonment option sacrifices eventual recovery for a deliberate no-winner termination. Neither policy prevents all griefing; do not claim a moderated competitive service.
- **Evidence gap:** No application, rendered prototype, physical-device test, complete-game observation, or production performance result exists at this revision. Accepted UX budgets and verification methods are targets, not measured outcomes.

### 14.1 Confirmed decisions and implementation gates

**D-01–D-06 are user-confirmed as of 2026-10-26.** The user selected the following options and accepted the remaining recommendations. A follow-up explicitly confirmed all-seat approval for post-start policy changes and server autosave plus manual save-and-leave without export/rollback. These choices no longer require repeated product approval; implementation gates below concern evidence, not re-asking the same decisions. A future change to the confirmed scope needs explicit approval.

| ID | Confirmed decision | Retained boundary / trade-off | Implementation evidence gate |
|---|---|---|---|
| D-01 | Adopt the 2025 official base/5–6/expansion rule family and paired-player turns in §5.3. Both UI languages preserve the same mechanical meaning. | No silent mixing with older/localized rule variants. | Phase 1 onward: source-derived rules and versioned fixtures. |
| D-02 | Keep the full §5.7 matrix as the final release target; use Heading for New Shores first and include the named standalone/combined profiles. Deliver and playtest base first, then expand by stages. | Full target is not a claim that every combination exists now; unverified profiles remain disabled. | Phase 2 base playtest, then per-profile/count evidence in Phases 4–6. |
| D-03 | Room policies configurable on creation/by host before start; after start, every seated player must approve changes. Host leaves → transfer administration. Autosave plus explicit server-side Save and leave; all-seat save/suspend/resume under §§4.6–4.8/5.8. | Default no clock/AI, five-minute grace and the approved absence policy. Optional clock is advisory, not automated play. No save export/import, rollback, cloned game or cross-device seat claim. Ruleset/score/seat identity remain immutable after start. | Phase 2A policy/host controls; 2C R-POLICY/R-SAVE/R-REC, consent and terminal-race checks. |
| D-04 | Structured trading **and room text chat** in v1 for negotiation, discussion, reminders and social interaction. | Chat cannot settle trades or alter rules; authenticated audience, personal mute, rate limits and safe rendering required. Voice/video remains out of scope. | Phase 2B R-CHAT/R-TRADE, privacy and mobile interaction checks; public abuse controls in Phase 3. |
| D-05 | One deployed application instance initially; retain executable rule engines/readers needed by unfinished games and block incompatible takeover. | No multi-instance failover claim or silent active-rule migration. Specific libraries remain evidence-backed technical choices, not product blockers. | Phase 1 framework proof; Phase 2C old-version recovery; Phase 3 upgrade/backup operations. |
| D-06 | First release supports **Traditional Chinese and English**. Retain desktop-first complete mobile play, original readable tabletop visuals, §8.5 accessibility/device targets, and newest-connection seat control with explicit reclaim. | Locale is per player and cannot change rules; original chat is not auto-translated. Performance thresholds are acceptance targets to measure, not proven results. | Phase 1 bilingual foundation; Phase 2 bilingual flows/real devices; all later profiles retain locale and accessibility coverage. |

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

### Confirmed decision follow-up — 2026-10-26

- D-01: 2025 official rules across base, 5–6 players and expansions; no edition mixing.
- D-02: keep the full matrix as the final target and deliver/playtest base first; retain the recommended Heading for New Shores scenario.
- D-03: creation/pre-game host settings; post-start changes require every seated player's consent; host succession on departure. The user explicitly selected server autosave plus manual Save and leave, without downloadable/importable saves or historical rollback.
- D-04: structured trading **plus text chat**, replacing the earlier structured-only proposal.
- D-05: one deployed instance for now, with retained executable rules/readers for unfinished games.
- D-06: Traditional Chinese **and English** in the first release, replacing the earlier Chinese-only proposal. The user accepted the remaining recommended device/accessibility/visual and newest-connection seat-control choices.
- All-seat save/suspend and resume operationalize the accepted save feature using the existing consensual-pause safeguard; individual saving does not silently pause everyone else or withdraw a seat.

### Technical and operational follow-through

- Product choices above are confirmed; the original library shortlist was React/TypeScript/Vite, Node.js, Colyseus as a candidate, SVG board, and Kysely or equivalent. The web renderer now follows section 8.8's auto 3D / SVG compatibility behavior; that engineering implementation does not imply visual, reference-device or accessibility acceptance.
- Finalize documented bounds for advisory clocks/grace, message length/rate/history, room caps, reference deployment resources, backup and game/chat retention before the relevant implementation/public milestone. These values cannot weaken fixed consent/privacy/no-rollback safeguards.
- TDD workflow remains `off` while all required acceptance tests remain mandatory. No coding or test-first sequence is claimed by this documentation update.

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
