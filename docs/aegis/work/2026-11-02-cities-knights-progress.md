# Cities & Knights — progress cards, merchant and enablement (P3)

Advisory work record for phase P3 of
[the expansions roadmap](../plans/2026-11-01-expansions-roadmap.md). Branch
`feat/cities-knights-progress`, stacked on `feat/cities-knights-core` @
`7c6a25b` (PR #69). P2's record is
[2026-11-02-cities-knights-core.md](2026-11-02-cities-knights-core.md).

## Sources (accessed 2026-11-02)

The same files as P2 (no new download):

| Id | Publication | SHA-256 | Pages used here |
|---|---|---|---|
| CK25 | CN3087, CATAN – Cities & Knights 2025 (`v6.250401`) | `dac9f01afe9006e3b517aa257363c844eb2a9ff4b6578d3127f5d8d861c9a540` | 6 (Alchemy before the roll, draws, hand limit), 7 (the merchant, supply trade), 9–10 (knight actions, progress-card rules), 13–16 (the card list) |
| CK56-25 | CN3088, CATAN – Cities & Knights 5–6 2025 (`v6.250401`) | `eab1b29e2804f54d5fe79fb1a95e7d3199d37fb73483e4807a247a931be536c9` | 3 (paired turn: player 2 may not trade with other players), 4 (turn chart: both players may play progress cards; Alchemy only in player 1's Roll Dice phase) |
| CK-FAQ | catan.com/faq/cities-knights (older card names) | `47f50c967d000a5de642bd95ebfe1b6383e8dbfa7988683eb272a6a60a1d3122` | entries 58–115, only where compatible with CK25 (see below) |

The pages were read as text extracted with PyMuPDF (P2's extract) and
checked against the rendered pages where the card face and the list differ.
No code from the downloads was executed.

## Card-by-card transcription (paraphrased; no card text copied)

General rules (CK25 p. 10, p. 6): any number of progress cards may be played
in the player's Action phase; Alchemy only before the roll; VP cards are
played at once, face up, even off turn, outside the hand limit and safe from
Espionage; a card may be played on the turn it is drawn; a played card goes
face down under its own deck; a card that brings no benefit still counts as
played. Hand limit 4: off turn, discard at once; on turn, by the end of the
Action phase (CK56-25 does not change it). Progress cards are never traded
(CK25 p. 7).

### Science (18 cards, CK25 pp. 13–14)

| Card | # | Timing | Targets / choices | Effect | Responses | Page |
|---|---|---|---|---|---|---|
| Alchemy | 2 | own Roll Dice phase, before rolling (player 1 only in 5–6) | the two production dice (yellow, red), 1–6 each | the production dice show the chosen values; the event die is rolled and resolved first as usual | none | 6, 13 |
| Crane | 2 | own Action phase | one city improvement the player could buy | that improvement costs 1 commodity less (level 1 is free); one Crane per improvement | none | 13 |
| Engineering | 1 | own Action phase | one own city without a wall (wall limit 3) | build that wall for free | none | 13 |
| Invention | 2 | own Action phase | two number discs, neither 2, 6, 8 nor 12; no building needed | the discs swap hexes; the robber stays on its hex | none | 13 |
| Irrigation | 2 | own Action phase | none | 2 grain per fields hex next to at least one own building; a short supply pays what is left | none | 13 |
| Medicine | 2 | own Action phase | one own settlement that may become a city | upgrade it for 1 grain + 2 ore; one Medicine per upgrade | none | 13 |
| Mining | 2 | own Action phase | none | 2 ore per mountains hex next to at least one own building | none | 14 |
| Printing | 1 | at once when drawn, even off turn | none | face up, 1 VP | none | 14 |
| Road Building | 2 | own Action phase | two road sites | build 2 roads for free | none | 14 |
| Smithing | 2 | own Action phase | one or two own knights | promote each for free; a knight is promoted at most once per turn | none | 14 |

### Trade (18 cards, CK25 pp. 14–15)

| Card | # | Timing | Targets / choices | Effect | Responses | Page |
|---|---|---|---|---|---|---|
| Commercial Harbor | 2 | own Action phase; the offers may be made at any time during that turn | per other player: one own resource card | the player receives the resource and gives back 1 commodity of their choice; with no commodity the resource is returned; one offer per player | each player offered: choose the commodity | 14 |
| Guild Dues | 2 | own Action phase | a player with more VP | look at their hand and take any 2 resource/commodity cards | none (the actor chooses) | 14 |
| Merchant | 6 | own Action phase | a land hex next to an own building | take control of the merchant and place it there; 2:1 supply rate for that hex's resource (not commodities); 1 VP while controlled | none | 7, 14 |
| Merchant Fleet | 2 | own Action phase | one resource or commodity type | 2:1 supply trades giving that type for the rest of the turn, any number | none | 15 |
| Resource Monopoly | 4 | own Action phase | one resource type | every other player gives 2 of it, or 1 if they hold only 1 | automatic | 10, 15 |
| Trade Monopoly | 2 | own Action phase | one commodity type | every other player gives 1 of it if they have it | automatic | 15 |

### Politics (18 cards, CK25 pp. 15–16)

| Card | # | Timing | Targets / choices | Effect | Responses | Page |
|---|---|---|---|---|---|---|
| Constitution | 1 | at once when drawn, even off turn | none | face up, 1 VP | none | 16 |
| Diplomacy (face: Diplomat) | 2 | own Action phase | an open road (any player) | remove it; another player's road returns to their supply; after removing an own road the player may build 1 road for free at once | none | 15 |
| Encouragement | 2 | own Action phase | none | activate all own knights for free | none | 15 |
| Espionage | 3 | own Action phase | another player | look at their progress cards and optionally take 1 (VP cards are never in a hand) | none (the actor chooses) | 10, 15 |
| Intrigue | 2 | own Action phase | an opponent's knight on an intersection connected to one of the player's routes | displace it without using a knight | the knight's owner moves it as after a displacement, or it returns to their supply | 10, 15 |
| Sabotage | 2 | own Action phase | none | every player with as many or more VP than the player discards half of their resource + commodity cards, rounded down | each affected player chooses their discards | 16 |
| Taxation | 2 | own Action phase, only after the first barbarian attack | a new hex for the robber | move the robber; steal 1 random resource/commodity card from each player with a building there (1 per player) | none | 16 |
| Treason | 2 | own Action phase | another player | they remove one of their knights; the player may place an own knight of the same or lower strength, with the removed knight's status, by the normal placement rules (a mighty knight needs no Fortress) | the chosen player picks the knight | 16 |
| Wedding | 2 | own Action phase | none | every player with more VP gives 2 resource/commodity cards of their choice (all they have if fewer) | each giving player chooses | 16 |

Totals: science 18, trade 18, politics 18 — 54 cards, matching
`PROGRESS_DECKS` in `constants.ts` (P2).

### The merchant (CK25 pp. 7, 14)

Placed by a Merchant card on a land hex next to one of the player's
buildings; whoever played the last Merchant controls it (1 VP); the controller
trades that hex's resource 2:1 with the supply. CK25 gives the merchant no
production or blocking effect and no other way to leave the board.

### FAQ entries used (compatible with CK25)

- 58 the merchant VP passes with control; 59 only the controller gets the rate;
  60 the robber on the merchant's hex does not stop the rate; 61 the rate also
  buys commodities; 62 usable on the turn played.
- 63 the "Bishop" (now Taxation) never moves the pirate (P4 note).
- 67–72 Alchemy: both production dice chosen, 7 allowed, the event die is
  still rolled, the result applies to everybody, not combined with a roll.
- 73–75 Taxation (old Bishop): steal at the new hex, 1 card per player, an
  empty hex is a legal destination.
- 76–78 Commercial Harbor: no refund when nobody has commodities; the
  receiver chooses the commodity; the player chooses the resource.
- 79–81 Crane: one improvement, one Crane per improvement, level 1 for free.
- 82–87 Treason (old Deserter): the victim chooses; a placed knight keeps its
  status and may act if active; mighty without the Fortress; playable when no
  knight can be placed; placement where a new knight may stand.
- 88–93 Diplomacy (old Diplomat): Longest Road is kept if the relocated road
  leaves the route at least as long; an opponent's interruption does not open
  the adjacent roads; an opponent's road returns to their supply; the removed
  piece is the one re-placed.
- 95, 99 cards are played after the roll is resolved (Alchemy excepted).
- 97 no voluntary discard without playing (P2).
- 101–104 deck shortage and face-down returns (P2).
- 105–107 Invention: the robber's disc may be swapped; no building needed; the
  robber stays.
- 108 one Medicine per city; 109 Merchant Fleet trades; 110 Sabotage victims
  choose their discards; 111–113 Smithing on different knights, also with one
  knight, voluntarily only one; 114 VP cards cannot be stolen; 115 monopolies
  are not refunded.

### FAQ entries not used

- 98 (a card known to have no effect may not be played): CK25 p. 10 says a
  card that brings no benefit still counts as played and gives no such
  restriction. The engine follows CK25 for cards without a target; a card
  whose effect names a target needs a legal one (interpretation P3-1).
- 64–66, 94 (Diplomacy on ships): Seafarers + C&K is P4.
- 90 (a knight may not be left without a road): CK25's definition of an open
  road already keeps a road between two own buildings and/or knights; the
  FAQ's extra connection-to-a-building rule is not in CK25 and not enforced.

## Interpretations (also in docs/FIDELITY.md)

- **P3-1 Targets.** Cards whose effect names a board or player target
  (Crane, Engineering, Invention, Medicine, Smithing, Merchant, Diplomacy,
  Intrigue, Treason, Espionage, Guild Dues, Taxation) need a legal target to
  be played; the other cards may be played without benefit (CK25 p. 10).
- **P3-2 Forced answers.** A response with exactly one possible answer (a
  Wedding giver with at most 2 cards or a single card kind, a Sabotage victim
  with a single card kind, a Commercial Harbor receiver with a single
  commodity kind, a Treason victim with one knight, Guild Dues against a hand
  of at most 2 cards or one kind) is resolved without a prompt.
- **P3-3 Commercial Harbor** is an ability for the rest of the turn: one
  offer per other player per card played; the resource and the returned
  commodity are visible only to the two players.
- **P3-4 Paired player 2** plays progress cards in their Action phase
  (CK56-25 p. 4 chart), Commercial Harbor included: the card is an effect,
  not a trade offer, so the no-trade restriction (p. 3) does not stop it.
  Alchemy belongs to the Roll Dice phase, which only player 1 has.
- **P3-5 Merchant hexes.** Any land hex next to an own building, the desert
  included (no rate there, the VP still counts); the current hex is allowed,
  which is how a player takes control of a merchant next to their building.
- **P3-6 Irrigation and Mining** are not production: the robber does not stop
  them; each hex counts once however many own buildings touch it.
- **P3-7 Encouragement** activates knights like the Activate action, so a
  knight stood up by the card cannot act on that turn (CK25 p. 9).
- **P3-8 Diplomacy, own road**: the free replacement is optional and is
  placed at once; Longest Road is recomputed only after it (FAQ 88).
- **P3-9 Victory points** for Guild Dues, Sabotage and Wedding are the public
  scores (C&K has no hidden points).

## What was built

### Rules (slices 1–3)

`packages/rules/src/modules/citiesKnights/` gains `cards.ts` (the
`progress.play` dispatcher, hints, frame projection), `card-common.ts`
(`CardRule`, block reasons), `cards-science.ts`, `cards-trade.ts`,
`cards-politics.ts`, `merchant.ts` (merchant hex, 2:1 kinds, VP) and `hand.ts`
(commodity-aware card helpers). The module registers the commands listed in
`docs/API.md`; the engine draws no randomness itself (Taxation's steal uses
`ctx.rng`). No rules API changed beyond the module state and view fields
(`merchant`, `alchemy`, `fleets`, `harbor`) and the hints (`progress`,
`harborTargets`, `twoForOne`). 375 rules tests, base digests unchanged.

### Web (slice 4)

| Piece | Where |
|---|---|
| Hand with playable and unplayable cards and reasons; play forms for Alchemy (dice), Crane (track), Invention (two hexes), Smithing (knights); board targets for Engineering, Medicine, Intrigue, Merchant, Taxation, Diplomacy; player and kind pickers; Commercial Harbor offers; turn effects (Alchemy dice, 2:1 kinds, merchant) | `components/CitiesKnightsProgress.tsx`, mounted by `CitiesKnightsPanel.tsx` |
| Responder prompts for every frame (harbor exchange, Guild Dues, Espionage, Sabotage, Wedding, Treason remove and place, Diplomacy road) | `ProgressPrompt` in the same file, rendered by `CitiesKnightsPrompt.tsx` |
| Original card faces (25 glyphs in the three track colours) and the merchant piece | `components/SvgProgressArt.tsx`, `board/three/diorama-merchant.ts`, `DioramaCitiesKnights.tsx` |
| Board targets and merchant ghost for both renderers | `board/citiesKnights.ts`, `board/intent.ts`, `SceneContent.tsx` |
| Audio cues `progress.play`, `.alchemy`, `.merchant`, `.request` | `audio/progress-cues.ts`, `synth.ts`, `cues.ts`, `SoundPreview.tsx` |
| About 100 new strings in zh-Hant and en: 32 events, errors, prompts, card names and effect paraphrases, help-panel summaries | `i18n/modules/citiesKnights.ts`, `citiesKnights-events.ts`, `HelpPanel.tsx` |

Privacy: a prompt reads only the frame data projected to its responder; a
non-responder sees no card face, hand or prompt (`cities-knights-progress.test.tsx`).

### Enablement (slice 5)

`ck-2025` and `ck-paired-2025` are `enabled: true`; the unavailable reason is
removed. `@catan/bots` has no C&K rule module, so `botSeats` stays false and
the lobby and the service refuse bot seats (`BOT_RULE_MODULES` unchanged).
Enabled-profile lists were updated in rules (`profiles.test.ts`), server
(`session.test.ts`, `rooms.test.ts`, `cities-knights.test.ts`) and web
(`rulesets.test.ts`).
Conditions: all R-CK fixtures pass (PC-* and VIS-PC1–5 included), the source
evidence is above and in FIDELITY, and a whole game plays in the browser.

### Browser harness (slice 6)

`scripts/cities-knights/ckkit.py` holds the shared helpers (server on a private
SQLite file, lobby room creation, bots for other seats, target and picker
clicks, phone contexts). `capture.py` was moved onto it and no longer rewrites
a profile. `progress.py` plays every playable card through the UI: Alchemy
before the roll and the 23 types, once in the SVG renderer and once in the 3D
renderer on the desktop, plus four board-target cards on a phone in both
renderers; responder prompts are answered from the responder's page in the
pass's renderer. It asserts the 23 types in its
`PLAYED` set and writes `report.json`. Ports: service 3032, harness 3033+.

### Card coverage (25 distinct cards, 54 copies)

CK25 has 25 distinct progress cards: 10 science, 6 trade and 9 politics (the
copy counts add up to 18 per deck). Every card is covered as follows. "UI"
means player 1 plays it through the browser (hand button, board target or form,
every response in the page of the seat that owes it) in `progress.py`; the
run does it in the SVG renderer and again in the 3D renderer on the desktop,
and the board-target cards also on a phone. Engine fixtures are in
`packages/rules/test/ck-progress-*.test.ts`.

| Card (copies) | How it enters play | UI, SVG | UI, 3D | Engine fixtures |
|---|---|---|---|---|
| Alchemy (2) | played by hand before the roll | yes | yes | PC-AL1…4 |
| Crane (2) | played by hand | yes | yes | PC-CR1…3 |
| Engineering (1) | played by hand, board target (vertex) | yes | yes, phone | PC-EN1…2 |
| Invention (2) | played by hand, form (two discs) | yes | yes | PC-IN1…2 |
| Irrigation (2) | played by hand | yes | yes | PC-IR1 |
| Medicine (2) | played by hand, board target (vertex) | yes | yes | PC-ME1…2 |
| Mining (2) | played by hand | yes | yes | PC-MI1 |
| Printing (1) | automatic: revealed and scored when drawn, never in a hand | n/a (drawn, shown in the panel: `victory_cards_shown`) | n/a (same panel) | VIS-PC1, `ck-dice` |
| Road Building (2) | played by hand, then board targets | yes | yes | PC-RB1…2 |
| Smithing (2) | played by hand, form (knights) | yes | yes | PC-SM1…2 |
| Commercial Harbor (2) | played by hand, then offers; the receiver answers | yes | yes | PC-CH1…2, VIS-PC4 |
| Guild Dues (2) | played by hand, player target, card pick | yes | yes | PC-GD1…2, VIS-PC3 |
| Merchant (6) | played by hand, board target (hex) | yes | yes, phone | PC-MC1…3 |
| Merchant Fleet (2) | played by hand, kind picker | yes | yes | PC-MF1 |
| Resource Monopoly (4) | played by hand, kind picker | yes | yes | PC-RM1…2 |
| Trade Monopoly (2) | played by hand, kind picker | yes | yes | PC-TM1 |
| Constitution (1) | automatic: revealed and scored when drawn | n/a (as Printing) | n/a | VIS-PC1, `ck-dice` |
| Diplomacy (2) | played by hand, board target (edge), optional free road | yes | yes, phone | PC-DI1…3 |
| Encouragement (2) | played by hand | yes | yes | PC-EC1 |
| Espionage (3) | played by hand, player target; the spy takes or passes | yes | yes | PC-ES1…3, VIS-PC2 |
| Intrigue (2) | played by hand, board target (vertex); the owner retreats | yes | yes | PC-IT1…2 |
| Sabotage (2) | played by hand; each affected seat chooses | yes | yes | PC-SA1…2, VIS-PC5 |
| Taxation (2) | played by hand, board target (hex) | yes | yes | PC-TX1…3 |
| Treason (2) | played by hand, player target; the chosen seat removes, the player places | yes | yes, phone | PC-TR1…2 |
| Wedding (2) | played by hand; each richer seat chooses | yes | yes | PC-WE1…2, VIS-PC5 |

No card that a human must play is unreachable in either renderer. The two
automatic VP cards have no play action to reach (CK25 p. 10); their reveal and
the score are covered by the panel fixture and the rules tests.

### Verification

See the PR body for the exact counts. Browser runs: `progress.py` full run,
50 cases, 0 errors, 23 card types played; trade and politics stages re-run
after the prompt stylesheet fix, 17 cases, 0 errors; `capture.py` 14 cases,
0 errors. PostgreSQL repository tests are skipped without `TEST_POSTGRES_URL`.

### Limitations

- Headless Chromium with software WebGL only; no physical device, screen
  reader, IME or human playtest (U-03/U-04/U-06/U-07/U-08 remain open).
- Cards without a board target are driven through the SVG pass only; the hand
  panel is shared by both renderers.
- Responder prompts of paired (5–6) games are verified at engine level and in
  jsdom, not in a scripted multi-client browser run.
- Bots cannot play Cities & Knights; seats must be humans.
- Seafarers + C&K (including Diplomacy on ships and the Knight/pirate
  interactions) is P4.
- The merchant has no animation beyond the placement cue.
