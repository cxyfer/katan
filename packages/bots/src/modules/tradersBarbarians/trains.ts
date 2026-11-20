/**
 * Merchant Trains 的策略（T&B 計畫 §4.2、§12.2）。
 *
 * 規則重點（`TB/trains/index.ts`）：行動階段蓋了建築的回合，結束時開一輪投票決定一節車廂放在哪裡。玩家依座位順序公開出價
 * （wool 與 grain，投票結束後全部歸還銀行，也就是出價者付掉）；過半者直接放置，否則出價者同時分配票數，票數最多的位置勝出，
 * 平手時由出價最高者（唯一）或行動者放置。車廂所在的邊上的道路在最長道路算 2（`edgeWeight`）；夾在兩節車廂之間的路口上的
 * 建築每座 +1 VP（`BETWEEN_WAGONS_POINTS`）。
 *
 * - 位置的價值（`trainScene`）：每位玩家因這節車廂得到的變化，換算成勝利分當量：新夾住的建築 +1、列車前端停在建築上
 *   （下一節就夾住）的潛在價值、最長道路的得失（2 VP，含守成者規則）與路線長度。對自己的價值是自己的變化減去對手變化的加權
 *   （接近勝利的對手權重較高）。所有輸入都是公開的投影（盤面、車廂、公開出價與分配），不讀對手手牌。
 * - 出價（`wagonBid`，依序：`responders[0] === self` 才作答）：只用主要計畫用不到的 wool 與 grain。以公開的出價與各玩家的偏好
 *   （同一個價值函式，以對方的視角）預測結果，比較出價 k 張的結果價值減去 k 張牌的成本；划算才出價，同分取較少的張數。
 *   之後才出價的玩家假設出 0（看不到）。easy 一律出 0。
 * - 分配（`wagonAssign`，同時：`includes(self)`）：已公開的分配照用，其他出價者假設投給自己偏好的位置；選讓結果對自己最好的位置。
 * - 放置（`wagonPlace`，可能由非行動者放置）：選對自己價值最高的位置。
 * - 計畫與立即建造（只有 standard）：
 *   - `tradersBarbarians.trainRoad`：車廂讓道路算 2，base 的最長道路計畫只算道路條數；一條合法道路就能（以加權長度）拿下最長
 *     道路時加上這個計畫。
 *   - `tradersBarbarians.wagonSettlement`：已經夾在兩節車廂之間的空路口，蓋聚落多 1 VP；付得起又合法時，`actions` 也把它加分
 *     放進骨架的立即建造。
 *
 * 只讀投影與 hints，合法性一律以 hints 為準（P2）；不消耗亂數，同分依邊或路口編號（小者優先）決勝。
 */

import {
  BETWEEN_WAGONS_POINTS,
  COSTS,
  type GameView,
  type PublicModulePendingView,
  type TbTrainsView,
} from '@catan/rules';
import { isFreeSpot, playerYield, roadPath, targetOf, type BoardModel } from '../../board.ts';
import { addCosts, canAfford, etaRounds, PIP_VALUE, scaleCost, settlementSpotValue, type Plan } from '../../economy.ts';
import type { BotCommand, PlanInput, Scored, TurnContext } from '../types.ts';
import { isMine, TB_FRAME_KINDS } from './frames.ts';
import type { TbPartBot } from './part.ts';
import { integers, TB_PART_IDS, tbBoardTargets, tbPartHints, tbPartView } from './view.ts';

const TRAINS = TB_PART_IDS.trains;
export const TRAIN_ROAD_PLAN = 'tradersBarbarians.trainRoad' as const;
export const WAGON_SETTLEMENT_PLAN = 'tradersBarbarians.wagonSettlement' as const;

/** 最長道路的分數與最低長度（base 規則）。 */
const LONGEST_ROAD_POINTS = 2;
const LONGEST_ROAD_MIN = 5;
/** 路線每長 1 的價值（朝最長道路前進）。 */
const ROUTE_STEP_VALUE = 0.05;
/** 列車前端停在建築上：下一節車廂就會夾住它。 */
const HEAD_VALUE = 0.3;
/** 列車前端旁邊的路口有建築：再兩節才夾住。 */
const LOOKAHEAD_VALUE = 0.08;
/** 對手得分對自己的權重；接近勝利（差 `CLOSE_TO_WIN` 分以內）的對手較高。 */
const OPPONENT_WEIGHT = 0.5;
const LEADER_WEIGHT = 0.8;
const CLOSE_TO_WIN = 3;
/** 出價一張計畫外的牌的成本（勝利分當量）。 */
const BID_CARD_COST = 0.15;
/** 出價的收益至少要多這麼多才出。 */
const MIN_BID_GAIN = 0.05;
/** 一次最多出價幾張。 */
const MAX_BID = 4;
/** `trainRoad` 計畫的價值（與 base 只差一條路的最長道路計畫相同）。 */
const TRAIN_ROAD_VALUE = 1.8;

type Bids = Readonly<Record<string, { readonly wool: number; readonly grain: number }>>;

export interface WagonVote {
  readonly bids: Bids;
  readonly assignments: Readonly<Record<string, number>>;
  readonly active: string;
}

const command = (type: string, fields: Record<string, unknown> = {}): BotCommand => ({ type, ...fields }) as BotCommand;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function trainsView(view: Pick<GameView, 'modules'>): TbTrainsView | undefined {
  const trains = tbPartView(view, TRAINS);
  return trains && Array.isArray(trains.wagons) && Array.isArray(trains.starts) ? trains : undefined;
}

const votesOf = (bid: { readonly wool: number; readonly grain: number } | undefined): number =>
  bid ? Math.max(0, bid.wool) + Math.max(0, bid.grain) : 0;

/** 投票資料：frame 的公開 data；形狀不對時回 null。 */
export function voteOf(frame: PublicModulePendingView): WagonVote | null {
  const data = frame.data;
  if (!isRecord(data) || !isRecord(data.bids) || typeof data.active !== 'string') return null;
  const bids: Record<string, { wool: number; grain: number }> = {};
  for (const [id, bid] of Object.entries(data.bids)) {
    if (!isRecord(bid)) continue;
    const wool = typeof bid.wool === 'number' ? bid.wool : 0;
    const grain = typeof bid.grain === 'number' ? bid.grain : 0;
    bids[id] = { wool, grain };
  }
  const assignments: Record<string, number> = {};
  if (isRecord(data.assignments)) {
    for (const [id, edge] of Object.entries(data.assignments)) if (Number.isInteger(edge)) assignments[id] = edge as number;
  }
  return { bids, assignments, active: data.active };
}

// ---------------------------------------------------------------------------
// 盤面
// ---------------------------------------------------------------------------

/**
 * `playerId` 的最長路線，車廂所在的邊算 2（與 rules 的 `longestRouteLength` 加上 `edgeWeight` 相同：對手建築切斷路線，
 * 不重複走同一條路）。`extraRoad` 是假設多蓋的一條自己的路。
 */
export function weightedRoute(
  model: BoardModel,
  playerId: string,
  wagons: ReadonlySet<number>,
  extraRoad: number | null = null,
): number {
  const { topo } = model;
  const { buildings, roads } = model.view.board;
  const incident = new Map<number, number[]>();
  const add = (edge: number): void => {
    for (const vertex of topo.edges[edge]!.vertices) {
      const list = incident.get(vertex);
      if (list) list.push(edge);
      else incident.set(vertex, [edge]);
    }
  };
  roads.forEach((road, edge) => {
    if (road && road.player === playerId && !road.ship) add(edge);
  });
  if (extraRoad !== null && !roads[extraRoad]) add(extraRoad);
  if (incident.size === 0) return 0;
  const blocked = (vertex: number): boolean => {
    const building = buildings[vertex];
    return !!building && building.player !== playerId;
  };
  const used = new Set<number>();
  const walk = (vertex: number): number => {
    let best = 0;
    for (const edge of incident.get(vertex) ?? []) {
      if (used.has(edge)) continue;
      const [a, b] = topo.edges[edge]!.vertices;
      const next = a === vertex ? b : a;
      used.add(edge);
      const length = (wagons.has(edge) ? 2 : 1) + (blocked(next) ? 0 : walk(next));
      used.delete(edge);
      if (length > best) best = length;
    }
    return best;
  };
  let longest = 0;
  for (const vertex of incident.keys()) {
    if (blocked(vertex)) continue;
    longest = Math.max(longest, walk(vertex));
  }
  return longest;
}

/**
 * 最長道路的持有者（rules 的 `recomputeAwards`）：持有者仍有資格時，挑戰者要嚴格超過才轉手；否則取最長者，平手時持有者
 * 優先，再取座位最前者。
 */
export function longestRoadHolder(
  players: readonly { readonly id: string; readonly seat: number }[],
  lengths: ReadonlyMap<string, number>,
  current: string | null,
): string | null {
  const lengthOf = (id: string): number => lengths.get(id) ?? 0;
  const eligible = players.filter((player) => lengthOf(player.id) >= LONGEST_ROAD_MIN);
  if (current !== null && lengthOf(current) >= LONGEST_ROAD_MIN) {
    const challenger = eligible.find((player) => lengthOf(player.id) > lengthOf(current));
    return challenger ? challenger.id : current;
  }
  if (eligible.length === 0) return null;
  const best = Math.max(...eligible.map((player) => lengthOf(player.id)));
  const tied = eligible.filter((player) => lengthOf(player.id) === best);
  if (tied.some((player) => player.id === current)) return current;
  return tied.slice().sort((a, b) => a.seat - b.seat)[0]!.id;
}

/** 一個車廂位置對每位玩家的變化（勝利分當量）；與視角無關。 */
type Deltas = ReadonlyMap<string, number>;

export interface TrainScene {
  readonly model: BoardModel;
  /** 可以放車廂的邊（hints），由小到大。 */
  readonly locations: readonly number[];
  /** `edge` 對 `playerId` 的價值：自己的變化減去對手變化的加權。 */
  valueFor(playerId: string, edge: number): number;
  /** `playerId` 最想要的位置（同分取編號小者）；沒有位置時回 null。 */
  preferred(playerId: string): number | null;
}

/** 這個投影上的車廂估值；沒有 Trains 的 view 時回 undefined。 */
export function trainScene(model: BoardModel, locations: readonly number[]): TrainScene | undefined {
  const trains = trainsView(model.view);
  if (!trains) return undefined;
  const { view, topo } = model;
  const wagons = new Set(trains.wagons.map((wagon) => wagon.edge));
  const degree = new Map<number, number>();
  for (const edge of wagons) {
    for (const vertex of topo.edges[edge]!.vertices) degree.set(vertex, (degree.get(vertex) ?? 0) + 1);
  }
  const starts = new Set(trains.starts.map((start) => start.vertex));
  const players = view.players.map((player) => ({ id: player.id, seat: player.seat }));
  const lengths = new Map(players.map((player) => [player.id, weightedRoute(model, player.id, wagons)]));
  const holder = longestRoadHolder(players, lengths, view.awards.longestRoad);
  const sorted = [...new Set(locations)].sort((a, b) => a - b);

  const deltaCache = new Map<number, Deltas>();
  const deltasOf = (edge: number): Deltas => {
    const cached = deltaCache.get(edge);
    if (cached) return cached;
    const out = new Map<string, number>();
    const add = (id: string, value: number): void => {
      out.set(id, (out.get(id) ?? 0) + value);
    };
    // 夾住建築：車廂的一端原本有 1 節車廂。列車前端（原本沒有車廂、也不是起點）停在建築上，下一節就夾住。
    for (const vertex of topo.edges[edge]!.vertices) {
      const owner = view.board.buildings[vertex]?.player;
      const before = degree.get(vertex) ?? 0;
      if (before === 1 && owner) add(owner, BETWEEN_WAGONS_POINTS);
      if (before !== 0 || starts.has(vertex)) continue;
      if (owner) add(owner, HEAD_VALUE);
      for (const next of topo.vertices[vertex]!.edges) {
        if (next === edge || wagons.has(next)) continue;
        const [a, b] = topo.edges[next]!.vertices;
        const neighbour = view.board.buildings[a === vertex ? b : a]?.player;
        if (neighbour) add(neighbour, LOOKAHEAD_VALUE);
      }
    }
    // 道路算 2：只有這條邊上的道路主人路線變長，最長道路可能因此轉手。
    const owner = view.board.roads[edge]?.player;
    if (owner && !view.board.roads[edge]!.ship) {
      const after = weightedRoute(model, owner, new Set([...wagons, edge]));
      const before = lengths.get(owner) ?? 0;
      if (after !== before) {
        add(owner, (after - before) * ROUTE_STEP_VALUE);
        const next = longestRoadHolder(players, new Map([...lengths, [owner, after]]), holder);
        if (next !== holder) {
          if (holder !== null) add(holder, -LONGEST_ROAD_POINTS);
          if (next !== null) add(next, LONGEST_ROAD_POINTS);
        }
      }
    }
    deltaCache.set(edge, out);
    return out;
  };

  const weightOf = (viewer: string, other: string): number => {
    if (viewer === other) return 1;
    const player = view.players.find((entry) => entry.id === other);
    const close = player !== undefined && player.publicScore >= targetOf(view, other) - CLOSE_TO_WIN;
    return -(close ? LEADER_WEIGHT : OPPONENT_WEIGHT);
  };
  const valueFor = (playerId: string, edge: number): number => {
    let total = 0;
    for (const [id, delta] of deltasOf(edge)) total += weightOf(playerId, id) * delta;
    return total;
  };
  const preferred = (playerId: string): number | null => {
    let best: number | null = null;
    let bestValue = -Infinity;
    for (const edge of sorted) {
      const value = valueFor(playerId, edge);
      if (value > bestValue) {
        bestValue = value;
        best = edge;
      }
    }
    return best;
  };
  return { model, locations: sorted, valueFor, preferred };
}

/**
 * 投票的結果（放在哪條邊），依 rules 的 `afterBids`／`afterAssignments`：過半者放置；沒有人出價時行動者放置；否則各出價者
 * 投給 `assignments` 的位置（沒有的話是自己偏好的位置），票數最多者勝出，平手時出價最高者（唯一）放置，再不然是行動者。
 * 放置者一律選自己偏好的位置。
 */
export function predictOutcome(
  scene: TrainScene,
  bids: Readonly<Record<string, number>>,
  assignments: Readonly<Record<string, number>>,
  active: string,
): number | null {
  const entries = Object.entries(bids).sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  const total = entries.reduce((sum, [, votes]) => sum + votes, 0);
  if (total === 0) return scene.preferred(active);
  const majority = entries.find(([, votes]) => votes * 2 > total);
  if (majority) return scene.preferred(majority[0]);
  const tally = new Map<number, number>();
  for (const [id, votes] of entries) {
    if (votes <= 0) continue;
    const edge = assignments[id] ?? scene.preferred(id);
    if (edge === null) continue;
    tally.set(edge, (tally.get(edge) ?? 0) + votes);
  }
  if (tally.size > 0) {
    const best = Math.max(...tally.values());
    const leaders = [...tally].filter(([, votes]) => votes === best);
    if (leaders.length === 1) return leaders[0]![0];
  }
  const top = Math.max(...entries.map(([, votes]) => votes));
  const topBidders = entries.filter(([, votes]) => votes === top);
  return scene.preferred(topBidders.length === 1 ? topBidders[0]![0] : active);
}

function sceneOf(turn: TurnContext, locations: readonly number[]): TrainScene | undefined {
  return locations.length === 0 ? undefined : trainScene(turn.model, locations);
}

/** 可以放車廂的邊：trains hints 的 `locations`。 */
function locationsOf(view: GameView): readonly number[] {
  return integers(tbPartHints(view.hints, TRAINS)?.locations) ?? [];
}

/** 這一刻的盤面選擇（`board.targets`）；缺漏時退回 `locations`（rules 兩者是同一份）。 */
function choiceTargets(view: GameView, commandType: string): readonly number[] {
  const targets = tbBoardTargets(view.hints, commandType);
  return targets.length > 0 ? targets : locationsOf(view);
}

// ---------------------------------------------------------------------------
// frame
// ---------------------------------------------------------------------------

/** 主要計畫用不到的 wool 與 grain。 */
export function spareBidCards(turn: TurnContext): { wool: number; grain: number } {
  const hand = turn.economy.hand;
  const target = turn.economy.plans[0]?.cost ?? {};
  return {
    wool: Math.max(0, (hand.wool ?? 0) - (target.wool ?? 0)),
    grain: Math.max(0, (hand.grain ?? 0) - (target.grain ?? 0)),
  };
}

/** 出價的張數：比較出 0 到 `max` 張的「結果價值 − 牌的成本」，划算才出（同分取少）。 */
export function bidVotes(scene: TrainScene, vote: WagonVote, selfId: string, max: number): number {
  const bids: Record<string, number> = {};
  for (const [id, bid] of Object.entries(vote.bids)) if (id !== selfId) bids[id] = votesOf(bid);
  const net = (votes: number): number => {
    const outcome = predictOutcome(scene, { ...bids, [selfId]: votes }, {}, vote.active);
    return (outcome === null ? 0 : scene.valueFor(selfId, outcome)) - votes * BID_CARD_COST;
  };
  const base = net(0);
  let best = 0;
  let bestNet = base + MIN_BID_GAIN;
  for (let votes = 1; votes <= max; votes++) {
    const value = net(votes);
    if (value > bestNet + 1e-9) {
      best = votes;
      bestNet = value;
    }
  }
  return best;
}

function answerBid(turn: TurnContext, frame: PublicModulePendingView): BotCommand | null {
  const self = turn.ctx.selfId;
  if (!isMine(frame, self)) return null;
  const zero = command('tb.bidWagon', { wool: 0, grain: 0 });
  if (turn.level === 'easy') return zero;
  const vote = voteOf(frame);
  const scene = sceneOf(turn, locationsOf(turn.view));
  if (!vote || !scene) return zero;
  const spare = spareBidCards(turn);
  const votes = bidVotes(scene, vote, self, Math.min(MAX_BID, spare.wool + spare.grain));
  if (votes === 0) return zero;
  // 先出比較多的那一種（同數先 wool）。
  const first = spare.wool >= spare.grain ? 'wool' : 'grain';
  const other = first === 'wool' ? 'grain' : 'wool';
  const fromFirst = Math.min(votes, spare[first]);
  return command('tb.bidWagon', { [first]: fromFirst, [other]: votes - fromFirst });
}

/** 分配：讓結果對自己最好的位置；同分取對自己價值高的位置，再取編號小者。 */
export function assignEdge(scene: TrainScene, vote: WagonVote, selfId: string, targets: readonly number[]): number | null {
  const bids: Record<string, number> = {};
  for (const [id, bid] of Object.entries(vote.bids)) bids[id] = votesOf(bid);
  let best: number | null = null;
  let bestKey: [number, number] = [-Infinity, -Infinity];
  for (const edge of [...targets].sort((a, b) => a - b)) {
    const outcome = predictOutcome(scene, bids, { ...vote.assignments, [selfId]: edge }, vote.active);
    const key: [number, number] = [outcome === null ? 0 : scene.valueFor(selfId, outcome), scene.valueFor(selfId, edge)];
    if (key[0] > bestKey[0] + 1e-9 || (Math.abs(key[0] - bestKey[0]) <= 1e-9 && key[1] > bestKey[1] + 1e-9)) {
      best = edge;
      bestKey = key;
    }
  }
  return best;
}

function answerAssign(turn: TurnContext, frame: PublicModulePendingView): BotCommand | null {
  const self = turn.ctx.selfId;
  if (!isMine(frame, self)) return null;
  const targets = choiceTargets(turn.view, 'tb.assignWagon');
  if (targets.length === 0) return null;
  const vote = voteOf(frame);
  const scene = sceneOf(turn, targets);
  const edge = scene && vote ? assignEdge(scene, vote, self, targets) : scene?.preferred(self);
  return command('tb.assignWagon', { edge: edge ?? targets[0]! });
}

function answerPlace(turn: TurnContext, frame: PublicModulePendingView): BotCommand | null {
  const self = turn.ctx.selfId;
  if (!isMine(frame, self)) return null;
  const targets = choiceTargets(turn.view, 'tb.placeWagon');
  if (targets.length === 0) return null;
  const edge = sceneOf(turn, targets)?.preferred(self) ?? targets[0]!;
  return command('tb.placeWagon', { edge });
}

// ---------------------------------------------------------------------------
// 計畫
// ---------------------------------------------------------------------------

function planOf(input: PlanInput, plan: Omit<Plan, 'eta' | 'score'>, extraEta = 0): Plan {
  const { base, model } = input;
  const eta = etaRounds(base.hand, plan.cost, base.yield, base.rates, model.view.players.length, base.kinds) + extraEta;
  return { ...plan, eta, score: plan.value / (1 + eta) };
}

/** 一條合法道路就能以加權長度拿下最長道路（自己還不是持有者）；取路線最長者，同分取編號小者。 */
function trainRoadPlan(input: PlanInput, wagons: ReadonlySet<number>): Plan | null {
  const { model, base } = input;
  const { view, selfId } = model;
  if (base.left.roads <= 0 || wagons.size === 0) return null;
  const legal = view.hints?.legalRoads ?? [];
  if (legal.length === 0) return null;
  const players = view.players.map((player) => ({ id: player.id, seat: player.seat }));
  const lengths = new Map(players.map((player) => [player.id, weightedRoute(model, player.id, wagons)]));
  const holder = longestRoadHolder(players, lengths, view.awards.longestRoad);
  if (holder === selfId) return null;
  let best: number | null = null;
  let bestLength = -1;
  for (const edge of [...legal].sort((a, b) => a - b)) {
    const length = weightedRoute(model, selfId, wagons, edge);
    if (length <= bestLength) continue;
    if (longestRoadHolder(players, new Map([...lengths, [selfId, length]]), holder) !== selfId) continue;
    best = edge;
    bestLength = length;
  }
  if (best === null) return null;
  return planOf(input, {
    kind: TRAIN_ROAD_PLAN,
    vertex: null,
    roads: [best],
    ships: [],
    cost: COSTS.road,
    nextCost: COSTS.road,
    value: TRAIN_ROAD_VALUE,
    immediate: true,
  });
}

/** 夾在兩節車廂之間的空路口：聚落多 `BETWEEN_WAGONS_POINTS`。路徑與折價同 base 的聚落計畫。 */
function wagonSettlementPlans(input: PlanInput, between: readonly number[]): Plan[] {
  const { model, base } = input;
  if (base.left.settlements <= 0) return [];
  const legalNow = new Set(model.view.hints?.legalSettlements ?? []);
  const longTerm = playerYield(model, model.selfId, true);
  const out: Plan[] = [];
  for (const vertex of [...new Set(between)].sort((a, b) => a - b)) {
    const distance = base.search.distance[vertex];
    if (distance === undefined || distance === Infinity || !isFreeSpot(model, vertex)) continue;
    if (distance === 0 && !legalNow.has(vertex)) continue;
    const roads = distance === 0 ? [] : roadPath(base.search, vertex);
    if (roads.length > base.left.roads) continue;
    const spot = 1 + PIP_VALUE * settlementSpotValue(model, vertex, base.weights, longTerm);
    out.push(
      planOf(
        input,
        {
          kind: WAGON_SETTLEMENT_PLAN,
          vertex,
          roads,
          ships: [],
          cost: addCosts(COSTS.settlement, scaleCost(COSTS.road, roads.length)),
          nextCost: roads.length > 0 ? COSTS.road : COSTS.settlement,
          value: (spot + BETWEEN_WAGONS_POINTS) * 0.9 ** roads.length,
          immediate: roads.length === 0,
        },
        roads.length * 0.35,
      ),
    );
  }
  return out;
}

function scoreExtras(input: PlanInput): readonly Plan[] {
  if (input.level === 'easy') return [];
  const trains = trainsView(input.model.view);
  if (!trains) return [];
  const wagons = new Set(trains.wagons.map((wagon) => wagon.edge));
  const road = trainRoadPlan(input, wagons);
  const between = integers(trains.betweenWagons) ?? [];
  return [...(road ? [road] : []), ...wagonSettlementPlans(input, between)];
}

/**
 * 付得起時，夾在兩節車廂之間的合法聚落點：分數同骨架的立即建造（`1 + PIP_VALUE × 點值`）再加 `BETWEEN_WAGONS_POINTS`，
 * 去重後取代 base 對同一點的候選（只有 standard）。
 */
function actions(turn: TurnContext): Scored<BotCommand>[] {
  if (turn.level === 'easy') return [];
  const { model, economy, view } = turn;
  const between = integers(trainsView(view)?.betweenWagons) ?? [];
  if (between.length === 0 || economy.left.settlements <= 0 || !canAfford(economy.hand, COSTS.settlement)) return [];
  const legal = new Set(view.hints?.legalSettlements ?? []);
  const mine = playerYield(model, model.selfId, true);
  return [...new Set(between)]
    .filter((vertex) => legal.has(vertex))
    .sort((a, b) => a - b)
    .map((vertex) => ({
      item: { type: 'build.settlement', vertex },
      score: 1 + PIP_VALUE * settlementSpotValue(model, vertex, economy.weights, mine) + BETWEEN_WAGONS_POINTS,
    }));
}

function planStep(turn: TurnContext, plan: Plan): BotCommand | null | undefined {
  if (plan.kind !== TRAIN_ROAD_PLAN && plan.kind !== WAGON_SETTLEMENT_PLAN) return undefined;
  const hints = turn.view.hints;
  if (!hints) return null;
  const economy = turn.economy;
  const edge = plan.roads[0];
  if (edge !== undefined) {
    return hints.legalRoads.includes(edge) && economy.left.roads > 0 ? { type: 'build.road', edge } : null;
  }
  if (plan.kind !== WAGON_SETTLEMENT_PLAN || plan.vertex === null) return null;
  return hints.legalSettlements.includes(plan.vertex) && economy.left.settlements > 0
    ? { type: 'build.settlement', vertex: plan.vertex }
    : null;
}

export const trainsBot: TbPartBot = {
  id: TRAINS,
  answerFrame(turn, frame) {
    switch (frame.kind) {
      case TB_FRAME_KINDS.wagonBid:
        return answerBid(turn, frame);
      case TB_FRAME_KINDS.wagonAssign:
        return answerAssign(turn, frame);
      case TB_FRAME_KINDS.wagonPlace:
        return answerPlace(turn, frame);
      default:
        return undefined;
    }
  },
  actions,
  planStep,
  economy: { scoreExtras },
};
