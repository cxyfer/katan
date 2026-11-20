/**
 * Barbarian Attack 的策略（T&B 計畫 §4.2）。
 *
 * 規則重點（`TB/barbarians/index.ts`）：每蓋一座聚落或城市，海岸最多落下 3 個蠻族；一格 3 個就被征服（不生產，只碰被征服格的
 * 建築不計分）。每個回合結束時，海岸格的邊上騎士數多於蠻族數就驅逐，蠻族變成俘虜（2 個 = 1 VP）。騎士只在主人的回合結束時移動
 * （射程 3，花 1 grain 射程 5），停在城堡邊的騎士一定要移走。
 *
 * - BA 卡（`tradersBarbarians.baCard` 計畫）：基本價值加上「自己的建築受到的威脅」；沒有騎士可放時打折。付得起又不動用主要計畫
 *   的牌時，骨架的步驟 (c) 也會買。
 * - 騎士（`baKnights`、`baKnighthood`、`baSwiftKnight`）：以 `sceneValue` 評估盤面：可驅逐的格給俘虜與解圍的價值，差一點的格給
 *   部分價值，沒有用上的騎士依離蠻族的距離扣分。每次只送一步，下一次從新的投影重新評估。standard 只在 grain 夠時才加速；easy 不加速。
 * - Capture 選解圍最多的格；Treason 選最傷害領先者的走法（easy 取第一個）；偷牌選手牌最多的對手。
 * - 被征服的格不生產：`economy.hexYield` 回 `{}`（§12.2）。BA 給的 gold 由 coins part 估值，這裡不管。
 *
 * 只讀投影與 hints，合法性一律以 hints 為準（P2）；不消耗亂數，同分依編號（先出現者）決勝。
 */

import { BA_CARD_COST, CONQUER_AT, type BoardTopology, type GameView, type TbBarbarianAttackView } from '@catan/rules';
import type { BoardModel } from '../../board.ts';
import { etaRounds, type Plan } from '../../economy.ts';
import type { BotCommand, PlanInput, TurnContext } from '../types.ts';
import { isMine, TB_FRAME_KINDS } from './frames.ts';
import type { TbPartBot } from './part.ts';
import { integers, TB_PART_IDS, tbBoardTargets, tbPartHints, tbPartView } from './view.ts';

const BA = TB_PART_IDS.barbarianAttack;
export const BA_CARD_PLAN = 'tradersBarbarians.baCard' as const;

/** 一個俘虜的價值（2 個 = 1 VP）。 */
const PRISONER_VALUE = 0.5;
/** 依蠻族數的威脅係數：3 個時整格被征服。 */
const THREAT: readonly number[] = [0, 0.15, 0.45, 1];
/** 還差幾個騎士才能驅逐的格：依已到位的比例給這個比例的價值。 */
const PROGRESS = 0.35;
/** 沒有用上的騎士，離最近的蠻族每遠一步扣的價值。 */
const DISTANCE_COST = 0.03;
/** 走不到時當成的距離。 */
const FAR = 9;
/** 加速花 1 grain 的成本（與價值同尺度）。 */
const BOOST_COST = 0.15;
/** 小於這個差值的移動不做。 */
const EPSILON = 1e-6;
/** BA 卡計畫：基本價值、沒有騎士可放時的價值、威脅加值的倍率與上限、差一個俘虜就得分時的加值。 */
const CARD_VALUE = { base: 0.5, noKnights: 0.25, threat: 0.6, threatCap: 0.6, oddPrisoner: 0.1 } as const;

type BaView = TbBarbarianAttackView;
type Knight = { readonly player: string; readonly edge: number };

const command = (type: string, fields: Record<string, unknown> = {}): BotCommand => ({ type, ...fields }) as BotCommand;

function baView(view: Pick<GameView, 'modules'>): BaView | undefined {
  const ba = tbPartView(view, BA);
  return ba && Array.isArray(ba.coastal) && Array.isArray(ba.knights) ? ba : undefined;
}

// ---------------------------------------------------------------------------
// 盤面
// ---------------------------------------------------------------------------

const edgesByHex = new WeakMap<BoardTopology, readonly (readonly number[])[]>();

/** 每格的邊（拓樸是純幾何資料，快取不影響決定性）。 */
function hexEdges(topo: BoardTopology): readonly (readonly number[])[] {
  let table = edgesByHex.get(topo);
  if (!table) {
    const out: number[][] = topo.hexes.map(() => []);
    topo.edges.forEach((info, edge) => info.hexes.forEach((hex) => out[hex]?.push(edge)));
    table = out;
    edgesByHex.set(topo, table);
  }
  return table;
}

const barbariansOn = (ba: BaView, hex: number): number => ba.barbarians[hex] ?? 0;

/** 海岸格的集合；以投影的陣列為鍵快取（投影不會被原地修改）。 */
const coastalSets = new WeakMap<readonly number[], ReadonlySet<number>>();
function coastalSet(ba: BaView): ReadonlySet<number> {
  let set = coastalSets.get(ba.coastal);
  if (!set) {
    set = new Set(ba.coastal);
    coastalSets.set(ba.coastal, set);
  }
  return set;
}

/**
 * `playerId` 在這一格的利害：建築的產能（城市加倍），加上「只碰海岸格」的建築被征服時失去的分數（城市 2、聚落 1，打五折）。
 */
function stakeOf(model: BoardModel, ba: BaView, playerId: string, hex: number): number {
  const coastal = coastalSet(ba);
  let stake = 0;
  for (const vertex of model.hexVertices[hex] ?? []) {
    const building = model.view.board.buildings[vertex];
    if (building?.player !== playerId) continue;
    const weight = building.city ? 2 : 1;
    stake += model.hexPips[hex]! * weight * 0.05;
    if (model.topo.vertices[vertex]!.hexes.every((other) => coastal.has(other))) stake += weight * 0.5;
  }
  return stake;
}

/** `playerId` 受到的威脅：各海岸格的利害乘上蠻族數的威脅係數。`barbarians` 可以是假設的蠻族數。 */
function threatOf(model: BoardModel, ba: BaView, playerId: string, barbarians: (hex: number) => number): number {
  let total = 0;
  for (const hex of ba.coastal) total += stakeOf(model, ba, playerId, hex) * (THREAT[Math.min(CONQUER_AT, barbarians(hex))] ?? 1);
  return total;
}

/** 從有蠻族的格的邊出發，到每條邊的步數（多源 BFS；沒有蠻族時以所有海岸格為目標）。 */
function distanceToBarbarians(topo: BoardTopology, ba: BaView, barbarians: (hex: number) => number): number[] {
  const byHex = hexEdges(topo);
  let hexes = ba.coastal.filter((hex) => barbarians(hex) > 0);
  if (hexes.length === 0) hexes = ba.coastal;
  const distance = topo.edges.map(() => FAR);
  let frontier = [...new Set(hexes.flatMap((hex) => byHex[hex] ?? []))].sort((a, b) => a - b);
  for (const edge of frontier) distance[edge] = 0;
  for (let step = 1; step < FAR && frontier.length > 0; step++) {
    const next: number[] = [];
    for (const edge of frontier) {
      for (const vertex of topo.edges[edge]!.vertices) {
        for (const other of topo.vertices[vertex]!.edges) {
          if (distance[other]! <= step) continue;
          distance[other] = step;
          next.push(other);
        }
      }
    }
    frontier = next;
  }
  return distance;
}

/** 一次評估共用的盤面：蠻族數、各格驅逐後自己的解圍價值、到蠻族的距離（騎士的擺法另外傳入）。 */
interface Scene {
  readonly model: BoardModel;
  readonly ba: BaView;
  readonly selfId: string;
  readonly barbarians: (hex: number) => number;
  readonly relief: ReadonlyMap<number, number>;
  readonly distance: readonly number[];
}

function sceneOf(model: BoardModel, ba: BaView, barbarians: (hex: number) => number = (hex) => barbariansOn(ba, hex)): Scene {
  const relief = new Map<number, number>();
  for (const hex of ba.coastal) {
    const count = barbarians(hex);
    if (count > 0) relief.set(hex, stakeOf(model, ba, model.selfId, hex) * (THREAT[Math.min(CONQUER_AT, count)] ?? 1));
  }
  return { model, ba, selfId: model.selfId, barbarians, relief, distance: distanceToBarbarians(model.topo, ba, barbarians) };
}

/** 驅逐時自己大約拿到幾個俘虜：獨自驅逐全拿，與別人一起時依騎士比例（至少 1 個，蠻族夠分時）。 */
function myPrisoners(barbarians: number, mine: number, others: number): number {
  if (mine === 0) return 0;
  if (others === 0) return barbarians;
  return Math.max(Math.min(1, barbarians), (barbarians * mine) / (mine + others));
}

/**
 * 騎士擺成 `knights` 時，這個盤面對自己的價值：會被驅逐的格給俘虜與解圍，差幾個騎士的格依到位比例給部分價值，
 * 沒有挨著蠻族的己方騎士依距離扣分。只比較同一個盤面上的不同擺法，所以常數項（例如別人驅逐的解圍）沒有影響。
 */
function sceneValue(scene: Scene, knights: readonly Knight[]): number {
  const { model, ba, selfId, barbarians } = scene;
  const byHex = hexEdges(model.topo);
  let total = 0;
  const useful = new Set<number>();
  for (const hex of ba.coastal) {
    const count = barbarians(hex);
    if (count <= 0) continue;
    const edges = new Set(byHex[hex] ?? []);
    let mine = 0;
    let others = 0;
    for (const knight of knights) {
      if (!edges.has(knight.edge)) continue;
      if (knight.player === selfId) {
        mine += 1;
        useful.add(knight.edge);
      } else {
        others += 1;
      }
    }
    const relief = scene.relief.get(hex) ?? 0;
    const have = mine + others;
    if (have > count) total += myPrisoners(count, mine, others) * PRISONER_VALUE + relief;
    else if (mine > 0) total += PROGRESS * (have / (count + 1)) * (myPrisoners(count, mine, others) * PRISONER_VALUE + relief);
  }
  for (const knight of knights) {
    if (knight.player === selfId && !useful.has(knight.edge)) total -= DISTANCE_COST * (scene.distance[knight.edge] ?? FAR);
  }
  return total;
}

/** 對手中的領先者：公開分數最高，同分取座位順序在前者。 */
function leaderOf(view: GameView, selfId: string): string | null {
  let best: { id: string; score: number } | null = null;
  for (const player of view.players) {
    if (player.id === selfId) continue;
    if (!best || player.publicScore > best.score) best = { id: player.id, score: player.publicScore };
  }
  return best?.id ?? null;
}

// ---------------------------------------------------------------------------
// frame
// ---------------------------------------------------------------------------

/** 依分數挑最高者；同分保留先出現的。 */
function best<T>(items: readonly T[], score: (item: T) => number): { item: T; score: number } | null {
  let out: { item: T; score: number } | null = null;
  for (const item of items) {
    const value = score(item);
    if (!out || value > out.score + EPSILON) out = { item, score: value };
  }
  return out;
}

/** 回合結束的騎士移動：挑讓盤面價值增加最多的一步；沒有值得的移動就結束（停在城堡邊的騎士一定要移走）。 */
function knightsAnswer(turn: TurnContext, ba: BaView): BotCommand {
  const moves = tbPartHints(turn.view.hints, BA)?.knightMoves ?? [];
  const scene = sceneOf(turn.model, ba);
  const knights: Knight[] = ba.knights.map((knight) => ({ player: knight.player, edge: knight.edge }));
  const current = sceneValue(scene, knights);
  const castle = new Set(integers(ba.castleEdges) ?? []);
  const grain = turn.economy.hand.grain ?? 0;
  const boostable = turn.level !== 'easy' && grain >= 1;

  type Move = { from: number; to: number; boost: boolean };
  const candidates: Move[] = [];
  for (const move of moves) {
    const near = new Set(move.targets);
    for (const to of move.targets) candidates.push({ from: move.from, to, boost: false });
    if (boostable) for (const to of move.boosted) if (!near.has(to)) candidates.push({ from: move.from, to, boost: true });
  }
  const gainOf = (move: Move): number => {
    const next = knights.map((knight) => (knight.edge === move.from && knight.player === scene.selfId ? { ...knight, edge: move.to } : knight));
    const gain = sceneValue(scene, next) - current;
    if (!move.boost) return gain;
    // grain 夠（加速後還有剩）時才為了靠近而加速；只剩 1 張時，只為了這回合就能驅逐而加速。
    if (grain < 2 && gain < PRISONER_VALUE) return -Infinity;
    return gain - BOOST_COST;
  };
  const choice = best(candidates, gainOf);
  if (choice && choice.score > EPSILON) return command('tb.moveKnight', { ...choice.item });
  // 停在城堡邊的騎士：不加速，挑最好的一步移走。
  const forced = best(
    candidates.filter((move) => castle.has(move.from) && !move.boost),
    gainOf,
  );
  if (forced) return command('tb.moveKnight', { ...forced.item });
  return command('tb.endKnights');
}

/** Knighthood（城堡邊）與 Swift Knight（任何空邊）：放在讓盤面價值最高的邊。 */
function placeKnightAnswer(turn: TurnContext, ba: BaView): BotCommand | null {
  const targets = tbBoardTargets(turn.view.hints, 'tb.baPlaceKnight');
  const scene = sceneOf(turn.model, ba);
  const knights: Knight[] = ba.knights.map((knight) => ({ player: knight.player, edge: knight.edge }));
  const choice = best(targets, (edge) => sceneValue(scene, [...knights, { player: scene.selfId, edge }]));
  return choice ? command('tb.baPlaceKnight', { edge: choice.item }) : null;
}

/** 假設把 `delta` 的蠻族數加到某些格之後，自己的價值：騎士的盤面價值減去受到的威脅。 */
function outlook(turn: TurnContext, ba: BaView, delta: ReadonlyMap<number, number>, playerId = turn.ctx.selfId): number {
  const barbarians = (hex: number): number => Math.max(0, barbariansOn(ba, hex) + (delta.get(hex) ?? 0));
  if (playerId !== turn.ctx.selfId) return -threatOf(turn.model, ba, playerId, barbarians);
  const knights: Knight[] = ba.knights.map((knight) => ({ player: knight.player, edge: knight.edge }));
  return sceneValue(sceneOf(turn.model, ba, barbarians), knights) - threatOf(turn.model, ba, playerId, barbarians);
}

/** Capture：拿走一個蠻族之後，自己的處境最好的格。 */
function captureAnswer(turn: TurnContext, ba: BaView): BotCommand | null {
  const targets = tbBoardTargets(turn.view.hints, 'tb.baCapture');
  const choice = best(targets, (hex) => outlook(turn, ba, new Map([[hex, -1]])));
  return choice ? command('tb.baCapture', { hex: choice.item }) : null;
}

/** Treason：最傷害領先者、最不傷害自己的走法（from −1 是從 supply 拿）。easy 取第一個。 */
function treasonAnswer(turn: TurnContext): BotCommand | null {
  const ba = baView(turn.view);
  const moves = (tbPartHints(turn.view.hints, BA)?.treasonMoves ?? []).filter((move) => integers(move)?.length === 2);
  if (moves.length === 0) return null;
  if (turn.level === 'easy' || !ba) return command('tb.baTreason', { from: moves[0]![0], to: moves[0]![1] });
  const selfId = turn.ctx.selfId;
  const leader = leaderOf(turn.view, selfId);
  const others = turn.view.players.filter((player) => player.id !== selfId && player.id !== leader).map((player) => player.id);
  const delta = ([from, to]: readonly number[]): Map<number, number> => {
    const out = new Map<number, number>([[to!, 1]]);
    if (from! >= 0) out.set(from!, -1);
    return out;
  };
  const base = new Map<number, number>();
  const harm = (id: string, change: Map<number, number>): number => outlook(turn, ba, base, id) - outlook(turn, ba, change, id);
  const choice = best(moves, (move) => {
    const change = delta(move);
    let score = -harm(selfId, change);
    if (leader) score += harm(leader, change);
    for (const id of others) score += 0.3 * harm(id, change);
    return score;
  });
  return choice ? command('tb.baTreason', { from: choice.item[0], to: choice.item[1] }) : null;
}

/** 擲出 7 時偷牌：手牌最多的對手，同張數取分數高者。 */
function stealAnswer(turn: TurnContext): BotCommand | null {
  const victims = (tbPartHints(turn.view.hints, BA)?.stealVictims ?? []).filter((id) => id !== turn.ctx.selfId);
  const choice = best(victims, (id) => {
    const player = turn.view.players.find((candidate) => candidate.id === id);
    return (player?.handSize ?? 0) * 10 + (player?.publicScore ?? 0);
  });
  return choice ? command('tb.baSteal', { victim: choice.item }) : null;
}

function answerFrame(turn: TurnContext, frame: Parameters<NonNullable<TbPartBot['answerFrame']>>[1]): BotCommand | null | undefined {
  const kinds = [
    TB_FRAME_KINDS.baSteal,
    TB_FRAME_KINDS.baCapture,
    TB_FRAME_KINDS.baKnighthood,
    TB_FRAME_KINDS.baSwiftKnight,
    TB_FRAME_KINDS.baTreason,
    TB_FRAME_KINDS.baKnights,
  ] as readonly string[];
  if (!kinds.includes(frame.kind)) return undefined;
  if (!isMine(frame, turn.ctx.selfId)) return null;
  const ba = baView(turn.view);
  switch (frame.kind) {
    case TB_FRAME_KINDS.baSteal:
      return stealAnswer(turn);
    case TB_FRAME_KINDS.baTreason:
      return treasonAnswer(turn);
    case TB_FRAME_KINDS.baCapture:
      return ba ? captureAnswer(turn, ba) : null;
    case TB_FRAME_KINDS.baKnighthood:
    case TB_FRAME_KINDS.baSwiftKnight:
      return ba ? placeKnightAnswer(turn, ba) : null;
    default:
      return ba ? knightsAnswer(turn, ba) : null;
  }
}

// ---------------------------------------------------------------------------
// BA 卡計畫與產量
// ---------------------------------------------------------------------------

/** BA 卡的價值：基本價值（沒有騎士可放時打折），加上自己受到的威脅，再加上差一個俘虜就得分。 */
export function baCardValue(model: BoardModel, ba: BaView): number {
  const selfId = model.selfId;
  const knightsLeft = ba.knightsLeft?.[selfId] ?? 0;
  let value = knightsLeft > 0 ? CARD_VALUE.base : CARD_VALUE.noKnights;
  const threat = threatOf(model, ba, selfId, (hex) => (barbariansOn(ba, hex) >= 2 ? barbariansOn(ba, hex) : 0));
  value += Math.min(CARD_VALUE.threatCap, CARD_VALUE.threat * threat);
  if ((ba.prisoners?.[selfId] ?? 0) % 2 === 1) value += CARD_VALUE.oddPrisoner;
  return value;
}

function scoreExtras(input: PlanInput): readonly Plan[] {
  const { model, base } = input;
  const ba = baView(model.view);
  if (!ba || ba.deckCount + (ba.discard?.length ?? 0) === 0) return [];
  const cost = { ...BA_CARD_COST };
  const value = baCardValue(model, ba);
  const eta = etaRounds(base.hand, cost, base.yield, base.rates, model.view.players.length, base.kinds);
  return [{ kind: BA_CARD_PLAN, vertex: null, roads: [], ships: [], cost, nextCost: cost, value, eta, score: value / (1 + eta) }];
}

function planStep(turn: TurnContext, plan: Plan): BotCommand | null | undefined {
  if (plan.kind !== BA_CARD_PLAN) return undefined;
  return tbPartHints(turn.view.hints, BA)?.canBuildCard === true ? command('tb.buildBaCard') : null;
}

/** 被征服的格不生產（`TB/barbarians/index.ts` 的 `hexProduces`）；其他格沿用 base。 */
function hexYield(model: BoardModel, hex: number): Readonly<Record<string, number>> | undefined {
  const ba = baView(model.view);
  return ba && barbariansOn(ba, hex) >= CONQUER_AT ? {} : undefined;
}

export const barbarianAttackBot: TbPartBot = {
  id: BA,
  answerFrame,
  planStep,
  economy: { scoreExtras, hexYield },
};
