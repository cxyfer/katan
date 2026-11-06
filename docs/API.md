# Service API contract

Scope: the HTTP/WebSocket surface between `@catan/web` and `@catan/server`.
Both sides implement against this document; the server is authoritative for
every rule decision.

Conventions:

- All request/response bodies are JSON (`Content-Type: application/json`).
- Responses use `ApiResult<T>`: `{ "ok": true, "data": T }` or
  `{ "ok": false, "error": { "code", "messageId", "params" } }`.
- `messageId` is a stable i18n key; the client renders it with `params`. The
  server never sends localised sentences.
- Identity is a secure, HTTP-only, SameSite=Lax cookie (`catan_session`)
  issued by `POST /api/session`. No client-supplied player id is trusted.
- Every mutating game request carries `commandId` (client-generated UUID) and
  `expectedRevision`. Repeating the same `commandId` with the same payload
  returns the original receipt.

## HTTP endpoints

| Method | Path | Body | Data |
|---|---|---|---|
| GET | `/healthz` | – | `{ status: 'ok', uptimeSeconds, version }` |
| GET | `/readyz` | – | `{ status: 'ready' \| 'degraded', database, activeRooms }` |
| GET | `/api/config` | – | `ServerConfigView` |
| GET | `/api/session` | – | `{ player: PlayerIdentity \| null }` |
| POST | `/api/session` | `{ nickname, locale? }` | `{ player }` (sets cookie) |
| PATCH | `/api/session` | `{ nickname?, locale? }` | `{ player }` |
| GET | `/api/profiles` | – | `{ profiles: ProfileView[], selectable: string[] }` |
| GET | `/api/rooms` | query `playerCount?`, `profileId?`, `hasSeats?` | `{ rooms: RoomSummaryView[] }` |
| POST | `/api/rooms` | `{ visibility, capacity, profileId?, ruleset?, setupMode, orderMode?, policy? }` | `RoomView` |
| POST | `/api/rooms/join` | `{ code }` | `RoomView` |
| GET | `/api/rooms/:roomId` | – | `RoomView` |
| POST | `/api/rooms/:roomId/leave` | `{ entryEpoch? }` | `LeaveRoomResult` (`{ left: boolean, hostTransferredTo: string \| null, reason? }`) |
| POST | `/api/rooms/:roomId/seat` | `{ color }` | `RoomView` |
| POST | `/api/rooms/:roomId/ready` | `{ ready }` | `RoomView` |
| POST | `/api/rooms/:roomId/settings` | `{ capacity?, profileId?, ruleset?, setupMode?, orderMode?, policy? }` | `RoomView` |
| POST | `/api/rooms/:roomId/policy` | `{ policy }` | `RoomView` (pre-start applies, post-start proposes) |
| POST | `/api/rooms/:roomId/policy/consent` | `{ proposalId, approve }` | `RoomView` |
| POST | `/api/rooms/:roomId/start` | – | `{ gameId }` |
| POST | `/api/rooms/:roomId/close` | – | `{ closed: true }` |
| POST | `/api/rooms/:roomId/bots` | `{ level?, name? }` | `RoomView` |
| DELETE | `/api/rooms/:roomId/bots/:playerId` | – | `RoomView` |
| GET | `/api/games` | – | `{ games: ResumableGameView[] }` |
| GET | `/api/games/:gameId` | – | `GameSnapshot` |
| GET | `/api/games/:gameId/events` | query `after?`, `limit?` | `{ events: GameEvent[], revision }` |
| POST | `/api/games/:gameId/commands` | `CommandRequest` | `CommandReceipt` |
| POST | `/api/games/:gameId/save` | `{ requestId }` | `SaveReceipt` |
| POST | `/api/games/:gameId/abandon` | `{}` or `{ proposalId, approve }` | `AbandonProposeResult` (`{ proposalId, abandoned }`) or `AbandonConsentResult` (`{ abandoned }`) |
| POST | `/api/games/:gameId/withdraw` | `{ withdrawn }` | `WithdrawResult` (`{ withdrawn, abandoned }`) |
| POST | `/api/rooms/:roomId/withdraw` | `{ withdrawn }` | `RoomView` (compatibility alias of the game route) |
| POST | `/api/games/:gameId/suspend` | `{ proposalId? }` | `RoomView` |
| POST | `/api/games/:gameId/resume` | `{ ready }` | `RoomView` |
| GET | `/api/rooms/:roomId/chat` | query `after?`, `limit?` | `ChatPage` |
| POST | `/api/rooms/:roomId/chat` | `{ clientMessageId, text }` | `ChatMessageView` |

### Ruleset registry

`GET /api/profiles` lists every registry entry (SPEC §5.2), enabled or not;
`selectable` names the enabled ones. A `ProfileView` is:

```json
{
  "id": "base-paired-2025",
  "labelKey": "profile.base-paired-2025",
  "ruleVersion": "base-2025.4",
  "expansions": [],
  "scenario": null,
  "variants": [],
  "requiredBoxes": ["base", "base-5-6"],
  "playerCounts": [5, 6],
  "paired": true,
  "victoryTarget": 10,
  "setupModes": ["fixed", "variable"],
  "enabled": true,
  "botSeats": true
}
```

`expansions` is a set of `seafarers`, `citiesKnights`, `tradersBarbarians`,
`explorersPirates` (empty for the base game); `scenario` and `variants` are
registry ids. `requiredBoxes` is display metadata only and never validated.
Disabled entries carry `unavailableReasonKey`. `botSeats` says whether hosts
may seat computer opponents in the profile (see bots below). Every `labelKey`, reason and
`expansion.*` / `scenario.*` / `variant.*` / `box.*` name is in the protocol's
`RULESET_MESSAGE_IDS`, so both locales must translate it.

A room names its ruleset either by `profileId` or by its parts,
`ruleset: { expansions, scenario, variants? }`. The parts must equal one
registered profile's exactly (order-insensitive set equality; nothing is
inferred from pairwise compatibility), and that profile must support the
capacity. When both are sent they must name the same profile. Failures are
`E_UNSUPPORTED_COMBINATION` with `params.reason` one of `invalid-request`,
`unknown-profile`, `disabled`, `bad-player-count`, `bad-setup-mode` or
`profile-mismatch`. The started game stores the profile's `ruleVersion` as
the snapshot's `engineVersion`.

### Room settings and start

`POST /api/rooms/:roomId/settings` is host-only before start and accepts any
subset of `capacity`, `profileId`, `setupMode`, `orderMode` and `policy`. A capacity above
the deployment's `roomCapacityMax` is `E_ROOM_CAPACITY`; a count outside the
room's profile range is `E_UNSUPPORTED_COMBINATION`; an otherwise valid count
below the seated players is `E_CAPACITY_BELOW_SEATED`. A change clears every
seat's readiness.

`orderMode` is `'join'` (default) or `'random'`. `join` seats the game in the
lobby's current seat order; `random` draws a fresh permutation with the
server-side generator when the host starts. An unknown value is
`E_INVALID_ORDER_MODE`. The setting is part of `RoomView` and can only change
before the game starts.

`RoomView.startBlockers` is authoritative. A room may start with any seated
count the profile supports up to its capacity, so it does not need to be full;
`blocker.seats` reports the profile minimum while below it, and
`blocker.profilePlayerCount` reports a seated count the profile does not
support. `blocker.botsUnsupported` reports a bot seat in a profile bots cannot
play.

### Computer opponents (bots)

Bot seats are part of the room (SPEC §4.9). `RoomMemberView.bot` marks them
and `botLevel` (`'easy' | 'standard'`, default `'standard'`) is present only on
bot seats; `RoomSummaryView.botCount` and `ResumableGameView.players[].bot`
describe them in lists. `ServerConfigView.bots` reports whether hosts may add
bots and which levels exist. `ServerConfigView.retention.gameRetentionDays` is the
operator's unfinished-game retention window in days (`0` = disabled): a game idle
for longer is ended without a winner, with result reason `expired` (SPEC §4.6).
`ResumableGameView.allSeatsNeeded` is false for a game containing bot seats:
only the original human players must reconnect and become ready to resume.

- Creating a room never seats bots: `POST /api/rooms` ignores bot fields, and
  the host adds them one at a time from the lobby's bot toolbar.
- `POST /api/rooms/:roomId/bots` and `DELETE /api/rooms/:roomId/bots/:playerId`
  are host-only and lobby-only (`E_NOT_HOST`, `E_ROOM_STARTED`). Adding to a
  full room is `E_ROOM_FULL`; removing a seat that is not a bot is
  `E_NOT_A_BOT`. Both clear every person's readiness, like other settings.
- `name` is optional. A blank or omitted name picks the next free default name;
  a supplied name follows the session nickname rules (`E_INVALID_NICKNAME`) and
  must differ from every seated member, case-insensitively
  (`E_BOT_NAME_TAKEN`).
- When the deployment sets `BOTS_ENABLED=0`, adding bots is `E_BOTS_DISABLED`.
- Bots only play profiles whose every rules module (`ProfileDefinition.ruleModules`)
  is listed in `BOT_RULE_MODULES` (`packages/bots/src/support.ts`); the list is
  empty today, so only base profiles qualify and `ProfileView.botSeats` is false
  for every expansion profile. Adding a bot or
  changing a room with bot seats to such a profile is `E_INVALID_BOT`, reason
  `profile`. A bot seat that still ends up in such a room (for example after a
  registry change) adds `blocker.botsUnsupported`, so the game cannot start.
- Bot seats always report `ready` and `connected`, never become host, and do not
  vote: pause/resume, abandonment and post-start policy changes count people
  only. When every other seat is a bot, the one person may abandon without an
  absent player.
- Bots act through the ordinary command path with `commandId`s of the form
  `bot:<revision>:<attempt>`, so their receipts follow the rules below. They
  only act while at least one person in the room has a live socket.

### Withdrawal and ending a game

Leaving a started game has three distinct meanings (SPEC §4.6, §4.8); none of
them removes the seat.

- **Save and leave** — `POST /api/games/:gameId/save`, then unsubscribe over the
  socket and wait for `unsubscribed`, then `POST /api/rooms/:roomId/leave`
  (see "Leaving a room" below). The game stays resumable and the seat is not
  withdrawn.
- **Withdraw** — `POST /api/games/:gameId/withdraw` with `{ withdrawn: boolean }`
  records or retracts an explicit withdrawal and answers
  `WithdrawResult { withdrawn, abandoned }`. It runs under the same per-game
  lock as commands, so the first terminal transition wins: a game that already
  has a result (`completed` or `abandoned`) answers `E_GAME_OVER`. Repeating the
  current state is a no-op. Any change cancels the game's open *abandon*
  proposal (a pending suspend proposal is left alone). While withdrawn, the
  seat's commands are refused with `E_SEAT_WITHDRAWN` (a replayed receipt is
  still returned) until the player retracts with `{ withdrawn: false }`. A
  reconnection never clears the flag. When every person has withdrawn and the
  room policy allows abandonment, the same call ends the game with no winner
  (`abandoned: true`); when the policy disables it the game is kept. Bots never
  withdraw. `POST /api/rooms/:roomId/withdraw` is kept as an alias that
  forwards to the game route and still answers `RoomView`; a room without a
  game answers `E_GAME_NOT_STARTED` (409).
- **End the game** — `POST /api/games/:gameId/abandon` with `{}` proposes
  abandonment and answers `AbandonProposeResult { proposalId, abandoned }`. The
  proposal counts as the proposer's consent, and proposing while a proposal is
  already open consents to it (same `proposalId`). Voters are the connected,
  non-withdrawn people; a withdrawn seat counts as consenting and need not
  vote. `abandoned: true` means the last voter just agreed — for a sole person
  against bots that is immediate (the policy check still applies,
  `E_ABANDON_DISABLED`). Further votes use `{ proposalId, approve }` and answer
  `{ abandoned }`. `E_NO_ABSENT_PLAYER` still applies when several people are
  present and nobody is absent or withdrawn. A withdrawn seat cannot propose,
  consent or reject (`E_SEAT_WITHDRAWN`): its withdrawal already counts as
  consent and its return never cancels the vote, so a veto would be a new
  power. A person who is merely offline (no live socket) but has not
  withdrawn may still answer over HTTP; that is equivalent to reconnecting,
  which cancels the vote anyway (their consent is not counted, a rejection
  ends it), so it adds no power. A reconnecting seat cancels the open vote
  (after being marked connected), except a withdrawn seat, whose return changes
  nothing. Creating, consenting to, rejecting or cancelling the vote, and a
  person dropping out of it, push a fresh `room` message with
  `pendingAbandon` to everyone connected.

`RoomMemberView.withdrawn` (bots: always `false`) and `RoomView.pendingAbandon`
carry the state to clients. `pendingAbandon` is `null` when nothing is open;
otherwise `{ id, proposedBy, consents, absent, createdAt }`, where `consents`
are the people who agreed and `absent` the people currently offline or
withdrawn, for the confirmation dialog to name. `ResumableGameView.withdrawn` is
true when the viewer's own seat is withdrawn; the game stays listed so the seat
can be taken back. All three fields are optional in the types, but the server
always fills them.

### Command handling

`POST /api/games/:gameId/commands`

```json
{ "commandId": "uuid", "expectedRevision": 12, "command": { "type": "build.road", "edge": 41 } }
```

Response `CommandReceipt`:

```json
{
  "commandId": "uuid",
  "outcome": "accepted",
  "revision": 13,
  "events": [{ "seq": 13, "type": "build.road", "params": { "playerId": "p1", "edge": 41, "free": false } }]
}
```

Rejection:

```json
{
  "commandId": "uuid",
  "outcome": "rejected",
  "revision": 12,
  "error": { "messageId": "error.E_ILLEGAL_TARGET", "params": { "edge": 41 } },
  "events": []
}
```

Rules:

- A repeated `commandId` returns the stored receipt unchanged (no second
  effect), even if the payload differs — a differing payload is rejected with
  `error.E_COMMAND_ID_REUSED`.
- A seat that has withdrawn (see "Withdrawal and ending a game") gets
  `E_SEAT_WITHDRAWN` for a new command until it retracts the withdrawal.
- `expectedRevision` older than the current revision is rejected with
  `error.E_STALE_REVISION` unless the receipt already exists.
- The acting player always comes from the session cookie.
- Command types beyond the base set are accepted only when the game's profile
  lists a rules module that handles them; otherwise `error.E_INVALID_COMMAND`.

### Pending choices

`GameView.pending` is the active mandatory choice and `GameView.pendingQueue`
the choices queued behind it, in resolution order (always present, usually
empty). Base frames keep their kinds (`discard`, `moveRobber`, `steal`,
`yearOfPlenty`, `freeRoads`). A rules-module frame is
`{ kind: "<module>.<step>", module, responders, data }`: `responders` are the
players who still owe an answer and `data` holds only what the module chose to
show this viewer. Expansion state, when a profile has rules modules, is in
`GameView.modules[<id>]` and advisory targets in `hints.modules[<id>]`; base
games have neither field.

### Rules-module wire additions

All are absent for base games, so base payloads are unchanged.

- Domestic offers may carry module goods: `trade.offer` / `trade.revise`
  accept `giveGoods` / `wantGoods` (`{ gold: 3 }`) when the profile's module
  declares that good; `Offer` and the `trade.*` events repeat them. Goods are
  validated against the declaring module and current holdings when proposed,
  revised, consented to and settled. E&P gold uses the same contract as T&B
  gold.
- `PublicPlayerView.victoryTarget` appears when a module changes a player's
  target (the old boot); `PublicBoardView.extraNumbers` lists a hex's second
  production number; road entries may carry `bridge: true`.
- Traders & Barbarians state is in `GameView.modules.tradersBarbarians`, one
  key per active part (`harbors`, `tb-fishing`, `tb-coins`, `tb-rivers`,
  `tb-merchant-trains`, `tb-barbarian-attack`, `tb-traders-barbarians`). Hints
  in `hints.modules.tradersBarbarians` hold per-part hints plus `targets`
  (command type or keyed list → legal indices), `board` (a board choice the
  viewer owes) and `robberHexes`.
- Module command types (all `tb.*`): `spendFish`, `giveBoot`, `fishSwap`,
  `buyResource`, `sellResources`, `buildBridge`, `bidWagon`, `assignWagon`,
  `placeWagon`, `buildBaCard`, `baCapture`, `baPlaceKnight`, `baTreason`,
  `baSteal`, `moveKnight`, `endKnights`, `moveBarbarian`, `playKnight`,
  `playSwiftJourney`, `upgradeWagon`, `wagonStep`, `wagonBoost`, `driveOff`,
  `wagonStop`. Frames are `tradersBarbarians.<step>`.
### Seafarers commands (`sf-new-shores-*`)

| Command | Fields | When |
|---|---|---|
| `setup.placeShip` | `edge` | setup road step: a sea edge next to the settlement just placed (instead of `setup.placeRoad`) |
| `build.ship` | `edge` | own action window (lumber + wool), or free inside a Road Building (`freeRoads`) effect |
| `ship.move` | `from`, `to` | own action window, once per window; `from` must be an own open ship not built in this window and not next to the pirate |
| `gold.choose` | `resources` (array) | `seafarers.gold` frame, by its first responder; exactly `min(owed, bank total)` resources the bank holds |
| `pending.moveRobber` | `hex` (number or `null`) | a sea hex or `null` (the frame) moves the pirate, a land hex the robber |
| `dev.playKnight` | `hex` (number or `null`) | as above, for a Knight |

Pirate moves emit `pirate.moved`; a pirate theft is the base `steal` frame
(`pirate: true`) and the `robber.stole` event with `pirate: true`.
`board.pirate` is `null` while the pirate waits on the frame (where it
starts). `GameView.modules.seafarers` is public: `islandBonus` (small-island
ids per player), `islandClaims` (`{ player, island, vertex }`),
`shipsBuiltThisTurn` and `shipMoved` for the current action window.
`hints.modules.seafarers` lists `legalShips`, `setupShips`,
`movableShips` (`{ edge, targets }`), `pirateTargets` (sea hexes, plus
`null` when the frame is a legal move), `robberTargets` and
`goldRequired`. The `seafarers.gold` frame projects `data.picks` (owed
resources per remaining responder).

### Explorers & Pirates commands (`ep-*-2025`)

E&P never runs with the Seafarers commands above. A turn is `turn.roll`,
the Action phase (base `build.settlement`, `build.road`, `trade.*` and the
commands below), `ep.startMovement`, the Movement phase, then `turn.end`.
There are no development cards, cities or robber.
Domestic offers may include coins: `trade.offer` / `trade.revise` accept
`giveGoods` / `wantGoods` (`{ gold: 3 }`); `Offer` and the `trade.*` events
repeat them. Amounts and holdings are validated at proposal, revision,
consent and settlement (EP25 p. 9).
Profiles without a coin module refuse goods (`E_INVALID_SELECTION`).

| Command | Fields | When |
|---|---|---|
| `ep.setupHarbor` / `ep.setupSettlement` | `vertex` | variable setup, rounds 1 and 2 (a marked harbour site, then the starting island) |
| `ep.setupRoad` / `ep.setupShip` | `edge` | variable setup route step, either order (the ship carries a settler) |
| `ep.buildHarbor` | `vertex` | Action phase: an own coastal settlement (2 grain + 2 ore) |
| `ep.buildShip` | `edge`, `replace?` (ship id) | Action phase, next to an own harbour settlement (lumber + wool); `replace` when all 3 ships are on the board |
| `ep.buildSettler` / `ep.buildCrew` | `harbor` (vertex) or `ship` (id), `remove?` (cargo piece) | Action phase; when every slot is full, `remove` names the one piece returned to make room (a settler needs the holder empty) |
| `ep.sellForGold` | `give` | Action phase: 3 of a kind → 1 gold |
| `ep.buyResource` | `receive` | Action phase, twice: 2 gold → 1 resource |
| `ep.fastGold` | `give` | Action phase, with the Fast Gold spice ability: 1 resource → 1 gold |
| `ep.extraMove` | `ship` | Movement phase, once per ship: 1 wool → 2 more moves |
| `ep.startMovement` | – | ends the Action phase |
| `ep.moveShip` | `ship`, `edge` | Movement phase: one step along a sea edge; onto an edge with two other ships only to pass, when a legal stop is still reachable (`E_EP_EDGE_FULL`; `E_EP_TRIBUTE` when tribute is due and the owner has no coin) |
| `ep.load` / `ep.unload` | `ship`, `harbor`, `piece` | Movement phase, ship next to an own harbour settlement |
| `ep.swap` | `ship`, `harbor` | as above: exchange all cargo |
| `ep.found` | `ship`, `vertex` | Movement phase: a settler ship founds a settlement |
| `ep.dropCrew` / `ep.pickCrew` | `ship`, `hex` | lair or spice farm next to the ship |
| `ep.loadFish` / `ep.loadSpice` | `ship`, `hex` | a shoal's haul or a spice farm's sack |
| `ep.deliver` | `ship` | ship at a Council anchor with fish or spice |
| `ep.fishRoll` | – | Movement phase, once (fish missions) |
| `ep.chase` | `ship` | Movement phase: an unmoved ship at the hex of an opponent's pirate ship |
| `ep.placePirate` | `hex` | `explorersPirates.pirate` frame, stage `place` |
| `ep.robPlayer` | `victim` | the same frame, stage `rob` |

`GameView.modules.explorersPirates` is public: `scenario`, `setupStep`,
`missions`, `fog` (`{ hex, region }` per unexplored hex — unexplored hexes are
`sea` in `board.terrain` and their contents are drawn only when explored),
`council`, `anchors`, `harborMarks`, `sites` (lairs, shoals, spice farms,
Council), `ships` (`{ id, player, edge, cargo }`), `harbors`
(`{ vertex, player, cargo }`), `goldSupply`, `fishSupply`, `pirate`, mission
`tracks`, the current `turn` (phase, per-ship moves) and per player `gold`,
`harborPoints`, `missionPoints`, `supply`, `abilities` and `chaseNumbers`.
`hints.modules.explorersPirates` gives the phase, setup targets, build
targets, coin-trade allowances, per-ship `steps`, `found`, cargo and crew
options, `deliver`, `chase`, `stranded`, `fishRoll`, `pirateTargets` and
`robCandidates`. A pirate theft's card is private to the thief and the victim.
Since `ep-2025.2` (#97), `steps` lists a full edge (`full: true`, two other
ships) only if a legal stop — a non-full edge, or founding with the settler
aboard — can still be reached from it with the MP the ship already has; an
extra move not yet bought does not count. `stranded` means the ship in motion
is on an edge with two other ships and must sail on: it still has a step, a
founding site, or a step that `ep.extraMove` would open. While it is true,
`turn.end`, moving another ship and `ep.fishRoll` are refused
(`E_EP_EDGE_FULL`), so `canEndTurn` and `fishRoll` are false and the other
ships' `steps` are empty. A stranded ship with no way out is not `stranded`:
`turn.end`, another ship's move or the fish roll ends its movement there, and
the edge holds three ships until they sail on. Unfinished `ep-2025.1` games
behave the same way (SPEC §7.3).
Bots cannot be seated in E&P rooms (`E_INVALID_BOT`, `blocker.botsUnsupported`).
### Cities & Knights commands (`ck-*`)

The `ck-2025` and `ck-paired-2025` profiles are enabled: the lobby offers
them and a room created with either one runs the full module (knights,
barbarians, improvements, commodities, the 23 playable progress cards and the
merchant). Bot seats are still refused on these profiles (`botSeats: false` in the profile list; `blocker.botsUnsupported` on the start check).
Base `build.devCard` and `dev.play*` are rejected (`E_INVALID_COMMAND`).

| Command | Fields | When |
|---|---|---|
| `build.wall` | `vertex` | own action window, 2 brick; an own city without a wall, at most 3 walls |
| `city.improve` | `track`, `vertex?` | own action window; next level costs *level* commodities of the track; `vertex` names the city that takes a metropolis (required only when several qualify) |
| `knight.recruit` | `vertex` | 1 wool + 1 ore; a free intersection on an own route; enters inactive at strength 1 |
| `knight.activate` | `vertex` | 1 grain; an own inactive knight |
| `knight.promote` | `vertex` | 1 wool + 1 ore; once per knight and turn, a higher piece in supply, mighty needs politics level 3 |
| `knight.move` | `from`, `to` | an own active knight not activated in this window; `to` reachable along own routes |
| `knight.displace` | `from`, `to` | as a move, onto a weaker opponent knight; queues `citiesKnights.displaced` |
| `knight.chaseRobber` | `vertex` | an own eligible knight next to the robber's hex after the first attack; queues `moveRobber` |
| `knight.retreat` | `vertex` | `citiesKnights.displaced`, by the displaced knight's owner |
| `barbarians.pillage` | `vertex` | `citiesKnights.pillage`, each responder names one of their cities |
| `barbarians.chooseDeck` | `track` | `citiesKnights.defenderDraw`, by its first responder |
| `progress.discard` | `cards` (array) | `citiesKnights.progressDiscard` (exactly `data.required[self]` cards), or on the own turn while above the hand limit |
| `science.take` | `resource` (or `null` to pass) | `citiesKnights.scienceBonus`, by its first responder |
| `progress.play` | `card`, plus the card's fields (below) | the own turn; the card must be held and its `hints` entry `playable`. Alchemy only before the roll, every other card in the action window |
| `progress.harborOffer` | `to`, `resource` | own action window while `modules.citiesKnights.harbor` is open (Commercial Harbor): offer one resource to a player in `hints.harborTargets` |
| `progress.harborAnswer` | `commodity` | `citiesKnights.harborExchange`, by the offered player: give one commodity back (answered automatically when they hold one kind, or none) |
| `progress.takeCards` | `cards` | `citiesKnights.guildDues`, by the card's player: take exactly `data.count` cards from the victim's hand |
| `progress.takeProgress` | `card` (or `null`) | `citiesKnights.espionage`, by the card's player: take one of the seen progress cards |
| `progress.sabotageDiscard` | `cards` | `citiesKnights.sabotage`, each responder discards exactly `data.required[self]` cards |
| `progress.weddingGive` | `cards` | `citiesKnights.wedding`, each responder gives exactly `data.required[self]` cards to the card's player |
| `progress.treasonRemove` | `vertex` | `citiesKnights.treasonRemove`, by the chosen player: remove one of their own knights |
| `progress.treasonPlace` | `vertex` (or `null`), `level` | `citiesKnights.treasonPlace`, by the card's player: place an own knight of an allowed `level`, or decline |
| `progress.diplomacyRoad` | `edge` (or `null`) | `citiesKnights.diplomacyRoad`, by the card's player: rebuild the removed own road for free, or decline |

`progress.play` fields per card: `alchemy` → `dice` (`[yellow, red]`);
`crane` → `track` (and `vertex` when several cities qualify);
`engineering`, `medicine`, `intrigue` → `vertex`; `invention` → `hexes`
(two); `smithing` → `vertices` (one or two own knights);
`merchant`, `taxation` → `hex`; `diplomacy` → `edge`;
`guildDues`, `espionage`, `treason` → `target` (a player id);
`merchantFleet`, `resourceMonopoly`, `tradeMonopoly` → `kind`; the other
cards (`irrigation`, `mining`, `roadBuilding`, `encouragement`, `sabotage`,
`wedding`, `commercialHarbor`) take no field. Printing and Constitution are
not playable: they score when drawn.

A roll carries `turn.dice` as `[yellow, red]`; the event die is in
`modules.citiesKnights.lastRoll`. Frames: `citiesKnights.resolveRoll`
(a continuation with no responders that resumes production after the event),
`.pillage` (`data.cities` per responder), `.displaced` (`data.player`,
`level`, `active`, `from`, `options`), `.progressDiscard` (`data.required`),
`.defenderDraw` (`data.decks`) and `.scienceBonus`; the progress cards add
`.harborExchange` (`data.from`; `resource` only for the two players), `.guildDues`
(`data.victim`, `count`; `hand`, the victim's resource and commodity counts,
only for the card's player), `.espionage` (`data.victim`, `count`; `cards`, the
victim's progress cards, only for the spy), `.sabotage` and `.wedding`
(`data.actor`, `required`: a map from each affected player id to the number of
cards they must discard or give), `.treasonRemove` (`data.actor`, `knights`:
the chosen player's knight vertices), `.treasonPlace` (`data.level`, `active`,
`from`; `levels`, the knight levels the card's player may place, and `sites`,
the vertices where one can go) and `.diplomacyRoad` (`data.edge`, `edges`). Ending the turn while
above the progress-card limit is rejected (`E_PROGRESS_HAND_LIMIT`), and
`hints.canEndTurn` is `false` meanwhile. Choosing an empty progress deck is
`E_PROGRESS_DECK_EMPTY` (the base `E_DECK_EMPTY` is the development deck). A
`science.take` without a `resource` is `E_INVALID_SELECTION`; only `null` passes.
`hints.legalCities` omits settlements while a toppled city waits to be rebuilt.
Playing a card with a pending frame is `E_PENDING_EFFECT`; Alchemy twice in one
window is `E_ALCHEMY_SET`.

`GameView.modules.citiesKnights` is public: `barbarian`
(`position`, `length`, `attacks`), `barbarianStrength`, `defenderStrength`,
`robberActive`, `knights` (`player`, `vertex`, `level`, `active`, `fresh`,
`promoted`), `walls` (`vertex`, `player`), `metropolises` per track
(`player`, `vertex` or `null`), `toppled`, `progressVp` per player,
`progressCounts`, `decks` (card counts per track), `commodityBank`,
`lastRoll` (`event`, `red`, `atSeq`), `lastAttack`, `handLimit`, `merchant`
(`player`, `hex`, or `null`), and for the current window `alchemy` (`player`,
`dice`), `fleets` (`player`, `kind`) and `harbor` (`player`, `offers`).
Progress hands appear only in the owner's own player view (`progressCards`);
deck order is never projected. Players carry `commodities`, `improvements`,
`cityWalls` and `defenders`.

`hints.modules.citiesKnights` lists `recruitSites`, `knightSupply`, `knights`
(`vertex`, `level`, `active`, `canActivate`, `canPromote`, `canAct`, `moves`,
`displace`, `chase`), `wallSites`, `improvements` (`track`, `level`, `cost`,
`commodity`, `metropolis`, `sites`, `blocked`), `commodityRates`, `costs`,
`progressExcess`, `retreat`, `pillage`, `defenderDecks`, `scienceBonus`,
`progress` (per held card kind: `card`, `track`, `count`, `playable`, a
`reason` when not, and the legal `targets`), `harborTargets` and `twoForOne`
(card kinds given at 2:1 this window).
Events are `ck.*` (for example `ck.eventRolled`, `ck.barbariansAttack`,
`ck.cityPillaged`, `ck.knightDisplaced`, `ck.progressDrawn`); a drawn or
discarded card's face is sent only to its holder.

### Seafarers + Cities & Knights (`sf-ck-new-shores-*`)

The combined profiles (engine `sf-ck-2025.1`, 16 VP, human seats only)
accept every Seafarers and Cities & Knights command above, except the base
development cards, plus one command:

| Command | Fields | When |
|---|---|---|
| `knight.chasePirate` | `vertex` | own action window after the first barbarian attack; an own active knight that may act, on any intersection of the pirate's sea hex (coastal ones included); queues `moveRobber` with `pirate: true` |

Before the first attack the pirate cannot be moved by any command
(`E_PIRATE_INACTIVE`) and the robber waits off the board (`board.robber`
`-1`); a 7 still triggers discards. A `moveRobber` frame with `pirate: true`
(a pirate chase) accepts only a sea hex or `null`; one queued by
`knight.chaseRobber` (`cause: "knight"`, `pirate: false`) only a land hex;
a 7 after the first attack either. Knights may stand on an intersection of
three sea hexes next to an own ship; a ship next to an opponent's knight,
or the last ship before an own knight, does not move
(`E_SHIP_PINNED_BY_KNIGHT`; a route closed by buildings stays
`E_SHIP_NOT_MOVABLE`). Diplomacy may name a ship: `ck.roadRemoved` and
`ck.diplomacyRoadBuilt` then carry `ship: true`, as does the
`citiesKnights.diplomacyRoad` frame's `data`; a ship re-placed that way
counts as built this turn (`shipsBuiltThisTurn`, `E_SHIP_BUILT_THIS_TURN`).

`GameView.modules.seafarersCitiesKnights` is `{ pirateActive }`.
`hints.modules.seafarersCitiesKnights` lists `pirateActive`, `pirateChase`
(own knights that may chase the pirate now) and `bandit` (`robber`,
`pirate`, `either` or `null`: which bandit the viewer's pending move may
take). The chase emits `sfck.knightChasedPirate` (`playerId`, `vertex`,
`hex` — the pirate's hex before the move), followed by the usual
`pirate.moved` and, for a theft, `robber.stole` with `pirate: true`.

## WebSocket `/ws`

The client sends the session cookie; the server answers `hello` on connect.

Client → server:

```json
{ "type": "subscribe", "payload": { "roomId": "..." } }
{ "type": "subscribe", "payload": {} }
{ "type": "ping" }
```

`subscribe` with a `roomId` joins that room's live feed (`room`, `presence`,
`snapshot`, `events`, `chat`). `subscribe` **without** a `roomId` unsubscribes:
the socket leaves its room, stops receiving those pushes, and — when it was the
person's last socket there — the seat is marked disconnected and the room no
longer counts as having a live person (bots only act while someone does). It is
idempotent and the socket stays open for a later subscribe. Messages on one
socket are handled in order, so an unsubscribe followed at once by a subscribe
ends up subscribed. Closing the socket unsubscribes implicitly.

Once the unsubscribe has been processed the server answers
`{ "type": "unsubscribed", "payload": { "roomId": "..." | null, "entryEpoch": 1762400000000 | null } }`.
`roomId` is the room the socket just left, or `null` when it was not
subscribed (the acknowledgement is sent either way, so a client can always wait
for it). `entryEpoch` is the person's current entry epoch in that room (see
"Leaving a room"), read after the connection was removed; it is `null` exactly
when `roomId` is. The acknowledgement is sent only after the connection is out
of the room and the seat has been marked disconnected, so a request sent after
it no longer races the socket.

A `subscribe` the service refuses (the room was closed or the person is not a
member, including when that changes while the request waits for the room's
lock) is answered with an `error` message carrying the service's own code, for
example `E_ROOM_NOT_FOUND` or `E_NOT_A_MEMBER`, and leaves no connection behind.
Only unclassified failures use `E_WS_HANDLER`.

Save and leave from a client is therefore: `POST /api/games/:gameId/save`, then
unsubscribe over the socket and wait for `unsubscribed`, then
`POST /api/rooms/:roomId/leave`. Without the unsubscribe the socket keeps the
seat online, keeps bots playing and keeps pushing the room back to the leaving
client.

Server → client: `ServerMessage` union from `@catan/protocol`
(`hello`, `room`, `snapshot`, `events`, `chat`, `presence`, `notice`, `error`, `pong`,
`unsubscribed`).

### Leaving a room

`POST /api/rooms/:roomId/leave` takes an optional body `{ entryEpoch?: number }`
and answers `LeaveRoomResult { left, hostTransferredTo, reason? }`.

- `left: true` — the leave took effect. In a lobby the membership is removed
  (the room closes when no person remains, and the host role moves on); in a
  started game the seat is kept and only marked disconnected, and the host role
  moves on if the leaver held it. A caller with no membership also gets
  `left: true` (nothing to do).
- `left: false` — **ignored, nothing changed** (nothing is persisted, cancelled
  or broadcast), with `hostTransferredTo: null` and a `reason`:
  - `present`: the same person still has a live subscribed socket in that room.
    With several tabs open, a leave from one tab is ignored while any other tab
    is still subscribed; it takes effect once every tab has unsubscribed.
  - `stale`: the request carried an `entryEpoch` older than the person's current
    entry epoch in that room, i.e. they entered the room again after the
    request's basis.
  Both apply in lobbies and started games alike. The `present` check comes
  first. A caller with no socket and no `entryEpoch` (plain HTTP, older
  clients) is only subject to the first rule.
- A malformed `entryEpoch` (not a finite number) is `E_BAD_REQUEST`.

**Entry epoch.** Each room remembers, per person, a number that grows every time
that person enters the room: an HTTP join (including re-entering with an
existing membership) and a socket subscribe each bump it. It comes from one
process-wide counter counted in microseconds since the Unix epoch
(`Date.now() * 1000`, about 1.8e15, safely below 2^53, so it survives a JSON
round trip). Within one process it strictly increases, even if the clock steps
back. A client learns
its current epoch from the `unsubscribed` acknowledgement (`entryEpoch`) or, when
there is no socket to acknowledge, from `RoomView.viewerEntryEpoch` (present on
every room view that has a viewer, including the answer to a join). A request
that raced a re-entry — for example a `/leave` the client stopped waiting for,
arriving after the person joined again by invite code but before the socket
subscribed — carries the older epoch and is answered `stale`.

Epochs are not persisted. After a restart the service has forgotten them (the
current epoch reads as 0), so a request carrying an older epoch goes through
unless the person has entered the room again since the restart. A new process
starts counting from the clock, which is normally above every value the old one
issued, so such a late request is usually still judged `stale`; that is
best-effort across a restart, not a guarantee. It does not hold if the clock
stepped back, or if the old process had run ahead of the clock by issuing more
than 1000 entries per millisecond. Within a single process the ordering is
strict.

Connection registration and removal, joins, leaves and the host-grace expiry all
take the room's lock, so a connection or a re-join cannot slip in between a
leave's check and its change, and a host who reconnects while the grace timer is
waiting for the lock keeps the role.

A deliberate leave from the web client is therefore: unsubscribe → wait for
`unsubscribed` → `POST /api/rooms/:roomId/leave` with the `entryEpoch` from the
acknowledgement (or `viewerEntryEpoch` when there was no socket).

## Chat

- `clientMessageId` is a client UUID; the server deduplicates per sender and
  returns the original message on retry.
- Rate limit and length limits come from `ServerConfigView.limits`; violations
  return `error.E_CHAT_RATE_LIMITED` / `error.E_CHAT_TOO_LONG`.
- Rendering is plain text; the server never injects game state into chat.
