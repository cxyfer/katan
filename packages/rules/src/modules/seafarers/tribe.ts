/**
 * The Forgotten Tribe（世外部落，SF25 pp. 12–13）：邊上的禮物。
 *
 * 開局把 8 枚 VP 標記放在指定的邊，把發展牌堆最上面 4 張（不看）面朝下放在指定的邊，
 * 6 個港口面朝上隨機放在指定位置；18 個位置都是「陸地格與框之間」的邊。建造或移動一艘船到
 * 有禮物的邊就拿走禮物：
 * - VP 標記：放在自己面前，每枚 1 分（公開）；
 * - 發展牌：視同這回合購買（`newDevCards`），之後的回合才可打出，分數牌立即計分；
 * - 港口：面朝上，可行時放到自己海岸村落旁的合法邊，港口之間必須隔一條邊；沒有合法位置就
 *   暫存在自己面前（`held`），之後每次盤面變動重新檢查，有合法位置時開 `seafarers.harbor` frame
 *   讓玩家選位置。放下的港口加進 `layout.harbors`，立即可用。
 *
 * 隱私：未被拿走的發展牌身分只存在 module state，投影與事件都不含；拿走後只有拿的人知道。
 */

import { isLandHex, isSeaEdge, playerById, topologyOf } from '../../analysis.ts';
import { pendingFrames } from '../../pending.ts';
import { giftEdges, FT_PORT_TOKENS } from '../../seafarers-scenario-boards.ts';
import { shuffle } from '../../rng.ts';
import type { CommandOutcome, DevCardType, GameState, HarborType, ModulePending } from '../../types.ts';
import type { ModuleCommand, ModuleContext, ModuleViewContext, PublicModulePendingView } from '../types.ts';
import { seafarersState, seafarersView, type SeafarersState } from './state.ts';

export const HARBOR_FRAME = 'seafarers.harbor' as const;

/** 邊上尚未被拿走的禮物；發展牌的身分只在這裡（不投影）。 */
export type TribeGift =
  | { edge: number; kind: 'vp' }
  | { edge: number; kind: 'devcard'; card: DevCardType }
  | { edge: number; kind: 'port'; harbor: HarborType };

export interface TribeState {
  gifts: TribeGift[];
  /** 各玩家拿到的 VP 標記數（每枚 1 分，已計入 `bonusPoints`）。 */
  vp: Record<string, number>;
  /** 暫存在玩家面前、尚未放下的港口。 */
  held: Record<string, HarborType[]>;
}

export const isForgottenTribe = (ctx: ModuleViewContext): boolean => ctx.profile.scenario === 'forgotten-tribe';

/** 開局：VP 標記、牌堆頂 4 張（面朝下）與隨機排列的港口放到各自的邊。 */
export function initTribe(state: GameState, ctx: ModuleContext, slot: SeafarersState): void {
  const positions = giftEdges(topologyOf(state));
  const ports = shuffle(FT_PORT_TOKENS, ctx.rng);
  const cards = state.devDeck.splice(0, positions.filter((position) => position.kind === 'devcard').length);
  const gifts: TribeGift[] = [];
  for (const { edge, kind } of positions) {
    if (kind === 'vp') gifts.push({ edge, kind });
    else if (kind === 'devcard') gifts.push({ edge, kind, card: cards.shift()! });
    else gifts.push({ edge, kind, harbor: ports.shift()! });
  }
  slot.tribe = {
    gifts,
    vp: Object.fromEntries(state.players.map((player) => [player.id, 0])),
    held: Object.fromEntries(state.players.map((player) => [player.id, []])),
  };
}

/** 建造或移動船到 `edge` 後，拿走該邊的禮物（沒有禮物則什麼都不做）。 */
export function takeGift(state: GameState, playerId: string, edge: number, ctx: ModuleContext): void {
  const tribe = seafarersState(state).tribe;
  if (!tribe) return;
  const index = tribe.gifts.findIndex((candidate) => candidate.edge === edge);
  if (index < 0) return;
  const gift = tribe.gifts.splice(index, 1)[0]!;
  const player = playerById(state, playerId)!;
  if (gift.kind === 'vp') {
    tribe.vp[playerId] = (tribe.vp[playerId] ?? 0) + 1;
    player.bonusPoints += 1;
    ctx.kit.emit(state, 'tribe.gift', { playerId, edge, gift: 'vp' });
  } else if (gift.kind === 'devcard') {
    // 視同這回合購買：下回合才可打出；分數牌由 `scoreOf` 計入，隨後的勝利檢查立即生效。
    player.newDevCards.push(gift.card);
    ctx.kit.emit(state, 'tribe.gift', { playerId, edge, gift: 'devcard' }, { to: [playerId], params: { card: gift.card } });
  } else {
    (tribe.held[playerId] ??= []).push(gift.harbor);
    ctx.kit.emit(state, 'tribe.gift', { playerId, edge, gift: 'port', harbor: gift.harbor });
  }
}

/**
 * 港口可放的邊：陸地格與海／框之間的海岸邊，不是現有港口，也不與現有港口共用交叉點
 * （港口之間必須隔一條邊，SF25 pp. 12、20）。世外部落與新世界共用。
 */
export function separatedCoastEdges(state: GameState): number[] {
  const topo = topologyOf(state);
  const harborEdges = new Set<number>();
  const harborVertices = new Set<number>();
  for (const harbor of state.board.layout.harbors) {
    harborEdges.add(harbor.edge);
    for (const vertex of topo.edges[harbor.edge]?.vertices ?? []) harborVertices.add(vertex);
  }
  const out: number[] = [];
  topo.edges.forEach((info, edge) => {
    if (info.interior || harborEdges.has(edge)) return;
    if (!isSeaEdge(state, edge) || !info.hexes.some((hex) => isLandHex(state, hex))) return;
    if (info.vertices.some((vertex) => harborVertices.has(vertex))) return;
    out.push(edge);
  });
  return out;
}

/** 玩家現在可放港口的邊（世外部落）：上述的海岸邊，且一端是自己的村落或城市。 */
export function legalHarborEdges(state: GameState, playerId: string): number[] {
  const topo = topologyOf(state);
  return separatedCoastEdges(state).filter((edge) =>
    topo.edges[edge]!.vertices.some((vertex) => state.board.buildings[vertex]?.player === playerId));
}

function hasHarborFrame(state: GameState, playerId: string): boolean {
  return pendingFrames(state).some((frame) => 'module' in frame && frame.kind === HARBOR_FRAME && frame.responders.includes(playerId));
}

/**
 * 每次盤面變動後重新檢查：手上有暫存港口且現在有合法位置的玩家，開 frame 讓他選位置
 * （同一玩家同時只有一個 frame；放完一個若還有就再開）。
 */
export function offerHarbors(state: GameState, ctx: ModuleContext): void {
  const tribe = seafarersState(state).tribe;
  if (!tribe || state.turn.phase === 'gameOver') return;
  const count = state.players.length;
  for (let offset = 0; offset < count; offset++) {
    const player = state.players[(state.turn.seat + offset) % count]!;
    if ((tribe.held[player.id]?.length ?? 0) === 0 || hasHarborFrame(state, player.id)) continue;
    if (legalHarborEdges(state, player.id).length === 0) continue;
    const frame: ModulePending = { kind: HARBOR_FRAME, module: 'seafarers', responders: [player.id], data: {} };
    ctx.kit.enqueuePending(state, frame);
  }
}

/** 排隊的港口 frame 輪到時，若已沒有合法位置就放棄（港口留在面前，等下次盤面變動）。 */
export function activateHarborFrame(state: GameState, frame: ModulePending, ctx: ModuleContext): void {
  const owner = frame.responders[0];
  if (owner !== undefined && legalHarborEdges(state, owner).length === 0 && state.pending === frame) {
    ctx.kit.completePending(state, ctx.rng);
  }
}

/** 玩家作答時可選的港口與邊（只在輪到他的港口 frame 時有值）。 */
export function harborChoices(state: GameState, playerId: string): { harbors: HarborType[]; edges: number[] } {
  const frame = state.pending;
  if (!frame || !('module' in frame) || frame.kind !== HARBOR_FRAME || frame.responders[0] !== playerId) return { harbors: [], edges: [] };
  const held = seafarersView(state).tribe?.held[playerId] ?? [];
  return { harbors: [...new Set(held)], edges: legalHarborEdges(state, playerId) };
}

/** `harbor.place { edge, harbor }` — 把暫存的港口放到自己海岸村落旁的合法邊。 */
export function placeHarbor(state: GameState, actorId: string, command: ModuleCommand, ctx: ModuleContext): CommandOutcome {
  const { kit } = ctx;
  // 只有世外部落有這個指令；其他劇本要與送出未知指令時一致（同 `chooseFog`）：
  // 有 pending frame 時是 E_PENDING_EFFECT，沒有時是 E_INVALID_COMMAND。
  if (!seafarersView(state).tribe) {
    return state.pending ? kit.fail('E_PENDING_EFFECT', { pending: state.pending.kind }) : kit.fail('E_INVALID_COMMAND');
  }
  const frame = state.pending;
  if (!frame || !('module' in frame) || frame.kind !== HARBOR_FRAME) return kit.fail('E_PENDING_EFFECT', { pending: frame?.kind ?? 'none' });
  if (!frame.responders.includes(actorId)) return kit.fail('E_NOT_ACTOR');
  const { edge, harbor } = command;
  const tribe = seafarersState(state).tribe;
  const held = tribe?.held[actorId] ?? [];
  if (typeof edge !== 'number' || !Number.isInteger(edge) || typeof harbor !== 'string') return kit.fail('E_INVALID_COMMAND');
  const index = held.indexOf(harbor as HarborType);
  if (index < 0) return kit.fail('E_INVALID_SELECTION', { harbor });
  if (!legalHarborEdges(state, actorId).includes(edge)) return kit.fail('E_ILLEGAL_TARGET', { edge });
  held.splice(index, 1);
  state.board.layout.harbors.push({ edge, type: harbor as HarborType });
  kit.emit(state, 'harbor.placed', { playerId: actorId, edge, harbor });
  kit.completePending(state, ctx.rng);
  offerHarbors(state, ctx);
  return kit.accept(state);
}

/** 港口 frame 的公開形式：暫存港口是公開的（面朝上）。 */
export function projectHarborFrame(state: GameState, frame: ModulePending): PublicModulePendingView {
  const owner = frame.responders[0];
  return {
    kind: frame.kind,
    module: frame.module,
    responders: frame.responders.slice(),
    data: { harbors: owner === undefined ? [] : (seafarersView(state).tribe?.held[owner] ?? []).slice() },
  };
}

/** 公開狀態：禮物位置與種類（發展牌只有「有一張牌」，不含身分）、各人 VP 標記與暫存港口。 */
export function projectTribe(tribe: TribeState) {
  return {
    gifts: tribe.gifts.map((gift) => (gift.kind === 'port' ? { edge: gift.edge, kind: gift.kind, harbor: gift.harbor } : { edge: gift.edge, kind: gift.kind })),
    vp: { ...tribe.vp },
    held: Object.fromEntries(Object.entries(tribe.held).map(([id, list]) => [id, list.slice()])),
  };
}
