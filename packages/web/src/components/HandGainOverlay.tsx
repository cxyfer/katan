import { useLayoutEffect, useState, type CSSProperties, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { ResourceCardArt } from './ResourceCardArt.tsx';
import type { HandGain } from './useHandGains.ts';
import '../styles/hand-gains.css';

interface Placement {
  gain: HandGain;
  x: number;
  y: number;
}

/** Portal 避開收合手牌的裁切；純裝飾、不加入焦點或攔截棋盤操作。 */
export function HandGainOverlay({ gains, handRef }: { gains: readonly HandGain[]; handRef: RefObject<HTMLElement | null> }) {
  const [placements, setPlacements] = useState<Placement[]>([]);
  useLayoutEffect(() => {
    // 隱藏但保留掛載的手機抽屜不可把裝飾 portal 到可見桌面。
    let ancestor: HTMLElement | null = handRef.current;
    while (ancestor) {
      const style = window.getComputedStyle(ancestor);
      if (ancestor.hidden || ancestor.getAttribute('aria-hidden') === 'true' ||
          style.display === 'none' || style.visibility === 'hidden') {
        setPlacements([]);
        return;
      }
      ancestor = ancestor.parentElement;
    }
    setPlacements((current) => gains.flatMap((gain) => {
      const existing = current.find((placement) => placement.gain.id === gain.id);
      if (existing) return [existing];
      const card = handRef.current?.querySelector(`[data-testid="resource-${gain.resource}"]`);
      if (!card) return [];
      const rect = card.getBoundingClientRect();
      return [{
        gain,
        x: Math.max(42, Math.min(window.innerWidth - 42, rect.left + rect.width / 2)),
        y: Math.min(window.innerHeight - 22, rect.top + rect.height * .42),
      }];
    }));
  }, [gains, handRef]);

  if (!gains.length || !placements.length) return null;
  return createPortal(
    <div className="hand-gains" aria-hidden="true" data-testid="hand-gains">
      {placements.filter(({ gain }) => gains.includes(gain)).map(({ gain, x, y }) => (
        <div key={gain.id} className={`hand-gain hand-gain--${gain.resource}`} data-resource={gain.resource}
          style={{ '--gain-x': `${x}px`, '--gain-y': `${y}px`, '--gain-delay': `${gain.delayMs}ms` } as CSSProperties}>
          <ResourceCardArt resource={gain.resource} />
        </div>
      ))}
    </div>, document.fullscreenElement ?? document.body,
  );
}
