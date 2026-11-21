/**
 * E&P 的 Action 子階段（計畫 §4.3、§4.6、§4.7；E2）。骨架負責報價與 base 的聚落／道路，這裡提供：
 *
 * - `actions`：立即得分的 `ep.buildHarbor`、遠征的 `ep.buildSettler`、補船 `ep.buildShip`，
 *   以及差一兩張就能完成建造時用金幣補的 `ep.buyResource`；
 * - `planStep`：E&P 計畫的下一步（與 `actions` 共用同一組建造指令）；
 * - `endWindow`：手牌過多時換金幣，否則有航程就 `ep.startMovement`，沒有就 `turn.end`。
 *
 * 合法目標一律取自 hints（P2）。MVP 不替換船：Land Ho! 的目標是 2 艘，低於上限 3，用不到 `replace`
 * （E3 起任務需要 3 艘時再加）。
 */

import { EP_BASE_MP, EP_COSTS, RESOURCES, type Resource } from '@katan/rules';
import { bankHas } from '../../bank.ts';
import { canAfford, deficitOf, handSize, type Cost, type Hand, type Plan } from '../../economy.ts';
import type { BotCommand, Scored, TurnContext } from '../types.ts';
import { epGeometry, type EpGeometry } from './geometry.ts';
import { fleetOf, hasWork, voyagesOf } from './movement.ts';
import { geometryOf, SHIP_TARGET, settlerWanted } from './plans.ts';
import { epHints, epPlayer, epView, ownShips, type EpHints, type EpPlayerView, type EpShipView, type EpView } from './view.ts';

const HARBOR_SCORE = 1;
const SETTLER_SCORE = 0.9;
const SHIP_SCORE = 0.55;
const BUY_SCORE = 0.95;

interface Ctx {
  readonly turn: TurnContext;
  readonly hints: EpHints;
  readonly ep: EpView;
  readonly g: EpGeometry;
  readonly me: string;
  readonly player: EpPlayerView;
  readonly hand: Hand;
}

/** 只在自己的 Action 子階段（`H.phase === 'action'`）才有值。 */
function ctxOf(turn: TurnContext): Ctx | undefined {
  const hints = epHints(turn.view.hints);
  const ep = epView(turn.view);
  if (!hints || !ep || hints.phase !== 'action') return undefined;
  const g = geometryOf(turn);
  const player = epPlayer(ep, turn.ctx.selfId);
  return g && player ? { turn, hints, ep, g, me: turn.ctx.selfId, player, hand: turn.economy.hand } : undefined;
}

type Kind = 'harbor' | 'settler' | 'ship';
const KIND_PREFIX = 'explorersPirates.';

/** harbour 升級：優先選旁邊有空的船位（船放得下）的沿海聚落。 */
function harborCommand(c: Ctx): BotCommand | null {
  if (c.player.supply.harbors <= 0) return null;
  const room = (vertex: number): number => c.g.topo.vertices[vertex]!.edges.filter((edge) => c.hints.shipEdges.includes(edge)).length;
  const vertex = c.hints.harbors.slice().sort((a, b) => room(b) - room(a) || a - b)[0];
  return vertex === undefined ? null : { type: 'ep.buildHarbor', vertex };
}

/** settler：放在 harbour 旁的空船上（直接出航），沒有空船才放 harbour（之後再 `ep.load`）。 */
function settlerCommand(c: Ctx): BotCommand | null {
  if (c.hints.settlersLeft < 1 || !settlerWanted(c.g, c.me)) return null;
  const ship = c.ep.ships.find((entry) => entry.player === c.me && entry.cargo.length === 0 && c.hints.pieceShips.includes(entry.id));
  if (ship) return { type: 'ep.buildSettler', ship: ship.id };
  const harbor = c.ep.harbors.find((entry) => entry.player === c.me && entry.cargo.length === 0 && c.hints.pieceHarbors.includes(entry.vertex));
  return harbor ? { type: 'ep.buildSettler', harbor: harbor.vertex } : null;
}

/** 新船放在最有航程的位置：以假想的船規劃，取最佳航程分數（沒有航程時取最小編號的邊）。 */
function shipCommand(c: Ctx): BotCommand | null {
  if (c.hints.shipEdges.length === 0 || c.player.supply.ships <= 0 || ownShips(c.ep, c.me).length >= SHIP_TARGET) return null;
  let best: { edge: number; score: number } | null = null;
  for (const edge of c.hints.shipEdges) {
    const ghost: EpShipView = { id: 'ghost', player: c.me, edge, cargo: [] };
    const g = epGeometry(c.turn.view, { ...c.ep, ships: [...c.ep.ships, ghost] });
    const score = g ? (voyagesOf(fleetOf(c.turn, g), ghost, EP_BASE_MP, false)[0]?.score ?? 0) : 0;
    if (!best || score > best.score) best = { edge, score };
  }
  return best ? { type: 'ep.buildShip', edge: best.edge } : null;
}

const BUILDERS: Record<Kind, (c: Ctx) => BotCommand | null> = { harbor: harborCommand, settler: settlerCommand, ship: shipCommand };
const COSTS: Record<Kind, Cost> = { harbor: EP_COSTS.harbor, settler: EP_COSTS.settler, ship: EP_COSTS.ship };

function kindOf(plan: Plan): Kind | null {
  const name = plan.kind.startsWith(KIND_PREFIX) ? plan.kind.slice(KIND_PREFIX.length) : '';
  return name === 'harbor' || name === 'settler' || name === 'ship' ? name : null;
}

/** 這個計畫的下一步現在有合法目標（不看成本）。 */
function completable(c: Ctx, plan: Plan): boolean {
  const kind = kindOf(plan);
  if (kind) return BUILDERS[kind](c) !== null;
  if (plan.kind !== 'settlement') return false;
  const hints = c.turn.view.hints!;
  return plan.roads.length === 0 ? plan.vertex !== null && hints.legalSettlements.includes(plan.vertex) : hints.legalRoads.includes(plan.roads[0]!);
}

/** 只缺 1–2 張就能完成主要計畫時，用金幣補（2 金一張，每回合最多 2 次）。保留的金幣：有海盜時 1 枚付過路費。 */
function goldBuy(c: Ctx): BotCommand | null {
  const plan = c.turn.economy.plans[0];
  if (!plan || !completable(c, plan)) return null;
  const reserve = c.ep.pirates ? 1 : 0;
  const budget = Math.min(c.hints.goldBuysLeft, Math.floor((c.player.gold - reserve) / 2));
  const missing = deficitOf(c.hand, plan.nextCost);
  const need = RESOURCES.reduce((sum, resource) => sum + missing[resource], 0);
  if (need < 1 || need > budget) return null;
  const receive = RESOURCES.find((resource) => missing[resource] > 0 && bankHas(c.turn.view, resource));
  return receive ? { type: 'ep.buyResource', receive } : null;
}

export function epActions(turn: TurnContext): readonly Scored<BotCommand>[] {
  const c = ctxOf(turn);
  if (!c) return [];
  const out: Scored<BotCommand>[] = [];
  const scores: Record<Kind, number> = { harbor: HARBOR_SCORE, settler: SETTLER_SCORE, ship: SHIP_SCORE };
  for (const kind of ['harbor', 'settler', 'ship'] as const) {
    if (!canAfford(c.hand, COSTS[kind])) continue;
    const command = BUILDERS[kind](c);
    if (command) out.push({ item: command, score: scores[kind] });
  }
  const buy = goldBuy(c);
  if (buy) out.push({ item: buy, score: BUY_SCORE });
  return out;
}

/** 模組計畫的下一步；不是 E&P 的 kind 回 undefined。 */
export function epPlanStep(turn: TurnContext, plan: Plan): BotCommand | null | undefined {
  const kind = kindOf(plan);
  if (!kind) return undefined;
  const c = ctxOf(turn);
  return c ? BUILDERS[kind](c) : null;
}

/** 手牌過多時換金幣：`ep.fastGold`（有能力時）→ `ep.sellForGold`（三張同種），都以不動用主要計畫的過剩牌為先。 */
function goldRelief(c: Ctx): BotCommand | null {
  const { economy } = c.turn;
  if (handSize(c.hand) <= economy.handLimit) return null;
  const keep = economy.plans[0]?.cost ?? {};
  const surplus = (resource: Resource): number => c.hand[resource] - (keep[resource] ?? 0);
  const ranked = RESOURCES.slice().sort((a, b) => surplus(b) - surplus(a));
  if (c.hints.fastGoldLeft > 0 && c.ep.goldSupply > 0) {
    const give = ranked.find((resource) => c.hand[resource] >= 1);
    if (give) return { type: 'ep.fastGold', give };
  }
  const give = ranked.find((resource) => c.hand[resource] >= 3);
  return give && c.ep.goldSupply > 0 ? { type: 'ep.sellForGold', give } : null;
}

export function epEndWindow(turn: TurnContext): BotCommand | null | undefined {
  const c = ctxOf(turn);
  if (!c) return undefined;
  const relief = goldRelief(c);
  if (relief) return relief;
  const fleet = fleetOf(turn, c.g);
  const work = ownShips(c.ep, c.me).some((ship) => hasWork(fleet, ship, EP_BASE_MP, c.ep.turn.ships[ship.id]?.tribute ?? false));
  return { type: work ? 'ep.startMovement' : 'turn.end' };
}
