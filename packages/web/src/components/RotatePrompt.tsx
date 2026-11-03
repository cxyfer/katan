import { useEffect, useRef, useState } from 'react';
import { useT } from '../i18n/context.tsx';
import { useIsMobile } from './useIsMobile.ts';
import '../styles/rotate-prompt.css';

const DISMISSED_KEY = 'catan.rotatePromptDismissed';

/**
 * 已安裝（standalone）的觸控裝置以直向開啟牌桌時，提示使用者橫放。
 * iOS 無法鎖定方向，Android 大螢幕或多視窗也可能忽略 manifest 的 orientation；
 * 直向版面仍可遊玩，因此可選擇以直向繼續，本次瀏覽期間不再顯示。
 */
export function RotatePrompt() {
  const installed = useIsMobile('(display-mode: standalone), (display-mode: fullscreen)') || iosStandalone();
  const portrait = useIsMobile('(orientation: portrait) and (max-width: 649px) and (pointer: coarse)');
  const [dismissed, setDismissed] = useState(readDismissed);

  if (!installed || !portrait || dismissed) return null;

  const dismiss = () => {
    setDismissed(true);
    try {
      sessionStorage.setItem(DISMISSED_KEY, '1');
    } catch {
      // 無法寫入時只在這次掛載期間隱藏
    }
  };

  return <RotateDialog onDismiss={dismiss} />;
}

/** 只在對話框顯示期間掛載，卸載（按鈕關閉或轉向）時把焦點還給顯示前的元素。 */
function RotateDialog({ onDismiss }: { onDismiss: () => void }) {
  const t = useT();
  // autoFocus 在 commit 階段就會搶走焦點，早於 effect，所以在 render 階段記錄顯示前的焦點元素
  const previous = useRef<HTMLElement | null>(null);
  if (previous.current === null) previous.current = document.activeElement as HTMLElement | null;

  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const target = previous.current;
    const node = root.current;
    return () => {
      // StrictMode 開發模式會模擬卸載；此時對話框仍在 DOM 內，不應搶回焦點
      if (!node?.isConnected && target?.isConnected) target.focus();
    };
  }, []);

  return (
    <div ref={root} className="rotate-prompt" role="dialog" aria-modal="true" aria-labelledby="rotate-prompt-title" aria-describedby="rotate-prompt-body" data-testid="rotate-prompt">
      <div className="rotate-prompt__card">
        <svg className="rotate-prompt__device" width="72" height="72" viewBox="0 0 72 72" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
          <g className="rotate-prompt__phone">
            <rect x="25" y="14" width="22" height="40" rx="4" />
            <path d="M33 48h6" />
          </g>
          <path className="rotate-prompt__arrow" d="M58 26a24 24 0 0 0-14-12m0 0 2 6m-2-6 6-2" />
        </svg>
        <h2 id="rotate-prompt-title">{t('table.rotatePrompt.title')}</h2>
        <p id="rotate-prompt-body">{t('table.rotatePrompt.body')}</p>
        <button type="button" className="button button--ghost" data-testid="rotate-prompt-continue" autoFocus onClick={onDismiss}>
          {t('table.rotatePrompt.continue')}
        </button>
      </div>
    </div>
  );
}

/** iOS 16.4 以前不支援 display-mode 媒體查詢，改看 navigator.standalone。 */
function iosStandalone(): boolean {
  return (globalThis.navigator as Navigator & { standalone?: boolean } | undefined)?.standalone === true;
}

function readDismissed(): boolean {
  try {
    return sessionStorage.getItem(DISMISSED_KEY) === '1';
  } catch {
    return false;
  }
}
