/**
 * Traders & Barbarians 的 BotModule（T&B 計畫 §3.2–§3.3、§4.1、§4.4）。
 *
 * rules 以單一 `tradersBarbarians` module 組合劇本與變體的 part；這裡照做：依 profile 啟用的 part（rules 順序，
 * `parts.ts` 的 `tbPartsOf`）組合各 part 的 `TbPartBot`，規則與骨架組合模組的方式相同（`B/modules/compose.ts`）：
 *
 * - `answerFrame`、`setup`、`planStep`：第一個 `!== undefined` 的答案勝出（含 null）。
 * - `preroll`、`actions`：依 part 順序串接候選。
 * - `robberTargets`：依 part 順序 fold；某個 part 丟例外時沿用上一組（與 base 的 fold 相同）。
 * - economy：`costs`、`piecesLeft` 合併，同一個鍵先出現者優先；`scoreExtras` 串接；`hexYield` 第一個非 undefined 勝出；
 *   `discardLimit` 依序 fold；`awards` 任一 part 回 `longestRoad: false` 就關閉（§12.4 C1）；`routeEdge` 任一 part 回 false
 *   就不經過。其他 economy 鉤子 T&B 不用。
 * - `trade.goods` 合併（同一個 good 先出現者優先）；`trade.goodValue` 第一個非 undefined 勝出（§12.4 C2）。
 *
 * economy 與 trade 只在至少一個 part 定義了對應鉤子時才出現在模組上：骨架以「鉤子存在」決定是否組合盤面掛點
 * （例如 `hexYield`），沒有 part 需要時模組的形狀就與沒有這些鉤子相同。
 *
 * 保底（`duty`）是 `duty.ts` 的整張表，不經 part。`supports` 讀原始的劇本與變體 id（§3.3）；S9 起 `TB_READY_PARTS`
 * 含全部 8 個 part，8 個 T&B profile 都可以讓 Bot 入座，4 個 `tb-event-cards*` 仍然不行。
 */

import { getProfile, TB_PENDING_COMMANDS, type GameView, type ProfileDefinition } from '@katan/rules';
import type { BoardModel } from '../../board.ts';
import type { Plan } from '../../economy.ts';
import type { BanditTarget, BotCommand, BotEconomyHooks, BotModule, BotTradeHooks, Scored } from '../types.ts';
import { isTbFrame } from './frames.ts';
import { tradersBarbariansDuty } from './duty.ts';
import type { TbPartBot } from './part.ts';
import { TB_PART_BOTS, TB_READY_PARTS, tbPartsOf, tbSupports } from './parts.ts';
import { TRADERS_BARBARIANS } from './view.ts';

/**
 * frame 進行中可以送的 15 個模組指令（rules 的 `pendingCommands`）。`wagonPlace` 可能由非行動者（多數持有者）放置，
 * `wagonBid`／`wagonAssign` 每位玩家都要作答，所以全部列為回應型指令，不能只列一部分。
 */
export const TB_RESPONSE_COMMANDS: readonly string[] = TB_PENDING_COMMANDS;

/**
 * 各指令的思考延遲（毫秒，§4.4 全表）。鍵一律是 `tb.*`，不與 base、Seafarers、C&K、SF+CK 重複（server 把它們攤平合併，
 * 重複的鍵以先註冊者為準）。`pending.moveRobber` 不列，沿用 base 的 1200。
 */
export const TB_PACING: Readonly<Record<string, number>> = {
  // 建造與花費
  'tb.buildBridge': 900,
  'tb.buildBaCard': 900,
  'tb.upgradeWagon': 900,
  'tb.spendFish': 900,
  'tb.giveBoot': 900,
  'tb.buyResource': 800,
  'tb.sellResources': 800,
  // 打牌（同 dev.play*）
  'tb.playKnight': 1100,
  'tb.playSwiftJourney': 1100,
  // frame 回應
  'tb.moveBarbarian': 1200,
  'tb.bidWagon': 1000,
  'tb.driveOff': 1000,
  'tb.assignWagon': 900,
  'tb.placeWagon': 900,
  'tb.baCapture': 900,
  'tb.baPlaceKnight': 900,
  'tb.baTreason': 900,
  'tb.fishSwap': 800,
  'tb.baSteal': 800,
  // 回合結束的移動
  'tb.wagonStep': 450,
  'tb.wagonBoost': 600,
  'tb.moveKnight': 600,
  'tb.wagonStop': 500,
  'tb.endKnights': 700,
};

/**
 * 每個行動視窗的指令上限：維持 base 的 40（D-TB7）。Traders 的車隊移動排在同一個視窗裡，策略在單一 `tbWagon` frame
 * 最多送 12 個指令（§4.4）；Q3 量到任何 profile 超過 30 時改為 60，只影響 T&B profile。
 */
export const TB_COMMANDS_PER_WINDOW = 40;

type Answer = BotCommand | null | undefined;

/** 依序詢問，第一個 `!== undefined` 的答案勝出（含 null）。 */
function firstOf<T>(parts: readonly TbPartBot[], ask: (part: TbPartBot) => T | null | undefined): T | null | undefined {
  for (const part of parts) {
    const answer = ask(part);
    if (answer !== undefined) return answer;
  }
  return undefined;
}

function concatOf<T>(parts: readonly TbPartBot[], get: (part: TbPartBot) => readonly T[] | undefined): T[] {
  const out: T[] = [];
  for (const part of parts) out.push(...(get(part) ?? []));
  return out;
}

function mergeFirstWins<T>(layers: readonly Readonly<Record<string, T>>[]): Record<string, T> {
  const out: Record<string, T> = {};
  for (const layer of layers) {
    for (const [key, value] of Object.entries(layer)) if (!Object.hasOwn(out, key)) out[key] = value;
  }
  return out;
}

/**
 * 以 part 表組出 BotModule。`table`、`ready` 預設是正式的 part 表與開放清單；測試可以注入別的表（例如加上假的 part）
 * 檢查組合規則，不必改常數。
 */
export function createTradersBarbariansModule(
  table: ReadonlyMap<string, TbPartBot> = TB_PART_BOTS,
  ready: ReadonlySet<string> = TB_READY_PARTS,
): BotModule {
  const all = [...table.values()];
  const cache = new WeakMap<ProfileDefinition, readonly TbPartBot[]>();
  const partsOfProfile = (profile: ProfileDefinition | undefined): readonly TbPartBot[] => {
    if (!profile) return [];
    let parts = cache.get(profile);
    if (!parts) {
      parts = tbPartsOf(profile, table);
      cache.set(profile, parts);
    }
    return parts;
  };
  // 查不到 profile 時沒有 part（不 throw）。
  const partsOf = (view: Pick<GameView, 'profileId'>): readonly TbPartBot[] => partsOfProfile(getProfile(view.profileId));

  const economy = composeEconomy(all, (model) => partsOfProfile(model.profile));
  const trade = composeTrade(all, partsOf);
  const pacing = { ...mergeFirstWins(all.map((part) => part.pacing ?? {})), ...TB_PACING };
  const responseCommands = [...new Set([...TB_RESPONSE_COMMANDS, ...all.flatMap((part) => part.responseCommands ?? [])])];

  return {
    id: TRADERS_BARBARIANS,
    supports: (profile) => tbSupports(profile, ready),
    duty: tradersBarbariansDuty,
    answerFrame: (turn, frame): Answer =>
      isTbFrame(frame) ? firstOf(partsOf(turn.view), (part) => part.answerFrame?.(turn, frame)) : undefined,
    setup: (turn): Answer => firstOf(partsOf(turn.view), (part) => part.setup?.(turn)),
    preroll: (turn): Scored<BotCommand>[] => concatOf(partsOf(turn.view), (part) => part.preroll?.(turn)),
    actions: (turn): Scored<BotCommand>[] => concatOf(partsOf(turn.view), (part) => part.actions?.(turn)),
    planStep: (turn, plan: Plan): Answer => firstOf(partsOf(turn.view), (part) => part.planStep?.(turn, plan)),
    robberTargets: (view, selfId, targets) => {
      let current: readonly BanditTarget[] = targets;
      for (const part of partsOf(view)) {
        if (!part.robberTargets) continue;
        try {
          const next = part.robberTargets(view, selfId, current);
          if (Array.isArray(next)) current = next;
        } catch {
          // 保底路徑也會呼叫：丟例外的 part 視為沒有意見。
        }
      }
      return current;
    },
    ...(economy ? { economy } : {}),
    ...(trade ? { trade } : {}),
    pacing,
    maxCommandsPerWindow: TB_COMMANDS_PER_WINDOW,
    responseCommands,
  };
}

/** 只放至少一個 part 定義了的 economy 鉤子；一個都沒有時回 undefined。 */
function composeEconomy(
  all: readonly TbPartBot[],
  partsOf: (model: BoardModel) => readonly TbPartBot[],
): BotEconomyHooks | undefined {
  const has = (hook: keyof BotEconomyHooks): boolean => all.some((part) => part.economy?.[hook] !== undefined);
  const hooks: BotEconomyHooks = {
    ...(has('costs') && {
      costs: (model) => mergeFirstWins(partsOf(model).map((part) => part.economy?.costs?.(model) ?? {})),
    }),
    ...(has('piecesLeft') && {
      piecesLeft: (model) => mergeFirstWins(partsOf(model).map((part) => part.economy?.piecesLeft?.(model) ?? {})),
    }),
    ...(has('scoreExtras') && {
      scoreExtras: (input) => concatOf(partsOf(input.model), (part) => part.economy?.scoreExtras?.(input)),
    }),
    ...(has('hexYield') && {
      hexYield: (model, hex, vertex, city) =>
        firstOf(partsOf(model), (part) => part.economy?.hexYield?.(model, hex, vertex, city)) ?? undefined,
    }),
    ...(has('discardLimit') && {
      discardLimit: (model, base) =>
        partsOf(model).reduce((limit, part) => {
          const next = part.economy?.discardLimit?.(model, limit);
          return typeof next === 'number' && Number.isFinite(next) ? next : limit;
        }, base),
    }),
    ...(has('routeEdge') && {
      routeEdge: (model, edge) =>
        partsOf(model).some((part) => part.economy?.routeEdge?.(model, edge) === false) ? false : undefined,
    }),
    ...(has('awards') && {
      awards: (model) =>
        partsOf(model).some((part) => part.economy?.awards?.(model).longestRoad === false) ? { longestRoad: false } : {},
    }),
  };
  return Object.keys(hooks).length > 0 ? hooks : undefined;
}

/** 只放至少一個 part 定義了的 trade 鉤子；一個都沒有時回 undefined。 */
function composeTrade(
  all: readonly TbPartBot[],
  partsOf: (view: Pick<GameView, 'profileId'>) => readonly TbPartBot[],
): BotTradeHooks | undefined {
  const has = (hook: keyof BotTradeHooks): boolean => all.some((part) => part.trade?.[hook] !== undefined);
  const hooks: BotTradeHooks = {
    ...(has('goods') && {
      goods: (view, playerId) => mergeFirstWins(partsOf(view).map((part) => part.trade?.goods?.(view, playerId) ?? {})),
    }),
    ...(has('goodValue') && {
      goodValue: (turn, good, amount, side) =>
        firstOf(partsOf(turn.view), (part) => part.trade?.goodValue?.(turn, good, amount, side)),
    }),
  };
  return Object.keys(hooks).length > 0 ? hooks : undefined;
}

export const tradersBarbariansBotModule: BotModule = createTradersBarbariansModule();
