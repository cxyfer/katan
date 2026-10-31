import { describe, expect, it } from 'vitest';
import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { App } from '../src/App.tsx';
import type { SoundCue } from '../src/audio/cues.ts';
import type { AudioEngine, MusicScene } from '../src/audio/engine.ts';
import { AUDIO_KEY, type AudioPreferences } from '../src/audio/preferences.ts';
import { advanceEventCursor, attentionCue, useGameSounds } from '../src/audio/useGameSounds.ts';
import { DICE_ROLL_DURATION_MS } from '../src/board/animation.ts';
import { memoryStorage } from '../src/state/session.ts';
import { initialTableState, tableReducer, type TableState } from '../src/state/table.ts';
import { createFakeApi } from '../src/test/fake-api.ts';
import { makeChatMessage, makeEvent, makeHints, makeIdentity, makeSnapshot, makeView } from '../src/test/fixtures.ts';

interface RecordingEngine extends AudioEngine {
  played: Array<{ cue: SoundCue; delayMs: number | undefined }>;
  scenes: Array<MusicScene | null>;
  preferences: AudioPreferences[];
  unlocks: number;
}

function recordingEngine(supported = true): RecordingEngine {
  const engine: RecordingEngine = {
    supported,
    played: [],
    scenes: [],
    preferences: [],
    unlocks: 0,
    unlock: () => { engine.unlocks += 1; },
    play: (cue, delayMs) => { engine.played.push({ cue, delayMs }); },
    setPreferences: (preferences) => { engine.preferences.push(preferences); },
    setScene: (scene) => { engine.scenes.push(scene); },
    dispose: () => undefined,
  };
  return engine;
}

function gameState(events = [makeEvent(12, 'turn.started', { playerId: 'p2' })], options: Parameters<typeof makeView>[0] = {}): TableState {
  const view = makeView({ hints: makeHints(), turnPlayerId: 'p2', ...options });
  view.seq = Math.max(12, ...events.map((event) => event.seq));
  view.events = events;
  let state: TableState = { ...initialTableState('en', ''), session: makeIdentity() };
  state = tableReducer(state, { type: 'game-sync', cause: 'open', generation: 1 });
  return tableReducer(state, { type: 'snapshot', snapshot: makeSnapshot(view, view.seq), generation: 1 });
}

function withSnapshot(state: TableState, events: ReturnType<typeof makeEvent>[], options: Parameters<typeof makeView>[0] = {}): TableState {
  const view = makeView({ hints: makeHints(), turnPlayerId: 'p2', ...options });
  view.events = [...state.game!.view.events, ...events];
  view.seq = Math.max(...view.events.map((event) => event.seq));
  return tableReducer(state, { type: 'snapshot', snapshot: makeSnapshot(view, view.seq), cause: 'command' });
}

describe('event cursor', () => {
  it('takes a baseline on open and never replays history', () => {
    const state = gameState([makeEvent(11, 'build.city', { playerId: 'p2' }), makeEvent(12, 'turn.started', { playerId: 'p2' })]);
    const first = advanceEventCursor(null, state);
    expect(first.events).toEqual([]);
    expect(first.cursor).toEqual({ gameId: 'g1', generation: 1, seq: 12 });
    expect(advanceEventCursor(first.cursor, state).events).toEqual([]);
  });

  it('reports each new event once, whether the events packet or the projection arrives first', () => {
    const state = gameState();
    const cursor = advanceEventCursor(null, state).cursor;
    const events = tableReducer(state, { type: 'events', events: [makeEvent(13, 'build.road', { playerId: 'p2' })] });
    const afterEvents = advanceEventCursor(cursor, events);
    expect(afterEvents.events.map((event) => event.seq)).toEqual([13]);
    const projected = withSnapshot(state, [makeEvent(13, 'build.road', { playerId: 'p2' })]);
    expect(advanceEventCursor(afterEvents.cursor, projected).events).toEqual([]);
  });

  it('rebaselines after a reconnect instead of replaying missed events', () => {
    const state = gameState();
    const cursor = advanceEventCursor(null, state).cursor;
    let reconnect = tableReducer(state, { type: 'game-sync', cause: 'reconnect', generation: 2 });
    expect(advanceEventCursor(cursor, reconnect)).toEqual({ cursor, events: [] });
    const view = makeView({ hints: makeHints() });
    view.events = [makeEvent(20, 'build.city', { playerId: 'p2' })];
    view.seq = 20;
    reconnect = tableReducer(reconnect, { type: 'snapshot', snapshot: makeSnapshot(view, 20), generation: 2 });
    const next = advanceEventCursor(cursor, reconnect);
    expect(next.events).toEqual([]);
    expect(next.cursor).toEqual({ gameId: 'g1', generation: 2, seq: 20 });
  });
});

describe('attention cue', () => {
  it('rings once when an obligation moves to the viewer', () => {
    expect(attentionCue(null, { kind: 'roll', mine: true })).toEqual({ mine: true, cue: null });
    expect(attentionCue(false, { kind: 'roll', mine: true })).toEqual({ mine: true, cue: 'turn.yours' });
    expect(attentionCue(true, { kind: 'turn', mine: true }).cue).toBeNull();
    expect(attentionCue(false, { kind: 'discard', mine: true }).cue).toBe('turn.yours');
    expect(attentionCue(true, null)).toEqual({ mine: false, cue: null });
  });

  it('treats the dice presentation and projection catch-up as transient', () => {
    // 擲骰 → 演出中 → 行動：都是自己的回合，不因中間的過渡再響一次。
    expect(attentionCue(true, { kind: 'rolling', mine: false })).toEqual({ mine: true, cue: null });
    expect(attentionCue(true, { kind: 'turn', mine: true }).cue).toBeNull();
    expect(attentionCue(false, { kind: 'syncing', mine: false })).toEqual({ mine: false, cue: null });
  });
});

describe('useGameSounds', () => {
  it('plays new authoritative events, the move hand-over, rejections and chat', () => {
    const played: Array<[SoundCue, number | undefined]> = [];
    const play = (cue: SoundCue, delayMs?: number) => { played.push([cue, delayMs]); };
    const { rerender } = renderHook(({ state }) => useGameSounds(state, play), { initialProps: { state: gameState() } });
    expect(played).toEqual([]);

    let state = gameState();
    state = withSnapshot(state, [makeEvent(13, 'turn.ended', { playerId: 'p2' }), makeEvent(14, 'turn.started', { playerId: 'p1' })],
      { turnPlayerId: 'p1', phase: 'preroll' });
    rerender({ state });
    expect(played).toEqual([['turn.yours', undefined]]);

    played.length = 0;
    state = withSnapshot(state, [makeEvent(15, 'turn.rolled', { playerId: 'p1', dice: [2, 3], total: 5 })], { turnPlayerId: 'p1' });
    rerender({ state });
    expect(played).toEqual([['dice.roll', 0], ['dice.land', DICE_ROLL_DURATION_MS]]);

    played.length = 0;
    state = tableReducer(state, { type: 'command', event: { kind: 'begin', commandId: 'c1', labelId: 'x', command: { type: 'turn.end' }, baseRevision: 15 } });
    state = tableReducer(state, { type: 'command', event: { kind: 'receipt', receipt: { commandId: 'c1', outcome: 'rejected', revision: 15, events: [] } } });
    rerender({ state });
    rerender({ state: { ...state } });
    expect(played).toEqual([['ui.error', undefined]]);

    played.length = 0;
    state = tableReducer(state, { type: 'chat', event: { kind: 'server-message', message: makeChatMessage({ playerId: 'p2' }), selfId: 'p1' } });
    rerender({ state });
    expect(played).toEqual([['chat.message', undefined]]);
    // 靜音的玩家發言不響。
    state = tableReducer(state, { type: 'chat', event: { kind: 'mute', playerId: 'p3' } });
    played.length = 0;
    state = tableReducer(state, { type: 'chat', event: { kind: 'server-message', message: makeChatMessage({ id: 'm2', seq: 2, playerId: 'p3' }), selfId: 'p1' } });
    rerender({ state });
    expect(played).toEqual([]);
  });
});

describe('sound settings', () => {
  function renderApp(engine: AudioEngine, storage = memoryStorage()) {
    render(<App services={{ api: createFakeApi(), storage, languages: ['en'], connectSocket: false, audio: engine }} />);
    return storage;
  }

  it('persists mute and volume changes and unlocks audio in the same gesture', async () => {
    const engine = recordingEngine();
    const storage = renderApp(engine);
    await screen.findByTestId('sound-settings');
    expect(engine.scenes.at(-1)).toBe('harbor');

    fireEvent.click(screen.getByTestId('sound-mute'));
    expect(engine.preferences.at(-1)?.muted).toBe(true);
    expect(engine.unlocks).toBeGreaterThan(0);
    expect(JSON.parse(storage.getItem(AUDIO_KEY)!)).toMatchObject({ muted: true });
    expect(screen.getByTestId('sound-settings').dataset.muted).toBe('true');
    expect((screen.getByTestId('sound-test') as HTMLButtonElement).disabled).toBe(true);

    // 拉高音量會自動取消靜音，避免使用者以為滑桿無效。
    fireEvent.change(screen.getByTestId('sound-music'), { target: { value: '80' } });
    expect(engine.preferences.at(-1)).toMatchObject({ muted: false, music: 80 });
    fireEvent.click(screen.getByTestId('sound-test'));
    expect(engine.played.at(-1)?.cue).toBe('turn.yours');
  });

  it('restores stored preferences and unlocks on the first pointer gesture', async () => {
    const engine = recordingEngine();
    const storage = memoryStorage({ [AUDIO_KEY]: JSON.stringify({ muted: false, effects: 20, music: 0 }) });
    renderApp(engine, storage);
    await screen.findByTestId('sound-settings');
    expect(engine.preferences[0]).toEqual({ muted: false, effects: 20, music: 0 });
    expect((screen.getByTestId('sound-effects') as HTMLInputElement).value).toBe('20');
    const before = engine.unlocks;
    fireEvent.pointerDown(document.body);
    expect(engine.unlocks).toBe(before + 1);
  });

  it('explains when the browser has no web audio', async () => {
    renderApp(recordingEngine(false));
    expect(await screen.findByTestId('sound-unavailable')).toBeTruthy();
    expect((screen.getByTestId('sound-mute') as HTMLInputElement).disabled).toBe(true);
  });

  it('switches to the island theme at the table without replaying the opening history', async () => {
    const engine = recordingEngine();
    const api = createFakeApi();
    const view = makeView({ hints: makeHints() });
    view.events = [makeEvent(11, 'build.city', { playerId: 'p2' }), makeEvent(12, 'turn.started', { playerId: 'p1' })];
    api.setSnapshot(makeSnapshot(view, 12));
    render(<App services={{ api, storage: memoryStorage(), languages: ['en'], connectSocket: false, audio: engine }} />);
    fireEvent.click(await screen.findByTestId('resume-g1'));
    await screen.findByTestId('sound-settings-game');
    await waitFor(() => expect(engine.scenes.at(-1)).toBe('island'));
    await act(async () => { await Promise.resolve(); });
    expect(engine.played).toEqual([]);
  });
});
