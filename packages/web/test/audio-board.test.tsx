import { StrictMode } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GameEvent, ServerMessage } from '@catan/protocol';
import type { SocketLike } from '../src/api/socket.ts';
import { App } from '../src/App.tsx';
import type { SoundCue } from '../src/audio/cues.ts';
import type { AudioEngine } from '../src/audio/engine.ts';
import { DICE_PRESENTATION_DURATION_MS, DICE_ROLL_DURATION_MS, MAX_EFFECT_DURATION_MS } from '../src/board/animation.ts';
import { memoryStorage } from '../src/state/session.ts';
import { createFakeApi } from '../src/test/fake-api.ts';
import { makeEvent, makeSnapshot, makeView } from '../src/test/fixtures.ts';

/** 音效與真正的棋盤演出一起跑：骰子出現才搖骰、揭曉才落定、演出結束才播後果。 */

beforeEach(() => {
  const original = HTMLElement.prototype.getBoundingClientRect;
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    if (this.dataset.testid === 'board-surface' || this.dataset.testid === 'game-stage') return { x: 0, y: 0, left: 0, top: 0, width: 1200, height: 900, right: 1200, bottom: 900, toJSON() {} };
    return original.call(this);
  });
});
afterEach(() => vi.useRealTimers());

class TestSocket implements SocketLike {
  open = () => {};
  message = (_data: string) => {};
  send() {}
  close() {}
  onOpen(handler: () => void) { this.open = handler; }
  onClose() {}
  onMessage(handler: (data: string) => void) { this.message = handler; }
  onError() {}
  deliver(message: ServerMessage) { this.message(JSON.stringify(message)); }
}

function snapshot(seq: number, events: GameEvent[]) {
  const view = makeView({ events });
  view.seq = seq;
  return makeSnapshot(view, seq);
}

function recordingEngine() {
  const played: Array<{ at: number; cue: SoundCue }> = [];
  const engine: AudioEngine = {
    supported: true,
    unlock: () => undefined,
    play: (cue, delayMs = 0) => { played.push({ at: Date.now() + delayMs, cue }); },
    setPreferences: () => undefined,
    setScene: () => undefined,
    dispose: () => undefined,
  };
  return { engine, played };
}

async function open(strict = false) {
  const sockets: TestSocket[] = [];
  const { engine, played } = recordingEngine();
  const api = createFakeApi({ snapshot: snapshot(12, [makeEvent(12, 'turn.started', { playerId: 'p1' })]) });
  const app = <App services={{ api, storage: memoryStorage(), languages: ['en'], audio: engine,
    socketFactory: () => { const socket = new TestSocket(); sockets.push(socket); return socket; } }} />;
  render(strict ? <StrictMode>{app}</StrictMode> : app);
  act(() => sockets[0]!.open());
  fireEvent.click(await screen.findByTestId('resume-g1'));
  await screen.findByTestId('board-svg');
  vi.useFakeTimers();
  vi.setSystemTime(100_000);
  played.length = 0;
  return { socket: sockets[0]!, played };
}

/** 小步推進時間：React 只在 act 結束時執行 effect，大步推進會讓 effect 建立的計時器整體延後。 */
function advance(ms: number) {
  for (let elapsed = 0; elapsed < ms; elapsed += 10) act(() => vi.advanceTimersByTime(Math.min(10, ms - elapsed)));
}

const roll = (seq: number, total: number, dice: [number, number]) => makeEvent(seq, 'turn.rolled', { playerId: 'p2', dice, total });
const produce = (seq: number, total: number) => makeEvent(seq, 'production.resolved', { total, grants: { p1: { ore: 1 } } });

describe('sound follows the board presentation', () => {
  it('rattles when the dice appear, knocks on reveal and plays production when the dice finish', async () => {
    const { socket, played } = await open();
    const start = Date.now();
    act(() => socket.deliver({ type: 'snapshot', payload: snapshot(14, [roll(13, 5, [2, 3]), produce(14, 5)]) }));
    expect(screen.getByTestId('dice-focus')).toBeTruthy();
    advance(DICE_PRESENTATION_DURATION_MS + 50);
    expect(played).toEqual([
      { at: start, cue: 'dice.roll' },
      { at: start + DICE_ROLL_DURATION_MS, cue: 'dice.land' },
      { at: start + DICE_PRESENTATION_DURATION_MS, cue: 'production.self' },
    ]);
  });

  it('behaves the same under StrictMode when the events packet arrives before the projection', async () => {
    const { socket, played } = await open(true);
    const start = Date.now();
    const events = [roll(13, 5, [2, 3]), produce(14, 5)];
    act(() => socket.deliver({ type: 'events', payload: { gameId: 'g1', revision: 13, events } }));
    advance(300);
    act(() => socket.deliver({ type: 'snapshot', payload: snapshot(14, events) }));
    advance(DICE_PRESENTATION_DURATION_MS);
    expect(played).toEqual([
      { at: start, cue: 'dice.roll' },
      { at: start + DICE_ROLL_DURATION_MS, cue: 'dice.land' },
      { at: start + DICE_PRESENTATION_DURATION_MS, cue: 'production.self' },
    ]);
  });

  it('plays the result at once without a rattle when reduced motion skips the dice', async () => {
    const original = globalThis.matchMedia;
    vi.spyOn(globalThis, 'matchMedia').mockImplementation((query: string) =>
      query.includes('prefers-reduced-motion') ? { ...original(query), matches: true } as MediaQueryList : original(query));
    const { socket, played } = await open();
    const start = Date.now();
    act(() => socket.deliver({ type: 'snapshot', payload: snapshot(14, [roll(13, 5, [2, 3]), produce(14, 5)]) }));
    expect(screen.queryByTestId('dice-focus')).toBeNull();
    expect(played).toEqual([
      { at: start, cue: 'dice.land' },
      { at: start + 120, cue: 'production.self' },
    ]);
  });

  it('keeps a second roll of the same delta silent until its own dice are revealed', async () => {
    const { socket, played } = await open();
    const start = Date.now();
    act(() => socket.deliver({ type: 'snapshot', payload: snapshot(16, [roll(13, 5, [2, 3]), produce(14, 5), roll(15, 7, [6, 1]), produce(16, 7)]) }));
    // 第一次擲骰演出 + 它的特效組播完前，第二次擲骰的骰子還沒出現。
    advance(DICE_PRESENTATION_DURATION_MS + MAX_EFFECT_DURATION_MS - 100);
    expect(played.map(({ cue }) => cue)).toEqual(['dice.roll', 'dice.land', 'production.self']);
    advance(200);
    const second = played.findIndex(({ cue }, index) => cue === 'dice.roll' && index > 0);
    expect(second).toBe(3);
    const secondStart = played[second]!.at;
    expect(secondStart - start).toBeGreaterThanOrEqual(DICE_PRESENTATION_DURATION_MS + MAX_EFFECT_DURATION_MS);
    expect(secondStart - start).toBeLessThanOrEqual(DICE_PRESENTATION_DURATION_MS + MAX_EFFECT_DURATION_MS + 100);
    advance(DICE_PRESENTATION_DURATION_MS + 50);
    expect(played.slice(3)).toEqual([
      { at: secondStart, cue: 'dice.roll' },
      { at: secondStart + DICE_ROLL_DURATION_MS, cue: 'dice.land' },
      { at: secondStart + DICE_PRESENTATION_DURATION_MS, cue: 'production.self' },
    ]);
  });
});
