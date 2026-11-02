# Cities & Knights — core (P2)

Advisory work record for phase P2 of
[the expansions roadmap](../plans/2026-11-01-expansions-roadmap.md). Branch
`feat/cities-knights-core`, stacked on `feat/seafarers` @ `00954ec` (PR #63,
which stacks on PR #57). Progress-card effects are P3.

## Sources (accessed 2026-11-02)

| Id | Edition | Publication | File | SHA-256 | Pages used |
|---|---|---|---|---|---|
| CK25 | CATAN – Cities & Knights, 2025 (`v6.250401`, PDF created 2025-03-10) | CN3087 | `CN3087 CATAN–Cities&Knights_ Rulebook.pdf` (16 pp.) | `dac9f01afe9006e3b517aa257363c844eb2a9ff4b6578d3127f5d8d861c9a540` | 2 (objective), 3 (components, improvement board, player aid), 4–5 (setup), 6 (roll dice phase, event die, progress draws), 7 (production chart, 7, trade), 8 (walls, metropolises, improvements, level-3 abilities), 9–10 (knights, knight actions, progress-card rules, winning), 11 (barbarian attack), 12 (Seafarers combination — read for P4 only), 13–16 (progress-card list) |
| CK56-25 | CATAN – Cities & Knights 5–6, 2025 (`v6.250401`) | CN3088 | `CN3088 CATAN–Cities & Knights 5-6_ Rulebook.pdf` (4 pp.) | `eab1b29e2804f54d5fe79fb1a95e7d3199d37fb73483e4807a247a931be536c9` | 2 (components, introduction), 3 (setup changes, paired turn), 4 (turn summary chart) |
| CK-FAQ | catan.com/faq/cities-knights (HTML, older-edition card names) | — | `faq.html` | `47f50c967d000a5de642bd95ebfe1b6383e8dbfa7988683eb272a6a60a1d3122` | used only where compatible with CK25 (see below) |

Downloads went to a fresh directory outside the repository; pages were read
as text and rendered with PyMuPDF 1.24.14 (the wheel verified in P1) and read
as images where the rule is only printed in a picture (costs, improvement
board, barbarian track). No code from the downloads was executed.

## Rule clauses (paraphrased; no card or rule text is copied)

### Setup and turn (CK25 pp. 2, 4–6; CK56-25 p. 3)

| Clause | Source |
|---|---|
| Win with 13 VP or more at any point during your own turn | CK25 pp. 2, 10 |
| Development cards, sea frame 1-2 and the Largest Army tile are not used | CK25 p. 3 |
| Resource and commodity cards in eight face-up stacks; three progress decks sorted by type and shuffled separately; VP tokens in a pile | CK25 p. 4 (step 3) |
| Barbarian ship on the start space of the track; robber next to the final space (off the board) | CK25 p. 4 (step 4) |
| Each player: improvement board with one cube on the bottom space of each track | CK25 p. 5 (step 5) |
| Round 1: settlement + adjacent road, forward order. Round 2: city + adjacent road, reverse order. Distance rule for both | CK25 p. 5 (step 6) |
| Starting resources: one matching resource per hex adjacent to the city (one card per hex, no commodity) | CK25 p. 5 (step 7) |
| Turn: Roll Dice phase (Alchemy only before rolling; roll 3 dice; barbarian ship / attack; progress draws and VP cards), Production phase (collect or resolve a 7), Action phase (trade, build, walls, improvements, recruit/promote/activate knights, knight actions) | CK25 p. 6, player aid p. 3 |
| Resolve the event die before the production dice | CK25 p. 6 |
| Ship face: barbarian ship one space closer; on the last space the barbarians attack. The first attack moves the robber to the desert, activating it | CK25 p. 6 |
| City-gate face: each player whose cube range on that track contains the red die draws the top card of that deck, in turn order from the current player | CK25 p. 6 |
| VP progress cards are placed face up at once, even off-turn; then a player not on turn discards down to 4 progress cards, the player on turn has until the end of the Action phase; discards go face down under their deck | CK25 pp. 6, 10 |
| 5–6: board as in CATAN 5–6 with the C&K barbarian frame; 18 extra commodity cards; paired players as in CATAN 5–6 (P1 roll + production + action, P2 action phase without trading with other players); either player wins at 13 during their part | CK56-25 pp. 2–3 |

### Production, 7, trade (CK25 p. 7)

| Clause | Source |
|---|---|
| Settlements produce normally; cities: forest 1 paper + 1 lumber, pasture 1 cloth + 1 wool, mountains 1 coin + 1 ore, fields 2 grain, hills 2 brick | CK25 p. 7 (chart) |
| On a 7 no hex produces | CK25 p. 7 |
| Discard: more than 7 cards (resources + commodities) → return half rounded down; each wall raises the limit by 2 | CK25 pp. 7–8 |
| Robber inactive until placed on the desert after the first attack: it does not move and nobody steals | CK25 p. 7 |
| Active robber: move to a new hex, steal 1 random card (resource or commodity) from a player with a building there; the robber's hex produces neither resources nor commodities | CK25 p. 7 |
| Domestic trade: any combination of resources and commodities | CK25 p. 7 |
| Supply trade: resources may be traded for commodities; at 4:1 or 3:1 (port) commodities may also be given for resources or other commodities | CK25 p. 7 |
| Progress cards cannot be traded | CK25 p. 7 |

### Building (CK25 pp. 8–10; costs printed on the pages)

| Item | Cost | Rule | Source |
|---|---|---|---|
| City wall | 2 brick | under an own city, one per city, at most 3 built; +2 hand limit each; a pillaged city's wall returns to the player's supply | CK25 p. 8 |
| City improvement | level *n* costs *n* commodities of the track (science: paper, trade: cloth, politics: coin) | needs ≥ 1 city on the board; no skipping; any number per turn; improvements stay after losing the last city but none can be added until a city is built again | CK25 pp. 3, 8 |
| Recruit a knight | 1 wool + 1 ore | basic knight only, on an empty intersection connected to an own road, distance rule not needed, starts inactive | CK25 p. 9 |
| Promote a knight | 1 wool + 1 ore | replace with the next strength; status unchanged; needs a free higher piece; a knight is promoted at most once per turn; strong → mighty needs politics level 3 | CK25 p. 9, card text Smithing p. 14 |
| Activate a knight | 1 grain | stand up an inactive knight; recruit-then-activate and act-then-activate are allowed, activate-then-act on the same turn is not | CK25 p. 9 |

Improvement board (CK25 p. 3, rendered at 300 dpi):

| Level | Science | Trade | Politics | Cost | Red die draws |
|---|---|---|---|---|---|
| 0 | Basic City | Basic City | Basic City | — | none |
| 1 | School | Market | Town Hall | 1 | 1–2 |
| 2 | Library | Trading House | Embassy | 2 | 1–3 |
| 3 | Aqueduct | Merchant Guild | Fortress | 3 | 1–4 |
| 4 | Theater | Bank | Courthouse | 4 | 1–5 + metropolis (temporary) |
| 5 | University | Great Exchange | High Assembly | 5 | 1–6 + metropolis (permanent) |

Level-3 abilities (CK25 p. 8): science — a player who receives no cards in the
Production phase may take 1 resource of choice (not on a 7); trade — trade
any 2 identical commodities for 1 other commodity or resource; politics —
promote strong knights to mighty knights. The ability is permanent (FAQ 17,
20 compatible).

Metropolises (CK25 p. 8): first to level 4 on a track takes that track's
metropolis (temporary control); first to level 5 takes it permanently,
including from a level-4 holder. It goes on a different own city each; with
no available city the level-4/5 improvement cannot be purchased. 2 VP each (a
metropolis city is worth 4). Each metropolis city counts toward the
barbarians' strength and cannot be pillaged.

Knights (CK25 pp. 9–10): 6 per player, two of each strength (basic 1, strong
2, mighty 3). Knights act like buildings for routes: no road past an
opponent's knight (active or inactive), knights block settlement sites and
split opponents' routes for Longest Route. Knights active at the beginning of
the Action phase may take one action, after which they lie down:

- **Move**: along own continuous routes, past own pieces but not others',
  ending on a connected empty intersection.
- **Displace**: move (same route rules) onto an intersection holding a weaker
  opponent knight; the opponent then moves their knight by the move rules,
  status unchanged; if impossible, it returns to their supply.
- **Chase away the robber**: an active knight adjacent to the robber's hex
  activates the robber (move + steal as on a 7).

Progress cards (CK25 pp. 10, 13–16): play any number in the Action phase
(Alchemy only before rolling; VP cards immediately); hand limit 4; VP cards
are face up, not in the hand limit, cannot be stolen; may be played the turn
drawn; played cards go face down under their deck; a card played without
benefit still counts as played. **Playing effects is P3.**

Deck composition (CK25 pp. 13–16):

| Deck | Cards (count) | Total |
|---|---|---|
| Science | Alchemy 2, Crane 2, Engineering 1, Invention 2, Irrigation 2, Medicine 2, Mining 2, Printing (VP) 1, Road Building 2, Smithing 2 | 18 |
| Trade | Commercial Harbor 2, Guild Dues 2, Merchant 6, Merchant Fleet 2, Resource Monopoly 4, Trade Monopoly 2 | 18 |
| Politics | Constitution (VP) 1, Diplomacy 2, Encouragement 2, Espionage 3, Intrigue 2, Sabotage 2, Taxation 2, Treason 2, Wedding 2 | 18 |

### Barbarian attack (CK25 p. 11)

1. Barbarians' strength = number of cities on the board, a metropolis city
   counting as one city (worked example: 2 + 2 + 1 metropolis = 5).
   Defenders' strength = sum of all active knights' strengths.
2. Barbarians stronger: the player(s) with the lowest active-knight total
   (zero knights counts as lowest) each lose one city (city → settlement,
   wall removed; with no settlement in supply the city lies on its side as a
   settlement that must be upgraded before any other); a metropolis cannot be
   pillaged; if that group cannot lose a city, the next lowest group does.
3. Defenders at least as strong: the single highest contributor takes a 1 VP
   token; on a tie nobody does and each tied player, from the current player,
   draws a progress card from the deck of their choice.
4. Ship back to the start; all knights become inactive.

### Barbarian track and event die (component pictures, CK25 pp. 3, 6)

The C&K frame shows the ship on the leftmost wave of a track of 8 spaces (start,
6 intermediate waves, the attack space marked with the ship icon at the shore),
so the barbarians attack on the 7th ship result after a reset. The event die
faces are not written in CK25; the die shows a ship face and city-gate faces.
The engine uses three ship faces and one gate per track (the C&K component
die); this is recorded as a source gap in FIDELITY.

## FAQ entries used (compatible with CK25)

Battle ensues immediately (no activation when the ship arrives); a player
without a city or improvement may still be rewarded; the affected player
chooses which city is pillaged; a city lost this roll produces as a
settlement; walls do not protect cities; commodities can be discarded and
stolen; knights: at most one promotion per knight and turn, may recruit and
promote at once, may promote then act if activated earlier, no voluntary
deactivation or removal, a displaced knight may return to the attacker's
origin if connected and needs a connected empty intersection, passive knights
interrupt roads; progress-card shortage: draw in order until the stack is
empty.

## FAQ entries not used

- "Barbarian strength b = s + m" (cities + metropolises): CK25 p. 11 says
  cities including metropolis cities and its worked example counts a
  metropolis city once. CK25 wins; recorded in FIDELITY.
- Card names (Bishop, Deserter, Spy, …) are the older edition's; the 2025
  names above are used.

## What was built

| Area | Files | Notes for later phases |
|---|---|---|
| Hooks | `modules/types.ts`, `modules/README.md`, `engine.ts`, `analysis.ts`, `pending.ts`, `project.ts` | `vertexBlocker`, `allowCity`, `robberInactive`, `bankRate`, `beforeEndTurn`, `disabledCommands`; `discardLimit`, `resumePending` and continuation frames; base digests unchanged |
| State | `types.ts` | players gain `commodities`, `progressCards`, `improvements`, `cityWalls`, `defenders`; the game gains `commodityBank` and `progressDecks` (per track, top = index 0) |
| Module | `modules/citiesKnights/` (`dice.ts`, `production.ts`, `barbarians.ts`, `knights.ts`, `cities.ts`, `progress.ts`, `state.ts`, `constants.ts`, `messages.ts`) | 13 commands, 6 frames, `ck.*` events; see below |
| Profiles | `profiles.ts` | `ck-2025` (3–4) and `ck-paired-2025` (5–6): `implemented: true`, `enabled: false`, `profile.unavailable.citiesKnightsProgress`; `sf-ck-*` unchanged and disabled |
| Web | `board/citiesKnights.ts`, `components/SvgCitiesKnights.tsx`, `board/three/diorama-knights.ts`, `board/three/DioramaCitiesKnights.tsx`, `components/CitiesKnightsPanel.tsx`, `CitiesKnightsPrompt.tsx`, `CitiesKnightsBadge.tsx`, `CardKindArt.tsx`, `styles/cities-knights.css`, `i18n/modules/citiesKnights*.ts`, `audio/` | original SVG and procedural 3D knights (3 levels × active), walls, metropolis keeps per track, barbarian ship and track, event die, commodity cards and emblems, toppled city; board actions and two-step knight targets; panel (track, chart, progress hand, supply, last attack); prompts for pillage, retreat, defender deck, progress discard, science bonus; commodities in hand, discard, bank and player trades; scoring marks and help; five cues |
| Evidence | `packages/rules/test/ck-*.test.ts`, `packages/server/test/cities-knights.test.ts`, `packages/web/test/cities-knights.test.tsx`, `scripts/cities-knights/` | R-CK fixture map in `docs/FIDELITY.md` |

## Phase 3 hooks and state shapes

- `GameState.moduleState.citiesKnights` (`CitiesKnightsState` in
  `state.ts`): `barbarian`, `attacks`, `knights[]` (`player`, `vertex`,
  `level`, `active`, `activatedIn`, `promotedIn` as `windowId`s), `walls`
  (city vertices), `metropolises` per track, `toppled`, `progressVp` per
  player, `lastRoll`, `lastAttack`, `produced` (science ability).
- Progress cards: `player.progressCards` (private hand),
  `state.progressDecks[track]` (draw from the front; discards go under the
  deck). `drawProgressCard(state, playerId, track, ctx, cause)` handles
  draws, VP cards and empty decks; `queueProgressDiscards` and
  `progressLimitVeto` handle the limit. P3 needs a `progress.play` command,
  per-card frames (add them to `pendingCommands`), Alchemy before the roll
  (`rollDice` already reads the module's dice) and the merchant piece
  (`vertexBlocker` / production / `score`).
- Frames: `citiesKnights.resolveRoll` (continuation), `.pillage`,
  `.displaced`, `.progressDiscard`, `.defenderDraw`, `.scienceBonus`.
- Knight helpers in `knights.ts` (`knightReach`, `displaceTargets`,
  `retreatOptions`, `vertexOccupant`) are what Diplomacy/Intrigue/Treason
  style cards will need; barbarian helpers in `barbarians.ts`.

## Interpretations

Recorded in `docs/FIDELITY.md`, "Cities & Knights interpretations and open
fixtures": barbarian strength per CK25 (not the FAQ formula), event-die faces
as a source gap (3 ships + 3 gates), no reward without a defender, metropolis
site check only when it awards, draws before discards, the hand limit of 4 for
5–6 (a correction to the roadmap draft, which said 5), the aqueduct scope, the
merchant in P3, and the road past an opponent building, which is fixed on
master by #60 and arrives with the rebase (`vertexBlocker` must then build on
#60's connectivity).

## Browser harness

`scripts/cities-knights/capture.py` (port `CK_PORT`, default 3032) runs the
built service on a private SQLite file. The profiles are disabled, so it
switches a readied base room's `profile_id` while the service is stopped
(test-only). `scripts/cities-knights/topology.mjs` prints edge endpoints for
the bot. Curated captures and the file table are in
`docs/screenshots/cities-knights/`.

## Verification

- Rules: R-CK fixtures in `ck-dice` (15), `ck-cities` (14), `ck-barbarians`
  (11), `ck-knights` (11) and simulated 3/4/5/6-player games (`ck-sim`, 2);
  base and Seafarers regression digests unchanged.
- Service: a `ck-2025` game through `RoomService`/`GameCoordinator` on the
  test-only path (three dice, idempotent receipts, base development cards
  rejected), and the disabled profile still
  rejected for new rooms.
- Web: 10 client tests (actions, two-step knight move, pillage arming, SVG
  pieces and hidden robber, 3D models, prompts, panel, commodity discard,
  points, events and cues in both locales).
- Browser: `scripts/cities-knights/capture.py`, 14 cases, 0 page errors
  (Chromium 145, software WebGL). The P0 base harness compares the base boards
  byte for byte with the P0 references
  (`2026-11-02-cities-knights-core/base-compare-report.json`, 4 of 4
  identical).
- `SMOKE_PORT=3431 pnpm verify` (exit 0): typecheck; rules 27 files / 274
  tests; protocol 8; server 105 passed, 11 skipped (PostgreSQL contract
  replay, no `TEST_POSTGRES_URL`); web 57 files / 571 tests; build; smoke
  13/13; dev runner passed.

## Limitations

- Progress cards are drawn, held, discarded and scored (VP cards), but not
  playable; the merchant is not in play. Both are P3, so the profiles stay
  disabled and the browser evidence uses a test-only profile switch.
- The stack is not yet rebased onto master (#58–#60, #64); the road past an
  opponent building stays open until then.
- No human playtest, physical device, Safari/Firefox or screen-reader check.
- PostgreSQL repository tests were not run (no `TEST_POSTGRES_URL`).
