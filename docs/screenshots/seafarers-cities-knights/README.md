# Seafarers + Cities & Knights captures (Heading for New Shores combined)

Review captures for phase P4, taken by `scripts/seafarers-cities-knights/capture.py`
against the production build (`pnpm build`, service on `127.0.0.1`, headless
Chromium with software WebGL, zh-Hant, reduced motion). The rooms are real
games through the real UI and API; the 4-player room is created through the
lobby, the 3- and 6-player rooms through the rooms API. The full run had
14 cases and no page errors (`report.json` lists all of them
with their sha256).

Test-only fixtures, written into the private SQLite file while the service
is stopped (`ckkit.Server.patch_game`): after setup each game is put after
the first barbarian attack (so the pirate is in play), with a second own
ship, knights on a sea intersection and on roads, and the pirate next to the
ship knight; for the score capture, island bonus, the science metropolis, a
Defender of Catan point, the merchant and Longest Trade Route are written for
player 1. Other seats and filler turns are played over the API.

| File | Renderer | Viewport | State |
|---|---|---|---|
| `lobby-combined.png` | – | 1366×900 | lobby on the room page, all four seats ready, before the start (re-captured from `369b7fe`, 2026-11-08): Cities & Knights + Seafarers resolves to Heading for New Shores; bot note 「電腦對手尚未支援這個規則組合。」 |
| `p4-svg-desktop-chase-pirate-knight.png` | SVG | 1366×900 | COMB-6: an active knight next to the pirate’s sea hex (on the ships) chases it |
| `p4-svg-desktop-chase-pirate-target.png` | SVG | 1366×900 | COMB-6: the pirate moves to sea hexes (or the frame) only; land is not offered |
| `p4-svg-desktop-after-chase.png` | SVG | 1366×900 | ships, the lying knight on the sea intersection, pirate and robber together |
| `p4-svg-phone-chase-robber.png` | SVG | 390×844 | SFCK-4: a knight chasing the robber moves the robber only: land targets, no pirate frame |
| `p4-3d-desktop-knight-across-ships.png` | 3D | 1366×900 | COMB-2: the knight’s targets reach across own roads and ships (junction at the own building) |
| `p4-3d-desktop-board.png` | 3D | 1366×900 | 3D: ships, knights on the sea intersection and the coast, pirate and robber |
| `p4-svg-desktop-score.png` | SVG | 1366×900 | score: island bonus, metropolis, defender, merchant and Longest Trade Route together |
| `p3-r3f-desktop-chase-pirate-knight.png` | 3D | 1366×900 | COMB-6: an active knight next to the pirate’s sea hex (on the ships) chases it |
| `p3-r3f-desktop-chase-pirate-target.png` | 3D | 1366×900 | COMB-6: the pirate moves to sea hexes (or the frame) only; land is not offered |
| `p3-svg-phone-board.png` | SVG | 390×844 | phone board after the pirate chase |
| `p6-3d-phone-chase-pirate-knight.png` | 3D | 390×844 | COMB-6: an active knight next to the pirate’s sea hex (on the ships) chases it |
| `p6-3d-phone-chase-pirate-target.png` | 3D | 390×844 | COMB-6: the pirate moves to sea hexes (or the frame) only; land is not offered |
| `p6-svg-desktop-board.png` | SVG | 1366×900 | board after the pirate chase |

Clauses: COMB-2 (knights cross the sea along own ships), COMB-6 (a knight
chases the pirate), SFCK-4 (a robber chase moves the robber only) and COMB-7
(the score breakdown) are quoted in
[the P4 work record](../../aegis/work/2026-11-02-seafarers-cities-knights.md).
Each step asserts the DOM or game state it captures: targets offered (sea
hexes and the frame for the pirate, no land; land only for the robber), the
pirate's and robber's hex after the move, the knight lying down, the knight's
new vertex and every score mark.
