/**
 * T&B 的保底義務（規格 I9；T&B 計畫 §4.1 的整張保底表）。S2 合併後凍結：各 part 的策略切片不改這裡。
 *
 * 只取 hints 與 view 裡現成的第一個候選，不得 throw（server 的保底呼叫不在 try 裡），也不消耗亂數。資格判定一律採保守的
 * `responders[0] === self`（P3，`frames.ts` 的 `isMine(…, 'duty')`）：保底骨架在這之前就會擋掉其他人，這裡再檢查一次，
 * 讓直接呼叫 `duty` 的測試得到同樣的結果。T&B 的 frame 但不該由自己動作、或 hints 沒有候選時回 null（歸我管、不送指令，
 * 交給 server 診斷）；其他情況回 undefined，交給 base。
 *
 * | # | frame 或強制動作 | 最小動作 |
 * |---|---|---|
 * | 1 | `fishSwap` | `tb.fishSwap {token:null}`（放棄也用掉本回合的交換） |
 * | 2 | `wagonBid`（依序） | `tb.bidWagon {wool:0,grain:0}` |
 * | 3 | `wagonAssign`（同時） | `tb.assignWagon` 到 `board.targets[0]` |
 * | 4 | `wagonPlace` | `tb.placeWagon` 到 `board.targets[0]` |
 * | 5 | `baSteal` | `tb.baSteal` 對 `stealVictims[0]` |
 * | 6 | `baCapture` | `tb.baCapture` 到 `board.targets[0]` |
 * | 7、8 | `baKnighthood`、`baSwiftKnight` | `tb.baPlaceKnight` 到 `board.targets[0]` |
 * | 9 | `baTreason` | `tb.baTreason` 用 `treasonMoves[0]` |
 * | 10 | `baKnights`（回合結束） | 停在城堡邊、有落點的己方騎士移到 `targets['tb.moveKnight:<e>:0'][0]`；沒有就 `tb.endKnights` |
 * | 11 | `tbBarbarian`（擲出 7） | `tb.moveBarbarian`：`barbarians[0]` → `targets['tb.barbarian:<from>'][0]` |
 * | 12 | `tbWagon`（回合結束） | `tb.wagonStop`；有 Swift Journey 時 frame 留著，下一次再送一次 |
 * | 13 | FR 的 `moveRobber` | 不在這裡：base 取盜賊 fold 的第一項，`variants.ts` 的 `robberTargets` 換成 `robberHexes` |
 * | 14 | 打牌（騎士、蠻族騎士、Swift Journey） | 不打：不是強制動作 |
 * | 15 | base 的棄牌、偷牌、豐收之年、道路建設 | base 的 `pendingDuty` |
 * | 16 | setup（含 BA／Traders 第 2 輪放城市、Fishing 第 2 輪拿魚） | base 的 `setupDuty` |
 * | 17 | preroll、action | 回 undefined，由 base 送 `turn.roll`／`turn.end` |
 */

import type { GameView, PublicModulePendingView } from '@catan/rules';
import type { BotCommand } from '../../types.ts';
import type { BotModule } from '../types.ts';
import { isMine, isTbFrame, TB_FRAME_KINDS } from './frames.ts';
import { integers, tbBoardTargets, tbPartHints, tbPartView, tbTargets } from './view.ts';

type Duty = BotCommand | null | undefined;

const command = (type: string, fields: Record<string, unknown> = {}): BotCommand => ({ type, ...fields }) as BotCommand;

/** 不在 hints 裡時回 null（不送必定被拒的指令）。 */
const onFirst = <T>(items: readonly T[] | undefined, build: (item: T) => BotCommand): BotCommand | null => {
  const first = items?.[0];
  return first === undefined ? null : build(first);
};

export const tradersBarbariansDuty: NonNullable<BotModule['duty']> = (view, selfId) => {
  try {
    return dutyOf(view, selfId);
  } catch {
    // 形狀不明的投影：T&B 的 frame 歸我管、不送指令；其他交給 base。
    return isTbFrame(view?.pending) ? null : undefined;
  }
};

function dutyOf(view: GameView, selfId: string): Duty {
  if (view.result) return undefined;
  const pending = view.pending;
  // 第 15–17 列：base 的 frame、setup、preroll 與 action 都交給 base。
  if (!pending || !isTbFrame(pending)) return undefined;
  if (!isMine(pending, selfId, 'duty')) return null;
  return frameDuty(view, pending, selfId);
}

function frameDuty(view: GameView, frame: PublicModulePendingView, selfId: string): Duty {
  const hints = view.hints;
  const ba = tbPartHints(hints, 'tb-barbarian-attack');
  switch (frame.kind) {
    case TB_FRAME_KINDS.fishSwap:
      return command('tb.fishSwap', { token: null });
    case TB_FRAME_KINDS.wagonBid:
      return command('tb.bidWagon', { wool: 0, grain: 0 });
    case TB_FRAME_KINDS.wagonAssign:
      return onFirst(wagonTargets(view, 'tb.assignWagon'), (edge) => command('tb.assignWagon', { edge }));
    case TB_FRAME_KINDS.wagonPlace:
      return onFirst(wagonTargets(view, 'tb.placeWagon'), (edge) => command('tb.placeWagon', { edge }));
    case TB_FRAME_KINDS.baSteal:
      return onFirst(ba?.stealVictims?.filter((id) => id !== selfId), (victim) => command('tb.baSteal', { victim }));
    case TB_FRAME_KINDS.baCapture:
      return onFirst(tbBoardTargets(hints, 'tb.baCapture'), (hex) => command('tb.baCapture', { hex }));
    case TB_FRAME_KINDS.baKnighthood:
    case TB_FRAME_KINDS.baSwiftKnight:
      return onFirst(tbBoardTargets(hints, 'tb.baPlaceKnight'), (edge) => command('tb.baPlaceKnight', { edge }));
    case TB_FRAME_KINDS.baTreason:
      return onFirst(
        ba?.treasonMoves?.filter((move) => integers(move)?.length === 2),
        ([from, to]) => command('tb.baTreason', { from, to }),
      );
    case TB_FRAME_KINDS.baKnights:
      return knightsDuty(view);
    case TB_FRAME_KINDS.tbBarbarian:
      return barbarianDuty(view);
    case TB_FRAME_KINDS.tbWagon:
      return command('tb.wagonStop');
    default:
      return null;
  }
}

/** 分配與放置車廂：`board.targets`；缺漏時退回 trains hints 的 `locations`（兩者在 rules 是同一份）。 */
function wagonTargets(view: GameView, commandType: string): readonly number[] {
  const board = tbBoardTargets(view.hints, commandType);
  if (board.length > 0) return board;
  return integers(tbPartHints(view.hints, 'tb-merchant-trains')?.locations) ?? [];
}

/**
 * 回合結束的騎士移動（第 10 列）。`tb.endKnights` 只在「己方騎士停在城堡邊、而且有落點」時被拒，落點不含城堡邊，
 * 所以把這樣的騎士一隻一隻移走（不加速，不花 grain），之後就能結束。
 */
function knightsDuty(view: GameView): BotCommand {
  const castle = new Set(integers(tbPartView(view, 'tb-barbarian-attack')?.castleEdges) ?? []);
  for (const move of tbPartHints(view.hints, 'tb-barbarian-attack')?.knightMoves ?? []) {
    if (!castle.has(move.from)) continue;
    const to = tbTargets(view.hints, `tb.moveKnight:${move.from}:0`)[0];
    if (to !== undefined) return command('tb.moveKnight', { from: move.from, to, boost: false });
  }
  return command('tb.endKnights');
}

/** 擲出 7 時移動一個蠻族（第 11 列）：落點是任何沒有蠻族的邊。 */
function barbarianDuty(view: GameView): BotCommand | null {
  for (const from of integers(tbPartView(view, 'tb-traders-barbarians')?.barbarians) ?? []) {
    const to = tbTargets(view.hints, `tb.barbarian:${from}`)[0];
    if (to !== undefined) return command('tb.moveBarbarian', { from, to });
  }
  return null;
}
