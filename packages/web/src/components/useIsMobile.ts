import { useEffect, useState } from 'react';

/** 手機橫屏（短高度、觸控）：牌桌改用浮動 HUD 以讓出棋盤高度。 */
export const COMPACT_LANDSCAPE_QUERY = '(orientation: landscape) and (max-height: 520px) and (pointer: coarse)';

/**
 * Viewport classification. The layout itself is CSS-driven; this hook only
 * decides *where a panel is rendered*, which matters because the mobile drawer
 * must not duplicate the desktop side panels in the DOM (docs/SPEC.md §8.1).
 */
export function useIsMobile(query = '(max-width: 900px)'): boolean {
  const [matches, setMatches] = useState(() => queryMatches(query));

  useEffect(() => {
    if (typeof globalThis.matchMedia !== 'function') return;
    const list = globalThis.matchMedia(query);
    setMatches(list.matches);
    const listener = (event: MediaQueryListEvent) => setMatches(event.matches);
    if (typeof list.addEventListener === 'function') {
      list.addEventListener('change', listener);
      return () => list.removeEventListener('change', listener);
    }
    return undefined;
  }, [query]);

  return matches;
}

function queryMatches(query: string): boolean {
  if (typeof globalThis.matchMedia !== 'function') return false;
  try {
    return globalThis.matchMedia(query).matches;
  } catch {
    return false;
  }
}
