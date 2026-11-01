# Expansion roadmap: Seafarers, Cities & Knights, Traders & Barbarians, Explorers & Pirates

Status: advisory plan (Aegis workspace record, not an authoritative runtime
decision). SPEC §5 remains authoritative; each phase amends SPEC/FIDELITY when
it changes a contract or enables a profile.

This revises an earlier research proposal. The main revisions are listed in
§1; phases and their stacking are in §3.

## 1. Review of the earlier proposal

Kept:

- No free "checkbox" mixing. A game is one explicit registry profile; the lobby
  derives its choices from the registry and the server rejects anything else
  (SPEC §5.2). Only combinations with an official source are registered.
  Pairwise compatibility is **not** transitive: SF+CK and CK+T&B being allowed
  says nothing about SF+CK+T&B.
- Platform first, then Seafarers, then Cities & Knights, then their
  combination. T&B is a box of independent scenarios and variants, never one
  boolean module. E&P is a different movement/cargo engine and is never
  combined with Seafarers.
- C&K uses the 5-level improvement tracks (level 3 ability, level 4
  metropolis, level 5 can take a metropolis); the scaffold comment "0..3" is
  wrong and is fixed in the C&K phase.
- A single `Pending` cannot express C&K/T&B roll resolution; it becomes an
  ordered queue in the platform phase.

Changed:

1. **Source of truth is the 2025 rulebook PDFs**, not secondary summaries
   (Colonist, Wikipedia). They are downloadable (SPEC §15). Every phase records
   edition, publication id, SHA-256, pages and access date for the sources it
   uses, and transcribes scenario maps from the printed map. Secondary
   summaries may only point to where to look. Unresolvable contradictions stay
   open fixtures instead of becoming house rules (SPEC §5.3).
2. **C&K is split into two phases** (core pieces/economy, then progress cards
   and enablement). Each is a reviewable PR; the profile is `implemented` after
   the first and `enabled` only after the second.
3. **Generic boards belong to the platform phase**: topology built from an
   arbitrary hex-coordinate set (sea frame, separate islands), and the 3D/SVG
   renderers and camera fit working from that topology instead of assuming
   19/30-hex islands. Seafarers then only adds its maps and pieces.
4. **Engine modularisation is part of the platform** so later phases land in
   their own files (`packages/rules/src/modules/<expansion>/…`, per-module
   event/error/i18n lists merged by the existing single-source-of-truth tests).
   This keeps parallel phase branches from colliding in `engine.ts` and the
   catalogs.
5. **Versioning**: each profile carries its own `ruleVersion`; the snapshot's
   `engineVersion` keeps meaning "the rules this game was created under".
   Base keeps master's version (`base-2025.3` since PR #60), so existing
   saves are untouched.
6. **"Required boxes" is display metadata only** (lobby hint), not part of
   validation.
7. **Scope cuts made explicit** (deferred, not dropped): Catan for Two and any
   2-player mode (needs a neutral-player subsystem and capacity 2 across room,
   lobby and paired logic); all T&B and E&P combinations with SF/CK; T&B/E&P
   5–6 player profiles; other Seafarers scenarios (fog/exploration etc.);
   mini-expansions. Each would be a later phase with its own sources.

## 2. Cross-phase rules

- Base behaviour, base saves and base fixtures must not change. `pnpm verify`
  passes at the end of every phase.
- Privacy invariant (`rules/test/privacy.test.ts`) extends to every new hidden
  thing: progress-card hands, decks, face-down tiles/cards, fog, hidden VP.
- Idempotent command receipts and server randomness recorded in the snapshot
  (the engine never draws on its own) stay as they are.
- A profile is `enabled` only when its fixture family passes and its source
  evidence is recorded in `docs/FIDELITY.md`. Otherwise it stays
  `implemented: true, enabled: false` with an `unavailableReasonKey`, and the
  PR says so.
- Assets are original: procedural three.js geometry like
  `board/three/diorama-structures.ts`, hand-written SVG emblems, procedural
  audio cues in `audio/`. No official artwork, logos or verbatim card text;
  card effects are paraphrased in both locales (zh-Hant and en).
- Each phase adds browser evidence under `scripts/<slug>/` and
  `docs/aegis/work/<date>-<slug>.md` (+ `INDEX.md` rows) and screenshots under
  `docs/screenshots/<slug>/`, following the existing harnesses.

## 3. Phases

| Phase | Branch | Stacks on | Content | Profiles after the phase |
|---|---|---|---|---|
| P0 platform | `feat/expansion-platform` | `master` | registry v2, compatibility, pending queue, layout/scenario registry, generic topology + rendering, module structure, lobby picker, per-profile versions | base only (enabled) |
| P1 Seafarers | `feat/seafarers` | P0 | Heading for New Shores 3/4 + 5/6, ships, pirate, gold, island bonus, Longest Trade Route, ship/pirate assets | `sf-new-shores-*` enabled |
| P2 C&K core | `feat/cities-knights-core` | P1 | setup, event/red die, commodities, 5-level improvements, metropolis, knights, barbarians, walls, defenders; assets | `ck-*` implemented, disabled |
| P3 C&K progress | `feat/cities-knights-progress` | P2 | 54 progress cards, merchant, card UI/assets, full-game fixtures | `ck-*` enabled |
| P4 SF+CK | `feat/seafarers-cities-knights` | P3 | New Shores with C&K (R-COMB), 3/4 + 5/6 | `sf-ck-new-shores-*` enabled |
| P5 T&B | `feat/traders-barbarians` | P0 | variants (event cards, harbourmaster), Fishermen, Rivers, Caravans, Barbarian Attack, Traders & Barbarians scenario — base 3/4 only | each scenario its own profile |
| P6 E&P | `feat/explorers-pirates` | P1 | Land Ho!, then Pirate Lairs / Fish / Spices / full campaign — 3/4 only, standalone | each mission set its own profile |

P1 → P4 is one stack because the combination needs both expansions and C&K
code can account for ships from the start. P5 only needs the platform. P6
reuses Seafarers' sea/ship rendering and pirate assets, not its rules. When a
lower PR is squash-merged, the PR above it is rebased onto the new base.
Recommended merge order: P0, P1, P2, P3, P4, P5, P6.

## 4. Phase contracts

### P0 platform (no new rules)

- Registry v2: `ExpansionId` (`seafarers`, `citiesKnights`,
  `tradersBarbarians`, `explorersPirates`), `ScenarioId`, per-profile
  `expansions`, `scenario`, `variants`, `ruleVersion`, `sources` (source ids +
  pages), `requiredBoxes`, `implemented`/`enabled`. `resolveCombination` takes
  `{ expansions, scenario, variants, playerCount, setupMode }` and returns
  `allowed`/`reason`/`profile`. Existing ids and the eight SF/CK rows stay.
- Pending queue: ordered frames with explicit responders; base keeps behaving
  as a queue of at most one; old snapshots without the new field load.
- Layout/scenario registry: `createGame` asks the profile's layout builder;
  base builders unchanged and byte-identical for the same seed.
- Generic topology from an explicit hex set (with sea frame, islands, marked
  harbour slots) registered under stable ids; renderers (3D + SVG), camera fit,
  coastline and targets work from it. A dev preview (`?preview=`) shows a
  synthetic archipelago without creating a room.
- Rules modules: hook points for setup, roll resolution, production, build
  options, scoring, projection; per-module event/error code arrays.
- Protocol/web: `ProfileView` exposes expansions/scenario/variants/
  requiredBoxes; lobby/home picker selects expansion set → scenario → count
  from the registry; disabled profiles never offered.

As built (2026-11-01, `feat/expansion-platform`; details in
`docs/aegis/work/2026-11-01-expansion-platform.md`):

- `resolveCombination` keeps the existing `{ ok, profile } | { ok: false,
  reason }` shape (reasons `invalid-request`, `unknown-profile`, `disabled`,
  `bad-player-count`, `bad-setup-mode`) instead of `allowed`. Profiles gained
  `ruleModules` (default `[...expansions, ...variants]`) and `layoutId`;
  `modules: {seafarers, citiesKnights}` is gone from profiles and
  `ProfileView`. Rooms accept `profileId` or `ruleset: { expansions,
  scenario, variants }`.
- Pending queue = `state.pending` (active head) + optional
  `state.pendingQueue`, omitted when empty so base snapshots stay
  byte-identical. Module frames are `{ kind: '<module>.<step>', module,
  responders, data }`; a frame with no responders is a continuation resolved
  by the module's `resumePending`.
- Module state lives in `state.moduleState[<id>]` (absent for base games).
- Placeholder module directories exist for all four expansions, each with its
  own `messages.ts`; web has per-module catalogs in
  `packages/web/src/i18n/modules/<id>.ts`.
- Generic topologies come from `TopologyDefinition` (`buildTopologyFromHexes`,
  `registerTopologyDefinition`); renderers derive land from terrain
  (`BoardGeometry.land`), so sea hexes are open water.

### P1 Seafarers — Heading for New Shores

SF25 pp.2–5 and SF56-25 pp.2–4 plus R-SF (SPEC §5.6). Ships, ship movement
limits, closed routes, pirate (move on 7/knight, blocks, steals from adjacent
ships), gold choice with shortage ordering, per-player-per-small-island bonus,
Longest Trade Route, Road Building with ships, paired actor ship move. Maps
transcribed per count. Assets: ship (per colour), pirate ship, island-bonus
marker, gold/sea polish, ship build/move targets, cues.

As built (2026-11-01, `feat/seafarers`; details in
`docs/aegis/work/2026-11-01-seafarers.md`):

- Both `sf-new-shores-*` profiles are enabled (`sf-2025.1`). The 3/4 maps are
  transcribed per cell into `packages/rules/src/seafarers-boards.ts`
  (topologies `sf-new-shores-3/-4/-56`, layout builder `sf-new-shores`); the
  5–6 profile's only setup mode is `variable` (fixed small islands, random
  main island and ports). The middle-row end cells of each outline are frame,
  and the pirate starts there (`board.pirate = null`).
- The base engine became sea-aware (land vertices/edges, roads extend only
  roads, robber on land, road/ship junction only at an own building for the
  trade route). New module hooks for later phases: `allowBuilding` (building
  veto, e.g. scenario start islands), `moveBandit` (claims robber targets for
  another bandit — C&K/SF+CK must keep the Bishop on the robber),
  `freeRouteTargets` (extra Road Building pieces), `afterBoardChange` now gets
  the kit; kit gained `legalRoads` and `placedFreeRoute`.
- Ships are `RoadRef.ship` pieces owned by the `seafarers` module
  (`build.ship`, `ship.move`, `setup.placeShip`); gold is the
  `seafarers.gold` pending frame (`gold.choose`); module state tracks the
  current window's built ships/move and the island claims.
- Deviations: gold shortage ordering is an explicit interpretation (turn
  order from the roller); SF-FAQ 18 ship-circle special cases conflict with
  SF25 p. 2 and stay an open fixture (SF25 wording implemented); the 3/4
  variable setup (SF25 p. 5) is not offered.

### P2 C&K core

CK25/CK56-25. City-on-second-placement setup, three dice and event order
before production/7, commodities and separate bank, 5-level tracks and
abilities, metropolis award/transfer/protection, knights (3 strengths, 6 per
player, activation/promotion/move/displace/chase robber), barbarian track and
attack resolution, walls, defender VP, robber off-board until first attack,
no development cards / Largest Army. Assets: knights (3 levels × active),
walls, metropolis per track, barbarian ship and track, event die, commodity
emblems, improvement chart UI.

### P3 C&K progress cards

All 54 cards (three 18-card decks), acquisition by event + red die and level,
hand limit 4 (5 for 5–6), immediate VP cards, Alchemist pre-roll, merchant,
each card's targets/responses/privacy. Card visuals (original), i18n
paraphrases, full simulated games. Enable `ck-*` if R-CK passes.

### P4 SF + C&K

COMB guidance: target 16, gold gives resources only, merchant not on gold,
first-barbarian protection also applies to the pirate, knights on road/ship
networks, Bishop stays robber-only, both 5–6 rulebooks for paired profiles.

### P5 Traders & Barbarians

Sources: the current English T&B rulebook (and 5–6 only to the extent cited).
Each scenario/variant is its own profile on the base board (3/4 players):
Fishermen, Rivers, Caravans, Barbarian Attack, Traders & Barbarians; event
cards and harbourmaster as `variants` on base profiles where the rules allow.
Catan for Two and SF/CK combinations deferred.

### P6 Explorers & Pirates

Standalone 3/4 players. Land Ho! first (free ship movement, cargo of
settlers/crew, fog revealed by server randomness and never projected early,
harbour settlements), then Pirate Lairs, Fish for Catan, Spices for Catan and
the full Explorers & Pirates campaign. Never combinable with Seafarers;
C&K/T&B combinations deferred.
