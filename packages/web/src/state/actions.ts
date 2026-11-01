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
import { awaitingProjection, type TableState } from './table.ts';
import { blocksNewCommands } from './commands.ts';
import { seafarersHints, SHIP_COST } from '../board/seafarers.ts';

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
  | 'ship.move';

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
}

/** Shared reason resolution, in the priority order a player experiences it. */
export function reasonFor(input: ActionInput, extra: string | null): string | null {
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
  const syncing = awaitingProjection(state);
  const ready = !blocked && connected && !presentingDice && !syncing;
  const input: ActionInput = { snapshot, selfId, connected, blockedByCommand: blocked, presentingDice, syncing };
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
