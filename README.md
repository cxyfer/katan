# CATAN-style browser game

A server-authoritative, browser-based multiplayer hex-board trading game for
3–4 players (base game), built from the design specification in
[`docs/SPEC.md`](docs/SPEC.md).

The rules engine is pure and deterministic; the service owns identity, rooms,
durability and per-player projections; the client renders only what its seat is
allowed to see.

## Repository layout

```
packages/rules      pure rules engine (no network, no database)
packages/protocol   wire types, room policy and stable message ids
packages/server     HTTP + WebSocket service, persistence, rooms, chat
packages/web        React + Vite client (Traditional Chinese / English)
docs/SPEC.md        the confirmed product specification
docs/API.md         the HTTP/WebSocket contract
docs/OPERATIONS.md  configuration, deployment, backup, upgrade
docs/FIDELITY.md    fixture-to-evidence index and known gaps
```

## Quick start (local development)

```bash
pnpm install
pnpm dev            # open http://localhost:5173 (Vite + proxied service)
```

The service listens on port 3000; Vite forwards `/api` and `/ws` from port 5173
so guest cookies and live table updates share the browser's origin. The runner
compiles the TypeScript service using the same esbuild options as production,
watches service/rules/protocol changes, and stops both servers on Ctrl-C or a
runtime startup failure. No prior `pnpm build` is required. Data stays in
`.data/catan.sqlite` unless `SQLITE_PATH` is set. If ports are occupied, stop
the earlier dev session or use `PORT=3001 VITE_PORT=5174 pnpm dev`; Vite does not
silently select a different port. Keep using one hostname for the same session.

Open `http://localhost:5173/?preview=island` to inspect the island models without
creating a room. The preview uses the game's 3D renderer and offers 19/30-tile
layouts, quality settings, and a 25–80° viewing-angle slider. Hold the left
mouse button and drag horizontally to rotate or vertically to change elevation;
Shift-left drag or right drag pans, and the wheel zooms. Single-touch drag
orbits; two fingers pinch to zoom and move together to pan.
Focus the map to use arrow keys to pan, `[` / `]` to rotate, and Home to fit.
The 30-tile preview is a visual demonstration; expansion rules remain disabled.

Games use 3D when available, with a playable SVG board during loading or GPU
failure. Add `?renderer=svg` for the explicit 2D path or `?quality=low` for
reduced shadow and pixel-density costs.

## Quick start (Docker)

The Compose files run the published `ghcr.io/cxyfer/katan` image:

```bash
docker compose up -d     # SQLite, persistent volume
# or
POSTGRES_PASSWORD='<secret>' docker compose -f docker-compose.postgres.yml up -d
```

To build the image from this checkout instead, add the build override:

```bash
docker compose -f docker-compose.yml -f docker-compose.build.yml up --build -d
# or
POSTGRES_PASSWORD='<secret>' docker compose -f docker-compose.postgres.yml \
  -f docker-compose.build.yml up --build -d
```

The package is published publicly, so the Compose files pull it without a
registry login.

Open `http://localhost:3000`, enter a nickname, create a private room, share the
invite code, and start once every seated player is ready and the ruleset's
minimum is met. A room does not need to be full: a four-seat base room may
start with three, and a six-seat paired room with five. See
[`docs/OPERATIONS.md`](docs/OPERATIONS.md) for configuration and backup.

## Verification

```bash
pnpm verify                          # typecheck + all tests + build + post-build smoke
```

Individual gates:

```bash
pnpm typecheck                       # all packages
pnpm --filter @catan/rules test      # rules fixtures R-B01–R-B07, R-56, R-VIS
pnpm --filter @catan/server test     # R-ROOM/R-POLICY/R-SAVE/R-REC/R-CHAT
pnpm --filter @catan/protocol test
pnpm --filter @catan/web test        # client component tests
pnpm build                           # client bundle + service bundle
pnpm smoke                           # boots the built artefacts and plays a setup
pnpm test:dev                        # temp SQLite, real dev proxy/socket/watch lifecycle
SMOKE_BASE_URL=http://host:3000 pnpm smoke   # verify a running deployment
```

The production island preview can be captured and exercised with the existing
board evidence runner's Python/Playwright environment:

```bash
python scripts/board-3d/verify-diorama.py --out test-results/island-diorama
```

Build first with `pnpm build`; choose a new empty output directory. This checks
desktop/mobile viewports, both layouts, zoom, left-drag orbit, alternate pan,
actual WebGL camera elevation changes, quality changes, browser errors and
the preview's absence of game/identity API calls. Viewport
emulation does not establish physical-device performance.

Sound checks (build first; new empty output directories):

```bash
python3 scripts/audio/verify.py http://127.0.0.1:5173 test-results/audio-palette  # needs `pnpm dev`
python3 scripts/audio/live.py test-results/audio-live                             # starts the built service
```

`verify.py` renders every cue offline and checks it is audible without
clipping, then measures live music and effect output after a click. `live.py`
plays a real three-player setup and checks that events arriving over the
WebSocket are audible, and that they are silent while muted.

To replay the service suite against PostgreSQL:

```bash
TEST_POSTGRES_URL=postgres://user:pass@host:5432/db pnpm --filter @catan/server test
```

## What is supported today

- Base game (`base-2025`) for **3 and 4 players**, and paired base
  (`base-paired-2025`) for **5 and 6 players**, fixed or variable setup.
- Private rooms with invite codes and a public room list.
- Guest identity via a secure browser cookie, with nickname changes.
- Host-configured room policy before start; after start every seated player must
  approve a change.
- Server-authoritative commands with durable, idempotent receipts.
- Structured trade offers plus room text chat.
- Automatic persistence, individual *save and leave*, all-seat
  save/suspend/resume, and restart recovery.
- Traditional Chinese and English UI.
- Sound: event cues and generative background music synthesised live with the
  Web Audio API (no audio files), with mute and separate effect/music volume in
  every screen. Listen to the whole palette at `/?preview=sounds`.

- **Seafarers — Heading for New Shores** for 3–6 players (SF25/SF56-25 2025
  editions): the printed 3- and 4-player maps and the 5–6 map with its random
  main island, ships (build, move, Road Building), the pirate, gold fields,
  the per-player small-island bonus, Longest Trade Route and a 14-point goal,
  in both the 3D and SVG boards.

- **Cities & Knights** for 3–6 players (CK25/CK56-25 2025 editions): the
  event die and barbarians, knights, walls, commodities, city improvements,
  metropolises, the 54 progress cards (23 playable types, two scored when
  drawn) and the merchant, with a 13-point goal, in both the 3D and SVG
  boards. Computer opponents are not available in this mode yet.

- **Seafarers + Cities & Knights — Heading for New Shores combined** for 3–6
  players (COMB guidance and CK25 p. 12): the New Shores maps with the Cities
  & Knights setup, progress decks, knights, barbarians and merchant, knights
  carried along ships and onto the sea, the pirate waiting for the first
  barbarian attack and chased by knights, gold without commodities and a
  16-point goal, in both the 3D and SVG boards. Bot seats are not offered
  for the expansions.

See [`docs/FIDELITY.md`](docs/FIDELITY.md) for the full list of gaps,
including the device, accessibility and playtest evidence that has not been
produced.

## Design notes

- **The engine never draws randomness itself.** Callers pass an `Rng`; every
  drawn outcome is stored in the snapshot, so recovery never replays a draw.
- **Commands are identified by a client-generated id.** Repeating an id returns
  the original receipt instead of applying a second effect.
- **Projections are the only state a client receives.** Hidden hands, deck order
  and unrevealed cards are never serialised into another seat's payload.
- **SQL is portable.** Statements are authored with `?` placeholders and
  rewritten for PostgreSQL; the same repository contract suite runs on both.

## Intellectual property

This is an original implementation of a paraphrased rules specification. It does
not include official artwork, logos or card text. Review licensing before any
public branded release (SPEC §14).
