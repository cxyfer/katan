# Development runner repair

## Evidence and boundary

Reproduced Node 24.12.0 parameter-property failure by running the existing
strip-only service command. The existing Vite `/api/config` returns HTML instead
of JSON because the config has no service proxy. The runner also leaves Vite
alive after a service crash. These are separate developer-path failures; the
production bundle tests do not cover them.

Decision: code-change. Fix the runner and Vite config, not domain constructors
or game state. Reuse/extract the existing esbuild options as one build owner;
own Vite as a child process so it cannot terminate the runner early on SIGTERM,
and serialize service restarts through the esbuild onEnd hook. Keep development
output separate from production output.
No new dependencies, schema changes, credential changes or real-data cleanup.

## Plan

1. Replace strip-only subprocess launch with compiled/watch server lifecycle.
2. Proxy same-origin HTTP/WebSocket traffic and correct the README dev URL.
3. Test startup, private cookie/session, live socket, three-player setup/roll,
   watch rebuild and source-error recovery, shutdown (including delayed bind and
   a stalled child) and occupied-port failure using temporary SQLite and ports.
4. Check browser entry to a real local table without fixture interception,
   typecheck/build/test regression, then append the fix to open PR #14.

## Completion evidence

The runner integration test passed after the final shutdown and initial-build
failure assertions were added. A three-browser Chromium check also entered a
real local table through the Vite proxy; see
`docs/aegis/work/2026-10-30-dev-runner.md` for the exact boundary and limits.

Verification boundary: local Node 24.12.0 and Chromium. Existing user Vite on
5173 is not owned by this task and must not be killed. Use isolated test ports.
TDD Route: off; regression verification required. ArchitectureReviewRequired:
yes (development lifecycle and shared build configuration).
