/**
 * 擲骰聲跟著盤面「實際」的骰子演出走，而不是自己推算時間軸。
 *
 * 盤面（board/useBoardAnimation.ts）在每次更新骰子佇列時同步回報佇列內容，
 * BoardView 在某次擲骰真的出現在畫面上時回報開始。依此：
 * - 演出開始：搖骰聲；點數揭曉（DICE_ROLL_DURATION_MS）：落定聲；
 *   骰子演出結束（DICE_PRESENTATION_DURATION_MS）：這次擲骰的後果（產出、強盜…）。
 * - 盤面不會演出（減少動態、背景分頁、必要操作模式、佇列溢出、沒有棋盤）：
 *   畫面已直接顯示結果，落定聲與後果立即播放。
 * - 已排隊或演出中被丟棄（重新同步、必要操作、分頁隱藏）：點數揭曉前被丟棄就取消
 *   （BACKGROUND_CUES 例外，立即播放）；揭曉後被丟棄則立即補完。
 * 因此聲音永遠不會比畫面先透露點數，也不會為已丟棄的演出補響。
 */

import { DICE_PRESENTATION_DURATION_MS, DICE_ROLL_DURATION_MS, MAX_EFFECT_DURATION_MS, MAX_EFFECT_GROUPS } from '../board/animation.ts';
import { BACKGROUND_CUES, stagger, type SoundCue } from './cues.ts';

type Output = (cue: SoundCue, delayMs?: number) => void;
type Timer = ReturnType<typeof setTimeout>;

interface Entry {
  /** useGameSounds 登記的後果提示；盤面先回報開始時暫時為 null。 */
  after: SoundCue[] | null;
  started: boolean;
  revealed: boolean;
  afterPlayed: boolean;
  timers: Timer[];
}

/** 已登記卻遲遲沒有開始演出（例如棋盤卸載）時的保險期限：盤面最長的佇列時間。 */
export const ROLL_START_TIMEOUT_MS = MAX_EFFECT_GROUPS * (DICE_PRESENTATION_DURATION_MS + MAX_EFFECT_DURATION_MS);

export class RollSoundCoordinator {
  private queue: readonly string[] = [];
  private readonly entries = new Map<string, Entry>();

  constructor(private readonly output: Output) {}

  /** 盤面的骰子佇列（含演出中的那一個）改變時同步呼叫。 */
  setQueue(ids: readonly string[]): void {
    const removed = this.queue.filter((id) => !ids.includes(id));
    this.queue = [...ids];
    for (const id of removed) this.leave(id);
  }

  /** 某次擲骰的骰子出現在畫面上。 */
  started(id: string): void {
    // 只接受仍在盤面佇列中的擲骰；已丟棄的 id 不再建立項目。
    if (!this.queue.includes(id)) return;
    const entry = this.entry(id);
    if (entry.started) return;
    entry.started = true;
    this.clearTimers(entry);
    this.output('dice.roll');
    entry.timers.push(globalThis.setTimeout(() => {
      entry.revealed = true;
      this.output('dice.land');
    }, DICE_ROLL_DURATION_MS));
    entry.timers.push(globalThis.setTimeout(() => this.playAfter(id), DICE_PRESENTATION_DURATION_MS));
  }

  /** useGameSounds 收到一次擲骰與它的後果。 */
  register(id: string, after: readonly SoundCue[]): void {
    const existing = this.entries.get(id);
    if (existing) {
      existing.after = [...after];
      return;
    }
    if (!this.queue.includes(id)) {
      // 盤面不會演出這次擲骰：畫面已直接顯示結果。
      this.output('dice.land');
      for (const { cue, delayMs } of stagger(after, 0)) this.output(cue, delayMs + 120);
      return;
    }
    const entry = this.entry(id);
    entry.after = [...after];
    entry.timers.push(globalThis.setTimeout(() => {
      if (!entry.started) this.leave(id);
    }, ROLL_START_TIMEOUT_MS));
  }

  /** 卸載或重設時取消所有計時器。 */
  dispose(): void {
    for (const entry of this.entries.values()) this.clearTimers(entry);
    this.entries.clear();
    this.queue = [];
  }

  private entry(id: string): Entry {
    let entry = this.entries.get(id);
    if (!entry) {
      entry = { after: null, started: false, revealed: false, afterPlayed: false, timers: [] };
      this.entries.set(id, entry);
    }
    return entry;
  }

  /** 這次擲骰離開了盤面的佇列：正常播完，或被丟棄。 */
  private leave(id: string): void {
    const entry = this.entries.get(id);
    if (!entry) return;
    this.clearTimers(entry);
    this.entries.delete(id);
    if (entry.revealed) {
      this.playAfter(id, entry);
    } else if (!entry.afterPlayed) {
      // 點數尚未揭曉就被丟棄：只保留需要叫玩家回來的提示。
      const callBacks = (entry.after ?? []).filter((cue) => BACKGROUND_CUES.has(cue));
      for (const { cue, delayMs } of stagger(callBacks)) this.output(cue, delayMs);
    }
  }

  private playAfter(id: string, entry = this.entries.get(id)): void {
    if (!entry || entry.afterPlayed) return;
    entry.afterPlayed = true;
    for (const { cue, delayMs } of stagger(entry.after ?? [])) this.output(cue, delayMs);
  }

  private clearTimers(entry: Entry): void {
    for (const timer of entry.timers) globalThis.clearTimeout(timer);
    entry.timers = [];
  }
}
