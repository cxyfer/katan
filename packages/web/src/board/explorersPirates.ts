/**
 * Typed access to the Explorers & Pirates module's public view and advisory
 * hints (`GameView.modules.explorersPirates`, `ActionHints.modules.explorersPirates`).
 * Other games have neither, so every helper returns `null` there.
 */

import type { ExplorersPiratesHints, ExplorersPiratesView, GameView, Resource } from '@catan/rules';
import { EP_COSTS } from '@catan/rules';

export type EpView = ExplorersPiratesView;
export type EpHints = ExplorersPiratesHints;
export type EpShipView = EpView['ships'][number];
export type EpShipHints = EpHints['ships'][number];

export const EP_FRAME = 'explorersPirates.pirate';

export function epView(view: Pick<GameView, 'modules'> | null | undefined): EpView | null {
  return (view?.modules?.explorersPirates as EpView | undefined) ?? null;
}

export function epHints(view: Pick<GameView, 'hints'> | null | undefined): EpHints | null {
  return (view?.hints?.modules?.explorersPirates as EpHints | undefined) ?? null;
}

export const EP_HARBOR_COST: Partial<Record<Resource, number>> = EP_COSTS.harbor;
export const EP_SHIP_COST: Partial<Record<Resource, number>> = EP_COSTS.ship;
export const EP_SETTLER_COST: Partial<Record<Resource, number>> = EP_COSTS.settler;
export const EP_CREW_COST: Partial<Record<Resource, number>> = EP_COSTS.crew;

/** Board commands whose edge target is an E&P ship. */
const SHIP_COMMANDS = new Set(['ep.buildShip', 'ep.setupShip', 'ep.moveShip']);

export function isEpShipCommand(commandType: string | null | undefined): boolean {
  return !!commandType && SHIP_COMMANDS.has(commandType);
}

/** Unexplored hexes by index → region. */
export function fogRegions(view: EpView | null): Map<number, 'parrot' | 'goose'> {
  return new Map((view?.fog ?? []).map((entry) => [entry.hex, entry.region]));
}

/*
 * 同一條路徑上的船：船身長約半條邊以上（SVG 52/100、3D 0.6/1），頭尾相接會越過
 * 兩端頂點、壓到港口，所以每艘船都順著路徑，在橫跨路徑的平行「航道」上並排。
 * 以下長度都以邊長（= 六角形邊長）為單位。
 */

/** 船身含貨物橫跨路徑的寬度：SVG 船身加貨物約 22.5/100，3D 船身 0.13 × 1.5 = 0.195。 */
export const SHIP_BEAM = 0.225;
/** 相鄰航道的間距（SVG 的預設；兩艘船時即原本的並排位置）。 */
export const SHIP_LANE = 0.24;

/** 一艘船在路徑上的位置：`across` 橫跨路徑（正向即路徑法線），`along` 順著龍骨。 */
export interface ShipLane {
  across: number;
  along: number;
}

export interface ShipLaneOptions {
  /** 相鄰航道的間距；超過四艘時壓縮，整組不超過四艘的展開幅度。 */
  lane?: number;
  /** 相鄰航道沿龍骨交錯的距離（slot 偶數往後、奇數往前），讓斜視時桅帆與貨物不疊成一列。 */
  stagger?: number;
  /**
   * 海岸路徑上開放水域的一側（+1 / -1）：最靠陸的航道留在錨點（單艘船的位置），
   * 整組往海側展開；0 時以錨點置中。
   */
  shore?: -1 | 0 | 1;
}

/** `count` 艘同路徑船各自的航道（slot 0 起），相對於單艘船時的錨點。 */
export function shipLanes(count: number, { lane = SHIP_LANE, stagger = 0, shore = 0 }: ShipLaneOptions = {}): ShipLane[] {
  const step = count > 1 ? Math.min(lane, (3 * lane) / (count - 1)) : 0;
  const shift = shore * ((count - 1) / 2) * step;
  return Array.from({ length: count }, (_, slot) => ({
    across: (slot - (count - 1) / 2) * step + shift,
    along: count > 1 && stagger ? (slot % 2 ? stagger : -stagger) : 0,
  }));
}

/** 依船隻編號排序（`s2` 在 `s10` 之前），讓航道不隨陣列順序變動。 */
const byShipId = new Intl.Collator('en', { numeric: true }).compare;

/** Ships sharing an edge sit side by side: the lane (`slot` of `of`, ordered by ship id) of each ship on its edge. */
export function shipSlots(view: EpView | null): Map<string, { slot: number; of: number }> {
  const out = new Map<string, { slot: number; of: number }>();
  const byEdge = new Map<number, EpShipView[]>();
  for (const ship of view?.ships ?? []) byEdge.set(ship.edge, [...(byEdge.get(ship.edge) ?? []), ship]);
  for (const group of byEdge.values()) {
    group.sort((a, b) => byShipId(a.id, b.id)).forEach((ship, slot) => out.set(ship.id, { slot, of: group.length }));
  }
  return out;
}

/** Points a player has from E&P beyond the base score (harbour +1 each, mission tracks). */
export function epBonusPoints(view: EpView | null, playerId: string): number {
  const player = view?.players[playerId];
  if (!player) return 0;
  return player.harborPoints + Object.values(player.missionPoints).reduce<number>((sum, value) => sum + (value ?? 0), 0);
}

/** Display order of a player's ships: ship ids are `s<n>`. */
export function shipNumber(view: EpView | null, id: string): number {
  const own = (view?.ships ?? []).filter((ship) => ship.player === view?.ships.find((candidate) => candidate.id === id)?.player);
  return own.findIndex((ship) => ship.id === id) + 1;
}
