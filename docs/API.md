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
| GET | `/api/profiles` | – | `{ profiles: ProfileView[] }` |
| GET | `/api/rooms` | query `playerCount?`, `profileId?`, `hasSeats?` | `{ rooms: RoomSummaryView[] }` |
| POST | `/api/rooms` | `{ visibility, capacity, profileId, setupMode, policy? }` | `RoomView` |
| POST | `/api/rooms/join` | `{ code }` | `RoomView` |
| GET | `/api/rooms/:roomId` | – | `RoomView` |
| POST | `/api/rooms/:roomId/leave` | – | `{ left: true, hostTransferredTo: string \| null }` |
| POST | `/api/rooms/:roomId/seat` | `{ color }` | `RoomView` |
| POST | `/api/rooms/:roomId/ready` | `{ ready }` | `RoomView` |
| POST | `/api/rooms/:roomId/settings` | `{ capacity?, profileId?, setupMode?, policy? }` | `RoomView` |
| POST | `/api/rooms/:roomId/policy` | `{ policy }` | `RoomView` (pre-start applies, post-start proposes) |
| POST | `/api/rooms/:roomId/policy/consent` | `{ proposalId, approve }` | `RoomView` |
| POST | `/api/rooms/:roomId/start` | – | `{ gameId }` |
| POST | `/api/rooms/:roomId/close` | – | `{ closed: true }` |
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

### Room settings and start

`POST /api/rooms/:roomId/settings` is host-only before start and accepts any
subset of `capacity`, `profileId`, `setupMode` and `policy`. A capacity above
the deployment's `roomCapacityMax` is `E_ROOM_CAPACITY`; a count outside the
room's profile range is `E_UNSUPPORTED_COMBINATION`; an otherwise valid count
below the seated players is `E_CAPACITY_BELOW_SEATED`. A change clears every
seat's readiness.

`RoomView.startBlockers` is authoritative. A room may start with any seated
count the profile supports up to its capacity, so it does not need to be full;
`blocker.seats` reports the profile minimum while below it, and
`blocker.profilePlayerCount` reports a seated count the profile does not
support.

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
