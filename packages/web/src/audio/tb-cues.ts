/**
 * Traders & Barbarians sound cues: procedural recipes and the event mapping.
 * Like the base cues, only public parameters and "is this the viewer" decide
 * the sound, so a cue never reveals a hidden draw.
 */

import type { GameEvent } from '@catan/protocol';

export const TB_SOUND_CUES = ['tb.fish', 'tb.coins', 'tb.barbarians', 'tb.wagon', 'tb.victory'] as const;
export type TbSoundCue = (typeof TB_SOUND_CUES)[number];

export const TB_CUE_LENGTH_SECONDS: Record<TbSoundCue, number> = {
  'tb.fish': 0.9, 'tb.coins': 0.6, 'tb.barbarians': 1.4, 'tb.wagon': 0.8, 'tb.victory': 1.3,
};

export const TB_CUE_DESCRIPTIONS: Record<TbSoundCue, string> = {
  'tb.fish': '捕魚：水花與氣泡 · Fish splash',
  'tb.coins': '金幣入袋 · Coins',
  'tb.barbarians': '野蠻人戰鼓 · Barbarian drums',
  'tb.wagon': '馬車車輪 · Wagon wheels',
  'tb.victory': '情境獎勵 · Scenario award',
};

/** Cue for a T&B rule event (null for none). */
export function tbCueForEvent(event: GameEvent): TbSoundCue | null {
  const type = event.type;
  if (!type.startsWith('tb.')) return null;
  if (type.startsWith('tb.fish') || type === 'tb.bootDrawn' || type === 'tb.bootGiven') return 'tb.fish';
  if (type.includes('Gold') || type.includes('gold') || type.includes('Coin')) return 'tb.coins';
  if (type.includes('arbarian') || type.includes('Conquer') || type.includes('conquer')) return 'tb.barbarians';
  if (type.includes('agon') || type.includes('Train') || type.includes('Delivered')) return 'tb.wagon';
  if (type === 'tb.strongestPorts' || type.includes('Prisoner') || type.includes('wealth')) return 'tb.victory';
  return null;
}
