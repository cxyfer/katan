/**
 * 音效引擎：管理唯一的 AudioContext、匯流排與背景音樂。
 *
 * 訊號路徑：效果匯流排、音樂匯流排 → 主音量 → 壓縮器（避免多個聲音疊加時爆音）
 * → 喇叭；兩條匯流排各自送出到共用殘響。
 *
 * 瀏覽器的自動播放政策要求 AudioContext 在使用者手勢中建立或恢復，所以引擎
 * 直到 `unlock()`（由第一次點擊／按鍵同步呼叫）才建立 context；在那之前的提示一律
 * 略過，不排隊補播。靜音時暫停 context；分頁隱藏時停掉音樂，只保留需要玩家回來
 * 處理的提示（BACKGROUND_CUES）。
 */

import { BACKGROUND_CUES, type SoundCue } from './cues.ts';
import { MusicSequencer, type MusicScene } from './music.ts';
import { DEFAULT_AUDIO_PREFERENCES, levelToGain, type AudioPreferences } from './preferences.ts';
import { createImpulseResponse, createNoiseBuffer, renderCue, seededRandom, type SynthTarget } from './synth.ts';

export type { MusicScene } from './music.ts';

export interface AudioEngine {
  /** 瀏覽器是否提供 Web Audio。 */
  readonly supported: boolean;
  /** 在使用者手勢內同步呼叫：建立或恢復 AudioContext。 */
  unlock(): void;
  play(cue: SoundCue, delayMs?: number): void;
  setPreferences(preferences: AudioPreferences): void;
  /** null 表示不播放背景音樂。 */
  setScene(scene: MusicScene | null): void;
  dispose(): void;
}

export type ContextFactory = () => AudioContext | null;

type AudioContextConstructor = new (options?: AudioContextOptions) => AudioContext;

function defaultContextFactory(): AudioContext | null {
  const scope = globalThis as unknown as { AudioContext?: AudioContextConstructor; webkitAudioContext?: AudioContextConstructor };
  const Constructor = scope.AudioContext ?? scope.webkitAudioContext;
  if (!Constructor) return null;
  try {
    return new Constructor({ latencyHint: 'interactive' });
  } catch {
    return null;
  }
}

function hasWebAudio(): boolean {
  const scope = globalThis as unknown as { AudioContext?: unknown; webkitAudioContext?: unknown };
  return typeof scope.AudioContext === 'function' || typeof scope.webkitAudioContext === 'function';
}

/** 同一個提示在這段時間內重複觸發時只發一次聲。 */
const REPEAT_GUARD_SECONDS = 0.06;
/** 丟棄已排程提示時舊匯流排的淡出時間，避免直接切斷造成喀聲。 */
const BUS_FADE_SECONDS = 0.04;
/** 排程時預留的前置時間，避免第一個節點落在已經過去的時間點。 */
const SCHEDULE_PADDING_SECONDS = 0.01;

/** 背景音樂在相同刻度下比效果音小一些，事件提示才聽得清楚。 */
const MUSIC_HEADROOM = 0.7;

interface Bus {
  dry: GainNode;
  wet: GainNode;
}

interface Graph {
  ctx: AudioContext;
  master: GainNode;
  reverb: ConvolverNode;
  effects: Bus;
  music: Bus;
  effectsTarget: SynthTarget;
  sequencer: MusicSequencer;
}

export interface AudioEngineOptions {
  createContext?: ContextFactory;
  /** 可注入的 document，用於監聽分頁可見度。 */
  document?: Pick<Document, 'hidden' | 'addEventListener' | 'removeEventListener'> | null;
}

export class WebAudioEngine implements AudioEngine {
  readonly supported: boolean;
  private graph: Graph | null = null;
  private preferences: AudioPreferences = { ...DEFAULT_AUDIO_PREFERENCES };
  private scene: MusicScene | null = null;
  private disposed = false;
  private readonly lastStart = new Map<SoundCue, number>();
  private readonly random = seededRandom(Date.now() & 0xffff);
  private readonly createContext: ContextFactory;
  private readonly doc: AudioEngineOptions['document'];
  private readonly onVisibility = () => this.sync();

  constructor(options: AudioEngineOptions = {}) {
    this.createContext = options.createContext ?? defaultContextFactory;
    this.supported = options.createContext ? true : hasWebAudio();
    this.doc = options.document === undefined ? (typeof document === 'undefined' ? null : document) : options.document;
    this.doc?.addEventListener('visibilitychange', this.onVisibility);
  }

  unlock(): void {
    if (this.disposed || !this.supported) return;
    if (!this.graph) {
      // 靜音時也先建立：之後取消靜音的那次點擊未必再經過這裡。
      const ctx = this.createContext();
      if (!ctx) return;
      this.graph = this.build(ctx);
      this.applyGains(true);
    }
    // resume() 必須留在手勢的同步呼叫堆疊內，iOS Safari 才會放行。
    this.sync();
  }

  play(cue: SoundCue, delayMs = 0): void {
    const graph = this.graph;
    if (!graph || this.disposed || this.preferences.muted || this.preferences.effects <= 0) return;
    // 分頁隱藏時只響需要叫玩家回來的提示（BACKGROUND_CUES）；擲骰演出被盤面丟棄時，
    // RollSoundCoordinator 也已取消其餘提示。
    if (graph.ctx.state !== 'running' || (this.hidden() && !BACKGROUND_CUES.has(cue))) return;
    const at = graph.ctx.currentTime + SCHEDULE_PADDING_SECONDS + Math.max(0, delayMs) / 1000;
    const previous = this.lastStart.get(cue);
    if (previous !== undefined && Math.abs(at - previous) < REPEAT_GUARD_SECONDS) return;
    this.lastStart.set(cue, at);
    try {
      renderCue(graph.effectsTarget, cue, at, this.random);
    } catch {
      // 音效只是輔助提示；任何節點錯誤都不能影響遊戲操作。
    }
  }

  setPreferences(preferences: AudioPreferences): void {
    this.preferences = { ...preferences };
    this.applyGains(false);
    this.sync();
  }

  setScene(scene: MusicScene | null): void {
    this.scene = scene;
    if (scene) this.graph?.sequencer.setScene(scene);
    this.sync();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.doc?.removeEventListener('visibilitychange', this.onVisibility);
    const graph = this.graph;
    this.graph = null;
    if (!graph) return;
    graph.sequencer.stop();
    void graph.ctx.close().catch(() => undefined);
  }

  private hidden(): boolean {
    return this.doc?.hidden === true;
  }

  private wantsRunning(): boolean {
    const { muted, effects, music } = this.preferences;
    return !muted && (effects > 0 || music > 0);
  }

  private wantsMusic(): boolean {
    return this.scene !== null && !this.preferences.muted && this.preferences.music > 0 && !this.hidden();
  }

  /**
   * 依偏好、可見度與場景校正 context 與背景音樂的狀態。
   *
   * `ctx.state` 在 resume()／suspend() 完成前不會改變，所以每次轉換成功後都再校正一次，
   * 處理轉換期間偏好又改變的情況（例如恢復中途按下靜音）。轉換失敗（例如 iOS 不在手勢內）
   * 不重試，等下一次手勢的 unlock()。
   */
  private sync(): void {
    const graph = this.graph;
    if (!graph || this.disposed) return;
    const active = this.wantsRunning();
    const state = graph.ctx.state as AudioContextState | 'interrupted';
    // 只在真的到達目標狀態時再校正；resume() 完成卻仍未播放（例如 iOS 的 interrupted）
    // 時不重試，避免無止盡地反覆呼叫，等下一次手勢。
    const settle = (reached: AudioContextState) => {
      if (this.graph === graph && graph.ctx.state === reached) this.sync();
    };
    if (active && state !== 'running' && state !== 'closed') {
      void graph.ctx.resume().then(() => {
        graph.sequencer.resync();
        settle('running');
      }, () => undefined);
    } else if (!active && state === 'running') {
      graph.sequencer.stop();
      // 已排進時間軸、尚未響起的提示會在 context 恢復時一次補響；換掉效果匯流排把它們丟掉。
      this.replaceEffectsBus(graph);
      void graph.ctx.suspend().then(() => settle('suspended'), () => undefined);
      return;
    }
    if (active && this.wantsMusic()) {
      graph.sequencer.setScene(this.scene!);
      graph.sequencer.start();
    } else {
      graph.sequencer.stop();
    }
  }

  private applyGains(immediate: boolean): void {
    const graph = this.graph;
    if (!graph) return;
    const now = graph.ctx.currentTime;
    const set = (param: AudioParam, value: number) => {
      if (immediate) param.setValueAtTime(value, now);
      else param.setTargetAtTime(value, now, 0.05);
    };
    const effects = levelToGain(this.preferences.effects);
    const music = levelToGain(this.preferences.music) * MUSIC_HEADROOM;
    set(graph.master.gain, this.preferences.muted ? 0 : 1);
    for (const param of [graph.effects.dry.gain, graph.effects.wet.gain]) set(param, effects);
    for (const param of [graph.music.dry.gain, graph.music.wet.gain]) set(param, music);
  }

  /**
   * 換上新的效果匯流排：所有已排程的提示都接在舊匯流排上，舊匯流排淡出後斷開，
   * 它們就再也不會響（Web Audio 無法逐一取消已排程的節點）。
   */
  private replaceEffectsBus(graph: Graph): void {
    const previous = graph.effects;
    graph.effects = this.bus(graph.ctx, graph.master, graph.reverb);
    graph.effectsTarget = { ...graph.effectsTarget, output: graph.effects.dry, reverb: graph.effects.wet };
    const now = graph.ctx.currentTime;
    for (const node of [previous.dry, previous.wet]) {
      node.gain.cancelScheduledValues(now);
      node.gain.setValueAtTime(node.gain.value, now);
      node.gain.linearRampToValueAtTime(0, now + BUS_FADE_SECONDS);
    }
    globalThis.setTimeout(() => {
      previous.dry.disconnect();
      previous.wet.disconnect();
    }, BUS_FADE_SECONDS * 1000 + 30);
    this.lastStart.clear();
    const effects = levelToGain(this.preferences.effects);
    graph.effects.dry.gain.value = effects;
    graph.effects.wet.gain.value = effects;
  }

  /** 每條匯流排的乾聲與殘響送出各有一個增益節點，兩者都跟著該匯流排的音量，調低音樂時殘響尾巴也一起變小。 */
  private bus(ctx: AudioContext, master: AudioNode, reverb: AudioNode): Bus {
    const dry = ctx.createGain();
    dry.connect(master);
    const wet = ctx.createGain();
    wet.connect(reverb);
    return { dry, wet };
  }

  private build(ctx: AudioContext): Graph {
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -12;
    limiter.knee.value = 8;
    limiter.ratio.value = 6;
    limiter.attack.value = 0.003;
    limiter.release.value = 0.2;
    limiter.connect(ctx.destination);
    const master = ctx.createGain();
    master.connect(limiter);

    const reverb = ctx.createConvolver();
    reverb.buffer = createImpulseResponse(ctx);
    const reverbReturn = ctx.createGain();
    reverbReturn.gain.value = 0.55;
    reverb.connect(reverbReturn);
    reverbReturn.connect(master);

    const effects = this.bus(ctx, master, reverb);
    const music = this.bus(ctx, master, reverb);
    const noise = createNoiseBuffer(ctx, 3);
    return {
      ctx, master, reverb, effects, music,
      effectsTarget: { ctx, output: effects.dry, reverb: effects.wet, noise },
      sequencer: new MusicSequencer({ ctx, output: music.dry, reverb: music.wet, noise }, this.scene ?? 'harbor'),
    };
  }
}

export function createAudioEngine(options: AudioEngineOptions = {}): AudioEngine {
  return new WebAudioEngine(options);
}

/** 不支援 Web Audio 或測試環境用的靜默引擎。 */
export const SILENT_AUDIO_ENGINE: AudioEngine = Object.freeze({
  supported: false,
  unlock: () => undefined,
  play: () => undefined,
  setPreferences: () => undefined,
  setScene: () => undefined,
  dispose: () => undefined,
});
