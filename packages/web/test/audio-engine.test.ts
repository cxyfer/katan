import { afterEach, describe, expect, it, vi } from 'vitest';
import { WebAudioEngine } from '../src/audio/engine.ts';
import { DEFAULT_AUDIO_PREFERENCES } from '../src/audio/preferences.ts';

/** 只記錄呼叫的 AudioParam；引擎與配方只需要這些方法存在。 */
class FakeParam {
  value = 0;
  events: string[] = [];
  setValueAtTime(value: number) { this.value = value; this.events.push('set'); return this; }
  linearRampToValueAtTime(value: number) { this.value = value; return this; }
  exponentialRampToValueAtTime(value: number) { this.value = value; return this; }
  setTargetAtTime(value: number) { this.value = value; this.events.push('target'); return this; }
  cancelScheduledValues() { return this; }
}

class FakeNode {
  connections: unknown[] = [];
  connect(target: unknown) { this.connections.push(target); return target; }
  disconnect() { this.connections = []; }
}

class FakeSource extends FakeNode {
  frequency = new FakeParam();
  detune = new FakeParam();
  playbackRate = new FakeParam();
  type = 'sine';
  buffer: unknown = null;
  loop = false;
  start = vi.fn();
  stop = vi.fn();
}

class FakeContext {
  static instances: FakeContext[] = [];
  state: 'suspended' | 'running' | 'closed' = 'suspended';
  currentTime = 0;
  sampleRate = 8000;
  destination = new FakeNode();
  created: Record<string, number> = {};
  resume = vi.fn(async () => { this.state = 'running'; });
  suspend = vi.fn(async () => { this.state = 'suspended'; });
  close = vi.fn(async () => { this.state = 'closed'; });

  constructor() {
    FakeContext.instances.push(this);
  }

  private count(kind: string) {
    this.created[kind] = (this.created[kind] ?? 0) + 1;
  }

  createGain() { this.count('gain'); return Object.assign(new FakeNode(), { gain: new FakeParam() }); }
  createOscillator() { this.count('oscillator'); return new FakeSource(); }
  createBufferSource() { this.count('bufferSource'); return new FakeSource(); }
  createBiquadFilter() { this.count('filter'); return Object.assign(new FakeNode(), { type: 'lowpass', frequency: new FakeParam(), Q: new FakeParam() }); }
  createStereoPanner() { this.count('panner'); return Object.assign(new FakeNode(), { pan: new FakeParam() }); }
  createConvolver() { this.count('convolver'); return Object.assign(new FakeNode(), { buffer: null }); }
  createDynamicsCompressor() {
    this.count('compressor');
    return Object.assign(new FakeNode(), {
      threshold: new FakeParam(), knee: new FakeParam(), ratio: new FakeParam(), attack: new FakeParam(), release: new FakeParam(),
    });
  }
  createBuffer(channels: number, length: number, sampleRate: number) {
    const data = Array.from({ length: channels }, () => new Float32Array(length));
    return { duration: length / sampleRate, getChannelData: (channel: number) => data[channel]! };
  }
}

function fakeDocument(hidden = false) {
  const listeners = new Set<() => void>();
  return {
    hidden,
    addEventListener: (_type: string, listener: () => void) => listeners.add(listener),
    removeEventListener: (_type: string, listener: () => void) => listeners.delete(listener),
    fire() { for (const listener of listeners) listener(); },
    listeners,
  };
}

function engine(doc = fakeDocument()) {
  const instance = new WebAudioEngine({
    createContext: () => new FakeContext() as unknown as AudioContext,
    document: doc as unknown as Document,
  });
  return { instance, doc, context: () => FakeContext.instances.at(-1)! };
}

afterEach(() => {
  FakeContext.instances = [];
  vi.useRealTimers();
});

describe('WebAudioEngine', () => {
  it('creates no AudioContext before a user gesture and ignores earlier cues', () => {
    const { instance } = engine();
    instance.setPreferences(DEFAULT_AUDIO_PREFERENCES);
    instance.play('build.road');
    expect(FakeContext.instances).toHaveLength(0);
  });

  it('resumes inside the gesture and schedules synthesis nodes', async () => {
    const { instance, context } = engine();
    instance.setPreferences(DEFAULT_AUDIO_PREFERENCES);
    instance.unlock();
    expect(context().resume).toHaveBeenCalledTimes(1);
    await Promise.resolve();
    const before = context().created.oscillator ?? 0;
    instance.play('build.settlement');
    expect(context().created.oscillator).toBeGreaterThan(before);
  });

  it('drops an identical cue fired twice in the same instant', async () => {
    const { instance, context } = engine();
    instance.unlock();
    await Promise.resolve();
    instance.play('ui.select');
    const once = context().created.oscillator;
    instance.play('ui.select');
    expect(context().created.oscillator).toBe(once);
  });

  it('stays silent and suspends while muted, and plays again after unmuting', async () => {
    const { instance, context } = engine();
    instance.unlock();
    await Promise.resolve();
    instance.setPreferences({ ...DEFAULT_AUDIO_PREFERENCES, muted: true });
    expect(context().suspend).toHaveBeenCalled();
    await Promise.resolve();
    const before = context().created.oscillator ?? 0;
    instance.play('build.road');
    expect(context().created.oscillator ?? 0).toBe(before);

    instance.setPreferences(DEFAULT_AUDIO_PREFERENCES);
    instance.unlock();
    await Promise.resolve();
    instance.play('build.road');
    expect(context().created.oscillator).toBeGreaterThan(before);
  });

  it('pauses when the tab is hidden and resumes when it returns', async () => {
    const doc = fakeDocument();
    const { instance, context } = engine(doc);
    instance.unlock();
    await Promise.resolve();
    doc.hidden = true;
    doc.fire();
    expect(context().suspend).toHaveBeenCalled();
    await Promise.resolve();
    doc.hidden = false;
    doc.fire();
    expect(context().resume).toHaveBeenCalledTimes(2);
  });

  it('runs the music scheduler only while a scene is set and music is audible', async () => {
    vi.useFakeTimers();
    const { instance, context } = engine();
    instance.setPreferences(DEFAULT_AUDIO_PREFERENCES);
    instance.unlock();
    await Promise.resolve();
    const base = context().created.bufferSource ?? 0;
    instance.setScene('harbor');
    // 海浪的兩層噪音立即開始，和弦也在 lookahead 內排程。
    expect(context().created.bufferSource).toBe(base + 2);
    const oscillators = context().created.oscillator ?? 0;
    expect(oscillators).toBeGreaterThan(0);

    instance.setPreferences({ ...DEFAULT_AUDIO_PREFERENCES, music: 0 });
    context().currentTime = 30;
    vi.advanceTimersByTime(1000);
    expect(context().created.oscillator).toBe(oscillators);
    instance.setScene(null);
  });

  it('closes the context on dispose and stops reacting', async () => {
    const doc = fakeDocument();
    const { instance, context } = engine(doc);
    instance.unlock();
    await Promise.resolve();
    instance.dispose();
    expect(context().close).toHaveBeenCalled();
    expect(doc.listeners.size).toBe(0);
    instance.unlock();
    expect(FakeContext.instances).toHaveLength(1);
  });
});
