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
| POST | `/api/rooms` | `{ visibility, capacity, profileId?, ruleset?, setupMode, orderMode?, policy?, bots?, botLevel? }` | `RoomView` |
| POST | `/api/rooms/join` | `{ code }` | `RoomView` |
| GET | `/api/rooms/:roomId` | – | `RoomView` |
| POST | `/api/rooms/:roomId/leave` | – | `{ left: true, hostTransferredTo: string \| null }` |
| POST | `/api/rooms/:roomId/seat` | `{ color }` | `RoomView` |
| POST | `/api/rooms/:roomId/ready` | `{ ready }` | `RoomView` |
| POST | `/api/rooms/:roomId/settings` | `{ capacity?, profileId?, ruleset?, setupMode?, orderMode?, policy? }` | `RoomView` |
| POST | `/api/rooms/:roomId/policy` | `{ policy }` | `RoomView` (pre-start applies, post-start proposes) |
| POST | `/api/rooms/:roomId/policy/consent` | `{ proposalId, approve }` | `RoomView` |
| POST | `/api/rooms/:roomId/start` | – | `{ gameId }` |
| POST | `/api/rooms/:roomId/close` | – | `{ closed: true }` |
| POST | `/api/rooms/:roomId/bots` | `{ level? }` | `RoomView` |
| DELETE | `/api/rooms/:roomId/bots/:playerId` | – | `RoomView` |
| GET | `/api/games` | – | `{ games: ResumableGameView[] }` |
| GET | `/api/games/:gameId` | – | `GameSnapshot` |
| GET | `/api/games/:gameId/events` | query `after?`, `limit?` | `{ events: GameEvent[], revision }` |
| POST | `/api/games/:gameId/commands` | `CommandRequest` | `CommandReceipt` |
| POST | `/api/games/:gameId/save` | `{ requestId }` | `SaveReceipt` |
| POST | `/api/games/:gameId/abandon` | `{}` or `{ proposalId, approve }` | `{ proposalId }` or `{ abandoned }` |
| POST | `/api/rooms/:roomId/withdraw` | `{ withdrawn }` | `RoomView` |
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
  "ruleVersion": "base-2025.3",
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
bots and which levels exist.
`ResumableGameView.allSeatsNeeded` is false for a game containing bot seats:
only the original human players must reconnect and become ready to resume.

- `POST /api/rooms` accepts `bots` (an integer from `0` to `capacity − 1`) and
  `botLevel` to seat bots at creation. Anything else is `E_INVALID_BOT`.
- `POST /api/rooms/:roomId/bots` and `DELETE /api/rooms/:roomId/bots/:playerId`
  are host-only and lobby-only (`E_NOT_HOST`, `E_ROOM_STARTED`). Adding to a
  full room is `E_ROOM_FULL`; removing a seat that is not a bot is
  `E_NOT_A_BOT`. Both clear every person's readiness, like other settings.
- When the deployment sets `BOTS_ENABLED=0`, adding bots is `E_BOTS_DISABLED`.
- Bots only play profiles whose every rules module (`ProfileDefinition.ruleModules`)
  is listed in `BOT_RULE_MODULES` (`packages/bots/src/support.ts`); the list is
  empty today, so only base profiles qualify and `ProfileView.botSeats` is false
  for every expansion profile. Seating a bot at creation, adding one, or
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

### Cities & Knights commands (`ck-*`, implemented, not yet enabled)

The `ck-2025` / `ck-paired-2025` profiles are registered with
`enabled: false` (`profile.unavailable.citiesKnightsProgress`) until the
progress-card effects land, so the server rejects them for new rooms. The
contract below is what the rules module accepts once a game runs on them.
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

A roll carries `turn.dice` as `[yellow, red]`; the event die is in
`modules.citiesKnights.lastRoll`. Frames: `citiesKnights.resolveRoll`
(a continuation with no responders that resumes production after the event),
`.pillage` (`data.cities` per responder), `.displaced` (`data.player`,
`level`, `active`, `from`, `options`), `.progressDiscard` (`data.required`),
`.defenderDraw` (`data.decks`) and `.scienceBonus`. Ending the turn while
above the progress-card limit is rejected (`E_PROGRESS_HAND_LIMIT`), and
`hints.canEndTurn` is `false` meanwhile. Choosing an empty progress deck is
`E_PROGRESS_DECK_EMPTY` (the base `E_DECK_EMPTY` is the development deck). A
`science.take` without a `resource` is `E_INVALID_SELECTION`; only `null` passes.
`hints.legalCities` omits settlements while a toppled city waits to be rebuilt.

`GameView.modules.citiesKnights` is public: `barbarian`
(`position`, `length`, `attacks`), `barbarianStrength`, `defenderStrength`,
`robberActive`, `knights` (`player`, `vertex`, `level`, `active`, `fresh`,
`promoted`), `walls` (`vertex`, `player`), `metropolises` per track
(`player`, `vertex` or `null`), `toppled`, `progressVp` per player,
`progressCounts`, `decks` (card counts per track), `commodityBank`,
`lastRoll` (`event`, `red`, `atSeq`), `lastAttack` and `handLimit`.
Progress hands appear only in the owner's own player view (`progressCards`);
deck order is never projected. Players carry `commodities`, `improvements`,
`cityWalls` and `defenders`.

`hints.modules.citiesKnights` lists `recruitSites`, `knightSupply`, `knights`
(`vertex`, `level`, `active`, `canActivate`, `canPromote`, `canAct`, `moves`,
`displace`, `chase`), `wallSites`, `improvements` (`track`, `level`, `cost`,
`commodity`, `metropolis`, `sites`, `blocked`), `commodityRates`, `costs`,
`progressExcess`, `retreat`, `pillage`, `defenderDecks` and `scienceBonus`.
Events are `ck.*` (for example `ck.eventRolled`, `ck.barbariansAttack`,
`ck.cityPillaged`, `ck.knightDisplaced`, `ck.progressDrawn`); a drawn or
discarded card's face is sent only to its holder.

## WebSocket `/ws`

The client sends the session cookie; the server answers `hello` on connect.

Client → server:

```json
{ "type": "subscribe", "payload": { "roomId": "..." } }
{ "type": "ping" }
```

Server → client: `ServerMessage` union from `@catan/protocol`
(`hello`, `room`, `snapshot`, `events`, `chat`, `presence`, `notice`, `error`, `pong`).

Ordering guarantee: `events` are delivered in ascending `seq`; after any gap the
client refetches `GET /api/games/:gameId` and replaces its state.

## Chat

- `clientMessageId` is a client UUID; the server deduplicates per sender and
  returns the original message on retry.
- Rate limit and length limits come from `ServerConfigView.limits`; violations
  return `error.E_CHAT_RATE_LIMITED` / `error.E_CHAT_TOO_LONG`.
- Rendering is plain text; the server never injects game state into chat.
