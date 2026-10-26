# Island game UI redesign — intent

## TaskIntentDraft
- Outcome: a cohesive browser-game UI across entry, home, lobby and play, not a recolored engineering form.
- Approved: direction A, island exploration, deep ocean / gold / parchment; user confirmed in the design-choice tool on 2026-10-27.
- Parent: ../../plans/2026-10-27-island-ui.md; session goal goal-760a0ed0-0882-4b56-a6b4-195cc73e3620.
- Scope: frontend layout, original SVG art, visual tokens, presentation helpers, bilingual copy and UI tests.
- Non-goals: game rules, protocol, backend, enabled expansions, identity, fake live stats, official art, new server or external assets.
- Success: coherent screens, preserved create/join/readiness/play/trade/chat/recovery behavior, fresh verify plus rendered viewport/interaction evidence.
- Stop: done with evidence; needs-verification for unavailable device/assistive tests; pause-for-user for scope/authority changes.

## BaselineReadSetHint / BaselineUsageDraft
- Required, acknowledged and cited: README; SPEC §4/§8/§14; FIDELITY; affected existing client screens/styles and tests.
- No repository AGENTS/CONTEXT docs found. Missing refs: none. Decision: continue.

## ImpactStatementDraft
- Owner: packages/web existing screen/panel owners, styles.css and i18n catalogs; presentation-only SVG helper.
- Invariants: server projections and controller remain canonical; private hands remain private; commands, preview/confirmation, local drafts, start blockers, save/reconnect and both languages remain supported.
- Compatibility: no schema, public API, persisted data or dependency change. No retirement authority required.
- Risk: overflow or obscured mandatory actions; inaccessible tabs/focus; copy drift; preserve via tests and viewport checks. Real-device/screen-reader evidence unavailable so do not claim full conformance.

## TaskStartSnapshot / readiness
- master @ 7f75bbf; /data/home/workspace/catan; no remote. Source clean at start; user screenshot modifications/untracked files are excluded from task and preserved.
- ArchitectureReviewRequired: no runtime architecture change; independent UI compliance and code-quality reviews required.
- TDD off / skipped; post-change tests still required.
- Intent/scope/baseline locked to approved plan; return to design for any protocol/rule/identity change.
