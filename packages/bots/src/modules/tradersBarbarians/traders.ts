/**
 * Traders & Barbarians 劇本的策略（T&B 計畫 §4.2 Traders 列、§4.4；S7）。
 *
 * - 路線：`graph.ts` 依 MP 算最短路徑（有道路 1、沒有 2、邊上有蠻族再 +2）。中途不得經過其他據點的廣場：
 *   進入廣場就結束這一次移動。有貨時去需要它的據點，沒貨時去最近、貨物堆還有貨的據點。
 * - 過路費：經過對手道路要付 1 gold。路線的過路費不超過「gold − 準備金 1」；這一次移動就能送達時（送達會拿回 gold）
 *   可以用到準備金。付不起時改走不收費的路線，兩者都沒有才動用準備金。
 * - 運貨優先：`tbWagon` frame 一步一步沿路線走，走不動就停；單一 frame 最多送 12 個指令，之後改送 `tb.wagonStop`。
 * - 升級（`tb.upgradeWagon`）以計畫估值：能讓這回合多送一次貨時值 1 次運貨，其餘依 MP、gold 與滿級分數估長期價值。
 *   加速（`tb.wagonBoost`，1 grain、+2 MP）只在「本回合因此多送一次貨」時使用。驅離蠻族（`tb.driveOff`）不花資源，
 *   路線的下一條邊上有蠻族時就試。
 * - 蠻族騎士卡（`tb.playKnight`）：計入最大騎士團，也把擋路的蠻族移走（落到對手、尤其是領先者的道路上可以偷牌）。
 *   standard 在 preroll 打出；這回合 Swift Journey 比較划算時改打 Swift Journey。
 * - `tbBarbarian`（擲出 7）：與騎士卡用同一套蠻族挑選。
 * - 不為最長道路鋪路：`economy.awards` 回 `{ longestRoad: false }`（rules 以 `minLongestRoad=Infinity` 停用）。
 * - easy：照樣依路線送貨、打騎士卡與移動蠻族；不升級、不加速、不驅離、不打 Swift Journey。
 *
 * 決定性（R2）：不消耗亂數；路徑同分依 `graph.ts` 的編號規則，候選同分依編號。只讀公開投影（對手的手牌只看張數），
 * 計算單一 frame 的指令數時讀事件歷史裡公開的車隊事件。
 */

import {
  BOOST_MP,
  FULL_UPGRADE_POINTS,
  UPGRADE_COSTS,
  WAGON_LEVELS,
  type BoardTopology,
  type GameView,
  type PublicModulePendingView,
  type TbMoveData,
  type TbTradersView,
} from '@catan/rules';
import { canAfford, etaRounds, type Cost, type Plan } from '../../economy.ts';
import type { BotCommand, PlanInput, Scored, TurnContext } from '../types.ts';
import { isMine, TB_FRAME_KINDS } from './frames.ts';
import { edgesTo, vertexPaths, wagonStepCost } from './graph.ts';
import type { TbPartBot } from './part.ts';
import { goldOf, integers, TB_PART_IDS, tbPartHints, tbPartView, tbTargets } from './view.ts';

const TRADERS = TB_PART_IDS.traders;

/** 升級計畫的 kind。 */
export const UPGRADE_PLAN = 'tradersBarbarians.upgradeWagon' as const;

/** 為過路費保留的 gold（§4.2）。coins 的買賣（S3）可以讀 `tollReserve` 保留同樣的張數。 */
export const TRADERS_TOLL_RESERVE = 1;
/** 單一 `tbWagon` frame 最多送幾個指令，之後改送 `tb.wagonStop`（§4.4）。 */
export const WAGON_FRAME_COMMANDS = 12;

/** 一次過路費在路徑成本裡折算的 MP：1 gold 約 0.5 張資源，另外還送對手 1 gold。 */
const TOLL_MP = 1.5;
/** 一次運貨的價值（勝利分當量）：1 分。 */
const DELIVERY_VALUE = 1;
/** 每多 1 MP 的長期價值（勝利分當量）：往返一趟大約 8 MP，剩下的對局還能多送一部分。 */
const MP_VALUE = 0.35;
/** 每次運貨多拿 1 gold 的長期價值。 */
const GOLD_STEP_VALUE = 0.1;
/** 解鎖驅離蠻族（第 2 級）的價值。 */
const DRIVE_OFF_VALUE = 0.05;

type Wagon = TbTradersView['wagons'][string];
type Site = TbTradersView['sites'][number];

/** 車隊事件：每個 frame 指令各留下一筆（`tb.wagonStop` 只有在 Swift Journey 換下一次移動時留下 `tb.wagonAgain`）。 */
const WAGON_COMMAND_EVENTS: ReadonlySet<string> = new Set(['tb.wagonMoved', 'tb.wagonBoosted', 'tb.driveOff', 'tb.wagonAgain']);

function tradersOf(view: Pick<GameView, 'modules'>): TbTradersView | undefined {
  return tbPartView(view, TRADERS);
}

function hintsOf(view: GameView) {
  return tbPartHints(view.hints, TRADERS);
}

const command = (type: string, fields: Record<string, unknown> = {}): BotCommand => ({ type, ...fields }) as BotCommand;

// ---------------------------------------------------------------------------
// 路線
// ---------------------------------------------------------------------------

/** 車隊的一段路線：從目前位置到一個據點的廣場。 */
export interface WagonLeg {
  readonly target: number;
  /** 到達時會送貨（車上的貨是這個據點要的）。 */
  readonly delivers: boolean;
  /** 依序經過的路口（含起點與終點）。 */
  readonly vertices: readonly number[];
  readonly edges: readonly number[];
  /** 各邊的 MP。 */
  readonly costs: readonly number[];
  /** MP 合計。 */
  readonly mp: number;
  /** 經過對手道路的次數。 */
  readonly tolls: number;
}

interface LegContext {
  readonly view: GameView;
  readonly topo: BoardTopology;
  readonly playerId: string;
  readonly traders: TbTradersView;
  readonly barbarians: ReadonlySet<number>;
  readonly plazas: ReadonlySet<number>;
}

function legContext(view: GameView, topo: BoardTopology, playerId: string): LegContext | null {
  const traders = tradersOf(view);
  if (!traders) return null;
  return {
    view,
    topo,
    playerId,
    traders,
    barbarians: new Set(integers(traders.barbarians) ?? []),
    plazas: new Set(traders.sites.map((site) => site.plaza)),
  };
}

/** 這台車要去的據點：有貨時是需要它的據點；沒貨時是貨物堆還有貨的據點（依 rules 的順序）。 */
function destinations(traders: TbTradersView, wagon: Wagon): { site: Site; delivers: boolean }[] {
  if (wagon.cargo) {
    const cargo = wagon.cargo;
    return traders.sites.filter((site) => site.needs.includes(cargo)).map((site) => ({ site, delivers: true }));
  }
  return traders.sites
    .filter((site) => (traders.stackCounts[site.id] ?? 0) > 0 && site.plaza !== wagon.vertex)
    .map((site) => ({ site, delivers: false }));
}

/** `allowTolls` 為 false 時對手的道路不能走；其他據點的廣場不能經過（只能當終點）。 */
function legTo(ctx: LegContext, from: number, target: number, delivers: boolean, allowTolls: boolean): WagonLeg | null {
  const { view, topo, playerId, barbarians, plazas } = ctx;
  const paths = vertexPaths(topo, from, (edge, _at, next) => {
    if (next !== target && plazas.has(next)) return null;
    const step = wagonStepCost(view, playerId, edge, barbarians);
    if (step.toll && !allowTolls) return null;
    return step.mp + (step.toll ? TOLL_MP : 0);
  });
  const edges = edgesTo(paths, target);
  if (!edges || edges.length === 0) return null;
  const vertices = [from];
  const costs: number[] = [];
  let tolls = 0;
  for (const edge of edges) {
    const [a, b] = topo.edges[edge]!.vertices;
    vertices.push(a === vertices.at(-1) ? b : a);
    const step = wagonStepCost(view, playerId, edge, barbarians);
    costs.push(step.mp);
    if (step.toll) tolls += 1;
  }
  return { target, delivers, vertices, edges, costs, mp: costs.reduce((sum, mp) => sum + mp, 0), tolls };
}

/**
 * 到某個據點的路線，含過路費預算（§4.2）：收費路線的過路費不超過 gold − 準備金；`reach` MP 內就能送達時可以用到
 * 準備金。付不起時改走不收費的路線，兩者都沒有才動用準備金；仍然付不起時回 null。
 */
function budgetedLeg(ctx: LegContext, from: number, site: Site, delivers: boolean, reach: number): WagonLeg | null {
  const gold = goldOf(ctx.view, ctx.playerId);
  const any = legTo(ctx, from, site.plaza, delivers, true);
  if (any && (any.tolls === 0 || any.tolls <= gold - TRADERS_TOLL_RESERVE || (delivers && any.mp <= reach && any.tolls <= gold))) {
    return any;
  }
  const free = any && any.tolls > 0 ? legTo(ctx, from, site.plaza, delivers, false) : null;
  if (free) return free;
  return any && any.tolls <= gold ? any : null;
}

/** 路線的成本（與 Dijkstra 相同的折算）：MP 加上過路費。 */
const legCost = (leg: WagonLeg): number => leg.mp + leg.tolls * TOLL_MP;

/**
 * `playerId` 的車隊接下來的路線；`reach` 是這一次移動還有的 MP（估值時用車隊等級的 MP）。沒有目的地或走不到時回 null。
 * 多個候選時取成本最低的，同分取 rules 順序在前的據點。
 */
export function wagonLeg(view: GameView, topo: BoardTopology, playerId: string, reach?: number): WagonLeg | null {
  const ctx = legContext(view, topo, playerId);
  const wagon = ctx?.traders.wagons[playerId];
  if (!ctx || !wagon || wagon.vertex < 0) return null;
  const mp = reach ?? levelOf(wagon).mp;
  let best: WagonLeg | null = null;
  for (const { site, delivers } of destinations(ctx.traders, wagon)) {
    const leg = budgetedLeg(ctx, wagon.vertex, site, delivers, mp);
    if (leg && (!best || legCost(leg) < legCost(best))) best = leg;
  }
  return best;
}

function levelOf(wagon: Wagon): (typeof WAGON_LEVELS)[number] {
  return WAGON_LEVELS[Math.min(WAGON_LEVELS.length, Math.max(1, wagon.level)) - 1]!;
}

/** 從路線起點沿著走，`mp` 內走得到哪裡（逐邊累計，不能超過）。回傳走得到的邊數。 */
function stepsWithin(leg: WagonLeg, mp: number): number {
  let left = mp;
  let steps = 0;
  for (const cost of leg.costs) {
    if (cost > left) break;
    left -= cost;
    steps += 1;
  }
  return steps;
}

const reaches = (leg: WagonLeg, mp: number): boolean => stepsWithin(leg, mp) === leg.edges.length;

// ---------------------------------------------------------------------------
// 車隊移動（tbWagon frame）
// ---------------------------------------------------------------------------

/** 這個 frame 裡自己已經送過幾個指令：自最近一次 `turn.started` 起，自己的車隊事件數（frame 在回合結束時才開）。 */
export function wagonCommandsThisFrame(view: GameView, selfId: string): number {
  let count = 0;
  for (let index = view.events.length - 1; index >= 0; index--) {
    const event = view.events[index]!;
    if (event.type === 'turn.started') break;
    if (WAGON_COMMAND_EVENTS.has(event.type) && event.params.playerId === selfId) count += 1;
  }
  return count;
}

function moveData(frame: PublicModulePendingView): TbMoveData | null {
  const data = frame.data as Partial<TbMoveData> | undefined;
  if (!data || typeof data.mp !== 'number' || typeof data.boosted !== 'boolean') return null;
  return {
    mp: data.mp,
    boosted: data.boosted,
    extra: typeof data.extra === 'number' ? data.extra : 0,
    drivenOff: integers(data.drivenOff) ?? [],
  };
}

/** `tbWagon` 的一步：驅離擋路的蠻族、加速、沿路線走一步，或停下。 */
export function wagonDecision(turn: TurnContext, frame: PublicModulePendingView): BotCommand {
  const stop = command('tb.wagonStop');
  const { view, ctx, model } = turn;
  const data = moveData(frame);
  const hints = hintsOf(view);
  const wagon = tradersOf(view)?.wagons[ctx.selfId];
  if (!data || !hints || !wagon) return stop;
  if (wagonCommandsThisFrame(view, ctx.selfId) >= WAGON_FRAME_COMMANDS) return stop;
  const leg = wagonLeg(view, model.topo, ctx.selfId, data.mp);
  if (!leg) return stop;
  const standard = turn.level !== 'easy';
  const next = leg.edges[0]!;

  // 驅離：不花資源，路線的下一條邊上有蠻族、而且這回合還沒試過它時就試。
  const driveOff = integers(hints.driveOff) ?? [];
  if (standard && driveOff.includes(next)) {
    const to = barbarianTarget(turn, next, leg);
    if (to !== null) return command('tb.driveOff', { barbarian: next, to });
  }

  // 加速：這一次移動差一點送不到、加 2 MP 就送得到時，花 1 grain。
  if (standard && leg.delivers && !data.boosted && (turn.me.resources?.grain ?? 0) >= 1 && !reaches(leg, data.mp) && reaches(leg, data.mp + BOOST_MP)) {
    return command('tb.wagonBoost');
  }

  const to = leg.vertices[1]!;
  const steps = integers(hints.steps) ?? [];
  if (leg.costs[0]! <= data.mp && steps.includes(to)) return command('tb.wagonStep', { to });
  return stop;
}

// ---------------------------------------------------------------------------
// 蠻族（騎士卡與擲出 7）
// ---------------------------------------------------------------------------

interface BarbarianContext {
  readonly mine: ReadonlySet<number>;
  /** 對手路線上的邊 → 經過它的對手分數合計（領先者權重高）。 */
  readonly theirs: ReadonlyMap<number, number>;
}

function barbarianContext(turn: TurnContext, leg?: WagonLeg | null): BarbarianContext {
  const { view, model, ctx } = turn;
  const own = leg === undefined ? wagonLeg(view, model.topo, ctx.selfId) : leg;
  const theirs = new Map<number, number>();
  for (const player of view.players) {
    if (player.id === ctx.selfId) continue;
    const route = wagonLeg(view, model.topo, player.id);
    for (const edge of route?.edges ?? []) theirs.set(edge, (theirs.get(edge) ?? 0) + 1 + player.publicScore * 0.1);
  }
  return { mine: new Set(own?.edges ?? []), theirs };
}

/** 把 `from` 的蠻族移到哪條邊：對手（領先者優先）有手牌的道路上，或對手的路線上；不放在自己的路線與道路上。 */
function barbarianTarget(turn: TurnContext, from: number, leg?: WagonLeg | null, context?: BarbarianContext): number | null {
  const { view, ctx } = turn;
  const targets = tbTargets(view.hints, `tb.barbarian:${from}`);
  if (targets.length === 0) return null;
  const known = context ?? barbarianContext(turn, leg);
  let best: number | null = null;
  let bestScore = -Infinity;
  for (const edge of targets) {
    const score = targetScore(view, ctx.selfId, edge, known);
    if (score > bestScore) {
      bestScore = score;
      best = edge;
    }
  }
  return best;
}

function targetScore(view: GameView, selfId: string, edge: number, known: BarbarianContext): number {
  const owner = view.board.roads[edge]?.player ?? null;
  let score = 0;
  if (owner && owner !== selfId) {
    const player = view.players.find((candidate) => candidate.id === owner);
    score += (player?.handSize ?? 0) > 0 ? 3 + (player?.publicScore ?? 0) * 0.3 : 0.5;
  }
  if (owner === selfId) score -= 4;
  score += (known.theirs.get(edge) ?? 0) * 2;
  if (known.mine.has(edge)) score -= 10;
  return score;
}

/** 要移動哪一個蠻族、移到哪裡：先移自己路線上的，不移擋住對手路線的；同分取編號小的。 */
export function barbarianMove(turn: TurnContext): { from: number; to: number } | null {
  const barbarians = integers(tradersOf(turn.view)?.barbarians) ?? [];
  if (barbarians.length === 0) return null;
  const known = barbarianContext(turn);
  const own = turn.view.board.roads;
  const ranked = barbarians
    .map((edge) => ({
      edge,
      score: (known.mine.has(edge) ? 10 : 0) + (own[edge]?.player === turn.ctx.selfId ? 2 : 0) - (known.theirs.get(edge) ?? 0) * 2,
    }))
    .sort((a, b) => b.score - a.score || a.edge - b.edge);
  for (const { edge } of ranked) {
    const to = barbarianTarget(turn, edge, undefined, known);
    if (to !== null) return { from: edge, to };
  }
  return null;
}

// ---------------------------------------------------------------------------
// 打牌與升級
// ---------------------------------------------------------------------------

/** 打出這張騎士卡就拿到（或超過持有者）最大騎士團。 */
function takesArmy(turn: TurnContext): boolean {
  const { view, me } = turn;
  const holder = view.awards.largestArmy;
  if (holder === me.id) return false;
  const holderKnights = holder ? view.players.find((player) => player.id === holder)?.playedKnights ?? 0 : 0;
  return me.playedKnights + 1 >= 3 && me.playedKnights + 1 > holderKnights;
}

/** Swift Journey 這回合能多送一次貨：一次移動送不到、兩次送得到。 */
function swiftDelivers(turn: TurnContext, leg: WagonLeg | null): boolean {
  const wagon = tradersOf(turn.view)?.wagons[turn.ctx.selfId];
  if (!leg || !wagon || !leg.delivers) return false;
  const mp = levelOf(wagon).mp;
  if (reaches(leg, mp)) return false;
  // 第一次移動停在走得到的最遠處，第二次移動從那裡重新拿到滿 MP。
  const first = stepsWithin(leg, mp);
  const rest = { ...leg, costs: leg.costs.slice(first), edges: leg.edges.slice(first) };
  return first > 0 && reaches(rest, mp);
}

function knightCommand(turn: TurnContext): BotCommand | null {
  const move = barbarianMove(turn);
  return move ? command('tb.playKnight', move) : null;
}

/** standard 這回合要打 Swift Journey，而不是騎士卡。 */
function prefersSwift(turn: TurnContext, leg: WagonLeg | null): boolean {
  const hints = hintsOf(turn.view);
  if (turn.level === 'easy' || !hints?.canPlaySwift) return false;
  if (!hints.canPlayKnight) return true;
  return !takesArmy(turn) && swiftDelivers(turn, leg);
}

function preroll(turn: TurnContext): Scored<BotCommand>[] {
  const hints = hintsOf(turn.view);
  if (turn.level === 'easy' || !hints?.canPlayKnight) return [];
  const leg = wagonLeg(turn.view, turn.model.topo, turn.ctx.selfId);
  if (prefersSwift(turn, leg)) return [];
  const knight = knightCommand(turn);
  return knight ? [{ item: knight, score: 1 }] : [];
}

function actions(turn: TurnContext): Scored<BotCommand>[] {
  const hints = hintsOf(turn.view);
  if (!hints || (!hints.canPlayKnight && !hints.canPlaySwift)) return [];
  const leg = wagonLeg(turn.view, turn.model.topo, turn.ctx.selfId);
  if (prefersSwift(turn, leg)) {
    // 只在有路線時打（沒有目的地時多一次移動沒有用）。
    return leg ? [{ item: command('tb.playSwiftJourney'), score: 0.5 }] : [];
  }
  if (!hints.canPlayKnight) return [];
  const knight = knightCommand(turn);
  return knight ? [{ item: knight, score: 0.5 }] : [];
}

/**
 * 升級的價值（勝利分當量）：這回合因此多送一次貨時加 1 次運貨；其餘依多出的 MP、每次運貨多拿的 gold、解鎖驅離與
 * 滿級的分數估長期價值。
 */
export function upgradeValue(view: GameView, topo: BoardTopology, playerId: string): number | null {
  const wagon = tradersOf(view)?.wagons[playerId];
  if (!wagon || wagon.vertex < 0 || wagon.level >= WAGON_LEVELS.length) return null;
  const now = levelOf(wagon);
  const next = WAGON_LEVELS[wagon.level]!;
  let value = (next.mp - now.mp) * MP_VALUE + (next.value - now.value) * GOLD_STEP_VALUE;
  if (now.driveOff === 0 && next.driveOff > 0) value += DRIVE_OFF_VALUE;
  if (wagon.level + 1 === WAGON_LEVELS.length) value += FULL_UPGRADE_POINTS;
  const leg = wagonLeg(view, topo, playerId, now.mp);
  if (leg?.delivers && !reaches(leg, now.mp) && reaches(leg, next.mp)) value += DELIVERY_VALUE;
  return value;
}

function upgradePlans(input: PlanInput): Plan[] {
  const { model, level, base } = input;
  if (level === 'easy') return [];
  const wagon = tradersOf(model.view)?.wagons[model.selfId];
  if (!wagon) return [];
  const cost = UPGRADE_COSTS[wagon.level - 1] as Cost | undefined;
  const value = upgradeValue(model.view, model.topo, model.selfId);
  if (!cost || value === null) return [];
  const eta = etaRounds(base.hand, cost, base.yield, base.rates, model.view.players.length, base.kinds);
  return [
    {
      kind: UPGRADE_PLAN,
      vertex: null,
      roads: [],
      ships: [],
      cost,
      nextCost: cost,
      value,
      eta,
      score: value / (1 + eta),
      // 升到滿級立即得分。
      immediate: wagon.level + 1 === WAGON_LEVELS.length,
    },
  ];
}

function planStep(turn: TurnContext, plan: Plan): BotCommand | null | undefined {
  if (plan.kind !== UPGRADE_PLAN) return undefined;
  const hints = hintsOf(turn.view);
  return hints?.canUpgrade && canAfford(turn.economy.hand, plan.nextCost) ? command('tb.upgradeWagon') : null;
}

function answerFrame(turn: TurnContext, frame: PublicModulePendingView): BotCommand | null | undefined {
  if (frame.kind === TB_FRAME_KINDS.tbWagon) {
    return isMine(frame, turn.ctx.selfId) ? wagonDecision(turn, frame) : null;
  }
  if (frame.kind === TB_FRAME_KINDS.tbBarbarian) {
    if (!isMine(frame, turn.ctx.selfId)) return null;
    const move = barbarianMove(turn);
    return move ? command('tb.moveBarbarian', move) : null;
  }
  return undefined;
}

/** coins 的買賣（S3）要保留給過路費的 gold；不是 Traders 的對局時是 0。 */
export function tollReserve(view: Pick<GameView, 'modules'>): number {
  return tradersOf(view) ? TRADERS_TOLL_RESERVE : 0;
}

export const tradersBot: TbPartBot = {
  id: TRADERS,
  answerFrame,
  preroll,
  actions,
  planStep,
  economy: {
    scoreExtras: upgradePlans,
    // rules 停用最長道路（`minLongestRoad=Infinity`）：不為它鋪路，也不為它估值。
    awards: () => ({ longestRoad: false }),
  },
};
