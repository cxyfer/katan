/**
 * C&K 的 view 與 hints accessor、frame data 型別守衛與指令建構函式（C&K 計畫 §4.1）。
 *
 * rules 沒有宣告 frame data 的型別（CK-A 只匯出 frame kind 字串），所以這裡以型別守衛宣告投影的形狀，
 * 並由 `test/ck-model.test.ts` 對照真實投影鎖住。守衛一律回傳 null 表示形狀不符，呼叫端自行處理：
 * 保底路徑不得 throw。
 */

import {
  CITIES_KNIGHTS,
  CK_DEFENDER_FRAME,
  CK_DIPLOMACY_FRAME,
  CK_DISPLACED_FRAME,
  CK_ESPIONAGE_FRAME,
  CK_GUILD_DUES_FRAME,
  CK_HARBOR_FRAME,
  CK_PILLAGE_FRAME,
  CK_PROGRESS_DISCARD_FRAME,
  CK_RESOLVE_ROLL_FRAME,
  CK_SABOTAGE_FRAME,
  CK_SCIENCE_FRAME,
  CK_TREASON_PLACE_FRAME,
  CK_TREASON_REMOVE_FRAME,
  CK_WEDDING_FRAME,
  type CardKind,
  type CitiesKnightsHints,
  type CitiesKnightsView,
  type CkTrack,
  type Commodity,
  type GameView,
  type PublicModulePendingView,
  type Resource,
} from '@catan/rules';
import type { BotCommand } from '../../types.ts';
import { moduleHints, moduleView } from '../view.ts';

export { CITIES_KNIGHTS };

export function ckView(view: Pick<GameView, 'modules'>): CitiesKnightsView | undefined {
  return moduleView(view, CITIES_KNIGHTS);
}

/** 傳入 `view.hints`。 */
export function ckHints(hints: GameView['hints']): CitiesKnightsHints | undefined {
  return moduleHints(hints, CITIES_KNIGHTS);
}

// ---------------------------------------------------------------------------
// frame
// ---------------------------------------------------------------------------

/** C&K 的 14 種 pending frame（含只負責續行的 resolveRoll）。 */
export const CK_FRAME_KINDS: readonly string[] = [
  CK_PILLAGE_FRAME,
  CK_DISPLACED_FRAME,
  CK_PROGRESS_DISCARD_FRAME,
  CK_DEFENDER_FRAME,
  CK_SCIENCE_FRAME,
  CK_RESOLVE_ROLL_FRAME,
  CK_HARBOR_FRAME,
  CK_GUILD_DUES_FRAME,
  CK_ESPIONAGE_FRAME,
  CK_SABOTAGE_FRAME,
  CK_WEDDING_FRAME,
  CK_TREASON_REMOVE_FRAME,
  CK_TREASON_PLACE_FRAME,
  CK_DIPLOMACY_FRAME,
];

/** pending 是不是 C&K 的 frame（kind 以 `citiesKnights.` 開頭）：其他模組與 base 的 frame 回 false。 */
export function isCkFrame(pending: unknown): pending is PublicModulePendingView {
  if (typeof pending !== 'object' || pending === null) return false;
  const kind = (pending as { kind?: unknown }).kind;
  return typeof kind === 'string' && kind.startsWith(`${CITIES_KNIGHTS}.`);
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function numbers(value: unknown): number[] | null {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'number' && Number.isFinite(entry))
    ? (value as number[])
    : null;
}

function counts(value: unknown): Record<string, number> | null {
  if (!isRecord(value)) return null;
  for (const amount of Object.values(value)) if (typeof amount !== 'number' || !Number.isFinite(amount)) return null;
  return value as Record<string, number>;
}

export interface PillageData {
  /** 每位 responder 可被掠奪的城市。 */
  readonly cities: Readonly<Record<string, readonly number[]>>;
}
export function pillageData(frame: PublicModulePendingView): PillageData | null {
  const raw = frame.data?.cities;
  if (!isRecord(raw)) return null;
  const cities: Record<string, readonly number[]> = {};
  for (const [id, list] of Object.entries(raw)) {
    const vertices = numbers(list);
    if (!vertices) return null;
    cities[id] = vertices;
  }
  return { cities };
}

export interface DisplacedData {
  readonly player: string;
  readonly level: number;
  readonly active: boolean;
  readonly from: number;
  /** 騎士可以撤退到的路口（即時投影）。 */
  readonly options: readonly number[];
}
export function displacedData(frame: PublicModulePendingView): DisplacedData | null {
  const data = frame.data;
  const options = numbers(data?.options);
  if (!isRecord(data) || !options) return null;
  const { player, level, active, from } = data;
  if (typeof player !== 'string' || typeof level !== 'number' || typeof active !== 'boolean' || typeof from !== 'number') return null;
  return { player, level, active, from, options };
}

export interface ProgressDiscardData {
  readonly required: Readonly<Record<string, number>>;
}
export function progressDiscardData(frame: PublicModulePendingView): ProgressDiscardData | null {
  const required = counts(frame.data?.required);
  return required ? { required } : null;
}

export interface DefenderDrawData {
  /** 還有牌的牌組。 */
  readonly decks: readonly CkTrack[];
}
export function defenderDrawData(frame: PublicModulePendingView): DefenderDrawData | null {
  const raw = frame.data?.decks;
  if (!Array.isArray(raw) || !raw.every((deck) => typeof deck === 'string')) return null;
  return { decks: raw as CkTrack[] };
}

export interface HarborData {
  readonly from: string;
  /** 只有提出者與接收者看得到。 */
  readonly resource?: Resource;
}
export function harborData(frame: PublicModulePendingView): HarborData | null {
  const data = frame.data;
  if (!isRecord(data) || typeof data.from !== 'string') return null;
  return typeof data.resource === 'string' ? { from: data.from, resource: data.resource as Resource } : { from: data.from };
}

export interface GuildDuesData {
  readonly victim: string;
  readonly count: number;
  /** 受害者的手牌，只給行動者。 */
  readonly hand?: Readonly<Partial<Record<CardKind, number>>>;
}
export function guildDuesData(frame: PublicModulePendingView): GuildDuesData | null {
  const data = frame.data;
  if (!isRecord(data) || typeof data.victim !== 'string' || typeof data.count !== 'number') return null;
  const hand = counts(data.hand);
  return hand ? { victim: data.victim, count: data.count, hand } : { victim: data.victim, count: data.count };
}

export interface EspionageData {
  readonly victim: string;
  readonly count: number;
  /** 受害者的進步卡，只給行動者。 */
  readonly cards?: readonly string[];
}
export function espionageData(frame: PublicModulePendingView): EspionageData | null {
  const data = frame.data;
  if (!isRecord(data) || typeof data.victim !== 'string' || typeof data.count !== 'number') return null;
  const cards = data.cards;
  return Array.isArray(cards) && cards.every((card) => typeof card === 'string')
    ? { victim: data.victim, count: data.count, cards: cards as string[] }
    : { victim: data.victim, count: data.count };
}

/** Sabotage 與 Wedding 共用。 */
export interface GiveCardsData {
  readonly actor: string;
  readonly required: Readonly<Record<string, number>>;
}
export function giveCardsData(frame: PublicModulePendingView): GiveCardsData | null {
  const required = counts(frame.data?.required);
  const actor = frame.data?.actor;
  return required && typeof actor === 'string' ? { actor, required } : null;
}

export interface TreasonRemoveData {
  readonly actor: string;
  /** 受害者自己的騎士。 */
  readonly knights: readonly number[];
}
export function treasonRemoveData(frame: PublicModulePendingView): TreasonRemoveData | null {
  const knights = numbers(frame.data?.knights);
  const actor = frame.data?.actor;
  return knights && typeof actor === 'string' ? { actor, knights } : null;
}

export interface TreasonPlaceData {
  readonly level: number;
  readonly active: boolean;
  readonly from: number;
  /** 可以放的等級。 */
  readonly levels: readonly number[];
  readonly sites: readonly number[];
}
export function treasonPlaceData(frame: PublicModulePendingView): TreasonPlaceData | null {
  const data = frame.data;
  const levels = numbers(data?.levels);
  const sites = numbers(data?.sites);
  if (!isRecord(data) || !levels || !sites) return null;
  const { level, active, from } = data;
  if (typeof level !== 'number' || typeof active !== 'boolean' || typeof from !== 'number') return null;
  return { level, active, from, levels, sites };
}

export interface DiplomacyData {
  /** 被拆掉的那條道路或船。 */
  readonly edge: number;
  readonly edges: readonly number[];
  /** SF+CK：拆的是船，要重建船。 */
  readonly ship: boolean;
}
export function diplomacyData(frame: PublicModulePendingView): DiplomacyData | null {
  const data = frame.data;
  const edges = numbers(data?.edges);
  if (!isRecord(data) || !edges || typeof data.edge !== 'number') return null;
  return { edge: data.edge, edges, ship: data.ship === true };
}

// ---------------------------------------------------------------------------
// 指令建構函式（欄位名稱依 rules 的 handler）
// ---------------------------------------------------------------------------

const command = (type: string, fields: Record<string, unknown> = {}): BotCommand => ({ type, ...fields }) as BotCommand;

export const ckCommands = {
  // action
  buildWall: (vertex: number) => command('build.wall', { vertex }),
  /** `vertex` 只在這次升級會獲得大都市時給（放在哪座城市）。 */
  improveCity: (track: CkTrack, vertex?: number) => command('city.improve', vertex === undefined ? { track } : { track, vertex }),
  recruitKnight: (vertex: number) => command('knight.recruit', { vertex }),
  activateKnight: (vertex: number) => command('knight.activate', { vertex }),
  promoteKnight: (vertex: number) => command('knight.promote', { vertex }),
  moveKnight: (from: number, to: number) => command('knight.move', { from, to }),
  displaceKnight: (from: number, to: number) => command('knight.displace', { from, to }),
  chaseRobber: (vertex: number) => command('knight.chaseRobber', { vertex }),
  /** 各卡的目標欄位不同（`hex`、`target`、`kind`、`edge` 等），由呼叫端依 hints 的 targets 傳入。 */
  playProgress: (card: string, fields: Record<string, unknown> = {}) => command('progress.play', { card, ...fields }),
  harborOffer: (to: string, resource: Resource) => command('progress.harborOffer', { to, resource }),
  // pending
  retreatKnight: (vertex: number) => command('knight.retreat', { vertex }),
  pillage: (vertex: number) => command('barbarians.pillage', { vertex }),
  chooseDeck: (track: CkTrack) => command('barbarians.chooseDeck', { track }),
  discardProgress: (cards: readonly string[]) => command('progress.discard', { cards: cards.slice() }),
  /** `null` 是明確的放棄；缺少 `resource` 會被拒絕。 */
  scienceTake: (resource: Resource | null) => command('science.take', { resource }),
  harborAnswer: (commodity: Commodity) => command('progress.harborAnswer', { commodity }),
  takeCards: (cards: readonly CardKind[]) => command('progress.takeCards', { cards: cards.slice() }),
  takeProgress: (card: string | null) => command('progress.takeProgress', { card }),
  sabotageDiscard: (cards: readonly CardKind[]) => command('progress.sabotageDiscard', { cards: cards.slice() }),
  weddingGive: (cards: readonly CardKind[]) => command('progress.weddingGive', { cards: cards.slice() }),
  treasonRemove: (vertex: number) => command('progress.treasonRemove', { vertex }),
  /** `vertex: null` 放棄放置（不檢查等級）；放置時要帶 `level`。 */
  treasonPlace: (vertex: number | null, level?: number) =>
    command('progress.treasonPlace', vertex === null || level === undefined ? { vertex } : { vertex, level }),
  diplomacyRoad: (edge: number | null) => command('progress.diplomacyRoad', { edge }),
};
