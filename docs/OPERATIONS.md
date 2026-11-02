# Operations guide

Supported topology for this release: **one application replica**. PostgreSQL
improves durability and concurrency but does not coordinate live rooms across
replicas, so do not scale the service horizontally until live-room ownership,
listing, reconnect routing and cross-process coordination are implemented and
tested (SPEC §10).

## Configuration

| Variable | Default | Meaning |
|---|---|---|
| `PORT` | `3000` | HTTP/WebSocket listen port |
| `HOST` | `0.0.0.0` | Listen address |
| `DATABASE_URL` | – | `postgres://…` selects PostgreSQL; `sqlite:/path` selects SQLite |
| `SQLITE_PATH` | `./.data/catan.sqlite` | SQLite file when `DATABASE_URL` is unset |
| `WEB_DIST_PATH` | – | Directory of the built client; unset serves API only |
| `PUBLIC_URL` | – | Public origin (e.g. `https://catan.example.com`) used for the absolute `og:image`, `og:url` and canonical URLs in link previews; unset derives it from `X-Forwarded-Proto`/`Host` |
| `SESSION_COOKIE_NAME` | `catan_session` | Guest identity cookie name |
| `COOKIE_SECURE` | `true` when `NODE_ENV=production` | Adds `Secure` to the cookie |
| `NICKNAME_MAX_LENGTH` | `24` | Nickname bound (code points) |
| `CHAT_MAX_LENGTH` | `500` | Chat message bound (code points) |
| `CHAT_RATE_PER_MINUTE` | `20` | Per-sender chat messages per rolling minute |
| `CHAT_HISTORY_PAGE_SIZE` | `50` | Chat page size cap |
| `ROOM_CAPACITY_MAX` | `6` | Room capacity cap |
| `ROOM_IDLE_TTL_MINUTES` | `720` | Stale-lobby sweep horizon (never applied to resumable/suspended games) |
| `DEFAULT_TURN_CLOCK_SECONDS` | `0` | Advisory clock default (`0` = off) |
| `DEFAULT_DISCONNECT_GRACE_SECONDS` | `300` | Disconnect grace default |
| `DEFAULT_ALLOW_ABANDONMENT` | `true` | Default for the abandonment option |
| `SHUTDOWN_TIMEOUT_MS` | `10000` | Hard stop after SIGTERM |
| `PRESENCE_SWEEP_INTERVAL_MS` | `5000` | Presence sweep interval |
| `LOG_LEVEL` | `info` | `debug` \| `info` \| `warn` \| `error` |

Policy bounds are enforced server-side (`POLICY_BOUNDS`): turn clock `0–3600`,
disconnect grace `30–3600`. Invalid values are rejected with
`error.E_INVALID_POLICY`; a modified client cannot widen them.

## Deployment

The Compose files run the published `ghcr.io/cxyfer/katan:latest` image;
`docker compose pull` refreshes it. `latest` moves only on a stable release
tag, so pin an exact version tag (`ghcr.io/cxyfer/katan:v0.2.0`, or `0.1.0` for the first release) or a
digest in the `image:` line when a deployment must be reproducible. The
package is published publicly, so a pull needs no login.

### SQLite (single instance)

```bash
docker compose up -d
docker compose logs -f catan
```

The data volume must be mounted and persistent; the path is `SQLITE_PATH`
(`/data/catan.sqlite` in the image). SQLite mode requires a single writer, which
the supported one-replica topology provides.

### PostgreSQL

```bash
POSTGRES_PASSWORD='<secret>' docker compose -f docker-compose.postgres.yml up -d
```

Migrations run at startup inside a transaction per migration. A failure to
migrate stops the service with a non-zero exit instead of starting with partial
state.

### Build from the checkout

Add `docker-compose.build.yml` to compile the image from the checkout instead of
pulling the published one:

```bash
docker compose -f docker-compose.yml -f docker-compose.build.yml up --build -d
POSTGRES_PASSWORD='<secret>' docker compose -f docker-compose.postgres.yml \
  -f docker-compose.build.yml up --build -d
```

The local image is tagged `catan:local`, so a later `docker compose pull` does
not replace it.

## Health and readiness

- `GET /healthz` — liveness. Returns `200` with `{status, uptimeSeconds, version}`.
- `GET /readyz` — readiness. Returns `200` when the database answers `SELECT 1`
  and `503` with `{status: "degraded"}` otherwise. The container `HEALTHCHECK`
  uses `/healthz`; wire your orchestrator's readiness probe to `/readyz`.

## Shutdown

`SIGTERM` stops accepting new rooms and commands, closes WebSocket clients with
code `1001`, closes the HTTP listener and the database pool, then exits. The
container `stop_grace_period` must exceed the longest in-flight command; 30s is
the documented default. A hard timer (`SHUTDOWN_TIMEOUT_MS`) guarantees exit.

Because every accepted command is committed before it is acknowledged, a
process killed after `COMMIT` but before publication is recovered from the
stored snapshot and receipt; clients converge by refetching the game.

## Backup and restore

**SQLite**

```bash
docker compose stop catan
docker run --rm -v catan_catan-data:/data -v "$PWD:/backup" alpine \
  sh -c 'cp /data/catan.sqlite /backup/catan-$(date +%Y%m%d).sqlite'
docker compose start catan
```

Use `sqlite3 <file> ".backup <target>"` for a consistent copy while running, or
stop the service first. The `-wal` and `-shm` files must be copied together with
the database when the service is not stopped.

**PostgreSQL**

```bash
docker compose -f docker-compose.postgres.yml exec -T postgres \
  pg_dump -U catan catan | gzip > catan-$(date +%Y%m%d).sql.gz
```

Restore into an empty database, then start the service and verify `/readyz`.

## Upgrade and rollback

1. Record the running image digest and the current `schema_migrations` rows.
   `latest` moves with every release, so it cannot identify the old image:

   ```bash
   docker image inspect ghcr.io/cxyfer/katan:latest \
     --format '{{index .RepoDigests 0}}'   # ghcr.io/cxyfer/katan@sha256:<digest>
   ```
2. Back up the database.
3. Pull and start the new image (`docker compose pull` then
   `docker compose up -d`). Migrations are forward-only; an incompatible schema
   fails startup loudly instead of running with partial state.
4. Unfinished games keep the rules-engine version stored in their snapshot
   (`games.engine_version`). A release that cannot execute a referenced engine
   version must refuse to take over those games and preserve their data
   (SPEC §7.3); this release ships one engine version. PR #19 approved returning
   spent cards to the bank for unfinished `base-2025.1` games. On 2026-11-02,
   the maintainer explicitly approved the PR #60 exception: unfinished
   `base-2025.1` and `base-2025.2` games continue on `base-2025.3`
   (roads stop at opponent buildings; Road Building and Year of Plenty cannot
   stall, including effects already pending in saved games; older cards stay
   playable). Other rules migrations still require separate approval.
   Cards already lost and roads already built are not changed.
5. Rollback: pin the recorded digest in the Compose `image:` line
   (`ghcr.io/cxyfer/katan@sha256:<digest>`) and run `docker compose up -d`. If
   the new image applied a migration, restore the matching backup — schema
   migrations are not automatically reversible.

## Retention

Documented defaults, to be reviewed before public deployment:

- Lobby rooms are swept after `ROOM_IDLE_TTL_MINUTES` of inactivity.
- Running, suspended and interrupted games are **never** swept as stale
  lobbies; they persist until the operator's retention process removes them.
- Chat history is bound to the room/game membership epoch; a new game in the
  same room cannot read the previous game's history.
- Personal mutes never delete shared history.

## Abuse controls

- Nickname, room creation/join and public-list queries are validated and
  bounded; private room codes are 8 characters from a 32-symbol alphabet.
- Chat enforces length, per-sender rate limits and plain-text storage. The
  client renders chat as text; markup is never executed.
- Guest credentials are never logged; only the SHA-256 hash of the token is
  stored.

## Reverse proxy

Terminate TLS at the proxy and forward both HTTP and WebSocket upgrade:

```
proxy_set_header Upgrade $http_upgrade;
proxy_set_header Connection "upgrade";
proxy_set_header Host $host;
proxy_set_header X-Forwarded-Proto $scheme;
```

Set `COOKIE_SECURE=true` once TLS is in front of the service.
