import { useEffect } from 'react';
import { useT } from '../i18n/context.tsx';
import type { TableController } from '../state/useTable.ts';
import { ActionBar } from './ActionBar.tsx';
import { ChatPanel } from './ChatPanel.tsx';
import { EventLog } from './EventLog.tsx';
import { ExchangePanel } from './ExchangePanel.tsx';
import { GameIcon } from './GameArt.tsx';
import { HandPanel } from './HandPanel.tsx';
import { HelpPanel } from './HelpPanel.tsx';
import { TradePanel } from './TradePanel.tsx';

const PANELS = ['hand', 'trade', 'exchange', 'chat', 'help'] as const;
const ICONS = { hand: 'cards', trade: 'trade', exchange: 'anchor', chat: 'chat', help: 'book' };

/** 非模態抽屜只顯示一個面板；保留掛載以免切換時丟失表單草稿。 */
export function MobileDrawer({ controller }: { controller: TableController }) {
  const t = useT();
  const { state, actions, dispatch } = controller;
  const drawer = state.drawer;
  // 跨斷點返回手機時，保留的抽屜選擇必須重新同步聊天可見性。
  useEffect(() => {
    dispatch({ type: 'chat', event: { kind: drawer === 'chat' ? 'open' : 'close' } });
    return () => dispatch({ type: 'chat', event: { kind: 'close' } });
  }, [drawer, dispatch]);

  return (
    <aside className="drawer" data-testid="mobile-drawer" data-open={drawer === 'none' ? 'false' : 'true'} aria-label={t('drawer.open', { panel: t('board.heading') })}>
      <div className="drawer__bar">
        <div className="drawer__tabs" role="tablist" aria-label={t('board.heading')}>
          {PANELS.map((panel, index) => (
            <button key={panel} id={`drawer-tab-${panel}`} type="button" role="tab" aria-selected={drawer === panel} aria-controls={`drawer-panel-${panel}`}
              tabIndex={drawer === panel || (drawer === 'none' && index === 0) ? 0 : -1}
              className={`button button--tab${drawer === panel ? ' button--tab--active' : ''}`} data-testid={`drawer-tab-${panel}`}
              onClick={() => actions.setDrawer(drawer === panel ? 'none' : panel)}
              onKeyDown={(event) => {
                let next = index;
                if (event.key === 'ArrowRight') next = (index + 1) % PANELS.length;
                else if (event.key === 'ArrowLeft') next = (index + PANELS.length - 1) % PANELS.length;
                else if (event.key === 'Home') next = 0;
                else if (event.key === 'End') next = PANELS.length - 1;
                else return;
                event.preventDefault();
                const target = PANELS[next]!;
                actions.setDrawer(target);
                event.currentTarget.parentElement?.querySelector<HTMLButtonElement>(`#drawer-tab-${target}`)?.focus();
              }}
            >
              <GameIcon name={ICONS[panel]} size={18} />
              <span>{t(`drawer.${panel}`)}{panel === 'chat' && state.chat.unread > 0 && <span className="badge">{state.chat.unread}</span>}</span>
            </button>
          ))}
        </div>
        <button type="button" className="button button--ghost drawer__close" data-testid="drawer-close" aria-label={t('drawer.close')} title={t('drawer.close')} disabled={drawer === 'none'} onClick={() => {
          actions.setDrawer('none');
          document.getElementById(`drawer-tab-${drawer}`)?.focus();
        }}><GameIcon name="close" size={19} /></button>
      </div>
      <div className="drawer__content" data-testid="drawer-content" data-panel={drawer} hidden={drawer === 'none'}>
        {PANELS.map((panel) => <div key={panel} id={`drawer-panel-${panel}`} role="tabpanel" aria-labelledby={`drawer-tab-${panel}`} tabIndex={0} hidden={drawer !== panel}>
          {panel === 'hand' && <><HandPanel controller={controller} /><ActionBar controller={controller} /></>}
          {panel === 'trade' && <TradePanel controller={controller} />}
          {panel === 'exchange' && <ExchangePanel controller={controller} />}
          {panel === 'chat' && <ChatPanel controller={controller} />}
          {panel === 'help' && <><EventLog controller={controller} /><HelpPanel controller={controller} /></>}
        </div>)}
      </div>
    </aside>
  );
}
