/**
 * 經濟評估：手牌、成本缺口、資源權重、產能速率與建造計畫。
 */

import { CARD_KINDS, COMMODITIES, COSTS, RESOURCES, type CardKind, type Commodity, type Resource } from '@catan/rules';
import {
  cityUpgradeYield,
  emptyYield,
  isFreeSpot,
  piecesLeft,
  playerYield,
  roadPath,
  routeLength,
  searchRoads,
  vertexYield,
  yieldTotal,
  type BoardModel,
  type PieceCounts,
  type RoadSearch,
  type Yield,
} from './board.ts';
import type { BotModule } from './modules/types.ts';
import type { BotLevel } from './types.ts';

/**
 * 手牌：資源恆有值；commodity（C&K）只在持有時才寫入，讀取一律 `?? 0`，base 的物件形狀與只有資源時相同。
 * 型別與 `Yield` 相同，權重與匯率也用它。
 */
export type Hand = Record<Resource, number> & Partial<Record<Commodity, number>>;
/** 各卡種的權重或匯率：資源恆有值，commodity 只在模組回答時才有。 */
export type KindTable = Record<Resource, number> & Partial<Record<Commodity, number>>;
export type Cost = Partial<Record<CardKind, number>>;

/** 建造計畫所需的最多新道路數；更遠的空點視為暫時到不了。 */
export const MAX_PLAN_ROADS = 3;

/**
 * 自己（或手牌可見者）的手牌。張數類的函式（`handSize`、`addCosts`、`scaleCost`、`deficitOf`、`canAfford`、
 * `pay`）一律走 `CARD_KINDS`，不經模組的 `cardKinds` 鉤子（E-3）：保底沒有模型、不得 throw，naive 座位也要
 * 算對棄牌張數。base 的 commodity 恆為 0，結果與只有資源時相同。
 */
export function handOf(model: BoardModel, playerId: string = model.selfId): Hand {
  const player = model.view.players.find((candidate) => candidate.id === playerId);
  const hand: Hand = player?.resources ? { ...player.resources } : { ...emptyYield() };
  for (const commodity of COMMODITIES) {
    const amount = player?.commodities?.[commodity];
    if (typeof amount === 'number' && amount > 0) hand[commodity] = amount;
  }
  return hand;
}

export function handSize(hand: Hand): number {
  return CARD_KINDS.reduce((sum, kind) => sum + (hand[kind] ?? 0), 0);
}

export function addCosts(...costs: Cost[]): Cost {
  const out: Cost = {};
  for (const cost of costs) {
    for (const kind of CARD_KINDS) {
      const amount = cost[kind] ?? 0;
      if (amount > 0) out[kind] = (out[kind] ?? 0) + amount;
    }
  }
  return out;
}

export function scaleCost(cost: Cost, factor: number): Cost {
  const out: Cost = {};
  for (const kind of CARD_KINDS) {
    const amount = (cost[kind] ?? 0) * factor;
    if (amount > 0) out[kind] = amount;
  }
  return out;
}

/** 各卡種還缺幾張；commodity 只在有缺口時才寫入。 */
export function deficitOf(hand: Hand, cost: Cost): Hand {
  const out: Hand = { ...emptyYield() };
  for (const resource of RESOURCES) out[resource] = Math.max(0, (cost[resource] ?? 0) - hand[resource]);
  for (const commodity of COMMODITIES) {
    const missing = (cost[commodity] ?? 0) - (hand[commodity] ?? 0);
    if (missing > 0) out[commodity] = missing;
  }
  return out;
}

export function canAfford(hand: Hand, cost: Cost): boolean {
  return CARD_KINDS.every((kind) => (hand[kind] ?? 0) >= (cost[kind] ?? 0));
}

export function pay(hand: Hand, cost: Cost): Hand {
  const out = { ...hand };
  for (const resource of RESOURCES) out[resource] -= cost[resource] ?? 0;
  for (const commodity of COMMODITIES) {
    const amount = cost[commodity] ?? 0;
    if (amount > 0) out[commodity] = (hand[commodity] ?? 0) - amount;
  }
  return out;
}

/** 依盤面稀有度調整的資源權重：越少見的資源越有價值。 */
export function resourceWeights(model: BoardModel): Record<Resource, number> {
  const totals = emptyYield();
  model.hexResource.forEach((resource, hex) => {
    if (resource) totals[resource] += model.hexPips[hex]!;
  });
  const mean = yieldTotal(totals) / RESOURCES.length;
  const out = { ...emptyYield() };
  for (const resource of RESOURCES) {
    const ratio = totals[resource] > 0 ? mean / totals[resource] : 1.4;
    out[resource] = Math.min(1.3, Math.max(0.8, Math.sqrt(ratio)));
  }
  return out;
}

/** 加權點數；commodity 的權重缺漏視為 0（模組沒有給它估值）。 */
export function weightedPips(value: Yield, weights: KindTable): number {
  let sum = RESOURCES.reduce((total, resource) => total + value[resource] * weights[resource], 0);
  for (const commodity of COMMODITIES) {
    const amount = value[commodity];
    if (amount) sum += amount * (weights[commodity] ?? 0);
  }
  return sum;
}

/**
 * 路口鄰接的金礦點數總和（Seafarers）。金礦的資源由擲出時的玩家任選，不在 `hexResource` 內，所以
 * `vertexYield` 看不到它。沒有金礦的盤面（base）恆為 0，下面所有依它加分的估值都不會變動。
 */
export function goldPipsAt(model: BoardModel, vertex: number): number {
  let pips = 0;
  for (const hex of model.topo.vertices[vertex]!.hexes) {
    if (model.hexGold[hex]) pips += model.hexPips[hex]!;
  }
  return pips;
}

/** 一張萬用資源的權重：可以挑目前最缺的資源，所以取各資源權重的最大值。 */
export function wildcardWeight(weights: KindTable): number {
  return Math.max(...RESOURCES.map((resource) => weights[resource]));
}

/**
 * 一座建築的點數產能價值（加權後）。金礦以一張萬用資源計價：聚落一張、城市兩張，所以升級城市時
 * 多得的就是這一張。沒有金礦與模組產出鉤子時與 `weightedPips(vertexYield(...))` 完全相同；模組的
 * `hexYield` 回答時，以城市減聚落的產能差計價（C&K：森林上的城市多得一張 paper，不是多一張木材）。
 */
export function productionValue(model: BoardModel, vertex: number, weights: KindTable): number {
  const value = weightedPips(cityUpgradeYield(model, vertex), weights);
  const gold = goldPipsAt(model, vertex);
  return gold > 0 ? value + gold * wildcardWeight(weights) : value;
}

export type BasePlanKind = 'city' | 'settlement' | 'devCard' | 'longestRoad';
/** base 的四種計畫，加上模組計畫（kind 為 `<module id>.<名稱>`）。 */
export type PlanKind = BasePlanKind | `${string}.${string}`;

export interface Plan {
  kind: PlanKind;
  /** 目標路口（城市、聚落）。 */
  vertex: number | null;
  /** 需要先建的道路，依建造順序排列。 */
  roads: number[];
  /**
   * 需要先造的船（edge index），依建造順序排列；base 計畫恆為 `[]`。模組計畫（例如 Seafarers 的
   * 島嶼聚落）才會有值。省略時視為 `[]`：已有的模組計畫字面值不必逐一補上。
   */
  ships?: number[];
  /** 整個計畫的總成本（含道路）。 */
  cost: Cost;
  /** 下一步的成本：道路未完成時為一條道路，否則為目標本身。 */
  nextCost: Cost;
  /** 以勝利分為單位的估計價值。 */
  value: number;
  /** 估計還要幾輪才能湊齊資源。 */
  eta: number;
  score: number;
  /** 下一步完成就得分（主動開價的條件）；省略時：city，或 roads 為空的 settlement。 */
  immediate?: boolean;
}

/** 計畫完成後是否立即得分（見 `Plan.immediate`）。 */
export function isImmediate(plan: Plan): boolean {
  return plan.immediate ?? (plan.kind === 'city' || (plan.kind === 'settlement' && plan.roads.length === 0));
}

export interface Economy {
  readonly model: BoardModel;
  /** 這局的卡種清單：`RESOURCES` 加上各模組的 `cardKinds`。估值類迴圈（效用、棄牌、ETA）依它。 */
  readonly kinds: readonly CardKind[];
  readonly hand: Hand;
  /** 剩餘棋子；模組可加上自己的鍵（例如 ships），也可覆寫 base 的鍵。 */
  readonly left: Readonly<PieceCounts> & Readonly<Record<string, number>>;
  /** base 的四種成本，加上模組的具名成本。 */
  readonly costs: Readonly<Record<string, Cost>>;
  /** 資源權重（base）加上模組卡種的權重；模組卡種沒有人給權重時為 0。 */
  readonly weights: KindTable;
  /** 自己目前（排除強盜格）的點數產能。 */
  readonly yield: Yield;
  /** 銀行匯率：資源讀 `hints.bankRates`；模組卡種只在模組給了匯率時才有，缺漏表示不能與銀行交易。 */
  readonly rates: KindTable;
  readonly search: RoadSearch;
  readonly myRoute: number;
  readonly plans: Plan[];
}

export const PIP_VALUE = 0.07;

export function settlementSpotValue(model: BoardModel, vertex: number, weights: KindTable, mine: Yield): number {
  const spot = vertexYield(model, vertex);
  let value = weightedPips(spot, weights);
  for (const resource of RESOURCES) {
    if (spot[resource] > 0 && mine[resource] === 0) value += 2.5;
  }
  // 金礦：點數以萬用資源計價；它也能補上任何一種還沒有產能的資源（只算一次）。
  const gold = goldPipsAt(model, vertex);
  if (gold > 0) {
    value += gold * wildcardWeight(weights);
    if (RESOURCES.some((resource) => spot[resource] === 0 && mine[resource] === 0)) value += 2.5;
  }
  const harbor = model.harborAt[vertex];
  if (harbor === 'generic') value += 1.5;
  else if (harbor && mine[harbor as Resource] + spot[harbor as Resource] >= 4) value += 2.5;
  return value;
}

/**
 * 依缺口與產能估計湊齊成本需要的輪數；過剩的牌可先以銀行匯率換成缺口。`kinds` 是估值的卡種清單
 * （`Economy.kinds`），省略時只有資源；沒有匯率的卡種不能換匯。
 */
export function etaRounds(
  hand: Hand,
  cost: Cost,
  mine: Yield,
  rates: KindTable,
  players: number,
  kinds: readonly CardKind[] = RESOURCES,
): number {
  const missing = deficitOf(hand, cost);
  let total = kinds.reduce((sum, kind) => sum + (missing[kind] ?? 0), 0);
  if (total === 0) return 0;
  let tradeable = 0;
  for (const kind of kinds) {
    const surplus = (hand[kind] ?? 0) - (cost[kind] ?? 0);
    const rate = rates[kind];
    if (surplus > 0 && rate !== undefined) tradeable += Math.floor(surplus / rate);
  }
  const covered = Math.min(total, tradeable);
  total -= covered;
  if (total === 0) return 0.25;
  // 每輪有 players 次擲骰；以期望產量估算，換匯能力取最好的匯率。
  const perRound = (kind: CardKind) => ((mine[kind] ?? 0) * players) / 36;
  const income = kinds.reduce((sum, kind) => sum + perRound(kind), 0);
  let bestRate = Infinity;
  for (const kind of kinds) bestRate = Math.min(bestRate, rates[kind] ?? Infinity);
  const viaTrade = income / bestRate / 2;
  let rounds = 0;
  let remaining = covered;
  // 換匯先補產量最低的缺口。
  const order = kinds.slice().sort((a, b) => perRound(a) - perRound(b));
  for (const kind of order) {
    let need = missing[kind] ?? 0;
    const used = Math.min(need, remaining);
    need -= used;
    remaining -= used;
    if (need > 0) rounds += need / Math.max(perRound(kind), viaTrade, 0.05);
  }
  return rounds;
}

/** 依序合併；同一個鍵先出現的值優先。 */
function mergeFirstWins<T>(layers: readonly Readonly<Record<string, T>>[]): Record<string, T> {
  const out: Record<string, T> = {};
  for (const layer of layers) {
    for (const [key, value] of Object.entries(layer)) {
      if (!Object.hasOwn(out, key)) out[key] = value;
    }
  }
  return out;
}

/**
 * 經濟評估：base 加上各模組的 economy 鉤子。模組清單為空時，結果與只有 base 完全相同。
 * 模組計畫同分時排在 base 種類之後。
 */
export function economyOf(
  model: BoardModel,
  modules: readonly BotModule[] = [],
  level: BotLevel = 'standard',
): Economy {
  const base = baseEconomyOf(model, modules);
  // 不遞迴：scoreExtras 拿不到 TurnContext，只看 base 經濟。
  const extras: Plan[] = [];
  for (const module of modules) extras.push(...(module.economy?.scoreExtras?.({ model, level, base }) ?? []));
  if (extras.length === 0) return base;
  return { ...base, plans: [...base.plans, ...extras].sort(comparePlans) };
}

/** 卡種清單：`RESOURCES` 在前，依模組順序附加模組的 `cardKinds`、去重；沒有模組卡種時就是 `RESOURCES`。 */
function kindsOf(model: BoardModel, modules: readonly BotModule[]): readonly CardKind[] {
  let out: CardKind[] | null = null;
  for (const module of modules) {
    for (const kind of module.economy?.cardKinds?.(model) ?? []) {
      if (RESOURCES.includes(kind as Resource) || (out ?? []).includes(kind)) continue;
      out ??= [];
      out.push(kind);
    }
  }
  return out ? [...RESOURCES, ...out] : RESOURCES;
}

/** 模組給的數值表，只取 `extra` 內的卡種；每個卡種先回答的模組優先，非有限正數視為沒有回答。 */
function moduleTable(
  extra: readonly CardKind[],
  layers: readonly (Readonly<Partial<Record<CardKind, number>>> | undefined)[],
  allowZero: boolean,
): Partial<Record<CardKind, number>> {
  const out: Partial<Record<CardKind, number>> = {};
  for (const kind of extra) {
    for (const layer of layers) {
      const value = layer?.[kind];
      if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || (!allowZero && value === 0)) continue;
      out[kind] = value;
      break;
    }
  }
  return out;
}

function baseEconomyOf(model: BoardModel, modules: readonly BotModule[]): Economy {
  const { view, selfId } = model;
  const hand = handOf(model);
  const kinds = kindsOf(model, modules);
  const extraKinds = kinds.slice(RESOURCES.length);
  const left = {
    ...piecesLeft(model, selfId),
    ...mergeFirstWins(modules.map((module) => module.economy?.piecesLeft?.(model) ?? {})),
  };
  // base 的鍵不可覆寫：base 計畫直接讀 COSTS。
  const costs = {
    ...mergeFirstWins(modules.map((module) => module.economy?.costs?.(model) ?? {})),
    ...COSTS,
  };
  // 模組只回答自己的卡種（E-4）：資源權重與資源匯率維持 base，模組回傳的資源鍵一律忽略。
  const weights: KindTable =
    extraKinds.length === 0
      ? resourceWeights(model)
      : {
          ...resourceWeights(model),
          // 缺漏的模組卡種權重為 0。
          ...Object.fromEntries(extraKinds.map((kind) => [kind, 0])),
          ...moduleTable(extraKinds, modules.map((module) => module.economy?.weights?.(model)), true),
        };
  const mine = playerYield(model, selfId);
  const longTerm = playerYield(model, selfId, true);
  const bankRates = view.hints?.bankRates ?? { lumber: 4, brick: 4, wool: 4, grain: 4, ore: 4 };
  const rates: KindTable =
    extraKinds.length === 0
      ? bankRates
      : { ...bankRates, ...moduleTable(extraKinds, modules.map((module) => module.economy?.rates?.(model)), false) };
  const search = searchRoads(model, selfId, Math.min(MAX_PLAN_ROADS, Math.max(0, left.roads)));
  const players = view.players.length;
  const me = view.players.find((player) => player.id === selfId);
  const plans: Plan[] = [];
  const push = (plan: Omit<Plan, 'eta' | 'score'>): void => {
    const eta = etaRounds(hand, plan.cost, mine, rates, players, kinds);
    plans.push({ ...plan, eta, score: plan.value / (1 + eta) });
  };

  // 城市：選產能最高的聚落升級。
  if (left.cities > 0) {
    let best = -1;
    let bestValue = -Infinity;
    view.board.buildings.forEach((building, vertex) => {
      if (!building || building.player !== selfId || building.city) return;
      const value = productionValue(model, vertex, weights);
      if (value > bestValue) {
        bestValue = value;
        best = vertex;
      }
    });
    if (best >= 0) {
      push({
        kind: 'city',
        vertex: best,
        roads: [],
        ships: [],
        cost: COSTS.city,
        nextCost: COSTS.city,
        value: 1 + PIP_VALUE * bestValue,
      });
    }
  }

  // 聚落：道路網可達、且符合距離規則的空點。
  if (left.settlements > 0) {
    const legalNow = new Set(view.hints?.legalSettlements ?? []);
    const candidates: Plan[] = [];
    for (let vertex = 0; vertex < model.topo.vertices.length; vertex++) {
      const distance = search.distance[vertex]!;
      if (distance === Infinity || !isFreeSpot(model, vertex)) continue;
      const roads = distance === 0 ? [] : roadPath(search, vertex);
      if (distance === 0 && !legalNow.has(vertex)) continue;
      if (roads.length > left.roads) continue;
      const roadCost = scaleCost(COSTS.road, roads.length);
      const cost = addCosts(COSTS.settlement, roadCost);
      // 越遠越可能被別人搶先，價值打折。
      const value = (1 + PIP_VALUE * settlementSpotValue(model, vertex, weights, longTerm)) * 0.9 ** roads.length;
      const eta = etaRounds(hand, cost, mine, rates, players, kinds) + roads.length * 0.35;
      candidates.push({
        kind: 'settlement',
        vertex,
        roads,
        ships: [],
        cost,
        nextCost: roads.length > 0 ? COSTS.road : COSTS.settlement,
        value,
        eta,
        score: value / (1 + eta),
      });
    }
    candidates.sort((a, b) => b.score - a.score || a.vertex! - b.vertex!);
    plans.push(...candidates.slice(0, 3));
  }

  // 發展卡：牌庫非空就是一條穩定的得分路線；接近最大騎士團時加值。
  if (view.devDeckSize > 0) {
    let value = 0.55;
    const myKnights = me?.playedKnights ?? 0;
    const holder = view.awards.largestArmy;
    const holderKnights = holder ? view.players.find((player) => player.id === holder)?.playedKnights ?? 0 : 0;
    if (holder !== selfId && myKnights + 2 >= Math.max(3, holderKnights + 1)) value += 0.25;
    // 沒有聚落點也沒有城市可蓋時，發展卡是剩下的得分路線。
    if (!plans.some((plan) => plan.kind === 'settlement' || plan.kind === 'city')) value += 0.3;
    push({ kind: 'devCard', vertex: null, roads: [], ships: [], cost: COSTS.devCard, nextCost: COSTS.devCard, value });
  }

  // 最長道路：差一兩條就能拿到時才值得專門投資。
  const myRoute = routeLength(model, selfId);
  if (left.roads > 0) {
    const holder = view.awards.longestRoad;
    if (holder !== selfId) {
      const holderLength = holder ? view.players.find((player) => player.id === holder)?.longestRoadLength ?? 0 : 0;
      const needed = Math.max(5, holderLength + 1) - myRoute;
      if (needed >= 1 && needed <= 2 && needed <= left.roads) {
        const edge = bestRouteEdge(model, view.hints?.legalRoads ?? [], myRoute);
        if (edge !== null) {
          push({
            kind: 'longestRoad',
            vertex: null,
            roads: [edge],
            ships: [],
            cost: scaleCost(COSTS.road, needed),
            nextCost: COSTS.road,
            value: needed === 1 ? 1.8 : 1.4,
          });
        }
      }
    }
  }

  plans.sort(comparePlans);
  return { model, kinds, hand, left, costs, weights, yield: mine, rates, search, myRoute, plans };
}

function comparePlans(a: Plan, b: Plan): number {
  return b.score - a.score || planOrder(a) - planOrder(b);
}

const BASE_KIND_ORDER: readonly string[] = ['city', 'settlement', 'longestRoad', 'devCard'];

/**
 * base 種類依序為 0–3，再以路口編號打破同分（路口數最多 174，間距 1000 不會重疊）。模組計畫一律
 * 排在後面，而且共用同一個鍵、不加路口編號：同分時靠穩定排序保留串接順序，也就是先依模組順序、
 * 再依模組內的順序；若以路口編號排序，後面模組的計畫可能插到前面模組的計畫之前。
 */
function planOrder(plan: Plan): number {
  const rank = BASE_KIND_ORDER.indexOf(plan.kind);
  if (rank < 0) return BASE_KIND_ORDER.length * 1000;
  return rank * 1000 + (plan.vertex ?? 0);
}

/** 能讓自己最長道路變長的合法道路；沒有則回傳 null。 */
export function bestRouteEdge(model: BoardModel, legalRoads: readonly number[], current: number): number | null {
  let best: number | null = null;
  let bestLength = current;
  for (const edge of legalRoads) {
    const length = routeLength(model, model.selfId, [edge]);
    if (length > bestLength) {
      bestLength = length;
      best = edge;
    }
  }
  return best;
}
