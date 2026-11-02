import { useEffect, useState, type CSSProperties } from 'react';
import { useT } from '../i18n/context.tsx';
import { activeBootStep, bootPercent, BOOT_STEPS, type BootProgress, type BootStepStatus } from '../state/boot.ts';
import { EMBLEM_TILES, emblemCell } from './GameArt.tsx';

/** 從開啟網頁起算，超過此時間仍未完成就提示較慢並提供重新整理。 */
export const BOOT_SLOW_MS = 8000;

type StepView = BootStepStatus | 'active';

/**
 * 啟動畫面：接續 `index.html` 的靜態啟動畫面（同一組 class，樣式內嵌於 index.html），
 * 顯示各啟動請求的狀態與加權進度；徽記的七格地形隨進度逐格點亮。
 */
export function BootScreen({ boot }: { boot: BootProgress }) {
  const t = useT();
  const percent = bootPercent(boot);
  const active = activeBootStep(boot);
  const lit = Math.floor((percent / 100) * EMBLEM_TILES.length);
  const [slow, setSlow] = useState(false);

  useEffect(() => {
    const elapsed = globalThis.performance?.now() ?? 0;
    const timer = setTimeout(() => setSlow(true), Math.max(0, BOOT_SLOW_MS - elapsed));
    return () => clearTimeout(timer);
  }, []);

  const current = active ? t(`boot.step.${active}`) : t('boot.status.done');
  return (
    <main className="boot" id="main" data-testid="boot-screen" aria-busy="true">
      <svg className="boot__emblem" viewBox="-50 -50 100 100" aria-hidden="true" focusable="false">
        <defs>
          <linearGradient id="boot-brass" x1="0" y1="-1" x2="0" y2="1">
            <stop offset="0" stopColor="#f6dca0" />
            <stop offset=".55" stopColor="#d4a356" />
            <stop offset="1" stopColor="#8f6630" />
          </linearGradient>
        </defs>
        <polygon points={emblemCell(47)} fill="url(#boot-brass)" />
        <polygon points={emblemCell(41)} fill="#0f3440" />
        <g transform="rotate(30)">
          {EMBLEM_TILES.map((tile, index) => (
            <polygon key={`${tile.x}:${tile.y}`} className="boot__tile" data-lit={index < lit ? '' : undefined}
              style={{ '--tile': tile.fill } as CSSProperties}
              points={emblemCell(9.4)} transform={`translate(${tile.x} ${tile.y}) rotate(-30)`} />
          ))}
        </g>
      </svg>
      <h1 className="boot__title">{t('boot.title')}</h1>
      <div className="boot__bar" role="progressbar" aria-label={t('boot.progress')} aria-valuemin={0} aria-valuemax={100}
        aria-valuenow={percent} aria-valuetext={`${percent}% · ${current}`} data-testid="boot-progress">
        <span className="boot__fill" style={{ width: `${percent}%` }} />
      </div>
      <p className="boot__meta">
        <span className="boot__percent">{percent}%</span>
        <span className="boot__current" aria-live="polite">{current}</span>
      </p>
      <ol className="boot__steps">
        {BOOT_STEPS.map((step) => {
          const view: StepView = step === active ? 'active' : boot[step];
          return (
            <li key={step} className="boot__step" data-status={view} data-testid={`boot-step-${step}`}>
              <span className="boot__mark" aria-hidden="true" />
              <span className="boot__label">{t(`boot.step.${step}`)}</span>
              <span className="boot__state">{t(`boot.status.${view}`)}</span>
            </li>
          );
        })}
      </ol>
      {slow && (
        <p className="boot__slow" role="status" data-testid="boot-slow">
          {t('boot.slow')}
          <button type="button" className="boot__reload" onClick={() => globalThis.location.reload()}>{t('app.refresh')}</button>
        </p>
      )}
    </main>
  );
}
