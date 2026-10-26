# Browser-Based CATAN-Style Game: Design Specification

Date: 2026-10-26
Status: Design proposal for user review
Scope: Product requirements, system design, implementation plan, and acceptance criteria

## 1. Summary

Build a browser-based, multiplayer hex-board trading game for friends and public-table play. The initial product target supports 3–6 players, private rooms, a public room browser, touch-capable responsive controls, and room-selected rule modules. The planned first full release targets the base game, the 5–6 player rules, Seafarers, and Cities & Knights, including only combinations and scenarios that have been implemented and verified.

Ship the web client and game service as a Docker image. Operators choose SQLite for a compact single-instance installation or PostgreSQL for a separately managed database. Players initially join using a nickname and a persistent browser guest identity; account login is deferred.

This is a proposal, not an implementation authorization or an accepted architecture decision record. Product requirements below reflect user decisions. Technical choices are recommendations until reviewed.

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

- The active player sees legal actions, costs, and a clear current phase. Non-active players see whose action is awaited.
- The server validates each action and publishes the resulting authorized view to each player.
- On a temporary disconnect, retain the seat and show connection status. Rejoining with the same guest identity restores the seat and private player view.
- A disconnected player is not silently replaced by an AI. Timeout/abandonment behavior must be explicit and configurable only if later agreed.
- On normal service/container restart, recover saved games and allow players to reconnect. If recovery is impossible or a save is corrupt, preserve the last recoverable data and show a clear failure rather than silently starting a new game.

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
- Before implementation, pin the exact official rulebook editions and 5–6 player turn procedure. Do not choose between historical special-building procedures and the current published rules from memory.

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

### 6.3 Technology proposal (not yet approved)

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
- Game snapshot: game ID, ruleset and version snapshot, board topology/state, turn/phase, public and private player state, RNG/deck state as required for deterministic recovery, persistence revision.
- Game event: ordered command/result metadata sufficient for audit/recovery, without exposing secret card identities to unauthorized clients.

### 7.2 Commit/recovery boundary

For each accepted command: validate against current version, apply the transition, persist the new snapshot and event atomically, then publish the state update. Rejected commands do not mutate state. Repeated command IDs are idempotent so reconnect/retry does not duplicate a trade, build, or card play.

SQLite mode requires a mounted persistent directory and a single application writer. PostgreSQL mode requires connection pooling limits, schema migrations, health checks, and documented backups. Both need backup/restore documentation and migration tests. Retention and deletion policy for finished games should be decided before public production launch.

## 8. UI/UX and Accessibility Requirements

- Desktop is the primary layout: board remains the main focus; player status, own resources/cards, action controls, trade panel, and public event log have stable, scannable locations.
- Tablet layouts reflow panels without obscuring the board; trade/log panels may collapse.
- Mobile remains usable with zoom/pan on the board and touch-sized vertex/edge hit areas. Core actions must not require hover or precision dragging.
- Selecting a build action previews legal locations and cost. Touch selection has a confirm step when accidental placement is plausible.
- Trade builder clearly separates “offer” from “request”; acceptance is revalidated server-side against current inventory and game phase.
- Include loading, reconnecting, offline, invalid action, game-over, and persistence/recovery error states.
- Player colors are supplemented by labels/symbols; do not use color as the only status signal. Support keyboard navigation and accessible names for controls.
- Avoid transmitting hidden information to the client. Board gestures and overlays must not cover turn/connection status or required controls on supported viewport sizes.

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

Each phase is a reviewable delivery slice and must be committed separately after its acceptance checks pass. The current repository is empty, so exact source-file owners will be established in Phase 1; the paths below describe intended boundaries, not existing files.

### TDD Route

- Mode: `auto`.
- Decision: `strict` for game behavior, room/protocol contracts, persistence, authorization, and migrations because these are core shared behaviors with meaningful regression and data-integrity risk.
- Authority: automatic risk-based route from the Aegis planning guidance; the user has not separately requested TDD.
- Test posture: for those code tasks, first add a focused failing rule/contract/persistence test, implement the smallest behavior to pass, then refactor while keeping the suite green. Do not claim a test-first sequence for this documentation-only phase.
- Verification: run focused tests during each task, then relevant package checks, both database integration suites, browser flows, and container tests at their stated milestones.

### Phase 0 — Design baseline (this document)

- Deliver `docs/SPEC.md` with product scope, architecture proposal, staged plan, and acceptance criteria.
- Review scope/assumptions with the user before code implementation.
- Commit independently when Git author identity is configured.

### Phase 1 — Repository foundation and rule-engine skeleton

- Establish pnpm workspace, web/service/rules packages, shared protocol types, lint/typecheck/test scripts, and local developer documentation.
- Define stable board topology types (hexes, vertices, edges), player/resource models, game phases, ruleset descriptor, command/result shape, and deterministic test seams.
- Implement a small vertical base-game path or a narrowly complete rules-engine slice to prove rules tests run without networking.
- Add baseline Docker build and health endpoint only when the app can run end-to-end.
- Acceptance: clean install/build/typecheck/test; rules package runs in isolation; container builds and serves a health check as a non-root process.

### Phase 2 — Base game, private rooms, and playable lobby

- Implement complete 3–4 player base rules, initial placement, production, robber/discard/steal, trades, bank/harbor trade, development cards, longest road/largest army, and victory.
- Build private room creation/join, guest nickname identity, seats/colors/readiness, host settings, WebSocket updates, per-player private projections, and reconnect.
- Add game snapshots/event persistence through the shared SQLite/PostgreSQL repository interface.
- Acceptance: rules test coverage for legality and edge cases; full browser game reaches victory with separate clients; private info is absent from unauthorized payloads; reconnect and process restart restore a game; integration suite passes against SQLite and PostgreSQL.

### Phase 3 — Public room browser and operational Docker distributions

- Add public-room listing/filtering, room visibility enforcement, admission race handling, and stale-room cleanup.
- Publish/build the single image and SQLite/PostgreSQL Compose examples, migrations, health/readiness, graceful shutdown, and backup/restore/upgrade docs.
- Acceptance: public rooms are discoverable only while joinable; private rooms never appear; simultaneous joins cannot exceed capacity; both database deployment modes start, persist, restart, and recover from a documented backup.

### Phase 4 — 5–6 player rules

- Implement the selected current official 5–6 player procedure and corresponding board/setup limits as a versioned ruleset.
- Test all player counts and turn-order/extra-building interactions; confirm settings never pair 5–6 seats with an unsupported expansion configuration.
- Acceptance: 3-, 4-, 5-, and 6-player games pass setup/turn/scoring tests; browser play test completes a game with six clients or automated test clients; saved game resumes with the same rules version.

### Phase 5 — Seafarers

- Add scenario-driven multi-island topology, ships, shipping routes, pirate, exploration/gold fields where required by the selected scenario, scenario-specific scoring, and setup definitions.
- Start with a named, fixed supported scenario; add further scenarios only as individually versioned/tested profiles.
- Acceptance: route legality, ship movement, pirate interactions, scenario scoring, hidden/revealed map state, and selected 5–6 player combinations have rule tests and browser coverage.

### Phase 6 — Cities & Knights

- Add commodities, city improvements, knights and activation/movement, barbarian track/events, progress cards, metropolis, revised victory target, and game-specific UI.
- Add only the official scenario combinations selected in the compatibility registry; implement required Seafarers interactions explicitly.
- Acceptance: production/card/knight/barbarian/scoring rule tests; supported 3–6 player combinations play to completion; restart and reconnect preserve all expansion state.

### Phase 7 — Responsive/accessibility hardening and release validation

- Verify desktop, tablet, and mobile layouts; keyboard and touch input; all loading/error/reconnect states; hidden-information boundaries; performance for six clients.
- Validate Docker instructions on clean SQLite and PostgreSQL deployments; document supported rule versions, supported combinations, backup, update, and known limitations.
- Acceptance: no overlapping or inaccessible core controls on agreed viewports; touch users can complete all core actions; browser E2E, both database integration suites, rule suites, container smoke/recovery checks pass.

## 12. Test and Verification Strategy

- Rules engine: unit tests for each command/phase, invariant/property tests for resource conservation, piece limits, turn ownership, road/ship connectivity, and scoring; deterministic seeded scenarios for reproducible bugs.
- Compatibility matrix: ruleset registry tests enumerate allowed player count × expansion × scenario combinations and reject all others.
- Server: integration tests for concurrent joins/trades, duplicate/retried commands, reconnection, authorization, private projections, recovery and migrations.
- Database: same repository contract suite against SQLite and PostgreSQL, including transactions, constraint behavior, restart recovery, and schema upgrades.
- Browser: multi-client end-to-end paths for private invite, public discovery, readiness/start, trade, expansion configuration, disconnect/reconnect, and game completion.
- UI: screenshot/viewport verification at desktop, tablet, and mobile sizes, plus keyboard and touch interaction checks. A screenshot alone does not prove task completion.
- Container: build image, run as non-root, verify health/readiness, volume persistence, SIGTERM handling, and clean restore using both database modes.

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

## 14. Risks and Open Items

- **Rule edition and rights:** Pin official rulebook editions for base, 5–6 players, and expansions before implementation. Product name, logo, illustrations, card text, and commercial/public distribution may have intellectual-property constraints. Do not copy official assets or text without permission; obtain appropriate legal review/licensing before a public branded release. This is a risk note, not legal advice.
- **Expansion scope:** Each expansion has multiple scenarios and not all combinations are compatible. Release claims must name supported scenarios/player counts rather than imply universal compatibility.
- **Guest identity loss:** Browser-bound identity is convenient but not durable across device/browser-data loss. Account linking is deferred and should migrate the same stable player ID rather than create a second identity.
- **SQLite operations:** SQLite is appropriate for a single application instance. Concurrent multi-replica hosting is out of scope; PostgreSQL alone does not solve active room coordination.
- **Game recovery:** Persisting snapshots and ordered command/event records adds schema and migration responsibility. Recovery semantics and backup testing must be proven before enabling long-running public games.
- **Open product decision:** Decide whether to offer a turn timer/timeout behavior. Default proposal is no timer and no automatic takeover.
- **Open architecture decision:** Confirm React/Node/Colyseus/SQL library choices after the initial repository foundation and compatibility spike, before those choices become hard to reverse.

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

### Proposed, pending implementation-time confirmation

- React/TypeScript/Vite client; Node.js/TypeScript service; Colyseus candidate; SVG board; Kysely or equivalent SQL layer.
- One application replica for first release; SQLite volume or PostgreSQL service.
- Current published official 5–6 player procedure and named scenario profiles, after pinning rulebook editions.
- No timer and no automated player takeover.

### External references

- Official base game overview and rulebook download: [CATAN](https://www.catan.com/catan)
- Official 5–6 player expansion overview: [Play CATAN with 5 to 6 Players](https://www.catan.com/explore-catan/catan-basegame-expansions/play-catan-5-6-players)
- Official Seafarers overview, rules, and player-count information: [Seafarers](https://www.catan.com/seafarers)
- Official Cities & Knights overview and Seafarers combination notes: [Cities & Knights](https://www.catan.com/cities-knights)
- Official expansion family and scenario compatibility overview: [CATAN Basegame + Expansions](https://www.catan.com/explore-catan/catan-core-family-games)
- Colyseus rooms and lifecycle: [Rooms](https://docs.colyseus.io/room)
- Colyseus graceful shutdown guidance: [Graceful Shutdown](https://docs.colyseus.io/server/graceful-shutdown)
- CATAN intellectual-property policy: [Guidelines Dealing with Intellectual Property](https://www.catan.com/guidelines-dealing-intellectual-property-catan)

The rulebook links identify authoritative materials but were not exhaustively checked for every clause or edition in this design pass. Implementation must cite and test the exact rule text/edition it adopts.
