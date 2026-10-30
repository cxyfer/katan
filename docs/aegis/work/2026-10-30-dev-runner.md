# Development runner and live-table repair

## Diagnosis and repair

On Node 24.12.0, the previous runner launched the service through Node's
strip-only TypeScript loader. The service stopped at a parameter-property
constructor before listening, while Vite remained available. The web Vite
configuration also had no `/api` or WebSocket proxy, so a browser opened on
5173 could not use the service on 3000 or enter a table.

The runner now bundles the service with esbuild using the production build
contract, watches server/rules/protocol sources, and owns Vite in a child
process so Vite cannot exit the supervisor on SIGTERM. It stops both child
processes on startup/runtime failure or Ctrl-C. Development output is isolated
from `packages/server/dist/server.mjs`. Vite proxies HTTP and
WebSocket traffic to the configured service port with strict, explicit web-port
handling. No database, schema, credentials, API or game-rule changes were
made.

## Verification

- `pnpm test:dev`: passed. The isolated integration fixture used temporary
  SQLite and random ports and covered API cookies, WebSocket ping/pong, the
  three-player setup/roll smoke flow, watch restarts, syntax-error recovery,
  persistent sessions, occupied ports, runtime crashes and cleanup.
- Final `pnpm verify`: passed after the lifecycle fixes. This includes typecheck,
  404 web tests, rules (110), protocol (7), server (84 passed, 11 PostgreSQL
  tests skipped because PostgreSQL is not configured), web (404), production
  build, smoke (13/13), and the dev lifecycle integration test.
- Independent review found and reproduced two shutdown races: SIGINT during
  asynchronous Vite bind, and Vite's own SIGTERM handler exiting before the
  runner's backend kill deadline. Vite is now an owned child process with a
  bounded SIGTERM/SIGKILL shutdown; the delayed-bind test verifies both owned
  ports close and the runner exits. A network-only Vite URL is also treated as
  ready for non-default interface hosts.
- `python3 scripts/table-ui-polish/verify.py --out
  test-results/table-ui-polish-final-v3`: production Chromium verification
  passed 20/20 scenarios across SVG/R3F, English/Traditional Chinese, four
  viewport sizes, and reduced-motion variants.
- A fresh `pnpm dev` run used `PORT=3316`, `VITE_PORT=5174`, and an isolated
  temporary SQLite file because port 5173 already had an unrelated listener.
  Three independent Chromium contexts created and joined a room, readied and
  started it without API or WebSocket interception; all three reached the game
  table and board, reported `online`, and had no page errors or failed requests.
- The three PR screenshot targets (`trade-desktop.png`, `dice-focused.png`,
  `hand-gains.png`) were confirmed in GitHub at the pinned commit
  `118016a571eddcfe6f4636cd024afa12e827321f`; their paths are valid.

The existing Vite process on port 5173 was not owned or stopped by this task.
Use `http://localhost:5173` for the dev client; the service remains on port
3000 by default. Existing SQLite data remains at `.data/catan.sqlite` unless
`SQLITE_PATH` is set. The live browser check used separate ports and an
isolated database to avoid touching the existing listener or game data.
