/**
 * Explorers & Pirates 的 view 與 hints accessor（E&P 計畫 §3、§5.1 E1）。型別取自 rules 匯出的
 * `ExplorersPiratesView`／`ExplorersPiratesHints`；缺漏時一律回 undefined，不 throw（保底路徑也會呼叫）。
 */

import type { ExplorersPiratesHints, ExplorersPiratesView, GameView } from '@katan/rules';
import { moduleHints, moduleView } from '../view.ts';

export const EXPLORERS_PIRATES = 'explorersPirates';

export type EpView = ExplorersPiratesView;
export type EpHints = ExplorersPiratesHints;
export type EpShipView = EpView['ships'][number];
export type EpShipHints = EpHints['ships'][number];
export type EpPlayerView = EpView['players'][string];

/** `V`：`view.modules.explorersPirates`。 */
export function epView(view: Pick<GameView, 'modules'>): EpView | undefined {
  return moduleView(view, EXPLORERS_PIRATES);
}

/** `H`：`view.hints.modules.explorersPirates`；傳入 `view.hints`。 */
export function epHints(hints: GameView['hints']): EpHints | undefined {
  return moduleHints(hints, EXPLORERS_PIRATES);
}

/** 公開的玩家資料（金幣、棋子供應、能力）。 */
export function epPlayer(view: EpView | undefined, playerId: string): EpPlayerView | undefined {
  const players = view?.players as Record<string, EpPlayerView> | undefined;
  return players && Object.hasOwn(players, playerId) ? players[playerId] : undefined;
}

/** `playerId` 的船，依 view 順序。 */
export function ownShips(view: EpView | undefined, playerId: string): EpShipView[] {
  return (view?.ships ?? []).filter((ship) => ship.player === playerId);
}

/** 目前移動中的船（`V.turn.active`）；沒有則 undefined。 */
export function activeShip(view: EpView | undefined): EpShipView | undefined {
  const id = view?.turn?.active;
  return id ? view?.ships?.find((ship) => ship.id === id) : undefined;
}

/** 某艘船的 hints（`H.ships[i]`）。 */
export function shipHints(hints: EpHints | undefined, shipId: string): EpShipHints | undefined {
  return hints?.ships?.find((ship) => ship.id === shipId);
}

/** 手上的羊毛張數（extraMove 的費用）。 */
export function woolOf(view: GameView, playerId: string): number {
  return view.players.find((player) => player.id === playerId)?.resources?.wool ?? 0;
}
