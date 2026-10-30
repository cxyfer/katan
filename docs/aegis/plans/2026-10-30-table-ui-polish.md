# Table UI polish after PR #11

## Intent and baseline

User authorizes direct implementation of four presentation changes. Base:
`origin/master` at `6fb4b43`, clean dedicated `codex/table-ui-polish` worktree.
Authority: `docs/SPEC.md` sections 4.4, 4.5 and the table interaction follow-up;
implementation boundaries: BoardInspection, TradePanel/GameTools, HandPanel,
DicePresentation/BoardView. Existing visual language stays unchanged.

The previous 1500 ms inspection delay is an explicit old product choice,
not a broken timer. TradePanel currently stacks both resource selectors and
bank exchange. Dice presentation renders numeric results. Resource gain
animation is new presentation behavior, not a rules change.

Decision: code-change. Configuration alone cannot change these components.
Use existing owners, extract bank exchange into one component rather than
keeping duplicate forms, and add only a presentation helper for resource gains.
No rules, API, save schema, deployment or persistent-data changes.
ArchitectureReviewRequired: yes (presentation integration). TDD Route: off;
focused regression tests plus full verification are required.

## Implementation and ownership

1. Parent: shorten BoardInspection delay to exactly 1000 ms, test the boundary,
   cancellation and target changes; update current SPEC wording.
2. Trade worker: two-column give/want builder; separate ExchangePanel and
   exchange navigation with bilingual labels, draft retention and keyboard
   controls. Preserve existing trade commands, server rates and confirmation.
3. Hand worker: decorative resource cards descend into the local hand on fresh
   gains only; retain immediate authoritative counts, suppress initial/recovery
   playback, cap bursts, clean up effects and respect reduced motion.
4. Dice worker: reusable full-face pip layout for all values 1-6, focus and
   compact dice; preserve reveal timing and accessible result announcement.
5. Parent: integrate, independently review, test/typecheck/build/smoke, run
   browser checks on production assets at desktop and mobile sizes, commit,
   push and open a PR against master. No merge or production deployment.

## Acceptance and verification

- Map info absent at 999 ms and visible at 1000 ms. Moving, leaving, dragging,
  touch and Escape retain their existing semantics.
- Trade give/want are on the same row; bank/port exchange is a separate option.
  Both forms remain usable in English and Traditional Chinese on mobile.
- Only own visible positive resource changes animate; no invented opponent
  resources, initial hand animation, duplicate replay or delayed state updates.
- Pips fill the die face, not a small Unicode dice glyph inside a second face;
  result descriptions remain accessible and reduced motion remains supported.
- Run `pnpm typecheck`, workspace tests (web single-worker for stability),
  `pnpm build`, `pnpm smoke`, and browser geometry/interaction assertions.
- Browser fixtures demonstrate UI behavior, not real multiplayer delivery.

## Checkpoint

- Baseline inspected; dependencies installed from frozen lockfile.
- Four implementation slices complete; full verification and independent
  review are recorded in `../work/2026-10-30-table-ui-polish.md`.
- Browser verification passed 20/20 scenarios; final PR handoff pending.
- Retirement: remove bank form from TradePanel and numeric/Unicode die faces;
  keep no alternate legacy rendering owner.
