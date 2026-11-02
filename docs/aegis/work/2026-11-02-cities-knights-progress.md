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

(Filled in as the slices land.)
