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
pnpm dev            # client dev server + service on http://127.0.0.1:3000
```

## Quick start (Docker)

```bash
docker compose up --build -d     # SQLite, persistent volume
# or
POSTGRES_PASSWORD='<secret>' docker compose -f docker-compose.postgres.yml up --build -d
```

Open `http://localhost:3000`, enter a nickname, create a private room, share the
invite code, and start once every seat is ready. See
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
SMOKE_BASE_URL=http://host:3000 pnpm smoke   # verify a running deployment
```

To replay the service suite against PostgreSQL:

```bash
TEST_POSTGRES_URL=postgres://user:pass@host:5432/db pnpm --filter @catan/server test
```

## What is supported today

- Base game (`base-2025`) for **3 and 4 players**, fixed or variable setup.
- Private rooms with invite codes and a public room list.
- Guest identity via a secure browser cookie, with nickname changes.
- Host-configured room policy before start; after start every seated player must
  approve a change.
- Server-authoritative commands with durable, idempotent receipts.
- Structured trade offers plus room text chat.
- Automatic persistence, individual *save and leave*, all-seat
  save/suspend/resume, and restart recovery.
- Traditional Chinese and English UI.

Not yet enabled: 5–6 player paired turns, Seafarers and Cities & Knights. Those
profiles are registered in the ruleset registry but disabled; the server rejects
them. See [`docs/FIDELITY.md`](docs/FIDELITY.md) for the full list of gaps,
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
