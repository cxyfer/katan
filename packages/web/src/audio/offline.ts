/**
 * 以 OfflineAudioContext 離線渲染提示，供音效展示頁畫波形，以及瀏覽器檢查
 * 每個配方確實發聲、不爆音。訊號鏈與即時引擎相同（殘響 + 壓縮器）。
 */

import type { SoundCue } from './cues.ts';
import { createImpulseResponse, createNoiseBuffer, CUE_LENGTH_SECONDS, renderCue, seededRandom } from './synth.ts';

export interface CueAnalysis {
  cue: SoundCue;
  seconds: number;
  /** 取樣絕對值的最大值（1 為滿刻度）。 */
  peak: number;
  rms: number;
  /** 用來畫波形的區段峰值，0–1。 */
  envelope: number[];
}

type OfflineConstructor = new (channels: number, length: number, sampleRate: number) => OfflineAudioContext;

export async function renderCueOffline(cue: SoundCue, sampleRate = 22050, buckets = 120): Promise<CueAnalysis> {
  const Offline = (globalThis as unknown as { OfflineAudioContext?: OfflineConstructor }).OfflineAudioContext;
  if (!Offline) throw new Error('OfflineAudioContext unavailable');
  const seconds = CUE_LENGTH_SECONDS[cue] + 0.6;
  const ctx = new Offline(2, Math.ceil(seconds * sampleRate), sampleRate);
  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = -12;
  limiter.knee.value = 8;
  limiter.ratio.value = 6;
  limiter.connect(ctx.destination);
  const reverb = ctx.createConvolver();
  reverb.buffer = createImpulseResponse(ctx);
  const wet = ctx.createGain();
  wet.gain.value = 0.55;
  reverb.connect(wet);
  wet.connect(limiter);
  renderCue({ ctx, output: limiter, reverb, noise: createNoiseBuffer(ctx, 3) }, cue, 0.01, seededRandom(1));
  const buffer = await ctx.startRendering();
  const left = buffer.getChannelData(0);
  const right = buffer.getChannelData(1);
  let peak = 0;
  let sum = 0;
  const envelope = new Array<number>(buckets).fill(0);
  const size = Math.max(1, Math.floor(left.length / buckets));
  for (let index = 0; index < left.length; index += 1) {
    const value = Math.max(Math.abs(left[index]!), Math.abs(right[index]!));
    peak = Math.max(peak, value);
    sum += value * value;
    const bucket = Math.min(buckets - 1, Math.floor(index / size));
    envelope[bucket] = Math.max(envelope[bucket]!, value);
  }
  return { cue, seconds, peak, rms: Math.sqrt(sum / left.length), envelope };
}
