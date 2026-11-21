/**
 * E&P 的任務登錄（計畫 §4.2；E3）。每個任務提供三件事給 `movement.ts`：
 * - `targets`：這艘船的任務航點（終點邊 → 種類與價值），併入航程規劃；
 * - `here`：船此刻就在任務地點、有免費動作可做（`endWindow` 據此決定要不要進 Movement）；
 * - `free`：Movement 的免費動作（`ep.dropCrew`、`ep.load`、之後的 `loadFish`、`deliver` 等），在航程之前送出。
 * 魚與香料任務的外殼先回傳空結果，E4a、E4b 填入。
 */

import type { BotCommand } from '../../types.ts';
import type { Fleet } from '../movement.ts';
import type { EpHints, EpShipView } from '../view.ts';
import { fishMission } from './fish.ts';
import { lairsMission } from './lairs.ts';
import { spicesMission } from './spices.ts';

/** 任務航程的種類：`fetch` 是到 harbour 載棋子，其餘是前往任務地點。 */
export type MissionKind = 'lair' | 'fish' | 'spice' | 'fetch';

export interface MissionTarget {
  readonly kind: MissionKind;
  readonly value: number;
}

export interface Mission {
  readonly id: 'lairs' | 'fish' | 'spices';
  targets(f: Fleet, ship: EpShipView): ReadonlyMap<number, MissionTarget>;
  here(f: Fleet, ship: EpShipView): boolean;
  free(f: Fleet, hints: EpHints): BotCommand | null;
}

const MISSIONS: readonly Mission[] = [lairsMission, fishMission, spicesMission];

/** 這個劇本有的任務（依登錄順序，即 Full 的任務優先序）。 */
export function activeMissions(f: Fleet): readonly Mission[] {
  const have = f.g.ep.missions as readonly string[];
  return MISSIONS.filter((mission) => have.includes(mission.id));
}
