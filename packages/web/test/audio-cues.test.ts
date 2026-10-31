import { describe, expect, it } from 'vitest';
import {
  CUE_STAGGER_MS,
  cueForEvent,
  cuesForEvents,
  MAX_AUDIO_BACKLOG_MS,
  MAX_CUES_PER_BATCH,
  placeOnTimeline,
  presentationLength,
  SOUND_CUES,
} from '../src/audio/cues.ts';
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
import { DICE_PRESENTATION_DURATION_MS, DICE_ROLL_DURATION_MS, MAX_EFFECT_DURATION_MS } from '../src/board/animation.ts';
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

  it('times a roll with the dice presentation and holds its consequences until the dice settle', () => {
    const cues = cuesForEvents([
      makeEvent(13, 'turn.rolled', { playerId: 'p1', dice: [3, 4], total: 7 }),
      makeEvent(14, 'discard.required', { required: { p1: 4 } }),
      makeEvent(15, 'robber.moveRequired', { playerId: 'p1', cause: 'seven' }),
    ], 'p1');
    expect(cues).toEqual([
      { cue: 'dice.roll', delayMs: 0 },
      { cue: 'dice.land', delayMs: DICE_ROLL_DURATION_MS },
      // 兩個強盜事件對應同一個提示，只響一次，且不早於骰子演出結束。
      { cue: 'robber.alert', delayMs: DICE_PRESENTATION_DURATION_MS },
    ]);
  });

  it('staggers distinct cues of one batch in event order', () => {
    const cues = cuesForEvents([
      makeEvent(21, 'dev.knight', { playerId: 'p2', hex: 4 }),
      makeEvent(20, 'robber.moved', { playerId: 'p2', hex: 4 }),
      makeEvent(22, 'robber.stole', { playerId: 'p2', victim: 'p3' }),
    ], 'p1');
    expect(cues).toEqual([
      { cue: 'robber.move', delayMs: 0 },
      { cue: 'dev.knight', delayMs: CUE_STAGGER_MS },
      { cue: 'robber.steal', delayMs: CUE_STAGGER_MS * 2 },
    ]);
  });

  it('keeps the most important cues when a large batch arrives', () => {
    const events = [
      makeEvent(1, 'build.road', { playerId: 'p2' }),
      makeEvent(2, 'build.settlement', { playerId: 'p2' }),
      makeEvent(3, 'build.devCard', { playerId: 'p2' }),
      makeEvent(4, 'trade.bank', { playerId: 'p2' }),
      makeEvent(5, 'game.finished', { playerId: 'p1' }),
    ];
    const cues = cuesForEvents(events, 'p1');
    expect(cues).toHaveLength(MAX_CUES_PER_BATCH);
    expect(cues.map((entry) => entry.cue)).toContain('game.victory');
    expect(cuesForEvents([], 'p1')).toEqual([]);
  });

  it('serialises a roll behind a presentation that is still playing, like the board does', () => {
    const roll = (seq: number, total: number) => [
      makeEvent(seq, 'turn.rolled', { playerId: 'p2', dice: [total - 1, 1], total }),
      makeEvent(seq + 1, 'robber.moveRequired', { playerId: 'p2', cause: 'seven' }),
    ];
    const first = placeOnTimeline({ idleAt: 0 }, roll(20, 6), cuesForEvents(roll(20, 6), 'p1'), 1000);
    expect(first.cues.find((entry) => entry.cue === 'dice.land')?.delayMs).toBe(DICE_ROLL_DURATION_MS);
    expect(first.timeline.idleAt).toBe(1000 + DICE_PRESENTATION_DURATION_MS + MAX_EFFECT_DURATION_MS);

    // 第二次擲骰在 400 ms 後抵達：畫面要等第一次的骰子與特效播完才開始，聲音也一樣。
    const second = placeOnTimeline(first.timeline, roll(30, 7), cuesForEvents(roll(30, 7), 'p1'), 1400);
    const wait = first.timeline.idleAt - 1400;
    expect(second.cues).toEqual([
      { cue: 'dice.roll', delayMs: wait },
      { cue: 'dice.land', delayMs: wait + DICE_ROLL_DURATION_MS },
      { cue: 'robber.alert', delayMs: wait + DICE_PRESENTATION_DURATION_MS },
    ]);
  });

  it('skips the rattle and plays the result at once when the board does not present the dice', () => {
    const events = [
      makeEvent(13, 'turn.rolled', { playerId: 'p2', dice: [3, 4], total: 7 }),
      makeEvent(14, 'robber.moveRequired', { playerId: 'p2', cause: 'seven' }),
    ];
    expect(cuesForEvents(events, 'p1', false)).toEqual([
      { cue: 'dice.land', delayMs: 0 },
      { cue: 'robber.alert', delayMs: CUE_STAGGER_MS },
    ]);
  });

  it('lets only the dice occupy the timeline while the board is in a mandatory step', () => {
    const turn = [makeEvent(5, 'turn.started', { playerId: 'p2' })];
    expect(presentationLength(turn, false)).toBe(0);
    expect(placeOnTimeline({ idleAt: 0 }, turn, [], 1000, false).timeline.idleAt).toBe(1000);
    const roll = [makeEvent(6, 'turn.rolled', { playerId: 'p2', dice: [1, 1], total: 2 })];
    expect(presentationLength(roll, false)).toBe(DICE_PRESENTATION_DURATION_MS);
  });

  it('starts immediately once the timeline is idle and drops an overflowing backlog', () => {
    const road = [makeEvent(5, 'build.road', { playerId: 'p2' })];
    expect(presentationLength(road)).toBe(MAX_EFFECT_DURATION_MS);
    expect(placeOnTimeline({ idleAt: 500 }, road, cuesForEvents(road, 'p1'), 9000).cues).toEqual([{ cue: 'build.road', delayMs: 0 }]);
    const flooded = placeOnTimeline({ idleAt: 9000 + MAX_AUDIO_BACKLOG_MS + 1 }, road, cuesForEvents(road, 'p1'), 9000);
    expect(flooded).toEqual({ timeline: { idleAt: 9000 }, cues: [] });
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
