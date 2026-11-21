/**
 * Explorers & Pirates 的 BotModule 骨架（E&P 計畫 §4.9、§5.1 E0）。
 *
 * E0 註冊模組與節奏，E1 接上保底 `duty` 與最小的 `setup`：`supports` 仍恆為 false，
 * E&P 的房間仍然拒絕 Bot 入座（E2 起才開放）；後續切片再接上 phase 與 endWindow。
 */

import type { BotModule } from '../types.ts';
import { explorersPiratesDuty, setupDuty } from './duty.ts';
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

export const explorersPiratesBotModule: BotModule = {
  id: 'explorersPirates',
  // E0：骨架尚未實作策略，E&P 房間不放行 Bot。
  supports: () => false,
  pacing: EP_PACING,
  // 單一視窗最壞約 75 個指令（計畫 §4.9 的推導）。
  maxCommandsPerWindow: 80,
  duty: explorersPiratesDuty,
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
