/**
 * 變體 Friendly Robber 與 Harbors 的策略（T&B 計畫 §4.2）。S2 只放 `id` 的 stub，策略由 S3 實作；唯一的例外是
 * FR 的 `robberTargets`，它是正確性必需（§4.1 第 13 列），不是策略：
 *
 * base 的保底取盜賊目標 fold 的第一項（`B/base/duty.ts:22-26`），而 fold 的初值排除強盜現位格。FR 在所有玩家都受保護時
 * 只能放沙漠，即使強盜已經在沙漠（`TB/variants/friendlyRobber.ts:34-41`；引擎接受模組列入的現位格）。所以這裡把集合
 * 換成 hints 的 `robberHexes`（rules 已套用 FR 的縮減，與行動者無關）；hints 缺漏時原樣回傳收到的集合。
 * 只讀 hints，不 throw、不消耗亂數。
 */

import type { TbPartBot } from './part.ts';
import { TB_PART_IDS, tbRobberHexes } from './view.ts';

export const friendlyRobberBot: TbPartBot = {
  id: TB_PART_IDS.friendlyRobber,
  robberTargets: (view, _selfId, targets) => tbRobberHexes(view.hints) ?? targets,
};

export const harborsBot: TbPartBot = {
  id: TB_PART_IDS.harbors,
};
