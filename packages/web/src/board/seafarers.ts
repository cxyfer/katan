/**
 * Typed access to the Seafarers module's public view and advisory hints
 * (`GameView.modules.seafarers`, `ActionHints.modules.seafarers`). Base games
 * have neither, so every helper returns `null` there.
 */

import type { GameView, Resource } from '@katan/rules';
import { isEpShipCommand } from './explorersPirates.ts';

export interface IslandClaimView {
  player: string;
  island: number;
  vertex: number;
}

export interface SeafarersModuleView {
  islandBonus: Record<string, number[]>;
  islandClaims: IslandClaimView[];
  shipsBuiltThisTurn: number[];
  shipMoved: boolean;
  /** 各玩家的 home islands（四島群島、新世界在設置結束後才有）。 */
  home: Record<string, number[]> | null;
  /** 未知海域尚未翻開的空格（hex 索引）；其他劇本為空。牌庫不在投影裡。 */
  fog: number[];
}

export interface SeafarersHints {
  legalShips: number[];
  setupShips: number[];
  movableShips: { edge: number; targets: number[] }[];
  shipMoved: boolean;
  pirateTargets: (number | null)[];
  robberTargets: number[];
  goldRequired: number;
  /**
   * 金礦作答可拿的銀行存量：每種 `min(存量, goldRequired)`，只給當下作答的玩家（#137）。
   * `GameView.bank` 只到 `BANK_VIEW_CAP`，金礦卻可能要拿更多同種的牌。缺欄時為 null，由呼叫端退回公開的銀行。
   */
  goldBank: Record<Resource, number> | null;
}

export const SHIP_COST: Partial<Record<Resource, number>> = { lumber: 1, wool: 1 };

/** Points one island claim is worth (SF25 p. 4). */
export const ISLAND_BONUS_POINTS = 2;

/** Board commands whose edge target is a ship. */
const SHIP_COMMANDS = new Set(['build.ship', 'setup.placeShip', 'ship.move', 'ship.pick']);

export function isShipCommand(commandType: string | null | undefined): boolean {
  return !!commandType && (SHIP_COMMANDS.has(commandType) || isEpShipCommand(commandType));
}

export function seafarersView(view: Pick<GameView, 'modules'> | null | undefined): SeafarersModuleView | null {
  const slot = view?.modules?.seafarers as Partial<SeafarersModuleView> | undefined;
  if (!slot) return null;
  return {
    islandBonus: slot.islandBonus ?? {},
    islandClaims: slot.islandClaims ?? [],
    shipsBuiltThisTurn: slot.shipsBuiltThisTurn ?? [],
    shipMoved: !!slot.shipMoved,
    home: slot.home ?? null,
    fog: slot.fog ?? [],
  };
}

export function seafarersHints(view: Pick<GameView, 'hints'> | null | undefined): SeafarersHints | null {
  const slot = view?.hints?.modules?.seafarers as Partial<SeafarersHints> | undefined;
  if (!slot) return null;
  return {
    legalShips: slot.legalShips ?? [],
    setupShips: slot.setupShips ?? [],
    movableShips: slot.movableShips ?? [],
    shipMoved: !!slot.shipMoved,
    pirateTargets: slot.pirateTargets ?? [],
    robberTargets: slot.robberTargets ?? [],
    goldRequired: slot.goldRequired ?? 0,
    goldBank: slot.goldBank ?? null,
  };
}

/** Island bonus points a player holds (public). */
export function islandBonusPoints(view: Pick<GameView, 'modules'> | null | undefined, playerId: string): number {
  return (seafarersView(view)?.islandBonus[playerId]?.length ?? 0) * ISLAND_BONUS_POINTS;
}

/** 未知海域的空格（hex → 'open'）；沒有空格時回 undefined。 */
export function seafarersFog(view: Pick<GameView, 'modules'> | null | undefined): Map<number, 'open'> | undefined {
  const fog = seafarersView(view)?.fog ?? [];
  return fog.length > 0 ? new Map(fog.map((hex) => [hex, 'open' as const])) : undefined;
}

/** 輪到我選要翻開哪個空格（`seafarers.fog` frame 的候選）；沒有則 null。 */
export function fogChoice(view: Pick<GameView, 'pending'> | null | undefined, selfId: string | null): number[] | null {
  const pending = view?.pending;
  if (!pending || pending.kind !== 'seafarers.fog' || !('responders' in pending) || !selfId || !pending.responders.includes(selfId)) return null;
  const hexes = (pending.data as { hexes?: unknown }).hexes;
  return Array.isArray(hexes) ? hexes.filter((hex): hex is number => typeof hex === 'number') : null;
}
