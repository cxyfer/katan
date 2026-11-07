/**
 * Seafarers 的 BotModule（SF 計畫 §4）。SF-1 註冊模組並接上全部 0.4.1 鉤子：保底與節奏已完成，
 * 其餘鉤子先接到 stub 檔，後續切片只改各自的檔案，不必再改這裡：
 * - `plan.ts`（SF-2a）：economy 鉤子與 `planStep`
 * - `actions.ts`（SF-2a）：`actions` 與 `freeRouteCandidates`
 * - `frames.ts`（SF-2b）：`answerFrame`
 * - `bandit.ts`（SF-2b）：`banditCandidates` 與 `preroll`
 * - `setup.ts`（SF-2b）：`setup`
 */

import type { BotModule } from '../types.ts';
import { seafarersActions, seafarersFreeRouteCandidates } from './actions.ts';
import { seafarersBanditCandidates, seafarersPreroll } from './bandit.ts';
import { seafarersDuty } from './duty.ts';
import { seafarersAnswerFrame } from './frames.ts';
import { seafarersEconomy, seafarersPlanStep } from './plan.ts';
import { seafarersSetup } from './setup.ts';

/**
 * Bot 能玩的 Seafarers 劇本（D-SF9）。SF-4 起只放行 `new-shores`（Heading for New Shores）；
 * 其他劇本與 SF+CK 不會被自動放行，新增劇本時須同步更新 `support.test.ts` 的快照。
 */
export const SUPPORTED_SCENARIOS: readonly (string | null)[] = ['new-shores'];

/** 各指令的思考延遲（毫秒，§4.6）。每個行動視窗的指令上限維持 40，不設 `maxCommandsPerWindow`。 */
export const SEAFARERS_PACING: Readonly<Record<string, number>> = {
  'build.ship': 900,
  'setup.placeShip': 600,
  'ship.move': 700,
  'gold.choose': 800,
};

export const seafarersBotModule: BotModule = {
  id: 'seafarers',
  supports: (profile) => SUPPORTED_SCENARIOS.includes(profile.scenario),
  duty: seafarersDuty,
  answerFrame: seafarersAnswerFrame,
  setup: seafarersSetup,
  preroll: seafarersPreroll,
  actions: seafarersActions,
  freeRouteCandidates: seafarersFreeRouteCandidates,
  banditCandidates: seafarersBanditCandidates,
  planStep: seafarersPlanStep,
  economy: seafarersEconomy,
  pacing: SEAFARERS_PACING,
  // 非行動者在 gold frame 裡也要作答（依序輪到自己時）。
  responseCommands: ['gold.choose'],
};
