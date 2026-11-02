# Seafarers + Cities & Knights — Heading for New Shores combined (P4)

Advisory work record for phase P4 of
[the expansions roadmap](../plans/2026-11-01-expansions-roadmap.md). Branch
`feat/seafarers-cities-knights`, stacked on `feat/cities-knights-progress`
(P3). The P1 record is [2026-11-01-seafarers.md](2026-11-01-seafarers.md),
P2's [2026-11-02-cities-knights-core.md](2026-11-02-cities-knights-core.md)
and P3's [2026-11-02-cities-knights-progress.md](2026-11-02-cities-knights-progress.md).

## Sources (accessed 2026-11-02)

| Id | Publication | File | SHA-256 | Used here |
|---|---|---|---|---|
| COMB | "Rules for Cities and Knights with the Seafarer Expansion", catan.com product page <https://www.catan.com/seafarers> (section "Combination with the Cities & Knights Expansion"), fetched 2026-11-02 13:39 UTC | `seafarers.html` | `8ce6618fa5a8ec368a9b24c7d0c7253e26f85ee5b8d7d219a289aeb1403c05d2` | every clause below |
| COMB mirror | the same section on <https://www.catan.com/cities-knights>, fetched 2026-11-02 13:39 UTC | `cities-knights.html` | `6be0d9f72ac20585baf708702d7dc7cec6f46f8c0d5e619cddd5ff24d548ecd3` | wording check; its last clause is cut off mid-word ("…have reache"), so the `/seafarers` page is the authority |
| CK25 | CN3087, CATAN – Cities & Knights 2025 (`v6.250401`) | `CN3087.pdf` | `dac9f01afe9006e3b517aa257363c844eb2a9ff4b6578d3127f5d8d861c9a540` | p. 12 "Combining with CATAN – Seafarers Expansion" (its own combination rules), pp. 6–11 and 13–16 as in P2/P3 |
| CK56-25 | CN3088, CATAN – Cities & Knights 5–6 2025 (`v6.250401`) | `CN3088.pdf` | `eab1b29e2804f54d5fe79fb1a95e7d3199d37fb73483e4807a247a931be536c9` | p. 3 (player 2 may not trade with other players), p. 4 chart (player 2: trade with the supply, build, knight actions, progress cards) |
| SF25 | CN3083, CATAN – Seafarers 2025 (`v6.250401`) | `SF25-CN3083.pdf` | `a499abe2b613afd618dd3c806790400c7e84adebcc9b9ab19a24fb80dd04b099` | pp. 2–5 as in P1; no Cities & Knights note anywhere in the book |
| SF56-25 | CN3084, CATAN – Seafarers 5–6 2025 (`v6.250401`) | `SF56-25-CN3084.pdf` | `746ac86ef5262c666ac204ede77bbd2886960590a9e82c2bcdbe2533e78bb0fe` | pp. 2–4 as in P1 (player 2 takes an Action phase without trading with other players); no Cities & Knights note |
| CK-FAQ | catan.com/faq/cities-knights | `faq.html` | `47f50c967d000a5de642bd95ebfe1b6383e8dbfa7988683eb272a6a60a1d3122` | 63 (Bishop never moves the pirate), 64–66 (Diplomat and ships), 94 (open road = open ship rule) |
| SF-FAQ | catan.com/faq/seafarers | `faq-seafarers.html` | `91d8ad897e2d94b0191f42320d368fe0a0817e13fbc9375b88ba956dcfc60d75` | 18 (a shipping route between two settlements — "or for Cities & Knights also knights" — is closed) |

The two COMB pages were saved with `curl` into a fresh empty directory
outside the repository and reduced to text with a standalone script run in
isolated mode; nothing from the downloads was executed. The product pages are
dynamic HTML, so a later fetch may hash differently even when the clauses are
unchanged; the clause text below is the evidence. The PDFs are the files P1–P3
already recorded (same hashes).

The SPEC's "COMB, reviewed 2026-10-26" row predates this fetch; the clauses
fetched on 2026-11-02 are the ones implemented.

## COMB clauses (quoted from <https://www.catan.com/seafarers>)

Scenario suitability: "In our experience, scenarios such as Heading for New
Shores and Through the Desert are suitable. The exploratory scenarios and all
other scenarios featuring many smaller islands are unsuitable. When playing
with the Seafarers expansion, you must ensure that certain actions applying to
roads are also possible for ships."

| Id | Clause |
|---|---|
| COMB-1 | "For scenarios with several islands, the same rules as in Cities & Knights apply when the barbarian army attacks." |
| COMB-2 | "A knight can also be moved across the sea if the intersection he starts from is connected – via roads and ships or via ships only – to the intersection he ends up on." |
| COMB-3 | "You may move an active knight to an intersection between three sea hexes if one of your ships is adjacent to this intersection (the knight is then assumed to be on the ship)." |
| COMB-4 | "If a knight stands on an intersection bordered by the last ship of a shipping route, that shipping route is closed. In other words, a knight's connection to a settlement of his color must never be interrupted." |
| COMB-5 | "If you interrupt a foreign shipping route by means of a knight (or a settlement), that shipping route is considered interrupted in terms of the 'Longest Trade Route.' However, the owner of the shipping route may not break it up by moving their ships bordering the foreign knight." |
| COMB-6 | "If you deactivate an active knight adjacent to the sea hex occupied by the pirate, you may move the pirate." |
| COMB-7 | "The number of victory points specified for each scenario should be increased by 2." |
| COMB-8 | "For a city at a gold field, you only receive resources, not commodities." |
| COMB-9 | "The merchant may not be placed on a gold field." |
| COMB-10 | "The rule according to which the robber must not be moved until the barbarians have reached Catan for the first time also applies to the pirate (who is obviously not in the desert), provided that he is included in the scenario." |
| COMB-0 | "…certain actions applying to roads are also possible for ships." (the suitability paragraph above) |

## CK25 p. 12 "Combining with CATAN – Seafarers Expansion" (paraphrased)

| Id | Clause |
|---|---|
| CK12-1 | Ships: the Cities & Knights rules that apply to roads also apply to ships. |
| CK12-2 | Setup: the pirate waits on the last space of the barbarian track and enters play only after the first barbarian attack, then as the scenario places it. |
| CK12-3 | Barbarians attack all islands at once; all cities and knights on the board count for barbarian and defender strength. |
| CK12-4 | Gold fields produce resources only, never commodities; the merchant may not go on a gold field. |
| CK12-5 | Knights move along the player's continuous routes of roads and ships and may end on an empty intersection of sea hexes. |
| CK12-6 | Knights must always stay connected to a route of their colour; a ship move that would break that connection is not allowed. |
| CK12-0 | Suitable scenarios: those without hidden areas or many small islands, e.g. Heading for New Shores. |

CK25 p. 12 does not mention the victory-point change (COMB-7) or moving the
pirate with a knight (COMB-6); neither contradicts it. The two sources agree
everywhere they overlap, so no open source conflict is recorded for the
clauses above.

## Combined profile rules (SPEC §5.6 R-COMB, as transcribed)

- Heading for New Shores maps per player count (SF25 pp. 4–5, SF56-25 p. 4),
  with the C&K setup: settlement + road (or ship) forward, then **city** +
  road (or ship) in reverse, both on the main island; the city takes one
  resource per adjacent terrain hex (CK25 p. 5, SF25 p. 4).
- Victory: New Shores' 14 + 2 = **16** (COMB-7), for 3/4 and 5/6.
- Supplies: 15 roads and 15 ships (independent), 5 settlements, 4 cities, 6
  knights, 3 walls per player; 12 (3/4) or 18 (5/6) commodities of each kind;
  19 (3/4) or 24 (5/6) resources of each kind; the three progress decks
  replace the development cards; no Largest Army (CK25 p. 3, CK56-25 p. 3,
  SF25 p. 2).
- Island bonus (+2 per player per small island), Longest Trade Route,
  metropolises, Defender of Catan, the merchant and progress VP all count.
- Paired 5–6: player 1 rolls, produces and acts; player 2 takes an Action
  phase: build, trade with the supply only, move one ship (SF56-25 pp. 2–3),
  knight actions and progress cards except Alchemy (CK56-25 pp. 3–4).

## Interpretations

SFCK-1…7 are recorded in `docs/FIDELITY.md` ("Seafarers + Cities & Knights
interpretations and open fixtures"):

- SFCK-1: a knight's road/ship path joins only at an own building or at its
  start vertex.
- SFCK-2: recruiting and Treason's placement need a land vertex.
- SFCK-3: knights close and pin ships; no ship move strands a knight.
- SFCK-4: a robber chase moves the robber only; a pirate chase the pirate
  only.
- SFCK-5: gold is production for the aqueduct; the gold frame comes first.
- SFCK-6: Diplomacy may remove an open ship; an own ship is re-placed as a
  ship and is not "built this turn".
- SFCK-7: both bandits start off the board; the first attack places the
  robber, the pirate stays on the frame until moved.

## Design

The combined profiles list `['seafarersCitiesKnights', 'seafarers',
'citiesKnights']`. Only rules that need both expansions live in
`packages/rules/src/modules/seafarersCitiesKnights/` (≈200 lines):
`moveBandit` vetoes, `knight.chasePirate`, `shipMoveBlocked`,
`allowMerchant`, an `afterProduction` ordering note, projection and hints.
Three hooks were added to the module interface (`legalShips`,
`shipMoveBlocked`, `allowMerchant`); the C&K knight reach and Diplomacy use
`kit.legalShips` and ship edges, so neither expansion module names the
other. The web client adds `board/seafarersCitiesKnights.ts` (hints, target
narrowing, prompt id) and a pirate-chase action; everything else is the
Seafarers and C&K UI unchanged.

## Evidence

| Check | Command | Result |
|---|---|---|
| R-COMB fixtures | `pnpm --filter @catan/rules exec vitest run test/sfck-clauses.test.ts` | 37 passed |
| Simulated games 3/4/5/6 | `pnpm --filter @catan/rules exec vitest run test/sfck-sim.test.ts` | 5 passed |
| Service | `pnpm --filter @catan/server exec vitest run test/seafarers-cities-knights.test.ts` | 2 passed |
| Client | `pnpm --filter @catan/web exec vitest run test/seafarers-cities-knights.test.tsx` | 8 passed |
| Browser | `pnpm build && SFCK_PORT=3042 python3 scripts/seafarers-cities-knights/capture.py <new-dir>` | 14 cases, 0 page errors ([captures](../../screenshots/seafarers-cities-knights/README.md)) |

The browser harness taps on phones (a mouse click there hovers the seats
panel open) and pans/zooms the board when a panel covers a target, as a
player would.
