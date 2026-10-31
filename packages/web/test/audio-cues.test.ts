import { describe, expect, it } from 'vitest';
import { CUE_STAGGER_MS, cueForEvent, cueGroups, MAX_CUES_PER_BATCH, SOUND_CUES, stagger } from '../src/audio/cues.ts';
import { composeBar, chordForBar, SCENES, BEATS_PER_BAR } from '../src/audio/music.ts';
import {
  AUDIO_KEY,
  DEFAULT_AUDIO_PREFERENCES,
  levelToGain,
  normalizeAudioPreferences,
  readStoredAudio,
  writeStoredAudio,
} from '../src/audio/preferences.ts';
import { CUE_LENGTH_SECONDS } from '../src/audio/synth.ts';
import { memoryStorage } from '../src/state/session.ts';
import { makeEvent } from '../src/test/fixtures.ts';

describe('event cues', () => {
  it('maps rule events to cues from the viewer perspective', () => {
    expect(cueForEvent(makeEvent(1, 'build.road', { playerId: 'p2' }), 'p1')).toBe('build.road');
    expect(cueForEvent(makeEvent(1, 'setup.building', { playerId: 'p1' }), 'p1')).toBe('build.settlement');
    expect(cueForEvent(makeEvent(1, 'build.city', { playerId: 'p1' }), 'p1')).toBe('build.city');
    expect(cueForEvent(makeEvent(1, 'turn.started', { playerId: 'p2' }), 'p1')).toBe('turn.other');
    // 自己的回合由「輪到你」提示負責，事件本身不重複發聲。
    expect(cueForEvent(makeEvent(1, 'turn.started', { playerId: 'p1' }), 'p1')).toBeNull();
    expect(cueForEvent(makeEvent(1, 'game.finished', { playerId: 'p1' }), 'p1')).toBe('game.victory');
    expect(cueForEvent(makeEvent(1, 'game.finished', { playerId: 'p2' }), 'p1')).toBe('game.over');
    expect(cueForEvent(makeEvent(1, 'turn.ended', { playerId: 'p1' }), 'p1')).toBeNull();
    expect(cueForEvent(makeEvent(1, 'unknown.event'), 'p1')).toBeNull();
  });

  it('marks production as personal only when the public grants include the viewer', () => {
    const grants = { p2: { grain: 1 }, p1: { ore: 0 } };
    expect(cueForEvent(makeEvent(1, 'production.resolved', { grants }), 'p1')).toBe('production.other');
    expect(cueForEvent(makeEvent(1, 'production.resolved', { grants: { p1: { ore: 2 } } }), 'p1')).toBe('production.self');
    expect(cueForEvent(makeEvent(1, 'production.resolved', { grants: { p1: { ore: 2 } } }), null)).toBe('production.other');
  });

  it('never depends on parameters only the involved player receives', () => {
    // 偷竊卡種與購得的卡片只會出現在當事人的投影中；旁觀者聽到的聲音必須一致。
    const withResource = makeEvent(1, 'robber.stole', { playerId: 'p2', victim: 'p3', resource: 'ore' });
    const without = makeEvent(1, 'robber.stole', { playerId: 'p2', victim: 'p3' });
    expect(cueForEvent(withResource, 'p1')).toBe(cueForEvent(without, 'p1'));
    const bought = makeEvent(1, 'build.devCard', { playerId: 'p2', card: 'knight', remaining: 10 });
    const hidden = makeEvent(1, 'build.devCard', { playerId: 'p2', remaining: 10 });
    expect(cueForEvent(bought, 'p1')).toBe(cueForEvent(hidden, 'p1'));
    // 被偷的當事人知道自己被偷，可以聽到不同的提示。
    expect(cueForEvent(without, 'p3')).toBe('robber.stolenFromYou');
  });

  it('only rings the trade bell for players who were asked', () => {
    const offer = (from: string, to: string) => makeEvent(1, 'trade.offered', { from, to, give: {}, want: {} });
    expect(cueForEvent(offer('p2', 'all'), 'p1')).toBe('trade.offer');
    expect(cueForEvent(offer('p2', 'p1'), 'p1')).toBe('trade.offer');
    expect(cueForEvent(offer('p2', 'p3'), 'p1')).toBeNull();
    expect(cueForEvent(offer('p1', 'all'), 'p1')).toBeNull();
  });

  it('splits a batch at the roll and holds its consequences for the dice presentation', () => {
    expect(cueGroups([
      makeEvent(13, 'turn.rolled', { playerId: 'p1', dice: [3, 4], total: 7 }),
      makeEvent(14, 'discard.required', { required: { p1: 4 } }),
      makeEvent(15, 'robber.moveRequired', { playerId: 'p1', cause: 'seven' }),
    ], 'p1')).toEqual([
      // 兩個強盜事件對應同一個提示，只響一次。
      { rollSeq: 13, before: [], after: ['robber.alert'] },
    ]);
  });

  it('keeps events before the roll apart and splits a delta at every roll like the board', () => {
    const groups = cueGroups([
      makeEvent(39, 'dev.knight', { playerId: 'p2', hex: 4 }),
      makeEvent(40, 'turn.rolled', { playerId: 'p2', dice: [2, 2], total: 4 }),
      makeEvent(41, 'production.resolved', { total: 4, grants: { p1: { ore: 1 } } }),
      makeEvent(42, 'turn.ended', { playerId: 'p2' }),
      makeEvent(43, 'turn.started', { playerId: 'p3' }),
      makeEvent(44, 'turn.rolled', { playerId: 'p3', dice: [6, 1], total: 7 }),
      makeEvent(45, 'robber.moveRequired', { playerId: 'p3', cause: 'seven' }),
    ], 'p1');
    expect(groups).toEqual([
      { rollSeq: 40, before: ['dev.knight'], after: ['production.self', 'turn.other'] },
      { rollSeq: 44, before: [], after: ['robber.alert'] },
    ]);
  });

  it('staggers distinct cues of one batch in event order', () => {
    const [group] = cueGroups([
      makeEvent(21, 'dev.knight', { playerId: 'p2', hex: 4 }),
      makeEvent(20, 'robber.moved', { playerId: 'p2', hex: 4 }),
      makeEvent(22, 'robber.stole', { playerId: 'p2', victim: 'p3' }),
    ], 'p1');
    expect(stagger(group!.before)).toEqual([
      { cue: 'robber.move', delayMs: 0 },
      { cue: 'dev.knight', delayMs: CUE_STAGGER_MS },
      { cue: 'robber.steal', delayMs: CUE_STAGGER_MS * 2 },
    ]);
  });

  it('keeps the most important cues when a large batch arrives', () => {
    const [group] = cueGroups([
      makeEvent(1, 'build.road', { playerId: 'p2' }),
      makeEvent(2, 'build.settlement', { playerId: 'p2' }),
      makeEvent(3, 'build.devCard', { playerId: 'p2' }),
      makeEvent(4, 'trade.bank', { playerId: 'p2' }),
      makeEvent(5, 'game.finished', { playerId: 'p1' }),
    ], 'p1');
    expect(group!.before).toHaveLength(MAX_CUES_PER_BATCH);
    expect(group!.before).toContain('game.victory');
    expect(cueGroups([], 'p1')).toEqual([]);
  });

  it('documents a length for every cue', () => {
    for (const cue of SOUND_CUES) expect(CUE_LENGTH_SECONDS[cue]).toBeGreaterThan(0);
  });
});

describe('audio preferences', () => {
  it('round-trips through storage and clamps hostile values', () => {
    const storage = memoryStorage();
    expect(readStoredAudio(storage)).toEqual(DEFAULT_AUDIO_PREFERENCES);
    writeStoredAudio(storage, { muted: true, effects: 40, music: 0 });
    expect(readStoredAudio(storage)).toEqual({ muted: true, effects: 40, music: 0 });
    storage.setItem(AUDIO_KEY, '{"muted":"yes","effects":250,"music":-3}');
    expect(readStoredAudio(storage)).toEqual({ muted: false, effects: 100, music: 0 });
    storage.setItem(AUDIO_KEY, 'not json');
    expect(readStoredAudio(storage)).toEqual(DEFAULT_AUDIO_PREFERENCES);
    expect(normalizeAudioPreferences({ effects: 33.6 }).effects).toBe(34);
  });

  it('survives a storage that throws', () => {
    const broken = {
      getItem: () => { throw new Error('denied'); },
      setItem: () => { throw new Error('denied'); },
      removeItem: () => undefined,
    };
    expect(readStoredAudio(broken)).toEqual(DEFAULT_AUDIO_PREFERENCES);
    expect(() => writeStoredAudio(broken, DEFAULT_AUDIO_PREFERENCES)).not.toThrow();
  });

  it('uses a perceptual volume curve', () => {
    expect(levelToGain(0)).toBe(0);
    expect(levelToGain(100)).toBe(1);
    expect(levelToGain(50)).toBeCloseTo(0.25);
  });
});

describe('generative music', () => {
  it('is deterministic per scene and bar', () => {
    expect(composeBar('island', 5)).toEqual(composeBar('island', 5));
    expect(composeBar('harbor', 4)).not.toEqual(composeBar('island', 4));
    const melody = (scene: 'harbor' | 'island') => Array.from({ length: 16 }, (_, bar) => composeBar(scene, bar))
      .flat().filter((note) => note.voice === 'melody');
    // 旋律稀疏但不會整段空白；牌桌主題比港口主題熱鬧。
    expect(melody('harbor').length).toBeGreaterThan(0);
    expect(melody('island').length).toBeGreaterThan(melody('harbor').length);
  });

  it('lays a chord bed at each chord change and keeps the melody in the scale', () => {
    for (const scene of ['harbor', 'island'] as const) {
      const style = SCENES[scene];
      for (let bar = 0; bar < 32; bar += 1) {
        const notes = composeBar(scene, bar);
        const bed = notes.filter((note) => note.voice !== 'melody');
        if (bar % style.barsPerChord === 0) {
          expect(bed.map((note) => note.midi)).toEqual([...chordForBar(scene, bar)]);
        } else {
          expect(bed).toEqual([]);
        }
        for (const note of notes.filter((candidate) => candidate.voice === 'melody')) {
          expect(style.scale).toContain(note.midi);
          expect(note.beat).toBeGreaterThanOrEqual(0);
          expect(note.beat).toBeLessThan(BEATS_PER_BAR);
        }
      }
    }
  });

  it('cycles through the whole progression', () => {
    const style = SCENES.island;
    const cycle = style.chords.length * style.barsPerChord;
    expect(chordForBar('island', 0)).toEqual(chordForBar('island', cycle));
    expect(chordForBar('island', 0)).not.toEqual(chordForBar('island', style.barsPerChord));
  });
});
