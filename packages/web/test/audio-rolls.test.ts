import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CUE_STAGGER_MS, type SoundCue } from '../src/audio/cues.ts';
import { ROLL_START_TIMEOUT_MS, RollSoundCoordinator } from '../src/audio/rolls.ts';
import { DICE_PRESENTATION_DURATION_MS, DICE_ROLL_DURATION_MS } from '../src/board/animation.ts';

let played: Array<{ at: number; cue: SoundCue; delayMs: number | undefined }>;
let coordinator: RollSoundCoordinator;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(0);
  played = [];
  coordinator = new RollSoundCoordinator((cue, delayMs) => played.push({ at: Date.now(), cue, delayMs }));
});

afterEach(() => {
  coordinator.dispose();
  vi.useRealTimers();
});

const names = () => played.map(({ cue }) => cue);

describe('RollSoundCoordinator', () => {
  it('follows the board: rattle on start, knock on reveal, consequences when the dice finish', () => {
    coordinator.setQueue(['g1:13']);
    coordinator.register('g1:13', ['robber.alert']);
    expect(played).toEqual([]);
    vi.advanceTimersByTime(5000);
    // 還沒開始演出（例如排在前一次擲骰之後）：一聲都不響。
    expect(played).toEqual([]);

    coordinator.started('g1:13');
    expect(names()).toEqual(['dice.roll']);
    vi.advanceTimersByTime(DICE_ROLL_DURATION_MS - 1);
    expect(names()).toEqual(['dice.roll']);
    vi.advanceTimersByTime(1);
    expect(names()).toEqual(['dice.roll', 'dice.land']);
    vi.advanceTimersByTime(DICE_PRESENTATION_DURATION_MS - DICE_ROLL_DURATION_MS);
    expect(played.at(-1)).toMatchObject({ cue: 'robber.alert', at: 5000 + DICE_PRESENTATION_DURATION_MS });
    // 盤面在同一時刻把骰子移出佇列：後果不重複播放。
    coordinator.setQueue([]);
    expect(names()).toEqual(['dice.roll', 'dice.land', 'robber.alert']);
  });

  it('accepts the start signal before the consequences are registered in the same update', () => {
    coordinator.setQueue(['g1:20']);
    coordinator.started('g1:20');
    coordinator.register('g1:20', ['production.self']);
    vi.advanceTimersByTime(DICE_PRESENTATION_DURATION_MS);
    expect(names()).toEqual(['dice.roll', 'dice.land', 'production.self']);
  });

  it('plays the result at once when the board will not present the roll', () => {
    // 減少動態、背景分頁、溢出或必要操作：骰子沒有進入佇列，畫面直接顯示結果。
    coordinator.register('g1:30', ['robber.alert', 'turn.other']);
    expect(played).toEqual([
      { at: 0, cue: 'dice.land', delayMs: undefined },
      { at: 0, cue: 'robber.alert', delayMs: 120 },
      { at: 0, cue: 'turn.other', delayMs: 120 + CUE_STAGGER_MS },
    ]);
  });

  it('cancels a roll dropped before its reveal but still calls the player back', () => {
    coordinator.setQueue(['g1:40', 'g1:41']);
    coordinator.register('g1:40', ['production.other']);
    coordinator.register('g1:41', ['robber.alert', 'trade.offer']);
    coordinator.started('g1:40');
    vi.advanceTimersByTime(500);
    // 重新同步：盤面清空佇列，兩次擲骰都還沒揭曉。
    coordinator.setQueue([]);
    vi.advanceTimersByTime(10_000);
    expect(names()).toEqual(['dice.roll', 'trade.offer']);
  });

  it('completes a roll dropped after its reveal immediately', () => {
    coordinator.setQueue(['g1:50']);
    coordinator.register('g1:50', ['production.self']);
    coordinator.started('g1:50');
    vi.advanceTimersByTime(DICE_ROLL_DURATION_MS + 100);
    coordinator.setQueue([]);
    expect(names()).toEqual(['dice.roll', 'dice.land', 'production.self']);
    vi.advanceTimersByTime(5000);
    expect(names()).toEqual(['dice.roll', 'dice.land', 'production.self']);
  });

  it('serialises queued rolls exactly as the board presents them', () => {
    coordinator.setQueue(['g1:60', 'g1:61']);
    coordinator.register('g1:60', []);
    coordinator.register('g1:61', ['robber.alert']);
    coordinator.started('g1:60');
    vi.advanceTimersByTime(DICE_PRESENTATION_DURATION_MS);
    coordinator.setQueue(['g1:61']);
    // 第二次擲骰排在特效組之後才開始；在那之前不透露它的七點。
    vi.advanceTimersByTime(800);
    expect(names()).toEqual(['dice.roll', 'dice.land']);
    coordinator.started('g1:61');
    vi.advanceTimersByTime(DICE_PRESENTATION_DURATION_MS);
    expect(names()).toEqual(['dice.roll', 'dice.land', 'dice.roll', 'dice.land', 'robber.alert']);
  });

  it('gives up on a queued roll that never starts', () => {
    coordinator.setQueue(['g1:70']);
    coordinator.register('g1:70', ['robber.alert']);
    vi.advanceTimersByTime(ROLL_START_TIMEOUT_MS);
    coordinator.started('g1:70');
    expect(names()).toEqual(['dice.roll']);
  });

  it('starts each roll once and stops everything on dispose', () => {
    coordinator.setQueue(['g1:80']);
    coordinator.register('g1:80', ['production.self']);
    coordinator.started('g1:80');
    coordinator.started('g1:80');
    coordinator.dispose();
    vi.advanceTimersByTime(10_000);
    expect(names()).toEqual(['dice.roll']);
  });
});
