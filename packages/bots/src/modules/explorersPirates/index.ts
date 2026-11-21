/**
 * Explorers & Pirates 的 BotModule（E&P 計畫 §4.9、§5.1）。
 *
 * E0 註冊模組與節奏，E1 接上保底 `duty` 與最小的 `setup`，E2 接上 Land Ho! 的策略：economy 鉤子與計畫、
 * Action 的 `actions`／`planStep`／`endWindow`、Movement 的 `phase`、金幣的 trade 鉤子，並依部件開放 `supports`。
 */

import { epScenario, type ProfileDefinition } from '@katan/rules';
import type { BotModule } from '../types.ts';
import { epActions, epEndWindow, epPlanStep } from './action.ts';
import { explorersPiratesDuty, setupDuty } from './duty.ts';
import { epMovement } from './movement.ts';
import { explorersPiratesEconomy } from './plans.ts';
import { explorersPiratesTrade } from './trade.ts';
import { epHints, epView } from './view.ts';

/** 各指令的思考延遲（毫秒，§4.9 全表）。鍵一律是 `ep.*`，不與其他模組重複。 */
export const EP_PACING: Readonly<Record<string, number>> = {
  'ep.moveShip': 400,
  // 免費的 cargo 動作
  'ep.load': 600,
  'ep.unload': 600,
  'ep.swap': 600,
  'ep.dropCrew': 600,
  'ep.pickCrew': 600,
  'ep.loadFish': 600,
  'ep.loadSpice': 600,
  'ep.deliver': 600,
  'ep.startMovement': 600,
  'ep.extraMove': 700,
  // 與 trade.bank 相同
  'ep.buyResource': 800,
  'ep.sellForGold': 800,
  'ep.fastGold': 800,
  // 建造類，與 setup.placeBuilding 相同
  'ep.buildHarbor': 900,
  'ep.buildShip': 900,
  'ep.buildSettler': 900,
  'ep.buildCrew': 900,
  'ep.found': 900,
  'ep.setupHarbor': 900,
  'ep.setupSettlement': 900,
  // 與 setup.placeRoad 相同
  'ep.setupRoad': 600,
  'ep.setupShip': 600,
  // 沒有骰子演出
  'ep.fishRoll': 1000,
  'ep.chase': 1000,
  'ep.placePirate': 1200,
  'ep.robPlayer': 800,
};

/**
 * Bot 已經會玩的部件（§4.8 N3）。`core` 是共同的底座（Land Ho! 只有它）；E3 起加入 `pirates`、`lairs`，
 * E4a、E4b 再加入 `fish`、`spices`。
 */
export const SUPPORTED_PARTS: readonly string[] = ['core'];

/**
 * profile 需要的任務部件：`missions` 加上有海盜時的 `pirates`；未知 scenario 回 null（不 throw）。
 * `core` 不列入：它是每個 E&P profile 都有的底座。
 */
export function epPartsOf(profile: Pick<ProfileDefinition, 'scenario'>): string[] | null {
  try {
    const scenario = epScenario(profile.scenario);
    return [...scenario.missions, ...(scenario.pirates ? ['pirates'] : [])];
  } catch {
    return null;
  }
}

/** 部件都在 `ready` 內、而且人數不超過 4（CN3086 的 5–6 人尚未實作）才開放。 */
export function epSupports(profile: ProfileDefinition, ready: readonly string[] = SUPPORTED_PARTS): boolean {
  const parts = epPartsOf(profile);
  return parts !== null && profile.playerCounts.every((count) => count <= 4) && parts.every((part) => ready.includes(part));
}

export const explorersPiratesBotModule: BotModule = {
  id: 'explorersPirates',
  supports: (profile) => epSupports(profile),
  pacing: EP_PACING,
  // 單一視窗最壞約 75 個指令（計畫 §4.9 的推導）。
  maxCommandsPerWindow: 80,
  duty: explorersPiratesDuty,
  economy: explorersPiratesEconomy,
  trade: explorersPiratesTrade,
  actions: epActions,
  planStep: epPlanStep,
  endWindow: epEndWindow,
  phase: epMovement,
  /**
   * 變動式開局：只要 `V.setupStep` 非 null 就接管，讓 base 的 setup 指令（會被 veto）不會送出；
   * 游標上回傳最小動作，其他座位回 null。E3 以策略取代（§4.2）。
   */
  setup(turn) {
    if (!epView(turn.view)?.setupStep) return undefined;
    const hints = epHints(turn.view.hints);
    return hints ? (setupDuty(hints) ?? null) : null;
  },
};
