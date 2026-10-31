import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { StorageLike } from '../state/session.ts';
import type { SoundCue } from './cues.ts';
import { SILENT_AUDIO_ENGINE, type AudioEngine, type MusicScene } from './engine.ts';
import { readStoredAudio, writeStoredAudio, type AudioPreferences } from './preferences.ts';
import { RollSoundCoordinator } from './rolls.ts';

export interface AudioControls {
  supported: boolean;
  preferences: AudioPreferences;
  /** 由使用者操作呼叫（點擊、拖曳滑桿），會在同一個手勢內解鎖音訊。 */
  updatePreferences(patch: Partial<AudioPreferences>): void;
  play(cue: SoundCue, delayMs?: number): void;
  /** 跟著盤面骰子演出播放擲骰聲與其後果（BoardView 回報演出，useGameSounds 登記後果）。 */
  rolls: RollSoundCoordinator;
}

const AudioControlsContext = createContext<AudioControls>({
  supported: false,
  preferences: { muted: true, effects: 0, music: 0 },
  updatePreferences: () => undefined,
  play: () => undefined,
  rolls: new RollSoundCoordinator(() => undefined),
});

/** 會觸發「使用者啟用」的事件；在捕獲階段同步解鎖，搶在任何 React 處理之前。 */
const UNLOCK_EVENTS = ['pointerdown', 'keydown', 'touchend'] as const;

export function AudioProvider({ engine = SILENT_AUDIO_ENGINE, storage, scene, children }: {
  engine?: AudioEngine;
  storage: StorageLike;
  scene: MusicScene | null;
  children: ReactNode;
}) {
  const [preferences, setPreferences] = useState(() => readStoredAudio(storage));
  const preferencesRef = useRef(preferences);

  useEffect(() => {
    engine.setPreferences(preferencesRef.current);
    const unlock = () => engine.unlock();
    for (const type of UNLOCK_EVENTS) document.addEventListener(type, unlock, { capture: true, passive: true });
    return () => {
      for (const type of UNLOCK_EVENTS) document.removeEventListener(type, unlock, { capture: true });
    };
  }, [engine]);

  // 引擎由入口建立並擁有；這裡不 dispose，StrictMode 的重複掛載才不會關掉唯一的 context。
  useEffect(() => {
    engine.setScene(scene);
  }, [engine, scene]);

  const updatePreferences = useCallback((patch: Partial<AudioPreferences>) => {
    const next = { ...preferencesRef.current, ...patch };
    preferencesRef.current = next;
    // 先同步交給引擎再解鎖：取消靜音的那次點擊本身就能讓 iOS 恢復播放。
    engine.setPreferences(next);
    engine.unlock();
    writeStoredAudio(storage, next);
    setPreferences(next);
  }, [engine, storage]);

  const play = useCallback((cue: SoundCue, delayMs?: number) => engine.play(cue, delayMs), [engine]);
  const rolls = useMemo(() => new RollSoundCoordinator(play), [play]);
  useEffect(() => () => rolls.dispose(), [rolls]);

  const value = useMemo<AudioControls>(() => ({
    supported: engine.supported,
    preferences,
    updatePreferences,
    play,
    rolls,
  }), [engine.supported, preferences, updatePreferences, play, rolls]);

  return <AudioControlsContext.Provider value={value}>{children}</AudioControlsContext.Provider>;
}

export function useAudio(): AudioControls {
  return useContext(AudioControlsContext);
}
