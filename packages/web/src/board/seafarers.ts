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

/** 世外部落邊上的禮物（發展牌只有位置，沒有身分）。 */
export interface TribeGiftView {
  edge: number;
  kind: 'vp' | 'devcard' | 'port';
  /** 港口種類（面朝上，公開）。 */
  harbor?: string;
}

/** 世外部落：邊上的禮物、各玩家的 VP 標記數與暫存在面前的港口（全部公開）。 */
export interface TribeView {
  gifts: TribeGiftView[];
  vp: Record<string, number>;
  held: Record<string, string[]>;
}

/** 布匹產地的部落（頂點、圓片數字、剩餘布匹）。 */
export interface ClothTribeView {
  vertex: number;
  number: number;
  cloth: number;
}

/** 布匹產地：部落、供應堆、各玩家布匹與已建立關係的部落索引（全部公開）。 */
export interface ClothView {
  tribes: ClothTribeView[];
  supply: number;
  links: Record<string, number[]>;
  cloth: Record<string, number>;
}

/** 卡坦奇觀：地圖上的標記（交叉點索引）、各玩家認領的奇觀與完成層數（全部公開）。 */
export interface WondersView {
  markers: { greatWall: number[]; greatBridge: number[]; x: number[] };
  owned: Record<string, string | null>;
  levels: Record<string, number>;
}

/** 每 2 枚布匹 1 分，餘數不計（SF25 p. 14）。 */
export const clothPoints = (count: number): number => Math.floor(count / 2);

/** 回合結束時沒有布匹的部落達到這個數目就終局。 */
export const CLOTH_EXHAUSTED_TRIBES = 5;

/** 海盜巢穴的堡壘：頂點與剩餘的 pirate lair 數（0 = 已收復）。 */
export interface PirateFortressView {
  player: string;
  vertex: number;
  lairs: number;
}

export interface PirateBeachheadView {
  player: string;
  vertex: number;
}

/** 一位玩家的西島船線：起點、依序的邊、端點與下一個目標。 */
export interface PirateLineView {
  start: number | null;
  edges: number[];
  end: number | null;
  next: 'beachhead' | 'fortress' | 'done';
}

/** 海盜巢穴：堡壘、beachhead、各玩家船線與海盜航道（hex 索引，順時針）；全部公開。 */
export interface PirateIslandsView {
  fortresses: PirateFortressView[];
  beachheads: PirateBeachheadView[];
  lines: Record<string, PirateLineView>;
  route: number[];
}

/** 新世界設置階段的港口：現在抽到的港口（面朝上，公開）、已放數量與是否還能重新產生版圖。 */
export interface WorldView {
  drawn: string | null;
  placed: number;
  total: number;
  rerolls: number;
  canRegenerate: boolean;
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
  /** 世外部落的禮物與標記；其他劇本為 null。 */
  tribe: TribeView | null;
  /** 布匹產地的部落與布匹；其他劇本為 null。 */
  cloth: ClothView | null;
  /** 海盜巢穴的堡壘、beachhead、船線與航道；其他劇本為 null。 */
  pirateIslands: PirateIslandsView | null;
  /** 自己船線的下一個目標頂點（hints 的 `pirateLine.target`）；沒有時為 null。 */
  lineTarget: number | null;
  /** 新世界的港口設置階段；其他劇本為 null。 */
  world: WorldView | null;
  /** 卡坦奇觀的標記與奇觀進度；其他劇本為 null。 */
  wonders: WondersView | null;
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
  /** 世外部落：輪到此玩家放港口時，暫存的港口種類與可放的邊。 */
  harborChoices: { harbors: string[]; edges: number[] };
  /** 布匹產地：偷海盜旁的玩家時，手上有布匹因此可以改偷布匹的候選人。 */
  clothVictims: string[];
  /** 卡坦奇觀：現在可認領的奇觀與能否蓋下一層（只在自己的行動階段有值）。 */
  wonders: { claimable: string[]; buildable: boolean };
  /** 海盜巢穴：自己船線的下一個目標（beachhead、堡壘或已完成）、目標頂點、端點與船線的邊。 */
  pirateLine: { next: 'beachhead' | 'fortress' | 'done'; target: number | null; end: number | null; edges: number[] } | null;
}

export const SHIP_COST: Partial<Record<Resource, number>> = { lumber: 1, wool: 1 };

/** Points one island claim is worth (SF25 p. 4); other scenarios read `profile.islandBonus.points`. */
export const ISLAND_BONUS_POINTS = 2;

/** Board commands whose edge target is a ship. */
const SHIP_COMMANDS = new Set(['build.ship', 'setup.placeShip', 'ship.move', 'ship.pick']);

/** 世外部落禮物上顯示的港口比率與標示（2:1 資源港、3:1 通用港）。 */
export const harborRatio = (type: string): string => (type === 'generic' ? '3:1' : '2:1');

export function isShipCommand(commandType: string | null | undefined): boolean {
  return !!commandType && (SHIP_COMMANDS.has(commandType) || isEpShipCommand(commandType));
}

export function seafarersView(view: (Pick<GameView, 'modules'> & Partial<Pick<GameView, 'hints'>>) | null | undefined): SeafarersModuleView | null {
  const slot = view?.modules?.seafarers as Partial<SeafarersModuleView> | undefined;
  if (!slot) return null;
  return {
    islandBonus: slot.islandBonus ?? {},
    islandClaims: slot.islandClaims ?? [],
    shipsBuiltThisTurn: slot.shipsBuiltThisTurn ?? [],
    shipMoved: !!slot.shipMoved,
    home: slot.home ?? null,
    fog: slot.fog ?? [],
    tribe: slot.tribe ?? null,
    cloth: slot.cloth ?? null,
    pirateIslands: slot.pirateIslands ?? null,
    lineTarget: (view?.hints?.modules?.seafarers as { pirateLine?: { target?: number | null } | null } | undefined)?.pirateLine?.target ?? null,
    world: slot.world ?? null,
    wonders: slot.wonders ?? null,
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
    harborChoices: slot.harborChoices ?? { harbors: [], edges: [] },
    clothVictims: slot.clothVictims ?? [],
    wonders: slot.wonders ?? { claimable: [], buildable: false },
    pirateLine: slot.pirateLine ?? null,
  };
}

/** Island bonus points a player holds (public). */
export function islandBonusPoints(view: Pick<GameView, 'modules'> | null | undefined, playerId: string, points = ISLAND_BONUS_POINTS): number {
  return (seafarersView(view)?.islandBonus[playerId]?.length ?? 0) * points;
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
