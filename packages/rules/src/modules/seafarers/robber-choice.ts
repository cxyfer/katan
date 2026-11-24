/**
 * 布匹產地 variable setup 的選強盜（SF25 p. 15：「Players choose which hex with a number 12 disc should
 * start the game with the robber」）。
 *
 * 版圖隨機後 12 號圓片可能在兩座大島的任何格（共 2 枚），所以強盜的起點由玩家決定。實作成
 * `SetupState.stage = 'robber'`（與新世界的 `harbor` 階段同一種做法：沒有 pending frame，所以不會與設置的
 * 其他流程搶 frame）：開局時只有 variable 的布匹產地進入此階段；起始玩家（`order[0]`，「玩家們」的代表）在
 * 12 號圓片格中選一個，選完回到 `building`，從 `order[0]` 起照原本的設置順序放起始村落。
 * 這一步不消耗 rng；強盜在選擇前暫放在第一個 12 號格（layout 的初值），選擇後移到選定的格。
 * 全部狀態都在 `turn.setup.stage` 與 `board.robber`，所以 snapshot／重啟還原不需額外欄位。
 */

import type { CommandOutcome, GameState } from '../../types.ts';
import type { ModuleCommand, ModuleContext } from '../types.ts';
import { isClothForCatan } from './cloth.ts';

export const CLOTH_ROBBER_COMMAND = 'cloth.robber' as const;

/** 選強盜階段進行中。 */
export const robberChoicePhase = (state: GameState): boolean =>
  state.turn.phase === 'setup' && state.turn.setup?.stage === 'robber';

/** 可選的格：所有 12 號圓片格。 */
export function robberChoiceHexes(state: GameState): number[] {
  if (!robberChoicePhase(state)) return [];
  return state.board.layout.numbers.flatMap((number, hex) => number === 12 ? [hex] : []);
}

/** 開局：variable 的布匹產地先選強盜；fixed 直接放 (-2,-1)，不進入此階段。 */
export function initRobberChoice(state: GameState, ctx: ModuleContext): void {
  if (!isClothForCatan(ctx) || ctx.setupMode !== 'variable') return;
  state.turn.setup!.stage = 'robber';
  state.turn.seat = state.turn.setup!.order[0]!;
}

/** `cloth.robber { hex }` — 起始玩家在 12 號圓片格中選強盜的起點。 */
export function chooseClothRobber(state: GameState, actorId: string, command: ModuleCommand, ctx: ModuleContext): CommandOutcome {
  const { kit } = ctx;
  // D7：其他劇本照舊回未知指令（與 harbor.place、cloth.steal 一致）。
  if (!isClothForCatan(ctx)) return kit.fail(state.pending ? 'E_PENDING_EFFECT' : 'E_INVALID_COMMAND');
  if (!robberChoicePhase(state)) return kit.fail('E_WRONG_PHASE');
  const setup = state.turn.setup!;
  if (state.players[setup.order[0]!]!.id !== actorId) return kit.fail('E_NOT_YOUR_TURN');
  const { hex } = command;
  if (typeof hex !== 'number' || !Number.isInteger(hex) || !robberChoiceHexes(state).includes(hex)) {
    return kit.fail('E_ILLEGAL_TARGET', { hex });
  }
  state.board.robber = hex;
  setup.stage = 'building';
  state.turn.seat = setup.order[0]!;
  kit.emit(state, 'cloth.robberChosen', { playerId: actorId, hex });
  return kit.accept(state);
}

/** 動作提示：輪到的玩家看到可選的 12 號格；其他人與其他階段為空。 */
export function robberChoiceHints(state: GameState, playerId: string) {
  const setup = state.turn.setup;
  const mine = robberChoicePhase(state) && !!setup && state.players[setup.order[0]!]?.id === playerId;
  const hexes = mine ? robberChoiceHexes(state) : [];
  return {
    robberChoice: hexes,
    targets: hexes.length > 0 ? { [CLOTH_ROBBER_COMMAND]: hexes } : ({} as Record<string, number[]>),
    board: hexes.length > 0
      ? { kind: 'hex' as const, commandType: CLOTH_ROBBER_COMMAND, labelId: 'sf.cloth.robber', targets: hexes }
      : null,
  };
}
