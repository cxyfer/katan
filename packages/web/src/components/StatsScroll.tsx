import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';

interface Edges {
  start: boolean;
  end: boolean;
}

/** 次像素捲動位置與瀏覽器縮放會留下約 1px 的誤差，不算被裁掉。 */
const EDGE_TOLERANCE_PX = 1;

/**
 * 賽後數據表格的水平捲動容器。欄位多於面板寬度時，在仍有內容被裁掉的那一側
 * 加上漸層與陰影，明示可以捲動；溢出時容器也可聚焦，讓鍵盤以方向鍵捲動。
 */
export function StatsScroll({ label, children }: { label: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState<Edges>({ start: false, end: false });

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const update = () => {
      const scrolled = Math.abs(element.scrollLeft);
      const start = scrolled > EDGE_TOLERANCE_PX;
      const end = element.scrollWidth - element.clientWidth - scrolled > EDGE_TOLERANCE_PX;
      setEdges((previous) => (previous.start === start && previous.end === end ? previous : { start, end }));
    };
    update();
    element.addEventListener('scroll', update, { passive: true });
    // 容器（視窗寬度）與表格（切換語系、字型載入）任一方尺寸改變都要重算。
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(update) : null;
    observer?.observe(element);
    if (element.firstElementChild) observer?.observe(element.firstElementChild);
    return () => {
      element.removeEventListener('scroll', update);
      observer?.disconnect();
    };
  }, []);

  const overflowing = edges.start || edges.end;
  return (
    <div
      className="game-stats__scroll-frame"
      data-overflow-start={edges.start || undefined}
      data-overflow-end={edges.end || undefined}
    >
      <div
        ref={ref}
        className="game-stats__scroll"
        role={overflowing ? 'region' : undefined}
        aria-label={overflowing ? label : undefined}
        tabIndex={overflowing ? 0 : undefined}
      >
        {children}
      </div>
    </div>
  );
}
