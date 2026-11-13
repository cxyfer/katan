/**
 * 座位偏差量測（不進 CI；Issue #174 座位勝率偏差、#135 對局拆解）：
 *
 *   node bench/survey.mjs [局數] --profile <id> --players <n> --roles <規格>
 *                         [--from <起始局>] [--jsonl <檔>] [--markdown <檔>]
 *   node bench/survey.mjs --merge <jsonl 檔>... [--markdown <檔>]
 *
 * `--roles` 規格：`standard`／`easy`／`naive` 表示全部座位同一策略；`standard:easy` 表示 1 位 standard
 * 對其餘 easy（`standard:naive` 同理）。focus 座位依局數輪換（第 g 局放在座位 `g % 人數`），種子從
 * `10000 + g` 起，與 `bench/run.ts` 的 ① ② 對局完全相同（同一 profile、人數、局數時，focus 勝率一致）。
 *
 * 每局記錄每個座位的勝負、終局分數、開局頂點與其產出、造船、小島加分、城市、發展卡、交易等
 * （來源為 `state.stats` 與 rules 事件，不改任何規則或策略），再彙整成 markdown 表：
 * 座位勝率與 Wilson 95% 信賴區間、開局分析、各座位遊戲內容、依（策略 × 勝負）拆解。
 * `--jsonl` 把逐局記錄寫成檔案（第一行為 meta）；`--merge` 把多個分片（`--from` 切開、可平行執行）
 * 合併成同一份表。
 *
 * 座位編號從 1 起算（座位 1 = 回合順序第一位，也是開局第一個放置的人）。
 */

import { readFileSync, writeFileSync } from 'node:fs';
import {
  getProfile,
  isLandHex,
  scoreOf,
  TERRAIN_RESOURCE,
  topologyOf,
  type GameState,
  type ProfileDefinition,
} from '@catan/rules';
import { botModulesOf, botsCanPlay } from '../src/index.ts';
import { heuristicPolicy } from '../src/heuristic.ts';
import type { BotPolicy } from '../src/types.ts';
import { naivePolicy, runBotGame, type BotSeat } from '../test/harness.ts';
import { citiesKnightsKit } from '../test/modules/citiesKnights.ts';
import { seafarersKit } from '../test/modules/seafarers.ts';
import { sfckKit } from '../test/modules/seafarersCitiesKnights.ts';
import { kitsOf, type ModuleTestKit } from '../test/modules/types.ts';

type Role = 'standard' | 'easy' | 'naive';
const ROLES: readonly Role[] = ['standard', 'easy', 'naive'];

const BENCH_KITS: readonly ModuleTestKit[] = [seafarersKit, citiesKnightsKit, sfckKit];

const USAGE =
  'usage: survey [games] --profile <id> --players <n> --roles <role | focus:rest> [--from <game>] [--jsonl <file>] [--markdown <file>]\n' +
  '       survey --merge <jsonl>... [--markdown <file>]';

// ---------------------------------------------------------------------------
// 記錄格式
// ---------------------------------------------------------------------------

interface Meta {
  profile: string;
  players: number;
  roles: string;
  from: number;
  games: number;
}

interface SeatRecord {
  seat: number;
  role: Role;
  won: boolean;
  /** 終局分數（含隱藏分）。 */
  score: number;
  /** 開局依序放置的聚落頂點。 */
  opening: number[];
  /** 每個開局頂點周圍的點數（pips）合計。 */
  openPips: number[];
  /** 每個開局頂點是否臨海。 */
  openCoast: boolean[];
  /** 每個開局頂點是否在港口上。 */
  openHarbor: boolean[];
  /** 兩個開局頂點周圍不同資源（含金礦）的種類數。 */
  openKinds: number;
  paidShips: number;
  freeShips: number;
  setupShips: number;
  shipsMoved: number;
  islandBonuses: number;
  settlements: number;
  cities: number;
  roads: number;
  devBought: number;
  knights: number;
  playerTrades: number;
  bankTrades: number;
  produced: number;
  turns: number;
  improvements: number;
  /** 第 10、20 輪開始時的分數；整局在那之前結束則為 null。 */
  vp10: number | null;
  vp20: number | null;
}

interface GameRecord {
  game: number;
  seed: number;
  finished: boolean;
  /** 沒有正常終局的原因（看門狗、卡死、拒絕、守恆）。 */
  problem: string | null;
  winner: number | null;
  rounds: number;
  seats: SeatRecord[];
}

// ---------------------------------------------------------------------------
// 統計
// ---------------------------------------------------------------------------

const Z = 1.959964;

/** Wilson 95% 信賴區間（百分比）。 */
function wilson(wins: number, n: number): [number, number] {
  if (n === 0) return [0, 0];
  const p = wins / n;
  const denom = 1 + (Z * Z) / n;
  const center = (p + (Z * Z) / (2 * n)) / denom;
  const half = (Z * Math.sqrt((p * (1 - p)) / n + (Z * Z) / (4 * n * n))) / denom;
  return [Math.max(0, center - half) * 100, Math.min(1, center + half) * 100];
}

function erfc(x: number): number {
  // Abramowitz-Stegun 7.1.26，絕對誤差 < 1.5e-7。
  const t = 1 / (1 + 0.3275911 * Math.abs(x));
  const poly = t * (0.254829592 + t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429))));
  const value = poly * Math.exp(-x * x);
  return x >= 0 ? value : 2 - value;
}

/** 卡方分配的右尾機率（自由度為正整數）。 */
function chiSquareP(x: number, df: number): number {
  if (x <= 0) return 1;
  const half = x / 2;
  if (df % 2 === 0) {
    let term = 1;
    let sum = 1;
    for (let k = 1; k < df / 2; k++) {
      term *= half / k;
      sum += term;
    }
    return Math.exp(-half) * sum;
  }
  // 奇數自由度：Q = erfc(√(x/2)) + e^{-x/2} Σ_{k=1}^{m} (x/2)^{k-1/2} / Γ(k+1/2)
  let sum = 0;
  let term = Math.sqrt(half) / (Math.sqrt(Math.PI) / 2); // k = 1：(x/2)^{1/2} / Γ(3/2)
  const m = (df - 1) / 2;
  for (let k = 1; k <= m; k++) {
    sum += term;
    term *= half / (k + 0.5);
  }
  return erfc(Math.sqrt(half)) + Math.exp(-half) * sum;
}

function mean(values: readonly number[]): number {
  return values.length === 0 ? 0 : values.reduce((a, b) => a + b, 0) / values.length;
}

const fmt = (value: number, digits = 2): string => (Number.isFinite(value) ? value.toFixed(digits) : '-');

// ---------------------------------------------------------------------------
// 對局
// ---------------------------------------------------------------------------

interface RoleSpec {
  focus: Role | null;
  rest: Role;
}

function parseRoles(spec: string): RoleSpec {
  const [first, second, ...extra] = spec.split(':');
  const valid = (value: string | undefined): value is Role => ROLES.includes(value as Role);
  if (extra.length > 0 || !valid(first) || (second !== undefined && !valid(second))) {
    throw new Error(`--roles must be <role> or <focus>:<rest> with roles ${ROLES.join('|')}, got "${spec}"`);
  }
  return second === undefined ? { focus: null, rest: first } : { focus: first, rest: second };
}

function rolesFor(spec: RoleSpec, players: number, game: number): Role[] {
  return Array.from({ length: players }, (_, seat) =>
    spec.focus !== null && (((seat - game) % players) + players) % players < 1 ? spec.focus : spec.rest,
  );
}

function policyOf(role: Role, profile: ProfileDefinition): BotPolicy {
  return role === 'naive' ? naivePolicy('standard', botModulesOf(profile)) : heuristicPolicy(role);
}

function seatIndexOf(id: string): number {
  return Number(id.slice('bot'.length)) - 1;
}

function pipsOf(number: number | null | undefined): number {
  return number ? 6 - Math.abs(7 - number) : 0;
}

/** 開局頂點的產出：周圍數字的點數、是否臨海、是否在港口、資源種類。 */
function describeVertex(state: GameState, vertex: number): { pips: number; coast: boolean; harbor: boolean; kinds: string[] } {
  const topo = topologyOf(state);
  const layout = state.board.layout;
  const info = topo.vertices[vertex];
  const kinds: string[] = [];
  let pips = 0;
  let coast = false;
  for (const hex of info?.hexes ?? []) {
    if (!isLandHex(state, hex)) {
      coast = true;
      continue;
    }
    const terrain = layout.terrain[hex]!;
    const kind = terrain === 'gold' ? 'gold' : TERRAIN_RESOURCE[terrain];
    if (!kind) continue;
    kinds.push(kind);
    pips += pipsOf(layout.numbers[hex]);
  }
  const harbor = layout.harbors.some((entry) => topo.edges[entry.edge]?.vertices.includes(vertex));
  return { pips, coast, harbor, kinds };
}

function playGame(
  spec: RoleSpec,
  profile: ProfileDefinition,
  kits: readonly ModuleTestKit[],
  players: number,
  game: number,
): GameRecord {
  const roles = rolesFor(spec, players, game);
  const seats: BotSeat[] = roles.map((role, index) => ({
    id: `bot${index + 1}`,
    level: role === 'naive' ? 'standard' : role,
    policy: policyOf(role, profile),
  }));
  const openings: number[][] = seats.map(() => []);
  const events = seats.map(() => ({ paidShips: 0, freeShips: 0, setupShips: 0, shipsMoved: 0, islandBonuses: 0 }));
  const seed = 10_000 + game;
  const run = runBotGame({
    seats,
    seed,
    profileId: profile.id,
    kits,
    onDecision: (_state, decision) => {
      const vertex = (decision.command as { vertex?: unknown }).vertex;
      if (decision.command.type === 'setup.placeBuilding' && typeof vertex === 'number') {
        openings[seatIndexOf(decision.actor)]?.push(vertex);
      }
    },
    onStep: (step) => {
      for (const event of step.events) {
        const owner = typeof event.params.playerId === 'string' ? seatIndexOf(event.params.playerId) : -1;
        const tally = events[owner];
        if (!tally) continue;
        if (event.type === 'ship.built') tally[event.params.free === true ? 'freeShips' : 'paidShips'] += 1;
        else if (event.type === 'setup.ship') tally.setupShips += 1;
        else if (event.type === 'ship.moved') tally.shipsMoved += 1;
        else if (event.type === 'island.bonus') tally.islandBonuses += 1;
      }
    },
  });
  const state = run.state;
  const problem = run.failure
    ? 'rejected'
    : run.stalled
      ? 'stuck'
      : run.watchdog
        ? 'watchdog'
        : run.conservation.length > 0
          ? 'conservation'
          : state.result?.reason !== 'victory'
            ? 'no-victory'
            : null;
  const winnerId = state.result?.playerId;
  const timeline = state.stats?.timeline ?? [];
  const records: SeatRecord[] = state.players.map((player, seat) => {
    const stats = state.stats?.players[player.id];
    const described = (openings[seat] ?? []).map((vertex) => describeVertex(state, vertex));
    const produced = stats ? Object.values(stats.produced).reduce((a, b) => a + b, 0) : 0;
    const sampled = (round: number): number | null =>
      timeline.length - 1 > round ? (timeline[round]?.[seat] ?? null) : null;
    return {
      seat,
      role: roles[seat]!,
      won: player.id === winnerId,
      score: scoreOf(state, player.id, { includeHidden: true }),
      opening: openings[seat] ?? [],
      openPips: described.map((entry) => entry.pips),
      openCoast: described.map((entry) => entry.coast),
      openHarbor: described.map((entry) => entry.harbor),
      openKinds: new Set(described.flatMap((entry) => entry.kinds)).size,
      ...events[seat]!,
      settlements: stats?.settlementsBuilt ?? 0,
      cities: stats?.citiesBuilt ?? 0,
      roads: stats?.roadsBuilt ?? 0,
      devBought: stats ? Object.values(stats.devCardsBought).reduce((a, b) => a + (b ?? 0), 0) : 0,
      knights: stats?.devCardsPlayed.knight ?? 0,
      playerTrades: stats?.playerTrades ?? 0,
      bankTrades: stats?.bankTrades ?? 0,
      produced,
      turns: stats?.turns ?? 0,
      improvements: player.improvements.trade + player.improvements.politics + player.improvements.science,
      vp10: sampled(10),
      vp20: sampled(20),
    };
  });
  return {
    game,
    seed,
    finished: problem === null,
    problem,
    winner: winnerId ? state.players.findIndex((player) => player.id === winnerId) : null,
    rounds: (state.stats?.turns ?? 0) / players,
    seats: records,
  };
}

// ---------------------------------------------------------------------------
// 彙整與輸出
// ---------------------------------------------------------------------------

function table(header: readonly string[], rows: readonly (string | number)[][]): string[] {
  return [
    `| ${header.join(' | ')} |`,
    `| ${header.map(() => '---').join(' | ')} |`,
    ...rows.map((row) => `| ${row.join(' | ')} |`),
  ];
}

interface Flat extends SeatRecord {
  game: number;
}

const STAT_COLUMNS: readonly [string, (seat: SeatRecord) => number][] = [
  ['paid ships', (s) => s.paidShips],
  ['free ships', (s) => s.freeShips],
  ['setup ships', (s) => s.setupShips],
  ['ships moved', (s) => s.shipsMoved],
  ['island bonuses', (s) => s.islandBonuses],
  ['settlements', (s) => s.settlements],
  ['cities', (s) => s.cities],
  ['roads', (s) => s.roads],
  ['dev cards', (s) => s.devBought],
  ['knights', (s) => s.knights],
  ['player trades', (s) => s.playerTrades],
  ['bank trades', (s) => s.bankTrades],
  ['produced', (s) => s.produced],
  ['turns', (s) => s.turns],
  ['improvements', (s) => s.improvements],
];

function groupBy<T>(items: readonly T[], key: (item: T) => string): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const item of items) {
    const k = key(item);
    const bucket = out.get(k);
    if (bucket) bucket.push(item);
    else out.set(k, [item]);
  }
  return out;
}

function renderReport(meta: Meta, games: readonly GameRecord[], command: string): string {
  const finished = games.filter((game) => game.finished);
  const problems = games.length - finished.length;
  const flat: Flat[] = finished.flatMap((game) => game.seats.map((seat) => ({ ...seat, game: game.game })));
  const spec = parseRoles(meta.roles);
  const mixed = spec.focus !== null && spec.focus !== spec.rest;
  const lines: string[] = [];
  lines.push(`# Seat survey: ${meta.profile} ${meta.players}p ${meta.roles}`, '');
  lines.push(
    `\`${command}\` — ${games.length} games (game ${Math.min(...games.map((g) => g.game))}–${Math.max(...games.map((g) => g.game))}, ` +
      `seeds from ${10_000 + Math.min(...games.map((g) => g.game))}), ${finished.length} finished, ${problems} problems` +
      (problems > 0 ? ` (${[...groupBy(games.filter((g) => !g.finished), (g) => g.problem ?? '?').entries()].map(([k, v]) => `${k} ${v.length}`).join(', ')})` : '') +
      `; average ${fmt(mean(finished.map((game) => game.rounds)), 1)} rounds.`,
    '',
  );

  // A. 座位勝率（回合順序）
  const seatNumbers = Array.from({ length: meta.players }, (_, seat) => seat);
  const winsBySeat = seatNumbers.map((seat) => finished.filter((game) => game.winner === seat).length);
  const expected = finished.length / meta.players;
  const chi = winsBySeat.reduce((sum, wins) => sum + (wins - expected) ** 2 / expected, 0);
  lines.push('## Wins by seat (seat 1 plays and places first)', '');
  lines.push(
    ...table(
      ['seat', 'games', 'wins', 'win %', '95% CI', 'avg final score'],
      seatNumbers.map((seat) => {
        const wins = winsBySeat[seat]!;
        const [lo, hi] = wilson(wins, finished.length);
        return [
          seat + 1,
          finished.length,
          wins,
          fmt((wins / Math.max(1, finished.length)) * 100, 1),
          `${fmt(lo, 1)}–${fmt(hi, 1)}`,
          fmt(mean(flat.filter((s) => s.seat === seat).map((s) => s.score)), 2),
        ];
      }),
    ),
    '',
    `Uniform-seat chi-square = ${fmt(chi, 2)}, df = ${meta.players - 1}, p = ${fmt(chiSquareP(chi, meta.players - 1), 4)} ` +
      `(fair share ${fmt(100 / meta.players, 1)}%).`,
    '',
  );

  // B. focus 座位（輪換）
  if (mixed) {
    const focusRows = seatNumbers.map((seat) => {
      const played = finished.filter((game) => game.seats[seat]!.role === spec.focus);
      const wins = played.filter((game) => game.winner === seat).length;
      const [lo, hi] = wilson(wins, played.length);
      return { seat, n: played.length, wins, lo, hi };
    });
    const total = focusRows.reduce((sum, row) => sum + row.n, 0);
    const wins = focusRows.reduce((sum, row) => sum + row.wins, 0);
    const p = wins / Math.max(1, total);
    const homogeneity = focusRows.reduce((sum, row) => sum + (row.n > 0 ? (row.wins - row.n * p) ** 2 / (row.n * p * (1 - p) || 1) : 0), 0);
    const [lo, hi] = wilson(wins, total);
    lines.push(`## ${spec.focus} win rate by the seat it sits in (vs ${spec.rest}; fair share ${fmt(100 / meta.players, 1)}%)`, '');
    lines.push(
      ...table(
        ['focus seat', 'games', 'focus wins', 'win %', '95% CI'],
        [
          ...focusRows.map((row) => [row.seat + 1, row.n, row.wins, fmt((row.wins / Math.max(1, row.n)) * 100, 1), `${fmt(row.lo, 1)}–${fmt(row.hi, 1)}`]),
          ['all', total, wins, fmt(p * 100, 1), `${fmt(lo, 1)}–${fmt(hi, 1)}`],
        ],
      ),
      '',
      `Homogeneity chi-square across focus seats = ${fmt(homogeneity, 2)}, df = ${meta.players - 1}, p = ${fmt(chiSquareP(homogeneity, meta.players - 1), 4)}.`,
      '',
    );
  }

  // C. 開局
  const key = (s: SeatRecord): string => (mixed ? `${s.seat + 1} ${s.role}` : `${s.seat + 1}`);
  const bySeat = groupBy(flat, key);
  const keys = [...bySeat.keys()].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  lines.push('## Openings (settlement vertices in placement order)', '');
  lines.push(
    ...table(
      ['seat', 'n', 'top openings (count)', 'pips r1', 'pips r2', 'kinds', 'coastal r1 %', 'coastal r2 %', 'harbor %'],
      keys.map((k) => {
        const rows = bySeat.get(k)!;
        const counts = [...groupBy(rows, (s) => s.opening.join('/')).entries()].sort((a, b) => b[1].length - a[1].length);
        const top = counts.slice(0, 3).map(([opening, list]) => `${opening} ×${list.length}`).join(', ');
        const pct = (pick: (s: SeatRecord) => boolean): string => fmt((rows.filter(pick).length / rows.length) * 100, 0);
        return [
          k,
          rows.length,
          top + (counts.length > 3 ? ` (+${counts.length - 3})` : ''),
          fmt(mean(rows.map((s) => s.openPips[0] ?? 0))),
          fmt(mean(rows.map((s) => s.openPips[1] ?? 0))),
          fmt(mean(rows.map((s) => s.openKinds))),
          pct((s) => s.openCoast[0] === true),
          pct((s) => s.openCoast[1] === true),
          pct((s) => s.openHarbor.some(Boolean)),
        ];
      }),
    ),
    '',
  );

  // D. 各座位的遊戲內容（平均值）
  const statHeader = STAT_COLUMNS.map(([name]) => name);
  lines.push('## Play by seat (average per game)', '');
  lines.push(
    ...table(
      ['seat', 'n', 'win %', 'vp@10', 'vp@20', ...statHeader],
      keys.map((k) => {
        const rows = bySeat.get(k)!;
        const sampled = (pick: (s: SeatRecord) => number | null): string => {
          const values = rows.flatMap((s) => {
            const value = pick(s);
            return value === null ? [] : [value];
          });
          return values.length === 0 ? '-' : `${fmt(mean(values), 1)} (${values.length})`;
        };
        return [
          k,
          rows.length,
          fmt((rows.filter((s) => s.won).length / rows.length) * 100, 1),
          sampled((s) => s.vp10),
          sampled((s) => s.vp20),
          ...STAT_COLUMNS.map(([, pick]) => fmt(mean(rows.map(pick)))),
        ];
      }),
    ),
    '',
    'vp@N is the average score at the start of round N+1 over the games that lasted that long (count in parentheses).',
    '',
  );

  // E. 依策略與勝負拆解
  const byOutcome = groupBy(flat, (s) => `${s.role} ${s.won ? 'won' : 'lost'}`);
  const outcomeKeys = [...byOutcome.keys()].sort();
  lines.push('## Breakdown by role and outcome (average per game)', '');
  lines.push(
    ...table(
      ['role outcome', 'n', 'final score', 'pips r1+r2', ...statHeader],
      outcomeKeys.map((k) => {
        const rows = byOutcome.get(k)!;
        return [
          k,
          rows.length,
          fmt(mean(rows.map((s) => s.score))),
          fmt(mean(rows.map((s) => s.openPips.reduce((a, b) => a + b, 0)))),
          ...STAT_COLUMNS.map(([, pick]) => fmt(mean(rows.map(pick)))),
        ];
      }),
    ),
    '',
  );
  if (mixed) {
    // 同一座位上 focus 的勝負拆解。
    const focusFlat = flat.filter((s) => s.role === spec.focus);
    const byFocusSeat = groupBy(focusFlat, (s) => `${s.seat + 1} ${s.won ? 'won' : 'lost'}`);
    lines.push(`## ${spec.focus} by seat and outcome (average per game)`, '');
    lines.push(
      ...table(
        ['seat outcome', 'n', 'final score', 'pips r1+r2', ...statHeader],
        [...byFocusSeat.keys()].sort().map((k) => {
          const rows = byFocusSeat.get(k)!;
          return [
            k,
            rows.length,
            fmt(mean(rows.map((s) => s.score))),
            fmt(mean(rows.map((s) => s.openPips.reduce((a, b) => a + b, 0)))),
            ...STAT_COLUMNS.map(([, pick]) => fmt(mean(rows.map(pick)))),
          ];
        }),
      ),
      '',
    );
  }
  lines.push(
    '- seat 1 = turn order first and the first placement of round 1 (and the last of round 2); in a fixed-map profile the map is identical every game.',
    '- `pips` = production-number dots (6 − |7 − n|) around the settlement; `kinds` = distinct resources (gold counted) over both settlements.',
    '- `paid/free ships` and `island bonuses` come from rules events; the other columns from `state.stats`. `turns` = action windows the player had.',
    '',
  );
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// 命令列
// ---------------------------------------------------------------------------

function fail(message: string): never {
  console.error(`error: ${message}\n${USAGE}`);
  process.exit(1);
}

interface Args {
  games: number;
  profile: string | undefined;
  players: number | undefined;
  roles: string | undefined;
  from: number;
  jsonl: string | undefined;
  markdown: string | undefined;
  merge: boolean;
  files: string[];
}

function parseArgs(argv: readonly string[]): Args {
  const out: Args = { games: 100, profile: undefined, players: undefined, roles: undefined, from: 0, jsonl: undefined, markdown: undefined, merge: false, files: [] };
  const positional: string[] = [];
  const seen = new Set<string>();
  const value = (option: string, index: number): string => {
    const next = argv[index];
    if (next === undefined || next === '' || next.startsWith('-')) fail(`${option} needs a value`);
    if (seen.has(option)) fail(`${option} was given twice`);
    seen.add(option);
    return next;
  };
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index]!;
    switch (arg) {
      case '--profile':
        out.profile = value(arg, ++index);
        break;
      case '--players': {
        const raw = value(arg, ++index);
        if (!/^[1-9]\d*$/.test(raw)) fail(`--players must be a positive integer, got "${raw}"`);
        out.players = Number(raw);
        break;
      }
      case '--roles':
        out.roles = value(arg, ++index);
        break;
      case '--from': {
        const raw = value(arg, ++index);
        if (!/^\d+$/.test(raw)) fail(`--from must be a non-negative integer, got "${raw}"`);
        out.from = Number(raw);
        break;
      }
      case '--jsonl':
        out.jsonl = value(arg, ++index);
        break;
      case '--markdown':
        out.markdown = value(arg, ++index);
        break;
      case '--merge':
        out.merge = true;
        break;
      default:
        if (arg.startsWith('-')) fail(`unknown option ${arg}`);
        positional.push(arg);
    }
  }
  if (out.merge) {
    out.files = positional;
    if (out.files.length === 0) fail('--merge needs at least one jsonl file');
  } else {
    if (positional.length > 1) fail(`unexpected argument "${positional[1]}"`);
    const rawGames = positional[0] ?? '100';
    if (!/^[1-9]\d*$/.test(rawGames)) fail(`games must be a positive integer, got "${rawGames}"`);
    out.games = Number(rawGames);
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
const command = `node bench/survey.mjs ${process.argv.slice(2).join(' ')}`;
let meta: Meta;
let games: GameRecord[];

if (args.merge) {
  const parts = args.files.map((file) => readFileSync(file, 'utf8').split('\n').filter((line) => line.trim() !== ''));
  const metas = parts.map((lines) => (JSON.parse(lines[0]!) as { meta: Meta }).meta);
  const first = metas[0]!;
  for (const other of metas) {
    if (other.profile !== first.profile || other.players !== first.players || other.roles !== first.roles) {
      fail(`cannot merge shards of different configs: ${JSON.stringify(first)} vs ${JSON.stringify(other)}`);
    }
  }
  games = parts.flatMap((lines) => lines.slice(1).map((line) => JSON.parse(line) as GameRecord));
  const ids = new Set(games.map((game) => game.game));
  if (ids.size !== games.length) fail('shards overlap: a game index appears twice');
  meta = { ...first, from: Math.min(...games.map((game) => game.game)), games: games.length };
} else {
  if (!args.profile || args.players === undefined || !args.roles) fail('--profile, --players and --roles are required');
  const profile = getProfile(args.profile) ?? fail(`unknown ruleset profile: ${args.profile}`);
  if (!botsCanPlay(profile)) fail(`bots cannot play ${profile.id}`);
  if (!profile.playerCounts.includes(args.players)) fail(`profile ${profile.id} does not support ${args.players} players`);
  let spec: RoleSpec;
  try {
    spec = parseRoles(args.roles);
  } catch (error) {
    fail((error as Error).message);
  }
  const kits = kitsOf(profile, BENCH_KITS);
  meta = { profile: profile.id, players: args.players, roles: args.roles, from: args.from, games: args.games };
  games = [];
  for (let game = args.from; game < args.from + args.games; game++) games.push(playGame(spec, profile, kits, args.players, game));
  if (args.jsonl) {
    writeFileSync(args.jsonl, [JSON.stringify({ meta }), ...games.map((game) => JSON.stringify(game))].join('\n') + '\n');
  }
}

const report = renderReport(meta, games, command);
console.log(report);
if (args.markdown) writeFileSync(args.markdown, report);
