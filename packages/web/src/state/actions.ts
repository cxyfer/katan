/**
 * Derives the visible action set (enable/disable + reason) from the server's
 * advisory `ActionHintsView`, the viewer's own hand and the current phase.
 *
 * Hints are advisory: a locally "enabled" action can still be rejected by the
 * server, and the rejection reason is what the user finally sees. What this
 * module guarantees is that a *disabled* action always carries a reason id from
 * the catalog, so the UI never shows a dead control without an explanation
 * (docs/SPEC.md §8.4).
 */

import { COSTS, type Resource } from '@catan/rules';
import type { GameSnapshot } from '@catan/protocol';
import { awaitingProjection, awaitingRoom, tableSuspended, type TableState } from './table.ts';
import { blocksNewCommands } from './commands.ts';
import { seafarersHints, SHIP_COST } from '../board/seafarers.ts';
import { EP_HARBOR_COST, EP_SHIP_COST, epHints } from '../board/explorersPirates.ts';
import { citiesKnightsHints, citiesKnightsTargets } from '../board/citiesKnights.ts';
import { seafarersCitiesKnightsHints } from '../board/seafarersCitiesKnights.ts';

export interface ActionDescriptor {
  /** Stable id, also used as the DOM id suffix. */
  id: string;
  labelId: string;
  commandType: string | null;
  enabled: boolean;
  /** Message id explaining why the action is unavailable, or null. */
  reasonId: string | null;
  cost: Partial<Record<Resource, number>> | null;
  /** Number of legal board targets, when the action needs one. */
  targetCount: number;
}

export type ActionId =
  | 'roll'
  | 'endTurn'
  | 'build.road'
  | 'build.settlement'
  | 'build.city'
  | 'build.devCard'
  | 'build.ship'
  | 'ship.move'
  | 'ep.buildHarbor'
  | 'ep.buildShip'
  | 'knight.recruit'
  | 'knight.activate'
  | 'knight.promote'
  | 'knight.move'
  | 'knight.displace'
  | 'knight.chaseRobber'
  | 'knight.chasePirate'
  | 'build.wall';

function canAfford(
  resources: Partial<Record<Resource, number>> | undefined,
  cost: Partial<Record<Resource, number>>,
): boolean {
  if (!resources) return false;
  for (const key of Object.keys(cost) as Resource[]) {
    if ((resources[key] ?? 0) < (cost[key] ?? 0)) return false;
  }
  return true;
}

function selfResources(snapshot: GameSnapshot | null, selfId: string | null) {
  if (!snapshot || !selfId) return undefined;
  return snapshot.view.players.find((player) => player.id === selfId)?.resources;
}

interface ActionInput {
  snapshot: GameSnapshot | null;
  selfId: string | null;
  connected: boolean;
  blockedByCommand: boolean;
  /** 擲骰演出中：結果揭曉前不開放後續動作。 */
  presentingDice: boolean;
  /** 投影尚未追上已知事件：畫面是過時狀態。 */
  syncing: boolean;
  /** 全桌已暫停（§4.8）：伺服器拒絕所有指令，直到全員準備繼續。 */
  suspended: boolean;
}

/** Shared reason resolution, in the priority order a player experiences it. */
export function reasonFor(input: ActionInput, extra: string | null): string | null {
  // 暫停是整桌的狀態，重新連線也不會解除，所以優先說明。
  if (input.suspended) return 'play.disabled.suspended';
  if (!input.connected) return 'play.disabled.connectivity';
  if (input.blockedByCommand) return 'play.disabled.pending';
  // 演出期間一律顯示擲骰原因：其他原因（待處理、資源不足）來自擲骰後的投影，會透露點數。
  if (input.presentingDice) return 'play.disabled.rolling';
  if (input.syncing) return 'play.disabled.syncing';
  return extra;
}

export function deriveActions(state: TableState, selfId: string | null): ActionDescriptor[] {
  const snapshot = state.game;
  const view = snapshot?.view ?? null;
  const hints = view?.hints ?? null;
  const connected = state.connection === 'online';
  const blocked = blocksNewCommands(state.command);
  const presentingDice = state.dicePresenting;
  // 房間尚未載入時還不知道能不能下，與投影未追上一樣視為同步中。
  const syncing = awaitingProjection(state) || awaitingRoom(state);
  const suspended = tableSuspended(state);
  const ready = !blocked && connected && !presentingDice && !syncing && !suspended;
  const input: ActionInput = { snapshot, selfId, connected, blockedByCommand: blocked, presentingDice, syncing, suspended };
  const resources = selfResources(snapshot, selfId);
  const isTurnActor = !!view && !!selfId && view.turn.playerId === selfId;
  const pending = view?.pending ?? null;

  const phaseReason = (): string | null => {
    if (!isTurnActor) return 'play.disabled.notYourTurn';
    if (pending) return 'play.disabled.pending';
    return 'play.disabled.timing';
  };

  const build = (
    id: ActionId,
    labelId: string,
    commandType: string,
    cost: Partial<Record<Resource, number>> | null,
    targets: number[],
  ): ActionDescriptor => {
    const legal = targets.length;
    let reason: string | null = null;
    if (!isTurnActor) reason = 'play.disabled.notYourTurn';
    else if (view?.turn.phase !== 'action') reason = 'play.disabled.timing';
    else if (pending && pending.kind !== 'freeRoads') reason = 'play.disabled.pending';
    else if (legal === 0) reason = 'play.disabled.noTargets';
    else if (cost && !canAfford(resources, cost)) reason = 'play.disabled.inventory';
    return {
      id,
      labelId,
      commandType,
      enabled: reason === null && ready,
      reasonId: reasonFor(input, reason),
      cost,
      targetCount: legal,
    };
  };

  const actions: ActionDescriptor[] = [];

  actions.push({
    id: 'roll',
    labelId: 'play.roll',
    commandType: 'turn.roll',
    enabled: !!hints?.canRoll && ready,
    reasonId: reasonFor(input, hints?.canRoll ? null : phaseReason()),
    cost: null,
    targetCount: 0,
  });

  actions.push({
    id: 'endTurn',
    labelId: 'play.endTurn',
    commandType: 'turn.end',
    enabled: !!hints?.canEndTurn && ready,
    reasonId: reasonFor(input, hints?.canEndTurn ? null : phaseReason()),
    cost: null,
    targetCount: 0,
  });

  actions.push(
    build('build.road', 'play.build.road', 'build.road', COSTS.road, hints?.legalRoads ?? []),
  );
  actions.push(
    build(
      'build.settlement',
      'play.build.settlement',
      'build.settlement',
      COSTS.settlement,
      hints?.legalSettlements ?? [],
    ),
  );
  actions.push(
    build('build.city', 'play.build.city', 'build.city', COSTS.city, hints?.legalCities ?? []),
  );

  // Seafarers: build a ship, and move one ship per action window.
  const sea = seafarersHints(view);
  if (sea) {
    actions.push(build('build.ship', 'sf.build.ship', 'build.ship', SHIP_COST, sea.legalShips));
    let moveReason: string | null = null;
    if (!isTurnActor) moveReason = 'play.disabled.notYourTurn';
    else if (view?.turn.phase !== 'action') moveReason = 'play.disabled.timing';
    else if (pending) moveReason = 'play.disabled.pending';
    else if (sea.shipMoved) moveReason = 'sf.disabled.shipMoved';
    else if (sea.movableShips.length === 0) moveReason = 'sf.disabled.noShipMove';
    actions.push({
      id: 'ship.move',
      labelId: 'sf.move.ship',
      commandType: 'ship.pick',
      enabled: moveReason === null && ready,
      reasonId: reasonFor(input, moveReason),
      cost: null,
      targetCount: sea.movableShips.length,
    });
  }

  // Explorers & Pirates: harbour settlements and ships; no cities and no
  // development cards; building ends with the Movement phase.
  const ep = epHints(view);
  if (ep) {
    actions.push(build('ep.buildHarbor', 'ep.build.harbor', 'ep.buildHarbor', EP_HARBOR_COST, ep.harbors));
    const ship = build('ep.buildShip', 'ep.build.ship', 'ep.buildShip', EP_SHIP_COST, ep.shipEdges);
    if (ship.enabled && ep.shipReplace) {
      ship.enabled = false;
      ship.reasonId = 'ep.disabled.replaceShip';
    }
    actions.push(ship);
    const kept = actions.filter((action) => action.id !== 'build.city');
    if (ep.phase === 'movement') {
      for (const action of kept) {
        if (action.id.startsWith('build.') || action.id.startsWith('ep.')) {
          action.enabled = false;
          action.reasonId = reasonFor(input, 'ep.disabled.movement');
        }
      }
    }
    return kept;
  }
  // Cities & Knights: knights and city walls; development cards do not exist.
  const ck = citiesKnightsHints(view);
  if (ck) {
    const targets = (commandType: string) => citiesKnightsTargets(view, { commandType }) ?? [];
    actions.push(build('knight.recruit', 'ck.action.recruit', 'knight.recruit', ck.costs.knight, targets('knight.recruit')));
    actions.push(build('knight.activate', 'ck.action.activate', 'knight.activate', ck.costs.activate, targets('knight.activate')));
    actions.push(build('knight.promote', 'ck.action.promote', 'knight.promote', ck.costs.promote, targets('knight.promote')));
    actions.push(build('knight.move', 'ck.action.move', 'knight.pickMove', null, targets('knight.pickMove')));
    actions.push(build('knight.displace', 'ck.action.displace', 'knight.pickDisplace', null, targets('knight.pickDisplace')));
    actions.push(build('knight.chaseRobber', 'ck.action.chase', 'knight.chaseRobber', null, targets('knight.chaseRobber')));
    // Seafarers + C&K: chase the pirate with a knight next to its sea hex (COMB-6).
    const combined = seafarersCitiesKnightsHints(view);
    if (combined) actions.push(build('knight.chasePirate', 'sfck.action.chasePirate', 'knight.chasePirate', null, combined.pirateChase));
    actions.push(build('build.wall', 'ck.action.wall', 'build.wall', ck.costs.wall, targets('build.wall')));
    return actions;
  }

  const deckEmpty = (view?.devDeckSize ?? 0) <= 0;
  let devReason: string | null = null;
  if (deckEmpty) devReason = 'play.disabled.other';
  else if (!isTurnActor) devReason = 'play.disabled.notYourTurn';
  else if (pending) devReason = 'play.disabled.pending';
  else if (!canAfford(resources, COSTS.devCard)) devReason = 'play.disabled.inventory';
  actions.push({
    id: 'build.devCard',
    labelId: 'play.build.devCard',
    commandType: 'build.devCard',
    enabled: devReason === null && ready,
    reasonId: reasonFor(input, devReason),
    cost: COSTS.devCard,
    targetCount: 0,
  });

  return actions;
}

export function findAction(
  actions: readonly ActionDescriptor[],
  id: ActionId,
): ActionDescriptor | undefined {
  return actions.find((action) => action.id === id);
}

/** 動作欄的分組：同組動作在收合與展開時都排在一起。 */
export type ActionGroupId = 'turn' | 'build' | 'sea' | 'knights';

export interface ActionGroup {
  id: ActionGroupId;
  actions: ActionDescriptor[];
  /** 整組共用的停用原因；組內各動作原因不同時為 null。 */
  sharedReasonId: string | null;
}

const GROUP_ORDER: readonly ActionGroupId[] = ['turn', 'build', 'sea', 'knights'];

export function actionGroupOf(id: string): ActionGroupId {
  if (id === 'roll' || id === 'endTurn') return 'turn';
  if (id.startsWith('knight.')) return 'knights';
  if (id === 'build.ship' || id === 'ship.move' || id === 'ep.buildShip') return 'sea';
  return 'build';
}

/** 所有動作都停用且原因相同時回傳該原因，讓介面只說明一次。 */
export function sharedReason(actions: readonly ActionDescriptor[]): string | null {
  const first = actions[0]?.reasonId ?? null;
  if (!first) return null;
  return actions.every((action) => action.reasonId === first) ? first : null;
}

/** 依固定順序分組，保留各組內 `deriveActions` 的原始順序。 */
export function groupActions(actions: readonly ActionDescriptor[]): ActionGroup[] {
  return GROUP_ORDER.flatMap((id) => {
    const members = actions.filter((action) => actionGroupOf(action.id) === id);
    return members.length ? [{ id, actions: members, sharedReasonId: sharedReason(members) }] : [];
  });
}
