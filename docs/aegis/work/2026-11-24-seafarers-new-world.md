# Seafarers scenario S9: New World

Advisory work record for slice S9 of
[the scenarios spec](../specs/2026-11-22-seafarers-scenarios.md) (D2–D5, D7,
D9; §2.3, §5.1–§5.4, §6.8, §7.3–§7.5, §8, §9 OQ-5, §11 including SFX-S9).
Branch `feat/sfx-s9-new-world`, based on `release/v0.4.6` (S0–S5 merged: the
scenario registry, the profile-driven island bonus with home islands, the
shared 42-cell frame, the harbor edge rules of The Forgotten Tribe).
Profile `sf-new-world-2025` (3 and 4 players, 12 VP, rule version `sf-2025.3`,
setup mode `variable`), enabled by this slice.

## Sources (accessed 2026-11-24)

| Id | Edition | Publication | File | SHA-256 | Pages used |
|---|---|---|---|---|---|
| SF25 | CATAN – Seafarers, 2025 (`v6.250401`) | CN3083 | `CN3083 CATAN–Seafarers Rulebook 2025 secured reduced.pdf` (20 pp.) | `a499abe2b613afd618dd3c806790400c7e84adebcc9b9ab19a24fb80dd04b099` (same file as `2026-11-01-seafarers.md`) | 2–3 (rules), 20 (New World: setup, additional rules, victory, further setup options, component table) |

The PDF is not in the repository. Page 20 was rendered to an image (`p20.png`,
200 dpi, sha256 `c9ee7e8e57b6ff24f568fd140fbae74dc93e6fc56a4ce0cd755b78d13ba22c6b`)
outside the repository and read both as text and as an image; no code from the
download was executed.

## What page 20 says (paraphrased)

1. Gather the listed hexes and place them **randomly face up** inside the
   frame. "Players may take this opportunity to agree to shift the setup of the
   hexes if they would like to change the number or size of islands."
2. Gather the number discs and place them randomly on the land hexes. "If 2 red
   number discs end up on adjacent hexes, swap one of them with an adjacent black
   number hex so that all the red number discs are separated."
3. Players take turns placing a random port face up: on an edge between a land
   hex and a sea hex or between a land hex and a frame piece; at least one edge
   away from every other port. "Place the robber and pirate on the indicated
   locations." (the sentence sits under the port bullet; it is a separate setup
   step, see I1.)
4. Starting settlements with roads or ships go on one island or two different
   islands: those are the player's **home islands**. All other islands are
   unexplored for that player; each player has their own.
5. Additional rule: the first settlement on an unexplored island earns 1 VP
   (take a VP token, place it under the settlement), for each unexplored island,
   whether or not others settled there. Win: 12 VP on your own turn.
6. Further setup options (variant, not implemented): change the number and type
   of hexes freely; gold fields should not get red discs.

## Component table check

The page 20 table was read cell by cell and compared with the spec (§6.8) and
with the constants in `seafarers-new-world-boards.ts`; the tests re-check them
on 1,000 generated boards.

| | Sea | Gold | Hills | Forest | Pasture | Fields | Mountains | Desert | Total |
|---|---|---|---|---|---|---|---|---|---|
| Page 20 | 19 | – | 4 | 5 | 5 | 5 | 4 | – | 42 |
| `NW_HEX_COUNTS` | 19 | 0 | 4 | 5 | 5 | 5 | 4 | 0 | 42 |

| Discs | 2 | 3 | 4 | 5 | 6 | 8 | 9 | 10 | 11 | 12 | Total |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Page 20 | 1 | 3 | 3 | 3 | 2 | 2 | 3 | 3 | 2 | 1 | 23 |
| `NW_DISC_COUNTS` | 1 | 3 | 3 | 3 | 2 | 2 | 3 | 3 | 2 | 1 | 23 |

Port markers: 5 × 2:1 (one per resource) + 5 × 3:1 = 10 (`NW_PORT_TOKENS`). VP
tokens: 16 (`NW_VP_TOKENS`, see I6). Land hexes 23 = discs 23; sea 19. The frame
is the 42-cell outline rows 5-6-7-6-7-6-5 (`NS4_CELLS`; the two middle-row
protrusions are frame, as for the 4-player New Shores and the Fog Islands). The
topology `sf-new-world` shares those cells and has **no harbor slots**: ports
are placed by the players, so a layout starts with `harbors = []` (as for
The Forgotten Tribe).

## Layout builder (`seafarers-new-world-boards.ts`)

All draws use the passed `Rng`; the result is stored in the snapshot.

1. `shuffle` the 42 hex tiles over the 42 cells.
2. `shuffle` the 23 discs over the land cells in cell order.
3. `separateRedDiscs`: while a red disc (6 or 8) touches another red disc,
   pick one of the red discs that still has a red neighbour (rng), then pick (rng)
   any black disc such that, after the swap, the red disc's new cell has no red
   neighbour (its own old cell does not count: it now holds the black disc);
   swap. Each swap removes every adjacency of that red disc and creates none,
   so the number of adjacent red pairs strictly falls: termination is
   guaranteed. A candidate always exists: the other three red discs can block at
   most 3 × 6 = 18 black cells and there are 19 black discs.
4. `islandsOf`: connected components of land hexes (hex adjacency) are the
   islands, numbered from 1 by the smallest hex index in each component. A
   vertex never touches two different islands: two land hexes at one vertex are
   always adjacent, so the home-island rule has no ambiguous corner.

Statistics over seeds 1–1,000 (`scratchpad` run of the same function the test
uses): 559 boards needed at least one swap (683 swaps in total, at most 3 per
board); island counts 1 / 2 / 3 / 4 / 5 / 6 = 144 / 335 / 333 / 136 / 46 / 6.
A one-island board (14.4 %) has no island bonus at all, which is what the
"agree to shift" redraw is for (I5).

## Setup stage `harbor` (`modules/seafarers/world.ts`)

`SetupState.stage` gains `'harbor'`. The Seafarers module's `initGame` creates
`SeafarersState.world = { pool, drawn, placed, rerolls }`, sets
`turn.setup.stage = 'harbor'` and draws the first port; no pending frame is used
(S3 had trouble with frames in setup). The acting player is `turn.seat`
(`players[placed % n]`, i.e. the start player first, then clockwise). The command
is `world.harbor { edge }`: the port is the one just drawn (public), the player
only chooses the edge. After a placement the module draws the next port with
`ctx.rng` and moves `turn.seat`; after the 10th (or when no legal edge is left)
the stage becomes `building` and the starting settlements run exactly as before
from `order[0]`. `project.ts` reports `turn.setup.seat = turn.seat` during the
harbor stage so the UI names the right player.

Legal edges (`separatedCoastEdges`, shared with The Forgotten Tribe): a
non-interior edge between a land hex and a sea hex or the frame, not already a
port, sharing no vertex with an existing port.

Public state (`GameView.modules.seafarers.world`): `{ drawn, placed, total,
rerolls, canRegenerate }`. Hints for the acting player carry `harborChoices`,
`targets['world.harbor']` and `board` (an armed edge target list for both
renderers); other seats get empty values. Events: `world.harborDrawn`,
`world.harborPlaced`, `world.harborsSkipped`, `world.regenerated`.

## Regeneration with every human's consent (OQ-5)

Spec default taken: a whole-board redraw, no limit on the number of redraws, each
one needs every human seat; no choice of cells.

- **Who/when.** Only the host proposes (`POST /api/games/:id/regenerate`, no
  body); only while `canRegenerate` (harbor stage, no port placed yet). The
  proposal reuses the game proposal tables (`game_proposals` / `game_consents`,
  kind `regenerate`, the same mechanism as the all-seat save/suspend vote);
  the proposer counts as one consent; bot seats would count as agreeing (none
  exist for this profile).
- **Vote.** Another seat answers `{ proposalId, approve }`; one refusal sets the
  proposal to `rejected` and the board is untouched; the proposer may withdraw
  the same way. The host alone can never redraw while another human is seated.
- **Apply.** When the last consent arrives the service calls
  `regenerateBoard(state, secureRng())` from `@katan/rules` (not a player
  command: `world.regenerate` is refused as an unknown command). It redraws
  terrain, discs and islands, returns all ports to the pool, draws a new first
  port and starts again at the start player; revision + 1 and the events are
  stored in one transaction before anything is published.
- **Lapse.** Any accepted command (a port being placed) cancels an open
  `regenerate` proposal; asking afterwards gives `E_REGENERATE_UNAVAILABLE`.
- **UI.** Host: a "propose a new board" button in the port prompt; other seats:
  an agree/decline banner (`RegeneratePanel`, same layout as the suspend vote);
  after the redraw everyone's snapshot is pushed.

## Interpretation table

| # | Question | Decision |
|---|---|---|
| I1 | "Place the robber and pirate on the indicated locations" | The map on page 20 draws the pirate (ship) on the left frame and the robber (pawn) on the right frame; neither stands on a hex. Pirate `null` (frame, as in New Shores), robber `-1` (beside the board, as in the Traders & Barbarians boards). Both are in play: a 7 or a knight moves the robber to any land hex (nothing is blocked before that) or the pirate to any sea hex. The robber is not drawn until it stands on a hex. |
| I2 | Red-disc swap partner | "An adjacent black disc" may not exist or may leave a red pair; any black disc that creates no new red adjacency is allowed, chosen with the rng (spec §6.8). Terminates (see above). |
| I3 | "At least one edge away" | No shared vertex between port edges (the same reading as The Forgotten Tribe, I5 there). |
| I4 | "Random port each time" | One port is drawn per turn, after the previous one was placed, not shuffled up front; the undrawn pool is server-only. The drawn port is face up and public. A port cannot be declined or swapped. |
| I5 | Agreeing to shift the hexes | Digital form: whole-board redraw, host proposes, every human agrees, any refusal cancels, unlimited but each time unanimous, only before the first port (spec OQ-5 default). Robber/pirate and the start player do not change. |
| I6 | 16 VP tokens | The tokens are bookkeeping: a claim is recorded per (player, island) and there is no supply limit. With 4 players and up to 5 other islands the count could in theory pass 16, but a player needs 12 VP to end the game, so it cannot matter in practice; SF25 says nothing about running out. |
| I7 | No legal edge for a port | Cannot happen on 42 hexes with 23 land hexes (every port uses at most 3 of the 30+ coast edges), but handled: the remaining ports go back to the box (`world.harborsSkipped`) and setup moves on. Tested on a one-hex board. |
| I8 | Home islands | Recorded when setup ends from the settlements touching an island (one or two), as for The Four Islands; later settlements on a home island earn nothing, every other island gives 1 VP once per player. A one-island board has no bonus (redraw if unwanted). |
| I9 | Setup mode | `variable` only (the board is random). `fixed` is refused. |
| I10 | Bots | Not supported (profile `botSeats` is false, the room refuses a bot seat with reason `profile`). |
| I11 | Variant "Further setup options" | Not implemented (free hex counts, gold fields); no gold or desert in this scenario. |
| I12 | One-island boards | About 14 % of random boards are one island, so no island bonus is possible. Kept as is (maintainer decision): the lobby does not warn about it; the all-seat redraw is the way out, and the help text explains it. |
| I13 | Robber and pirate on the frame | Kept as is (maintainer decision): the robber (`-1`) and the pirate (`null`) are not drawn on the frame before they first move; drawing them there would need a change in both renderers and is out of scope. |
| I14 | Who may propose a redraw | Kept as is (maintainer decision): only the host proposes, as the spec words it; every other human seat can only agree or decline. |
| I15 | Redraw edge cases | Consent is idempotent (a retry or double click counts once). It is refused with `E_GAME_SUSPENDED` while the table is suspended, and a suspension cancels an open redraw proposal. A redraw empties the client's port selection so a port cannot be placed on an old edge. |
| I16 | Phone evidence | Same standard as The Forgotten Tribe and Cloth for Catan: both renderers are exercised on the desktop (SVG and 3D port placement), the phone run operates one renderer (SVG, through the target list). The renderers share one board intent (`hints.board` through `boardIntent`), so a phone 3D run adds no separate rule path. |

## Evidence

Test files and their counts are listed in `docs/FIDELITY.md` (R-SFX-S9). Browser
evidence: `scripts/seafarers/capture_new_world.py` with the fixture
`scripts/seafarers/world_fixture.mjs`; report `docs/screenshots/seafarers-new-world/report.json`
(sha256 per image; `committed: true` marks the curated captures kept).
