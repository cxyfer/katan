# Release evidence index

Required by SPEC §12.2. This index records what was actually executed, in which
environment, and what remains unexercised. A claim that is not listed here is
not evidence.

## Versions

| Component | Version |
|---|---|
| Rules engine (`ENGINE_VERSION`) | `base-2025.1` |
| Service image | `catan:local` (built from this commit) |
| Node.js | v22.23.3 |
| pnpm | 10.28.0 |
| TypeScript | 7.0.2 |
| PostgreSQL used for the contract replay | 16.15 (`postgres:16-alpine`) |
| SQLite | `node:sqlite` (Node 22 built-in) |

The source hashes for the official rulebooks were not downloaded or recorded in
this environment; the rules are implemented from the specification's paraphrase
and the publisher's rulebooks. This is listed as a gap in `docs/FIDELITY.md`.

## Executed commands and results

All commands were run from the repository root unless stated otherwise.

| # | Command | Result |
|---|---|---|
| 1 | `pnpm --filter @catan/rules test` | 109 passed / 12 files |
| 2 | `pnpm --filter @catan/rules exec tsc --noEmit` | clean |
| 3 | `pnpm --filter @catan/protocol test` | 7 passed |
| 4 | `pnpm --filter @catan/server test` | 78 passed, 11 skipped (PostgreSQL-only) |
| 5 | `TEST_POSTGRES_URL=postgres://catan:catan@127.0.0.1:55432/catan pnpm --filter @catan/server test` | 89 passed / 9 files |
| 6 | `pnpm --filter @catan/server exec tsc --noEmit` | clean |
| 7 | `node packages/server/build.mjs` | `built dist/server.mjs` |
| 8 | bundled service smoke test (`/healthz`, `POST /api/session`) | `200` with `{status:"ok"}` and a `HttpOnly; SameSite=Lax` session cookie |
| 9 | `pnpm --filter @catan/web exec tsc --noEmit` | clean |
| 10 | `pnpm --filter @catan/web test` | 101 passed / 11 files |
| 11 | `pnpm --filter @catan/web exec vite build` | `dist/index.html` 0.47 kB, CSS 6.57 kB, JS 360.52 kB (gzip 107.90 kB) |
| 12 | `node scripts/smoke.mjs` (built artefacts, SQLite) | 13/13 checks passed |
| 13 | `DOCKER_BUILDKIT=0 docker build -t catan:local .` | image built, non-root runtime |
| 14 | `docker run … catan:local` then `SMOKE_BASE_URL=… node scripts/smoke.mjs` | 13/13 checks passed; container healthy and still running after 20 s |
| 15 | `docker stop -t 30 catan-app` then `docker start catan-app` | graceful `SIGTERM` logged; the same guest identity was restored from the volume |
| 16 | `docker compose -f docker-compose.postgres.yml up -d --no-build` then the smoke run | `/readyz` → `ready`; 13/13 checks passed; `guests`/`games`/`chat_messages` rows present in PostgreSQL |
| 17 | Playwright + Chromium 156 headless, three isolated browser contexts against the published URL | lobby → start → settlement → road, `PROBLEMS: none` (see below) |
| 18 | Same harness, full three-player game advanced through the API then rendered | 12 setup commands accepted, roll accepted, 12 states captured in `docs/screenshots/` (superseded by the 2026-10-28 refresh below) |
| 19 | Board-fit measurement at 1366×768 before and after the fix | SVG bottom `803` → `752` against a `768` viewport; whole map now above the fold |
| 20 | `TEST_POSTGRES_URL=postgres://catan:catan@127.0.0.1:55433/catan pnpm --filter @catan/server test` on PostgreSQL 17.12 (`postgres:17`), 2026-11-14, commit `0130d07` (#115) | 28 files; 358 passed, 2 skipped (`retention sweep scheduling`, SQLite-only by design); exit 0, 0 errors. Both E&P restart cases in `explorers-pirates.test.ts` passed. The same suite at `885644a` passed its tests but exited 1 with 10 `Cannot use a pool after calling end on the pool` unhandled rejections (see `packages/server/test/shutdown-drain.test.ts`) |

Rows 1–19 were executed in the original session; row 20 was added on 2026-11-14.

## Real-browser verification

The API-level smoke test could not see a defect that only a browser produces, so
the flow was replayed in headless Chromium (Playwright 156.0.8078.4) with three
isolated contexts, one per seat, against the published URL. The run asserts:

- entry and nickname for all three seats, with no `E_NETWORK` state;
- a private three-seat room, two joins, three ready signals, and `start` enabled
  with no blockers;
- the board renders (SVG present) and a settlement then a road are placed by
  clicking the engine-provided legal targets;
- the turn passes to the second seat, which then sees its own legal targets;
- **zero** failed requests, zero `/api/*` responses >= 400, and zero console
  errors.

Two defects were found and fixed by this run, neither of which any existing test
could observe:

1. **Every API call failed in a real browser.** `ApiClient` stored the host
   `fetch` in a private field and invoked it as `this.#fetch(...)`, passing the
   client instance as the receiver; the browser's native `fetch` rejects any
   receiver other than its global with `TypeError: Illegal invocation`. Node's
   `fetch` and the injected test fakes tolerate it, so the suite was green while
   the application was unusable. Fixed at the transport adapter, with a
   regression test whose fake enforces the browser's receiver contract (it fails
   without the fix).
2. **The "Fit board" control did not fit the board.** `resetView` only reset pan
   and zoom, while the SVG was capped at `70vh` measured from the wrong edge, so
   at the specification's primary desktop viewport (1366×768) the map ended 25px
   below the fold. Fixed by measuring the SVG's own top edge and sizing the board
   to the remaining viewport height; verified by measurement and screenshots.
3. **Service notices rendered as raw ids.** 32 of the 40 message ids the service
   authors (`blocker.*` and its own `error.E_*`) were absent from both catalogs,
   so a player saw `blocker.seats` instead of a sentence. Fixed by giving
   `@catan/protocol` the service vocabulary, adding a server-side guard test that
   scans the source for undeclared ids, adding the missing keys in both locales,
   and extending the client parity test to the full 95-id set.

## Screenshot refresh (2026-10-28)

Two interface redesigns landed after the 2026-10-26 captures, so every set under
`docs/screenshots/` was re-rendered against the current build
(`index-BN2uccZK.js`, `index-DIALwB7a.css`). All runs used headless Chromium
against the existing service on `127.0.0.1:3000`; none started a replacement
server.

| Set | Harness | Result |
|---|---|---|
| Canonical 22 states at `deviceScaleFactor: 2` | `docs/aegis/work/2026-10-28-screenshots/capture-canonical.py` | 119 assertions, 0 page errors |
| `island-ui/` 53 states (6 scenes × 4 viewports × 2 locales + 5 mobile panels) | `verify-browser.py` | 306 assertions, 0 page errors |
| `card-table/` 20 states (6 viewports × 2 locales) | `verify-card-table.py` | 144 assertions, 0 page errors |
| `table-interactions/` 8 fixture states + `real/` 20 states | `verify-table-interactions.py`, `verify-card-table.py` | 190/190 checks and 144 assertions |

The canonical, `card-table/` and `real/` sets drive a real three-player game
through the UI; the interaction set still mocks every `/api/**` call. The
terminal result remains an injected HTTP fixture, not a completed server game.
Two measured layout facts are recorded rather than corrected: the entry document
is 842 px tall at 1366×768, and the 360×640 lobby capture shows the invite card
over the ready control.

## Fixture families passed

| Family | Evidence |
|---|---|
| R-B01 … R-B07 | `packages/rules/test/{setup,production,seven,trade,devcards,awards,victory}.test.ts` |
| R-56 | `packages/rules/test/paired.test.ts` (engine-level; `base-paired-2025` advertised) |
| R-VIS | `packages/rules/test/privacy.test.ts`, `packages/server/test/game.test.ts` |
| R-ROOM | `packages/server/test/{rooms,abandonment,housekeeping}.test.ts` |
| R-POLICY | `packages/server/test/rooms.test.ts`, `packages/server/test/abandonment.test.ts` |
| R-SAVE | `packages/server/test/recovery.test.ts` |
| R-REC | `packages/server/test/{recovery,db-contract}.test.ts` on SQLite and PostgreSQL |
| R-TRADE | `packages/rules/test/trade.test.ts` (engine); service-level races not exercised with several browsers |
| R-CHAT | `packages/server/test/chat.test.ts` |
| Message-id completeness | `packages/rules/test/message-ids.test.ts`, `packages/protocol/test/protocol.test.ts`, catalog parity in `packages/web/test/i18n.test.ts` |
| U-01…U-05, U-I18N (partial) | `packages/web/test/*.test.tsx` — jsdom component tests only |

## Client coverage

`packages/web` ships 101 jsdom component tests. They cover catalog parity and
protocol-list coverage, board geometry (19 hexes / 54 vertices / 72 edges with
engine-identical indices), action-hint enable/disable with reason ids, the
command lifecycle (submitting → unknown → resolve → stale → refresh → retry with
a new command id, draft preserved on rejection), chat send states with
deduplication and personal mute, the mobile drawer never covering the required
action, keyboard target selection, pan/zoom never committing, trade
offer/respond/settle/withdraw, and the lobby policy flow.

What they do **not** cover: any real browser, device, touch, screen-reader or
200%-zoom run; no screenshots or visual-regression baselines; no live server or
WebSocket transport (the socket is faked); no timing measurements; no IME
behaviour; and no Seafarers/Cities & Knights surfaces.

## Container verification

The published image was built and run, and the smoke script was pointed at the
running container (`SMOKE_BASE_URL`) so the shipped artefacts were exercised
together: client delivery, guest session, room discovery, start, a full initial
placement of 12 commands, a dice roll, chat and a projection check. The runtime
is non-root (`uid=10001`), writes SQLite into the mounted volume, reports
`healthy`, survives a `docker stop`/`docker start` cycle with the guest identity
intact, and serves the PostgreSQL Compose stack with `/readyz` reporting
`ready`.

## Observed play sessions

No **human** playtest, physical-device session or screen-reader walkthrough was
performed in this environment. The headless-Chromium run above is automated
interaction evidence, not a substitute for U-03, U-04, U-07 or U-08. U-03, U-04, U-06, U-07 and U-08
therefore remain unverified; `docs/FIDELITY.md` lists them as gaps rather than
claims.

## Unresolved limitations

The authoritative list is the "Known gaps and unresolved items" section of
`docs/FIDELITY.md`. In summary: harbor positions are approximated, the fixed
board transcription lacks a recorded page citation, only the base and paired-base
profiles are advertised, no device/accessibility/playtest evidence exists, multi-browser
races and real presence timing are unexercised, the advisory turn clock is
stored but not cued, and only one rules-engine version ships.

## Approved decisions carried forward

D-01 … D-06 from SPEC §14.1 were applied without re-requesting approval:

- **D-01** 2025 base rule family; no edition mixing.
- **D-02** base delivered first; the full §5.7 matrix stays registered with
  unverified rows disabled.
- **D-03** configurable pre-start policy, all-seat consent after start, host
  succession, autosave plus explicit Save and leave, all-seat suspend/resume.
- **D-04** structured trading plus room text chat.
- **D-05** one deployed instance, with the engine version stored per game.
- **D-06** Traditional Chinese and English from the first release.

No new product-scope decision was taken during implementation.
