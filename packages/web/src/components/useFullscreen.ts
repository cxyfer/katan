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
      else await target.current?.requestFullscreen();
    } catch {
      setFailed(true);
    }
  }, [target]);

  return { active, supported, failed, toggle };
}
