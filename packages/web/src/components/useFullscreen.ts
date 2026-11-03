import { useCallback, useEffect, useState, type RefObject } from 'react';

/** 全螢幕狀態以瀏覽器事件為準，離開或失敗時不顯示假的成功狀態。 */
export function useFullscreen(target: RefObject<HTMLElement | null>) {
  const [active, setActive] = useState(false);
  const [supported, setSupported] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setSupported(typeof target.current?.requestFullscreen === 'function' && document.fullscreenEnabled !== false);
    const sync = () => {
      setActive(document.fullscreenElement === target.current);
      setFailed(false);
    };
    document.addEventListener('fullscreenchange', sync);
    return () => document.removeEventListener('fullscreenchange', sync);
  }, [target]);

  const toggle = useCallback(async () => {
    setFailed(false);
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else {
        await target.current?.requestFullscreen();
        await lockLandscape();
      }
    } catch {
      setFailed(true);
    }
  }, [target]);

  return { active, supported, failed, toggle };
}

/**
 * 觸控裝置進入全螢幕後嘗試鎖定橫向（Android Chrome 只在全螢幕允許鎖定）；
 * iOS 沒有 lock、桌面 Chromium 會拒絕，失敗時維持原方向，不視為全螢幕失敗。
 * 離開全螢幕時瀏覽器會自動解除鎖定。
 */
async function lockLandscape(): Promise<void> {
  if (typeof globalThis.matchMedia !== 'function' || !globalThis.matchMedia('(pointer: coarse)').matches) return;
  const orientation = globalThis.screen?.orientation as (ScreenOrientation & { lock?: (type: 'landscape') => Promise<void> }) | undefined;
  if (typeof orientation?.lock !== 'function') return;
  try {
    await orientation.lock('landscape');
  } catch {
    // 不支援或被拒絕時保留目前方向
  }
}
