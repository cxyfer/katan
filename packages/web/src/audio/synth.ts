/**
 * 程序化音色：所有聲音都在瀏覽器內以 Web Audio 節點即時合成，不載入任何音檔。
 *
 * 每個配方只在給定的絕對時間點排程節點（`at` 為 AudioContext 時間，秒），
 * 因此同一份程式碼可以接到即時的 AudioContext，也可以接到 OfflineAudioContext
 * 做離線渲染檢查。節點在聲音結束後自行停止並由瀏覽器回收。
 */

import type { SoundCue } from './cues.ts';
import { TB_CUE_LENGTH_SECONDS, type TbSoundCue } from './tb-cues.ts';

export interface SynthTarget {
  ctx: BaseAudioContext;
  /** 乾聲輸出（效果匯流排或音樂匯流排）。 */
  output: AudioNode;
  /** 殘響送出；沒有時忽略 reverb 參數。 */
  reverb?: AudioNode | null;
  /** 共用的白噪音緩衝。 */
  noise: AudioBuffer;
}

export type Random = () => number;

/** 可重現的亂數（mulberry32），讓同一個種子得到同一段擲骰聲與旋律。 */
export function seededRandom(seed: number): Random {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

export function midiToFrequency(midi: number): number {
  return 440 * 2 ** ((midi - 69) / 12);
}

const SILENCE = 0.0001;

export function createNoiseBuffer(ctx: BaseAudioContext, seconds = 2, seed = 7): AudioBuffer {
  const length = Math.max(1, Math.floor(ctx.sampleRate * seconds));
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  const random = seededRandom(seed);
  for (let index = 0; index < length; index += 1) data[index] = random() * 2 - 1;
  return buffer;
}

/** 以指數衰減的噪音模擬一個小木造房間的殘響，供效果音與音樂共用。 */
export function createImpulseResponse(ctx: BaseAudioContext, seconds = 2.4, decay = 3.2): AudioBuffer {
  const length = Math.max(1, Math.floor(ctx.sampleRate * seconds));
  const buffer = ctx.createBuffer(2, length, ctx.sampleRate);
  for (let channel = 0; channel < 2; channel += 1) {
    const data = buffer.getChannelData(channel);
    const random = seededRandom(31 + channel);
    for (let index = 0; index < length; index += 1) {
      data[index] = (random() * 2 - 1) * (1 - index / length) ** decay;
    }
  }
  return buffer;
}

interface Envelope {
  at: number;
  attack?: number;
  hold?: number;
  decay: number;
  gain: number;
}

/** 先淡入、維持，再以指數曲線衰減到靜音；回傳結束時間。 */
function shape(param: AudioParam, { at, attack = 0.004, hold = 0, decay, gain }: Envelope): number {
  const peak = Math.max(SILENCE * 2, gain);
  // GainNode 預設增益為 1；來源的起點若被取整到比第一個自動化事件更早的取樣格，
  // 會漏出一個未衰減的滿刻度取樣（喀聲）。先把目前值設為靜音。
  param.value = SILENCE;
  param.setValueAtTime(SILENCE, at);
  param.linearRampToValueAtTime(peak, at + attack);
  param.setValueAtTime(peak, at + attack + hold);
  const end = at + attack + hold + decay;
  param.exponentialRampToValueAtTime(SILENCE, end);
  return end;
}

interface FilterSpec {
  type: BiquadFilterType;
  freq: number;
  /** 濾波器截止頻率在聲音期間滑到這個值。 */
  to?: number;
  q?: number;
}

interface Routing {
  pan?: number;
  /** 0–1 的殘響送出量。 */
  reverb?: number;
}

function route(target: SynthTarget, node: AudioNode, { pan = 0, reverb = 0 }: Routing): void {
  const { ctx } = target;
  let out: AudioNode = node;
  if (pan !== 0 && typeof ctx.createStereoPanner === 'function') {
    const panner = ctx.createStereoPanner();
    panner.pan.value = Math.max(-1, Math.min(1, pan));
    node.connect(panner);
    out = panner;
  }
  out.connect(target.output);
  if (reverb > 0 && target.reverb) {
    const send = ctx.createGain();
    send.gain.value = reverb;
    out.connect(send);
    send.connect(target.reverb);
  }
}

function filtered(target: SynthTarget, input: AudioNode, spec: FilterSpec | undefined, at: number, end: number): AudioNode {
  if (!spec) return input;
  const filter = target.ctx.createBiquadFilter();
  filter.type = spec.type;
  filter.Q.value = spec.q ?? 0.7;
  filter.frequency.setValueAtTime(spec.freq, at);
  if (spec.to !== undefined) filter.frequency.exponentialRampToValueAtTime(Math.max(20, spec.to), end);
  input.connect(filter);
  return filter;
}

export interface ToneSpec extends Envelope, Routing {
  freq: number;
  type?: OscillatorType;
  /** 音高在 `glide` 秒內以指數滑到這個頻率。 */
  to?: number;
  glide?: number;
  detune?: number;
  filter?: FilterSpec;
}

export function tone(target: SynthTarget, spec: ToneSpec): number {
  const { ctx } = target;
  const osc = ctx.createOscillator();
  osc.type = spec.type ?? 'sine';
  osc.frequency.setValueAtTime(spec.freq, spec.at);
  if (spec.detune) osc.detune.setValueAtTime(spec.detune, spec.at);
  const amp = ctx.createGain();
  const end = shape(amp.gain, spec);
  if (spec.to !== undefined) {
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, spec.to), spec.at + (spec.glide ?? end - spec.at));
  }
  const source = filtered(target, osc, spec.filter, spec.at, end);
  source.connect(amp);
  route(target, amp, spec);
  osc.start(spec.at);
  osc.stop(end + 0.05);
  return end;
}

export interface NoiseSpec extends Envelope, Routing {
  filter?: FilterSpec;
  /** 播放速率；低於 1 讓噪音較暗、較粗。 */
  rate?: number;
  /** 從噪音緩衝的哪個位置開始（0–1），讓連續的爆裂聲彼此不同。 */
  offset?: number;
}

export function noise(target: SynthTarget, spec: NoiseSpec): number {
  const { ctx } = target;
  const source = ctx.createBufferSource();
  source.buffer = target.noise;
  source.loop = true;
  source.playbackRate.value = spec.rate ?? 1;
  const amp = ctx.createGain();
  const end = shape(amp.gain, spec);
  const node = filtered(target, source, spec.filter, spec.at, end);
  node.connect(amp);
  route(target, amp, spec);
  source.start(spec.at, (spec.offset ?? 0) * target.noise.duration);
  source.stop(end + 0.05);
  return end;
}

// ---------------------------------------------------------------------
// 樂器
// ---------------------------------------------------------------------

/** 木頭敲擊：短促下滑的正弦「咚」加上帶通噪音的接觸聲。 */
export function knock(target: SynthTarget, at: number, freq: number, gain: number, routing: Routing = {}): void {
  tone(target, { at, freq, to: freq * 0.72, glide: 0.08, decay: 0.11, gain: gain * 0.9, ...routing });
  noise(target, {
    at, decay: 0.045, gain: gain * 0.55, offset: (freq % 97) / 97,
    filter: { type: 'bandpass', freq: freq * 5.5, q: 2.2 }, ...routing,
  });
}

/** 木琴音色：基音加上快速消失的四倍泛音。 */
export function marimba(target: SynthTarget, at: number, midi: number, gain: number, decay = 0.6, routing: Routing = {}): void {
  const freq = midiToFrequency(midi);
  tone(target, { at, freq, decay, gain, attack: 0.003, ...routing });
  tone(target, { at, freq: freq * 4, decay: decay * 0.18, gain: gain * 0.35, attack: 0.002, ...routing });
}

/** 鐘琴／船鐘：非整數倍泛音，衰減長，帶一點殘響。 */
export function bell(target: SynthTarget, at: number, midi: number, gain: number, decay = 1.2, routing: Routing = {}): void {
  const freq = midiToFrequency(midi);
  const partials: Array<[number, number, number]> = [[1, 1, 1], [2.01, 0.42, 0.7], [2.76, 0.3, 0.45], [5.4, 0.12, 0.22]];
  for (const [ratio, level, length] of partials) {
    tone(target, { at, freq: freq * ratio, decay: decay * length, gain: gain * level, attack: 0.002, ...routing });
  }
}

/** 撥弦（豎琴、卡林巴）：三角波加正弦泛音，濾波器逐漸收暗。 */
export function pluck(target: SynthTarget, at: number, midi: number, gain: number, decay = 0.9, routing: Routing = {}): void {
  const freq = midiToFrequency(midi);
  tone(target, {
    at, freq, type: 'triangle', decay, gain, attack: 0.003,
    filter: { type: 'lowpass', freq: freq * 8, to: freq * 2, q: 0.5 }, ...routing,
  });
  tone(target, { at, freq: freq * 2, decay: decay * 0.4, gain: gain * 0.3, attack: 0.002, ...routing });
}

/** 銅管：兩支微走音的鋸齒波，經過會先打開再收回的低通濾波器。 */
export function brass(target: SynthTarget, at: number, midi: number, gain: number, hold: number, routing: Routing = {}): void {
  const freq = midiToFrequency(midi);
  for (const detune of [-6, 7]) {
    const { ctx } = target;
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(freq * 0.985, at);
    osc.frequency.exponentialRampToValueAtTime(freq, at + 0.05);
    osc.detune.setValueAtTime(detune, at);
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.Q.value = 1.2;
    filter.frequency.setValueAtTime(freq * 1.5, at);
    filter.frequency.linearRampToValueAtTime(freq * 6, at + 0.06);
    filter.frequency.exponentialRampToValueAtTime(freq * 2.2, at + hold + 0.3);
    const amp = ctx.createGain();
    const end = shape(amp.gain, { at, attack: 0.035, hold, decay: 0.35, gain: gain / 2 });
    osc.connect(filter);
    filter.connect(amp);
    route(target, amp, routing);
    osc.start(at);
    osc.stop(end + 0.05);
  }
}

/** 硬幣：高頻正弦加 1.47 倍的金屬泛音。 */
export function coin(target: SynthTarget, at: number, freq: number, gain: number, routing: Routing = {}): void {
  tone(target, { at, freq, decay: 0.22, gain, attack: 0.001, ...routing });
  tone(target, { at, freq: freq * 1.47, decay: 0.16, gain: gain * 0.6, attack: 0.001, ...routing });
  noise(target, { at, decay: 0.012, gain: gain * 0.8, filter: { type: 'highpass', freq: 6000 }, ...routing });
}

/** 掃頻噪音：翻牌、揮動、偷取的「咻」聲。 */
export function swish(target: SynthTarget, at: number, from: number, to: number, length: number, gain: number, routing: Routing = {}): void {
  noise(target, {
    at, attack: length * 0.45, decay: length * 0.55, gain,
    filter: { type: 'bandpass', freq: from, to, q: 1.4 }, ...routing,
  });
}

// ---------------------------------------------------------------------
// 提示配方
// ---------------------------------------------------------------------

type Recipe = (target: SynthTarget, at: number, random: Random) => void;

const range = (random: Random, low: number, high: number) => low + random() * (high - low);

/** Traders & Barbarians cues (see `tb-cues.ts`). */
const TB_RECIPES: Record<TbSoundCue, (s: SynthTarget, at: number, random: Random) => void> = {
  // A splash and two rising bubbles.
  'tb.fish': (s, at) => {
    noise(s, { at, attack: 0.01, decay: 0.25, gain: 0.16, filter: { type: 'bandpass', freq: 900, q: 0.9 } });
    tone(s, { at: at + 0.12, freq: 380, to: 900, glide: 0.08, decay: 0.09, gain: 0.07 });
    tone(s, { at: at + 0.24, freq: 520, to: 1250, glide: 0.07, decay: 0.08, gain: 0.06 });
    marimba(s, at + 0.34, 72, 0.06, 0.5, { reverb: 0.25 });
  },
  // Coins dropped onto a table.
  'tb.coins': (s, at, random) => {
    [0, 0.06, 0.11, 0.19].forEach((offset, index) => coin(s, at + offset, 2600 + index * 210 + random() * 120, 0.07, { pan: -0.3 + index * 0.2, reverb: 0.15 }));
  },
  // Low war drums and a horn: barbarians land or attack.
  'tb.barbarians': (s, at) => {
    [0, 0.22, 0.44].forEach((offset, index) => {
      tone(s, { at: at + offset, freq: 70 - index * 4, to: 45, glide: 0.25, decay: 0.32, gain: 0.42 });
      noise(s, { at: at + offset, decay: 0.12, gain: 0.18, filter: { type: 'lowpass', freq: 400 } });
    });
    brass(s, at + 0.5, 45, 0.1, 0.5, { reverb: 0.35 });
  },
  // Creaking wheels and a few hoof knocks.
  'tb.wagon': (s, at) => {
    swish(s, at, 600, 300, 0.4, 0.08);
    [0.05, 0.2, 0.35, 0.5].forEach((offset, index) => knock(s, at + offset, index % 2 ? 330 : 280, 0.18, { reverb: 0.1 }));
  },
  // A scenario award (wealth, prisoners, deliveries).
  'tb.victory': (s, at) => {
    [67, 72, 76].forEach((midi, index) => bell(s, at + index * 0.09, midi, 0.08, 1, { reverb: 0.35 }));
  },
};

const RECIPES: Record<SoundCue, Recipe> = {
  // 骰子在木杯中搖晃，再拋到桌上彈跳；落定的聲音由 dice.land 在點數揭曉時補上。
  'dice.roll': (s, at, random) => {
    let time = at;
    for (let index = 0; index < 13; index += 1) {
      const gain = range(random, 0.16, 0.3);
      noise(s, {
        at: time, decay: range(random, 0.012, 0.024), gain, offset: random(),
        filter: { type: 'bandpass', freq: range(random, 2400, 4600), q: 5 }, pan: range(random, -0.3, 0.3),
      });
      tone(s, { at: time, type: 'triangle', freq: range(random, 1100, 1900), decay: 0.03, gain: gain * 0.25 });
      time += range(random, 0.035, 0.07);
    }
    const bounces = [0.86, 1.02, 1.14, 1.24, 1.31];
    bounces.forEach((offset, index) => {
      knock(s, at + offset, range(random, 300, 420), 0.32 * 0.78 ** index, { pan: range(random, -0.4, 0.4), reverb: 0.1 });
    });
  },
  'dice.land': (s, at, random) => {
    knock(s, at, range(random, 240, 280), 0.42, { pan: -0.15, reverb: 0.12 });
    knock(s, at + 0.07, range(random, 200, 240), 0.3, { pan: 0.2, reverb: 0.12 });
  },
  // 本人獲得資源：翻牌聲加上一串上行的鐘琴琶音。
  'production.self': (s, at) => {
    swish(s, at, 1800, 5200, 0.18, 0.12);
    [76, 79, 83, 88].forEach((midi, index) => bell(s, at + 0.06 + index * 0.08, midi, 0.13, 0.9, { reverb: 0.3, pan: -0.2 + index * 0.13 }));
  },
  'production.other': (s, at) => {
    swish(s, at, 1600, 4200, 0.15, 0.07);
    marimba(s, at + 0.05, 74, 0.08, 0.5, { reverb: 0.2 });
  },
  // 放下兩段木板。
  'build.road': (s, at) => {
    knock(s, at, 170, 0.42, { pan: -0.1, reverb: 0.1 });
    knock(s, at + 0.11, 205, 0.34, { pan: 0.1, reverb: 0.1 });
  },
  // 三下木槌，接上溫暖的三和弦。
  'build.settlement': (s, at) => {
    [0, 0.13, 0.26].forEach((offset, index) => {
      tone(s, { at: at + offset, type: 'triangle', freq: 520 - index * 20, to: 400, glide: 0.05, decay: 0.06, gain: 0.2 });
      noise(s, { at: at + offset, decay: 0.03, gain: 0.2, offset: index / 3, filter: { type: 'bandpass', freq: 2600, q: 4 } });
    });
    [67, 71, 74].forEach((midi, index) => marimba(s, at + 0.42 + index * 0.06, midi, 0.1, 0.9, { reverb: 0.28 }));
  },
  // 石材落地，再來一段銅管和弦。
  'build.city': (s, at) => {
    tone(s, { at, freq: 110, to: 52, glide: 0.35, decay: 0.45, gain: 0.5 });
    noise(s, { at, decay: 0.25, gain: 0.3, filter: { type: 'lowpass', freq: 500 }, rate: 0.6 });
    [60, 64, 67].forEach((midi) => brass(s, at + 0.22, midi, 0.07, 0.28, { reverb: 0.3 }));
    brass(s, at + 0.56, 72, 0.08, 0.45, { reverb: 0.35 });
  },
  // 抽牌：滑出、翻面，帶一點閃光。
  'dev.buy': (s, at) => {
    swish(s, at, 1500, 5000, 0.16, 0.2, { pan: 0.2 });
    noise(s, { at: at + 0.17, decay: 0.022, gain: 0.18, filter: { type: 'highpass', freq: 4200 } });
    bell(s, at + 0.2, 84, 0.06, 0.7, { reverb: 0.35 });
  },
  // 出鞘的金屬聲與號角。
  'dev.knight': (s, at) => {
    noise(s, { at, attack: 0.02, decay: 0.5, gain: 0.1, filter: { type: 'highpass', freq: 5200 } });
    tone(s, { at, freq: 2093, decay: 0.6, gain: 0.03 });
    tone(s, { at, freq: 3171, decay: 0.45, gain: 0.02 });
    brass(s, at + 0.12, 55, 0.12, 0.14, { reverb: 0.35 });
    brass(s, at + 0.34, 60, 0.13, 0.42, { reverb: 0.4 });
  },
  // 硬幣一路落入同一個口袋。
  'dev.monopoly': (s, at, random) => {
    let time = at;
    for (let index = 0; index < 8; index += 1) {
      coin(s, time, range(random, 2500, 3600), 0.07, { pan: range(random, -0.5, 0.5), reverb: 0.15 });
      time += 0.075 - index * 0.006;
    }
    marimba(s, time + 0.05, 62, 0.1, 0.8, { reverb: 0.25 });
  },
  // 豎琴的上行刮奏。
  'dev.yearOfPlenty': (s, at) => {
    [60, 62, 64, 67, 69, 72, 74, 76, 79].forEach((midi, index) =>
      pluck(s, at + index * 0.05, midi, 0.08, 1.1, { reverb: 0.45, pan: -0.4 + index * 0.1 }));
  },
  'dev.roadBuilding': (s, at) => {
    [0, 0.1, 0.32, 0.42].forEach((offset, index) => knock(s, at + offset, index % 2 ? 210 : 175, 0.26, { reverb: 0.1 }));
    marimba(s, at + 0.6, 67, 0.08, 0.5, { reverb: 0.25 });
    marimba(s, at + 0.68, 74, 0.08, 0.7, { reverb: 0.25 });
  },
  // 七點／強盜：定音鼓與兩支走音的低音鋸齒波，加上小二度的不安動機。
  'robber.alert': (s, at) => {
    tone(s, { at, freq: 82, to: 62, glide: 0.6, decay: 0.85, gain: 0.42 });
    for (const [midi, detune] of [[38, -8], [38, 9]] as const) {
      tone(s, {
        at, freq: midiToFrequency(midi), detune, type: 'sawtooth', attack: 0.25, hold: 0.3, decay: 0.9, gain: 0.06,
        filter: { type: 'lowpass', freq: 260, to: 900, q: 2 }, reverb: 0.3,
      });
    }
    pluck(s, at + 0.3, 62, 0.09, 0.6, { reverb: 0.3 });
    pluck(s, at + 0.55, 63, 0.09, 0.9, { reverb: 0.35 });
  },
  // 沉重的石像放到地塊上。
  'robber.move': (s, at) => {
    tone(s, { at, freq: 95, to: 48, glide: 0.3, decay: 0.35, gain: 0.5 });
    noise(s, { at, decay: 0.2, gain: 0.32, filter: { type: 'lowpass', freq: 350 }, rate: 0.5 });
    noise(s, { at: at + 0.02, decay: 0.15, gain: 0.1, filter: { type: 'bandpass', freq: 1200, q: 0.8 } });
  },
  'robber.steal': (s, at) => {
    swish(s, at, 300, 2800, 0.3, 0.26, { pan: -0.3 });
    pluck(s, at + 0.22, 69, 0.07, 0.25);
    pluck(s, at + 0.32, 64, 0.07, 0.35);
  },
  // 被偷的是自己：同樣的咻聲，接著下行的小調音型。
  'robber.stolenFromYou': (s, at) => {
    swish(s, at, 2800, 300, 0.3, 0.26, { pan: 0.3 });
    [67, 63, 60].forEach((midi, index) =>
      tone(s, { at: at + 0.25 + index * 0.14, type: 'triangle', freq: midiToFrequency(midi), decay: 0.4, gain: 0.1, reverb: 0.2 }));
  },
  // 紙牌摩擦。
  'discard': (s, at, random) => {
    [0, 0.05, 0.11, 0.16, 0.23].forEach((offset) => {
      noise(s, {
        at: at + offset, attack: 0.008, decay: range(random, 0.03, 0.06), gain: range(random, 0.1, 0.18), offset: random(),
        filter: { type: 'bandpass', freq: range(random, 3000, 6000), q: 0.8 }, pan: range(random, -0.3, 0.3),
      });
    });
  },
  // 船鐘兩響：有人向你詢價。
  'trade.offer': (s, at) => {
    bell(s, at, 81, 0.12, 1.3, { reverb: 0.35 });
    bell(s, at + 0.22, 81, 0.08, 1.4, { reverb: 0.35 });
  },
  'trade.complete': (s, at) => {
    coin(s, at, 3000, 0.08, { pan: -0.2 });
    coin(s, at + 0.08, 3400, 0.08, { pan: 0.2 });
    marimba(s, at + 0.14, 67, 0.1, 0.5, { reverb: 0.2 });
    marimba(s, at + 0.24, 74, 0.1, 0.8, { reverb: 0.25 });
  },
  'trade.bank': (s, at) => {
    [0, 0.07, 0.13].forEach((offset, index) => coin(s, at + offset, 2700 + index * 260, 0.07, { reverb: 0.15 }));
    noise(s, { at, attack: 0.2, decay: 0.5, gain: 0.08, filter: { type: 'lowpass', freq: 800 } });
  },
  'trade.cancel': (s, at) => {
    marimba(s, at, 69, 0.07, 0.4, { reverb: 0.2 });
    marimba(s, at + 0.12, 64, 0.07, 0.6, { reverb: 0.2 });
  },
  // 輪到你：明亮的上行大三和弦。
  'turn.yours': (s, at) => {
    [72, 76, 79, 84].forEach((midi, index) => bell(s, at + index * 0.11, midi, 0.1, 1.1, { reverb: 0.4, pan: -0.25 + index * 0.17 }));
  },
  'turn.other': (s, at) => {
    marimba(s, at, 60, 0.06, 0.4, { reverb: 0.15 });
  },
  // 勝利號角、和弦與閃光。
  'game.victory': (s, at) => {
    brass(s, at, 60, 0.12, 0.08, { reverb: 0.3 });
    brass(s, at + 0.16, 64, 0.12, 0.08, { reverb: 0.3 });
    brass(s, at + 0.32, 67, 0.12, 0.08, { reverb: 0.3 });
    brass(s, at + 0.5, 72, 0.13, 0.9, { reverb: 0.45 });
    for (const midi of [48, 55, 64]) brass(s, at + 0.5, midi, 0.06, 0.9, { reverb: 0.4 });
    [84, 88, 91, 96].forEach((midi, index) => bell(s, at + 0.55 + index * 0.1, midi, 0.05, 1.2, { reverb: 0.5, pan: index % 2 ? 0.4 : -0.4 }));
    noise(s, { at: at + 0.5, attack: 0.01, decay: 1.2, gain: 0.05, filter: { type: 'highpass', freq: 6500 } });
  },
  'game.over': (s, at) => {
    [67, 65, 64].forEach((midi, index) => marimba(s, at + index * 0.22, midi, 0.06, 0.6, { reverb: 0.3 }));
    for (const midi of [48, 60, 64, 67]) pluck(s, at + 0.72, midi, 0.04, 1.6, { reverb: 0.45 });
  },
  'ui.select': (s, at) => {
    tone(s, { at, freq: 1480, decay: 0.035, gain: 0.05 });
    tone(s, { at, type: 'triangle', freq: 740, decay: 0.05, gain: 0.04 });
  },
  'ui.error': (s, at) => {
    for (const offset of [0, 0.13]) {
      tone(s, { at: at + offset, type: 'square', freq: 150, decay: 0.09, gain: 0.05, filter: { type: 'lowpass', freq: 700 } });
    }
  },
  // 氣泡「啵」兩聲。
  'chat.message': (s, at) => {
    tone(s, { at, freq: 520, to: 1040, glide: 0.07, decay: 0.1, gain: 0.08 });
    tone(s, { at: at + 0.09, freq: 780, to: 1320, glide: 0.06, decay: 0.09, gain: 0.06 });
  },
  ...TB_RECIPES,
};

/** 於 `at` 排程一個提示。`random` 只影響擲骰等帶自然隨機感的配方。 */
export function renderCue(target: SynthTarget, cue: SoundCue, at: number, random: Random = Math.random): void {
  RECIPES[cue](target, at, random);
}

/** 每個提示約略的長度（秒），供離線渲染與節流判斷使用。 */
export const CUE_LENGTH_SECONDS: Record<SoundCue, number> = {
  'dice.roll': 1.5, 'dice.land': 0.35, 'production.self': 1.4, 'production.other': 0.7,
  'build.road': 0.35, 'build.settlement': 1.5, 'build.city': 1.6, 'dev.buy': 1.0, 'dev.knight': 1.4,
  'dev.monopoly': 1.4, 'dev.yearOfPlenty': 1.8, 'dev.roadBuilding': 1.4, 'robber.alert': 1.9,
  'robber.move': 0.6, 'robber.steal': 0.8, 'robber.stolenFromYou': 1.0, 'discard': 0.4,
  'trade.offer': 1.8, 'trade.complete': 1.2, 'trade.bank': 0.8, 'trade.cancel': 0.8,
  'turn.yours': 1.6, 'turn.other': 0.5, 'game.victory': 2.6, 'game.over': 2.6,
  'ui.select': 0.1, 'ui.error': 0.3, 'chat.message': 0.25,
  ...TB_CUE_LENGTH_SECONDS,
};
