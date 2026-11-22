/**
 * 座位偏差量測（不進 CI；Issue #174 座位勝率偏差、#135 對局拆解）：
 *
 *   node bench/survey.mjs [局數] --profile <id> --players <n> --roles <規格>
 *                         [--from <起始局>] [--openings <開局表> [--shift <k>] [--script-roles <角色>]]
 *                         [--setup-from naive] [--trajectory] [--jsonl <檔>] [--markdown <檔>]
 *   node bench/survey.mjs --merge <jsonl 檔>... [--markdown <檔>]
 *   node bench/survey.mjs --latin <jsonl 檔>... [--markdown <檔>]
 *
 * `--roles` 規格：單一角色（`standard`／`easy`／`naive`／`hard`／`hard0`）表示全部座位同一策略；
 * `hard0:standard` 表示 1 位凍結版 hard 對其餘 standard。focus 座位依局數輪換（第 g 局放在座位
 * `g % 人數`），種子從 `10000 + g` 起，與 `bench/run.ts` 的相同組態一致。
 *
 * `--openings 35/49,76/64,37/57` 指定每個座位「原本」的開局頂點（依座位 1、2、… 順序，每個座位兩個聚落，
 * 先放第一輪、再放第二輪；可由先前基線報告的 Openings 表讀出），`--script-roles standard` 只腳本化該角色的座位
 * （其餘角色照常自己選開局；腳本頂點若已被占走則退回 bot 自己的選擇），`--shift k` 讓座位 s 改用第
 * `(s + k) % 人數` 份。bot 的聚落頂點以腳本取代（只換頂點，道路與其後的策略不變；腳本頂點不合法時
 * 退回 bot 自己的選擇並記為 `scriptMiss`）。用來分離「開局位置的好壞」與「回合順序」：若勝率跟著開局走，
 * 偏差來自位置；若仍跟著座位走，偏差來自回合順序。不改任何規則或策略碼。
 *
 * `--setup-from naive`：`standard` 角色的座位在 setup 階段（所有 `setup.*` 指令：聚落、道路、船）改用 naive
 * 策略的決定，其餘階段仍是 standard；naive 與其他角色照常自選，不用腳本頂點。用來檢驗「standard 對 naive 的落差
 * 是不是來自 standard 的 setup」：這是對單一角色的 setup 做的對照，沒有開局腳本造成的頂點衝突，也不會改動
 * 對手的開局。與 `--openings` 互斥。
 *
 * `--latin` 讀入同一組開局、不同 `--shift` 的分片（每個位移一個檔，座位 × 開局成拉丁方陣），輸出
 * 「座位 × 開局」勝率矩陣與兩個邊際：座位邊際（每個座位輪過每一份開局，開局的影響平均掉，剩下回合順序）、
 * 開局邊際（每份開局輪過每個座位，回合順序平均掉，剩下開局位置）。位移必須恰好是 0..人數−1，而且只用
 * 在每個位移都有記錄、都終局的局號（交集；被剔除的局數逐位移回報），否則同一個種子在不同位移的座位 ×
 * 開局排列會缺席，邊際就混入種子本身的結果。
 *
 * 每局記錄每個座位的勝負、終局分數、開局頂點與其產出、造船、小島加分、城市、發展卡、交易等
 * （來源為 `state.stats` 與 rules 事件，不改任何規則或策略），再彙整成 markdown 表：
 * 座位勝率與 Wilson 95% 信賴區間、開局分析、各座位遊戲內容、依（策略 × 勝負）拆解。
 * `--jsonl` 把逐局記錄寫成檔案（第一行為 meta）；`--merge` 把多個分片（`--from` 切開、可平行執行）
 * 合併成同一份表（規則見 `survey-merge.ts`：同一 shift 內局號不能重複，位移不同的分片只能池化）。
 * `--trajectory` 加記每次擲骰的起始理論產量、總 pips 並列名次、第 5／15 輪結束分數和終局勝利點卡數。
 * 有 hard／hard0 角色時自動啟用；純舊角色不加此旗標時輸出不變。
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
} from '@katan/rules';
import { botsCanPlay } from '../src/index.ts';
import type { BotPolicy } from '../src/types.ts';
import { runBotGame, type BotSeat } from '../test/harness.ts';
import { citiesKnightsKit } from '../test/modules/citiesKnights.ts';
import { seafarersKit } from '../test/modules/seafarers.ts';
import { sfckKit } from '../test/modules/seafarersCitiesKnights.ts';
import { kitsOf, type ModuleTestKit } from '../test/modules/types.ts';
import { policyOf } from './roles.ts';
import { cohortWarning, latinCohort, mergeShards, poolBalanceWarning, SEED_BASE, ShardMergeError, type Shard } from './survey-merge.ts';
import { checkpointVp, openingMetrics } from './survey-observations.ts';
import { parseRoles, parseShard, ROLES, rolesFor, type GameRecord, type Meta, type Role, type RoleSpec, type SeatRecord } from './survey-records.ts';

const BENCH_KITS: readonly ModuleTestKit[] = [seafarersKit, citiesKnightsKit, sfckKit];

const USAGE =
  'usage: survey [games] --profile <id> --players <n> --roles <role | focus:rest> [--from <game>] [--openings <a/b,...> [--shift <k>] [--script-roles <role>]] [--setup-from naive] [--trajectory] [--jsonl <file>] [--markdown <file>]\n' +
  '       survey --merge <jsonl>... [--markdown <file>]\n' +
  '       survey --latin <jsonl>... [--markdown <file>]';

// 記錄格式（Meta、SeatRecord、GameRecord）與 jsonl 分片的解析在 `survey-records.ts`。

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

/** 開局腳本：`openings[i]` 是第 i 份開局（每份依放置順序的聚落頂點）；座位 s 使用第 `(s + shift) % n` 份。 */
interface OpeningScript {
  openings: readonly (readonly number[])[];
  shift: number;
  /** 只腳本化這個角色；省略表示所有座位。 */
  onlyRole?: Role;
}

/**
 * 把策略的聚落放置換成腳本頂點（只換 `setup.placeBuilding`；其餘指令原樣通過）。第幾個聚落由自己已
 * 放的建築數決定，不靠內部計數（`nextDecision` 會對每個座位反覆詢問，指令未必被套用）。
 */
function scripted(policy: BotPolicy, script: OpeningScript, seat: number, players: number, misses: number[]): BotPolicy {
  const mine = script.openings[(seat + script.shift) % players]!;
  return {
    decide(view, ctx) {
      const command = policy.decide(view, ctx);
      if (!command || command.type !== 'setup.placeBuilding') return command;
      const placed = view.board.buildings.filter((building) => building?.player === ctx.selfId).length;
      const wanted = mine[placed];
      if (wanted !== undefined && view.hints?.legalSettlements.includes(wanted)) return { type: 'setup.placeBuilding', vertex: wanted };
      misses[seat] = (misses[seat] ?? 0) + 1;
      return command;
    },
  };
}

/** 其餘階段用 `policy`，setup 階段（任何 `setup.*` 指令）改用 `setup` 策略的決定；`setup` 沒有決定時退回 `policy`。 */
function setupFrom(policy: BotPolicy, setup: BotPolicy): BotPolicy {
  return {
    decide(view, ctx) {
      const command = policy.decide(view, ctx);
      if (!command || !command.type.startsWith('setup.')) return command;
      return setup.decide(view, ctx) ?? command;
    },
  };
}

function playGame(
  spec: RoleSpec,
  profile: ProfileDefinition,
  kits: readonly ModuleTestKit[],
  players: number,
  game: number,
  script: OpeningScript | null,
  setupFromNaive: boolean,
  trajectory: boolean,
): GameRecord {
  const roles = rolesFor(spec, players, game);
  const misses: number[] = roles.map(() => 0);
  const seats: BotSeat[] = roles.map((role, index) => ({
    id: `bot${index + 1}`,
    level: role === 'naive' ? 'standard' : role === 'hard0' ? 'hard' : role,
    policy:
      script && (script.onlyRole === undefined || script.onlyRole === role)
        ? scripted(policyOf(role, profile), script, index, players, misses)
        : setupFromNaive && role === 'standard'
          ? setupFrom(policyOf(role, profile), policyOf('naive', profile))
          : policyOf(role, profile),
  }));
  const openings: number[][] = seats.map(() => []);
  // 開局描述必須在放置當下（套用前的狀態）取得：之後的對局可能改動數字標記（例如 C&K 的 Inventor）。
  const described: ReturnType<typeof describeVertex>[][] = seats.map(() => []);
  const events = seats.map(() => ({ paidShips: 0, freeShips: 0, setupShips: 0, shipsMoved: 0, islandBonuses: 0 }));
  const seed = SEED_BASE + game;
  const run = runBotGame({
    seats,
    seed,
    profileId: profile.id,
    kits,
    onDecision: (before, decision) => {
      const vertex = (decision.command as { vertex?: unknown }).vertex;
      if (decision.command.type === 'setup.placeBuilding' && typeof vertex === 'number') {
        const seat = seatIndexOf(decision.actor);
        openings[seat]?.push(vertex);
        described[seat]?.push(describeVertex(before, vertex));
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
  const metrics = trajectory ? openingMetrics(described.map((placed) => placed.map((entry) => entry.pips))) : undefined;
  const records: SeatRecord[] = state.players.map((player, seat) => {
    const stats = state.stats?.players[player.id];
    const placed = described[seat] ?? [];
    const produced = stats ? Object.values(stats.produced).reduce((a, b) => a + b, 0) : 0;
    const sampled = (round: number): number | null =>
      checkpointVp(timeline, round, seat, !trajectory || state.result !== null);
    return {
      seat,
      role: roles[seat]!,
      won: player.id === winnerId,
      score: scoreOf(state, player.id, { includeHidden: true }),
      opening: openings[seat] ?? [],
      openPips: placed.map((entry) => entry.pips),
      openCoast: placed.map((entry) => entry.coast),
      openHarbor: placed.map((entry) => entry.harbor),
      openKinds: new Set(placed.flatMap((entry) => entry.kinds)).size,
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
      robbed: stats ? Object.values(stats.robbed).reduce((a, b) => a + b, 0) : 0,
      blocked: stats ? Object.values(stats.blockedResources).reduce((a, b) => a + b, 0) : 0,
      longestRoad: state.awards.longestRoad === player.id,
      largestArmy: state.awards.largestArmy === player.id,
      scriptMiss: misses[seat] ?? 0,
      vp10: sampled(10),
      vp20: sampled(20),
      ...(metrics ? {
        ...metrics[seat]!,
        vp5: sampled(5),
        vp15: sampled(15),
        vpCards: [...player.devCards, ...player.newDevCards].filter((card) => card === 'victoryPoint').length,
      } : {}),
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
  ['robbed', (s) => s.robbed],
  ['blocked', (s) => s.blocked],
  ['longest road %', (s) => (s.longestRoad ? 100 : 0)],
  ['largest army %', (s) => (s.largestArmy ? 100 : 0)],
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
  lines.push(
    `# Seat survey: ${meta.profile} ${meta.players}p ${meta.roles}` +
      (meta.setupFrom ? ` (standard seats use ${meta.setupFrom}'s setup decisions)` : '') +
      (meta.openings
        ? ` (scripted openings ${meta.openings}${meta.scriptRoles ? ` for ${meta.scriptRoles} seats only` : ''}, ${meta.shift === undefined ? 'pooled over shifts' : `shift ${meta.shift}`})`
        : ''),
    '',
  );
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

  if (meta.openings && meta.shift !== undefined) {
    // 依「開局」重新歸類：座位 s 用第 (s + shift) % n 份。
    const shift = meta.shift;
    const list = meta.openings.split(',');
    const misses = flat.reduce((sum, s) => sum + s.scriptMiss, 0);
    lines.push(`## Wins by scripted opening (seat s plays opening (s + ${shift}) % ${meta.players} + 1)`, '');
    if (meta.scriptRoles) lines.push(`Only ${meta.scriptRoles} seats follow the script; the other seats choose their own openings, so the opening column is nominal for them.`, '');
    lines.push(
      ...table(
        ['opening', 'vertices', 'seat', 'wins', 'win %', '95% CI'],
        seatNumbers.map((seat) => {
          const wins = winsBySeat[seat]!;
          const [lo, hi] = wilson(wins, finished.length);
          return [((seat + shift) % meta.players) + 1, list[(seat + shift) % meta.players]!, seat + 1, wins, fmt((wins / Math.max(1, finished.length)) * 100, 1), `${fmt(lo, 1)}–${fmt(hi, 1)}`];
        }).sort((a, b) => Number(a[0]) - Number(b[0])),
      ),
      '',
      `Script misses (scripted vertex not legal, bot's own choice used): ${misses} over ${flat.length} seat-games.`,
      '',
    );
  }

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
  if (mixed) {
    // 投入與勝負：focus 在各投入量下的勝率（觀察性資料，投入量與開局、運氣互相混淆）。
    const focusSeats = flat.filter((s) => s.role === spec.focus);
    const buckets: readonly [string, (s: SeatRecord) => number, readonly [string, number, number][]][] = [
      ['paid ships', (s) => s.paidShips, [['0', 0, 0], ['1–2', 1, 2], ['3–4', 3, 4], ['5+', 5, 99]]],
      ['island bonuses', (s) => s.islandBonuses, [['0', 0, 0], ['1', 1, 1], ['2', 2, 2], ['3+', 3, 99]]],
      ['cities', (s) => s.cities, [['0', 0, 0], ['1', 1, 1], ['2', 2, 2], ['3+', 3, 99]]],
    ];
    lines.push(`## ${spec.focus} win rate by investment (observational; ${focusSeats.length} seat-games)`, '');
    for (const [name, pick, ranges] of buckets) {
      lines.push(
        ...table(
          [name, 'n', 'share %', 'win %', '95% CI', 'avg final score'],
          ranges.map(([label, lo, hi]) => {
            const rows = focusSeats.filter((s) => pick(s) >= lo && pick(s) <= hi);
            const wins = rows.filter((s) => s.won).length;
            const [cl, ch] = wilson(wins, rows.length);
            return [label, rows.length, fmt((rows.length / Math.max(1, focusSeats.length)) * 100, 1), fmt((wins / Math.max(1, rows.length)) * 100, 1), `${fmt(cl, 1)}–${fmt(ch, 1)}`, fmt(mean(rows.map((s) => s.score)))];
          }),
        ),
        '',
      );
    }
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
  openings: string | undefined;
  shift: number | undefined;
  scriptRoles: string | undefined;
  setupFrom: string | undefined;
  trajectory: boolean;
  jsonl: string | undefined;
  markdown: string | undefined;
  merge: boolean;
  latin: boolean;
  files: string[];
}

function parseArgs(argv: readonly string[]): Args {
  const out: Args = { games: 100, profile: undefined, players: undefined, roles: undefined, from: 0, openings: undefined, shift: undefined, scriptRoles: undefined, setupFrom: undefined, trajectory: false, jsonl: undefined, markdown: undefined, merge: false, latin: false, files: [] };
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
      case '--openings':
        out.openings = value(arg, ++index);
        break;
      case '--shift': {
        const raw = value(arg, ++index);
        if (!/^\d+$/.test(raw)) fail(`--shift must be a non-negative integer, got "${raw}"`);
        out.shift = Number(raw);
        break;
      }
      case '--script-roles':
        out.scriptRoles = value(arg, ++index);
        break;
      case '--setup-from': {
        const raw = value(arg, ++index);
        if (raw !== 'naive') fail(`--setup-from only supports "naive", got "${raw}"`);
        out.setupFrom = raw;
        break;
      }
      case '--trajectory':
        out.trajectory = true;
        break;
      case '--jsonl':
        out.jsonl = value(arg, ++index);
        break;
      case '--markdown':
        out.markdown = value(arg, ++index);
        break;
      case '--merge':
        out.merge = true;
        break;
      case '--latin':
        out.latin = true;
        break;
      default:
        if (arg.startsWith('-')) fail(`unknown option ${arg}`);
        positional.push(arg);
    }
  }
  if (out.merge && out.latin) fail('--merge and --latin are exclusive');
  if (out.merge || out.latin) {
    out.files = positional;
    if (out.files.length === 0) fail(`--${out.merge ? 'merge' : 'latin'} needs at least one jsonl file`);
  } else {
    if (positional.length > 1) fail(`unexpected argument "${positional[1]}"`);
    const rawGames = positional[0] ?? '100';
    if (!/^[1-9]\d*$/.test(rawGames)) fail(`games must be a positive integer, got "${rawGames}"`);
    out.games = Number(rawGames);
  }
  return out;
}


/** 讀一個 jsonl 分片（解析與驗證在 `survey-records.ts`）。 */
function readShard(file: string): Shard<Meta, GameRecord> {
  let text: string;
  try {
    text = readFileSync(file, 'utf8');
  } catch (error) {
    throw new ShardMergeError(`cannot read ${file}: ${(error as Error).message}`);
  }
  return parseShard(file, text);
}

/** 拉丁方陣：座位 × 開局的勝率矩陣與兩個邊際（只用在每個 shift 都終局的局號，見 `latinCohort`）。 */
function renderLatin(files: readonly string[], command: string): string {
  const shards = files.map(readShard);
  const first = shards[0]!.meta;
  const n = first.players;
  for (const { meta, file } of shards) {
    if (!meta.openings) throw new ShardMergeError(`${file} has no scripted openings; --latin needs shards made with --openings and --shift`);
    if (meta.scriptRoles) throw new ShardMergeError(`${file} was made with --script-roles; --latin needs every seat scripted (such shards can only be pooled with --merge)`);
  }
  const list = first.openings!.split(',');
  if (list.length !== n) throw new ShardMergeError(`--openings has ${list.length} entries but the shards have ${n} players`);
  const cohort = latinCohort(shards);
  const { byShift, shifts } = cohort;
  const warning = cohortWarning(cohort);
  if (warning) console.error(`warning: ${warning}`);
  // cell[seat][opening] = [wins, games]
  const cell = Array.from({ length: n }, () => Array.from({ length: n }, () => [0, 0] as [number, number]));
  for (const [shift, games] of byShift) {
    for (const game of games) {
      for (let seat = 0; seat < n; seat++) {
        const slot = cell[seat]![(seat + shift) % n]!;
        slot[1] += 1;
        if (game.winner === seat) slot[0] += 1;
      }
    }
  }
  const rate = ([wins, games]: [number, number]): string => `${fmt((wins / Math.max(1, games)) * 100, 1)} (${wins}/${games})`;
  const lines: string[] = [];
  lines.push(`# Latin square: ${first.profile} ${n}p ${first.roles} (openings ${first.openings})`, '');
  lines.push(
    `\`${command}\` — cohort: ${cohort.ids.length} games per shift (game ids present and finished in every shift, so every seed meets every seat × opening arrangement exactly once); ` +
      shifts.map((shift) => { const s = cohort.stats.get(shift)!; return `shift ${shift}: ${s.games} games, ${s.finished} finished, ${s.dropped} dropped`; }).join('; ') + '.',
    '',
  );
  if (warning) lines.push(`> **Warning:** ${warning}. Games that did not finish in some shift are dropped from every shift.`, '');
  lines.push('Win % (wins/games) of the seat in the row when it plays the opening in the column; every game has one winner, so each shift run sums to 100%.', '');
  lines.push(
    ...table(
      ['seat \\ opening', ...list.map((entry, index) => `${index + 1} (${entry})`), 'seat marginal (turn order)'],
      cell.map((row, seat) => {
        const [wins, games] = row.reduce<[number, number]>((acc, slot) => [acc[0] + slot[0], acc[1] + slot[1]], [0, 0]);
        const [lo, hi] = wilson(wins, games);
        return [seat + 1, ...row.map(rate), `${fmt((wins / Math.max(1, games)) * 100, 1)} [${fmt(lo, 1)}–${fmt(hi, 1)}]`];
      }),
    ),
    '',
  );
  const openingMarginals = list.map((_, opening) => {
    const [wins, games] = cell.reduce<[number, number]>((acc, row) => [acc[0] + row[opening]![0], acc[1] + row[opening]![1]], [0, 0]);
    return { wins, games };
  });
  lines.push(
    ...table(
      ['opening marginal (position)', ...list.map((entry, index) => `${index + 1} (${entry})`)],
      [[
        'win % [95% CI]',
        ...openingMarginals.map(({ wins, games }) => {
          const [lo, hi] = wilson(wins, games);
          return `${fmt((wins / Math.max(1, games)) * 100, 1)} [${fmt(lo, 1)}–${fmt(hi, 1)}]`;
        }),
      ]],
    ),
    '',
  );
  // 邊際的卡方：每個邊際的 n 個單元格各自有相同的場次數。
  const chiOf = (marginals: readonly { wins: number; games: number }[]): string => {
    const total = marginals.reduce((sum, m) => sum + m.wins, 0);
    const expected = total / marginals.length;
    const chi = marginals.reduce((sum, m) => sum + (m.wins - expected) ** 2 / expected, 0);
    return `chi-square ${fmt(chi, 1)}, df ${marginals.length - 1}, p = ${fmt(chiSquareP(chi, marginals.length - 1), 4)}`;
  };
  const seatMarginals = cell.map((row) => ({ wins: row.reduce((sum, slot) => sum + slot[0], 0), games: row.reduce((sum, slot) => sum + slot[1], 0) }));
  const spec = parseRoles(first.roles);
  if (spec.focus !== null && spec.focus !== spec.rest) {
    // focus 座位的勝率：focus 輪過每個座位、每個座位輪過每份開局，所以位置與回合順序都被平衡掉，剩下策略差異。
    const focusCell = Array.from({ length: n }, () => Array.from({ length: n }, () => [0, 0] as [number, number]));
    for (const [shift, games] of byShift) {
      for (const game of games) {
        for (const seatRecord of game.seats) {
          if (seatRecord.role !== spec.focus) continue;
          const slot = focusCell[seatRecord.seat]![(seatRecord.seat + shift) % n]!;
          slot[1] += 1;
          if (seatRecord.won) slot[0] += 1;
        }
      }
    }
    const [fw, fg] = focusCell.flat().reduce<[number, number]>((acc, slot) => [acc[0] + slot[0], acc[1] + slot[1]], [0, 0]);
    const [flo, fhi] = wilson(fw, fg);
    lines.push(
      `${spec.focus} win % (wins/games) by the seat it sits in and the opening it plays (vs ${spec.rest}; fair share ${fmt(100 / n, 1)}%):`,
      '',
      ...table(['seat \\ opening', ...list.map((entry, index) => `${index + 1} (${entry})`)], focusCell.map((row, seat) => [seat + 1, ...row.map(rate)])),
      '',
      `- ${spec.focus} win rate pooled over every seat and opening: ${fmt((fw / Math.max(1, fg)) * 100, 1)}% [${fmt(flo, 1)}–${fmt(fhi, 1)}] (${fw}/${fg}).`,
      '',
    );
  }
  lines.push(`- seat marginal (opening effect averaged out): ${chiOf(seatMarginals)}.`, `- opening marginal (turn order averaged out): ${chiOf(openingMarginals)}.`, '');
  return lines.join('\n');
}

const args = parseArgs(process.argv.slice(2));
const command = `node bench/survey.mjs ${process.argv.slice(2).join(' ')}`;
let meta: Meta;
let games: GameRecord[];
const notes: string[] = [];

if (args.latin) {
  let text: string;
  try {
    text = renderLatin(args.files, command);
  } catch (error) {
    if (error instanceof ShardMergeError) fail(error.message);
    throw error;
  }
  console.log(text);
  if (args.markdown) writeFileSync(args.markdown, text);
  process.exit(0);
}
if (args.merge) {
  try {
    const shards = args.files.map(readShard);
    const merged = mergeShards(shards);
    games = merged.games;
    meta = { ...merged.meta, from: Math.min(...games.map((game) => game.game)), games: games.length };
    const poolWarning = poolBalanceWarning(shards);
    if (poolWarning) {
      console.error(`warning: ${poolWarning}`);
      notes.push(poolWarning);
    }
  } catch (error) {
    if (error instanceof ShardMergeError) fail(error.message);
    throw error;
  }
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
  let script: OpeningScript | null = null;
  if (args.openings) {
    const openings = args.openings.split(',').map((entry) => entry.split('/').map(Number));
    if (openings.length !== args.players || openings.some((entry) => entry.length !== 2 || entry.some((v) => !Number.isInteger(v) || v < 0))) {
      fail(`--openings needs ${args.players} entries of the form <vertex>/<vertex>, got "${args.openings}"`);
    }
    if (new Set(openings.flat()).size !== openings.length * 2) fail(`--openings must not repeat a vertex, got "${args.openings}"`);
    let onlyRole: Role | undefined;
    if (args.scriptRoles !== undefined) {
      if (!ROLES.includes(args.scriptRoles as Role)) fail(`--script-roles must be one of ${ROLES.join('|')}, got "${args.scriptRoles}"`);
      onlyRole = args.scriptRoles as Role;
      if (spec.focus !== onlyRole && spec.rest !== onlyRole) fail(`--script-roles ${onlyRole} matches no seat in --roles ${args.roles}`);
    }
    const shift = args.shift ?? 0;
    if (shift >= args.players) fail(`--shift must be below the player count (0..${args.players - 1}), got ${shift}`);
    script = { openings, shift, ...(onlyRole ? { onlyRole } : {}) };
  } else if (args.shift !== undefined) {
    fail('--shift needs --openings');
  } else if (args.scriptRoles !== undefined) {
    fail('--script-roles needs --openings');
  }
  if (args.setupFrom !== undefined) {
    if (script) fail('--setup-from and --openings are exclusive');
    if (spec.focus !== 'standard' && spec.rest !== 'standard') fail(`--setup-from naive needs a standard seat in --roles, got ${args.roles}`);
  }
  meta = {
    profile: profile.id,
    players: args.players,
    roles: args.roles,
    from: args.from,
    games: args.games,
    ...(args.setupFrom ? { setupFrom: args.setupFrom } : {}),
    ...(script ? { openings: args.openings!, shift: script.shift } : {}),
    ...(script?.onlyRole ? { scriptRoles: script.onlyRole } : {}),
  };
  const trajectory = args.trajectory || [spec.focus, spec.rest].some((role) => role === 'hard' || role === 'hard0');
  games = [];
  for (let game = args.from; game < args.from + args.games; game++) games.push(playGame(spec, profile, kits, args.players, game, script, args.setupFrom === 'naive', trajectory));
  if (args.jsonl) {
    writeFileSync(args.jsonl, [JSON.stringify({ meta }), ...games.map((game) => JSON.stringify(game))].join('\n') + '\n');
  }
}

const report = renderReport(meta, games, command) + (notes.length > 0 ? `\n${notes.map((note) => `- **Warning:** ${note}.`).join('\n')}\n` : '');
console.log(report);
if (args.markdown) writeFileSync(args.markdown, report);
