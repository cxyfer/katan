/**
 * variable setup 瀏覽器證據的版圖檢查：讀 stdin 的 `{ profileId, playerCount, board }`（API 快照的
 * `view.board`：topologyId、terrain、numbers），回報該版圖是否符合 SF25 的 variable setup 約束，
 * 以及與 fixed 版圖是否不同。Python 不自己推導拓樸（與 fixtures.mjs 相同的做法）。
 *
 * Usage: node --experimental-strip-types scripts/seafarers/variable_fixture.mjs < input.json
 */

import { readFileSync } from 'node:fs';
import { buildProfileLayout, getProfile, getTopology, NEIGHBOR_DIRS, seededRng } from '../../packages/rules/src/index.ts';
import { FT_VARIABLE_RESTRICTED, WC_VARIABLE_NO_RED } from '../../packages/rules/src/seafarers-scenario-boards.ts';

const { profileId, playerCount, board } = JSON.parse(readFileSync(0, 'utf8'));
const topology = getTopology(board.topologyId);
const byKey = new Map(topology.hexes.map((cell, index) => [`${cell.q},${cell.r}`, index]));
const near = topology.hexes.map((cell) => NEIGHBOR_DIRS.map((dir) => byKey.get(`${cell.q + dir.q},${cell.r + dir.r}`)).filter((index) => index !== undefined));
const red = (disc) => disc === 6 || disc === 8;
const { terrain, numbers } = board;

const redAdjacent = numbers.some((disc, hex) => red(disc) && near[hex].some((other) => red(numbers[other])));
const redOnGold = numbers.some((disc, hex) => red(disc) && terrain[hex] === 'gold');
const lowOnForestPasture = numbers.some((disc, hex) => [2, 3, 11, 12].includes(disc) && (terrain[hex] === 'forest' || terrain[hex] === 'pasture'));
const fixed = buildProfileLayout(getProfile(profileId), { mode: 'fixed', playerCount, rng: seededRng(1) });
const sameAsFixed = JSON.stringify(fixed.numbers) === JSON.stringify(numbers) && JSON.stringify(fixed.terrain) === JSON.stringify(terrain);
const robberOnTwelve = numbers[board.robber] === 12;
// S10b：世外部落右側 3 格不得放 5、6、8、9；卡坦奇觀緊鄰沙漠的 2 格不得放紅色圓片；布匹產地有兩個 12 號格。
const cellAt = (cell) => byKey.get(`${cell.q},${cell.r}`);
const tribeRestrictedBad = FT_VARIABLE_RESTRICTED.some((cell) => [5, 6, 8, 9].includes(numbers[cellAt(cell)]));
const wondersRedBesideDesert = WC_VARIABLE_NO_RED.some((cell) => red(numbers[cellAt(cell)]));
const twelveCount = numbers.filter((disc) => disc === 12).length;
process.stdout.write(JSON.stringify({ redAdjacent, redOnGold, lowOnForestPasture, sameAsFixed, robberOnTwelve, robberTerrain: terrain[board.robber], tribeRestrictedBad, wondersRedBesideDesert, twelveCount }));
