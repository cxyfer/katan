/**
 * 生成式背景音樂：海浪環境聲 + 緩慢的和弦鋪底 + 稀疏的卡林巴旋律。
 *
 * `composeBar` 是純函式：同一場景、小節與種子永遠得到同一組音符，可以單元測試；
 * `MusicSequencer` 以 lookahead 方式提前約一秒把音符排進 AudioContext 時間軸，
 * 主執行緒卡頓也不會讓節拍漂移。
 */

import { midiToFrequency, pluck, seededRandom, tone, type Random, type SynthTarget } from './synth.ts';

/** harbor：大廳、等待與結算畫面；island：牌桌上。 */
export type MusicScene = 'harbor' | 'island';

export interface SceneStyle {
  bpm: number;
  /** 每個和弦持續的小節數。 */
  barsPerChord: number;
  /** 每拍出現旋律音的機率。 */
  melodyDensity: number;
  /** 和弦進行：每個和弦由低到高的 MIDI 音。 */
  chords: readonly (readonly number[])[];
  /** 旋律可用的音階（五聲音階，任何組合都不刺耳）。 */
  scale: readonly number[];
  /** 海浪聲相對音量。 */
  ocean: number;
}

export const SCENES: Record<MusicScene, SceneStyle> = {
  // D 大調：Dmaj9 → Bm7 → Gmaj7 → A6sus，慢而開闊，像在港口等船。
  harbor: {
    bpm: 58,
    barsPerChord: 2,
    melodyDensity: 0.22,
    chords: [[50, 57, 64, 66, 69], [47, 54, 62, 66, 69], [43, 50, 59, 62, 66], [45, 52, 59, 62, 64]],
    scale: [74, 76, 78, 81, 83, 86, 88],
    ocean: 1,
  },
  // G 大調：Gmaj7 → Em7 → Cmaj9 → Dsus2，稍快、旋律較多，陪伴思考而不搶戲。
  island: {
    bpm: 68,
    barsPerChord: 2,
    melodyDensity: 0.32,
    chords: [[43, 55, 59, 62, 66], [40, 52, 59, 62, 67], [36, 52, 55, 59, 62], [38, 50, 57, 62, 64]],
    scale: [67, 69, 71, 74, 76, 79, 81],
    ocean: 0.55,
  },
};

export const BEATS_PER_BAR = 4;

export type MusicVoice = 'pad' | 'bass' | 'melody';

export interface MusicNote {
  voice: MusicVoice;
  midi: number;
  /** 小節內的起始拍（可為小數）。 */
  beat: number;
  /** 長度（拍）。 */
  beats: number;
  /** 0–1 的力度。 */
  velocity: number;
}

/** 小節的種子：同一首曲子在每次播放時都一致，但不同小節彼此不同。 */
function barSeed(scene: MusicScene, bar: number): number {
  return (scene === 'harbor' ? 0x51a7 : 0x1d3b) ^ Math.imul(bar + 1, 0x9e3779b1);
}

export function chordForBar(scene: MusicScene, bar: number): readonly number[] {
  const style = SCENES[scene];
  const index = Math.floor(Math.max(0, bar) / style.barsPerChord) % style.chords.length;
  return style.chords[index]!;
}

export function composeBar(scene: MusicScene, bar: number, random: Random = seededRandom(barSeed(scene, bar))): MusicNote[] {
  const style = SCENES[scene];
  const chord = chordForBar(scene, bar);
  const notes: MusicNote[] = [];
  const chordStart = bar % style.barsPerChord === 0;
  const chordBeats = style.barsPerChord * BEATS_PER_BAR;
  if (chordStart) {
    notes.push({ voice: 'bass', midi: chord[0]!, beat: 0, beats: chordBeats, velocity: 0.9 });
    for (const midi of chord.slice(1)) notes.push({ voice: 'pad', midi, beat: 0, beats: chordBeats, velocity: 0.7 });
  }
  // 旋律偏好和弦內音（同音名），每拍最多一個音，偶爾落在反拍。
  const chordClasses = new Set(chord.map((midi) => midi % 12));
  let previous: number | null = null;
  for (let beat = 0; beat < BEATS_PER_BAR; beat += 1) {
    if (random() >= style.melodyDensity) continue;
    const preferred = style.scale.filter((midi) => chordClasses.has(midi % 12) && midi !== previous);
    const pool = preferred.length > 0 && random() < 0.7 ? preferred : style.scale.filter((midi) => midi !== previous);
    const midi = pool[Math.floor(random() * pool.length)]!;
    const offbeat = random() < 0.25 ? 0.5 : 0;
    notes.push({ voice: 'melody', midi, beat: beat + offbeat, beats: 1.5, velocity: 0.55 + random() * 0.35 });
    previous = midi;
  }
  return notes;
}

// ---------------------------------------------------------------------
// 播放
// ---------------------------------------------------------------------

function renderNote(target: SynthTarget, note: MusicNote, at: number, beatSeconds: number): void {
  const length = note.beats * beatSeconds;
  const freq = midiToFrequency(note.midi);
  switch (note.voice) {
    case 'bass':
      tone(target, { at, freq, attack: 0.08, hold: length * 0.3, decay: length * 0.7, gain: 0.08 * note.velocity, reverb: 0.15 });
      break;
    case 'pad':
      // 兩支微走音的三角波，慢起慢收，形成柔和的和弦床。
      for (const detune of [-5, 6]) {
        tone(target, {
          at, freq, detune, type: 'triangle', attack: Math.min(1.8, length * 0.3), hold: length * 0.35,
          decay: length * 0.55, gain: 0.018 * note.velocity,
          filter: { type: 'lowpass', freq: 900, q: 0.4 }, reverb: 0.5,
        });
      }
      break;
    case 'melody':
      pluck(target, at, note.midi, 0.05 * note.velocity, Math.max(0.8, length), { reverb: 0.45, pan: ((note.midi % 7) - 3) / 8 });
      break;
  }
}

/** 由兩層帶通／低通噪音與慢速 LFO 構成的海浪聲；回傳停止函式。 */
function startOcean(target: SynthTarget, output: AudioNode): () => void {
  const { ctx } = target;
  const stops: Array<() => void> = [];
  const layers = [
    { filter: 'lowpass' as BiquadFilterType, freq: 420, q: 0.5, rate: 0.07, depth: 0.45, level: 0.5, playback: 0.5 },
    { filter: 'bandpass' as BiquadFilterType, freq: 1300, q: 0.6, rate: 0.113, depth: 0.5, level: 0.16, playback: 1 },
  ];
  for (const layer of layers) {
    const source = ctx.createBufferSource();
    source.buffer = target.noise;
    source.loop = true;
    source.playbackRate.value = layer.playback;
    const filter = ctx.createBiquadFilter();
    filter.type = layer.filter;
    filter.frequency.value = layer.freq;
    filter.Q.value = layer.q;
    const swell = ctx.createGain();
    swell.gain.value = layer.level;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = layer.rate;
    const depth = ctx.createGain();
    depth.gain.value = layer.level * layer.depth;
    lfo.connect(depth);
    depth.connect(swell.gain);
    source.connect(filter);
    filter.connect(swell);
    swell.connect(output);
    const at = ctx.currentTime;
    source.start(at, layer.rate * 10 % target.noise.duration);
    lfo.start(at);
    stops.push(() => {
      source.stop();
      lfo.stop();
      swell.disconnect();
    });
  }
  return () => stops.forEach((stop) => stop());
}

const LOOKAHEAD_SECONDS = 1.2;
const TICK_MS = 250;

/**
 * 背景音樂的排程器。場景切換不會重頭播放：從下一個小節起改用新場景的
 * 和聲與節奏，海浪聲則以平滑的音量曲線過渡。
 */
interface Session {
  /** 這次播放的乾聲與殘響送出；停止時一起淡出，已提前排程的長音也跟著消失。 */
  dry: GainNode;
  wet: GainNode | null;
  ocean: GainNode;
  target: SynthTarget;
  stopOcean: () => void;
}

const FADE_SECONDS = 0.6;

export class MusicSequencer {
  private timer: ReturnType<typeof setInterval> | null = null;
  private session: Session | null = null;
  private bar = 0;
  private nextBarTime = 0;

  constructor(private readonly target: SynthTarget, private scene: MusicScene) {}

  get running(): boolean {
    return this.timer !== null;
  }

  setScene(scene: MusicScene): void {
    if (scene === this.scene) return;
    this.scene = scene;
    this.session?.ocean.gain.setTargetAtTime(SCENES[scene].ocean, this.target.ctx.currentTime, 1.2);
  }

  start(): void {
    if (this.running) return;
    const { ctx } = this.target;
    const now = ctx.currentTime;
    const dry = ctx.createGain();
    dry.gain.setValueAtTime(0, now);
    dry.gain.linearRampToValueAtTime(1, now + FADE_SECONDS);
    dry.connect(this.target.output);
    let wet: GainNode | null = null;
    if (this.target.reverb) {
      wet = ctx.createGain();
      wet.gain.setValueAtTime(0, now);
      wet.gain.linearRampToValueAtTime(1, now + FADE_SECONDS);
      wet.connect(this.target.reverb);
    }
    const ocean = ctx.createGain();
    ocean.gain.setValueAtTime(0, now);
    ocean.gain.setTargetAtTime(SCENES[this.scene].ocean, now, 1.5);
    ocean.connect(dry);
    const target: SynthTarget = { ...this.target, output: dry, reverb: wet };
    this.session = { dry, wet, ocean, target, stopOcean: startOcean(target, ocean) };
    // 從和弦的第一小節重新開始，恢復播放時不會只剩旋律、缺了和弦鋪底。
    this.bar -= this.bar % SCENES[this.scene].barsPerChord;
    this.nextBarTime = now + 0.15;
    this.tick();
    this.timer = globalThis.setInterval(() => this.tick(), TICK_MS);
  }

  stop(): void {
    if (this.timer !== null) globalThis.clearInterval(this.timer);
    this.timer = null;
    const session = this.session;
    this.session = null;
    if (!session) return;
    const now = this.target.ctx.currentTime;
    for (const node of [session.dry, session.wet]) {
      if (!node) continue;
      node.gain.cancelScheduledValues(now);
      node.gain.setValueAtTime(node.gain.value, now);
      node.gain.linearRampToValueAtTime(0, now + FADE_SECONDS);
    }
    globalThis.setTimeout(() => {
      session.stopOcean();
      session.dry.disconnect();
      session.wet?.disconnect();
    }, FADE_SECONDS * 1000 + 50);
  }

  /** 分頁恢復後跳過已錯過的小節，不一次補播。 */
  resync(): void {
    this.nextBarTime = Math.max(this.nextBarTime, this.target.ctx.currentTime + 0.1);
  }

  private tick(): void {
    const session = this.session;
    if (!session) return;
    const { ctx } = this.target;
    if (this.nextBarTime < ctx.currentTime) this.resync();
    while (this.nextBarTime < ctx.currentTime + LOOKAHEAD_SECONDS) {
      const style = SCENES[this.scene];
      const beatSeconds = 60 / style.bpm;
      for (const note of composeBar(this.scene, this.bar)) {
        renderNote(session.target, note, this.nextBarTime + note.beat * beatSeconds, beatSeconds);
      }
      this.bar += 1;
      this.nextBarTime += BEATS_PER_BAR * beatSeconds;
    }
  }
}
