import { useEffect, useState } from 'react';
import { useT } from '../i18n/context.tsx';
import type { TableController } from '../state/useTable.ts';
import { ChatPanel } from './ChatPanel.tsx';
import { EventLog } from './EventLog.tsx';
import { GameIcon } from './GameArt.tsx';
import { HelpPanel } from './HelpPanel.tsx';
import { TradePanel } from './TradePanel.tsx';

const TOOLS = [
  { id: 'trade', label: 'drawer.trade', icon: 'trade' },
  { id: 'chat', label: 'drawer.chat', icon: 'chat' },
  { id: 'log', label: 'play.events', icon: 'scroll' },
  { id: 'help', label: 'drawer.help', icon: 'book' },
] as const;
type Tool = (typeof TOOLS)[number]['id'];

/** 次要面板保留掛載，切換時不丟失交易表單等區域草稿。 */
export function GameTools({ controller }: { controller: TableController }) {
  const t = useT();
  const [tool, setTool] = useState<Tool>('trade');
  const { dispatch } = controller;
  useEffect(() => {
    dispatch({ type: 'chat', event: { kind: tool === 'chat' ? 'open' : 'close' } });
    return () => dispatch({ type: 'chat', event: { kind: 'close' } });
  }, [tool, dispatch]);

  return <section className="game-tools" aria-label={t('board.heading')}>
    <div className="game-tools__tabs" role="tablist" aria-label={t('board.heading')}>
      {TOOLS.map((item, index) => <button
        key={item.id}
        id={`tool-${item.id}`}
        type="button"
        role="tab"
        aria-selected={tool === item.id}
        aria-controls={`tool-panel-${item.id}`}
        tabIndex={tool === item.id ? 0 : -1}
        data-testid={`tool-tab-${item.id}`}
        className={`game-tools__tab${tool === item.id ? ' game-tools__tab--active' : ''}`}
        onClick={() => setTool(item.id)}
        onKeyDown={(event) => {
          let next = index;
          if (event.key === 'ArrowRight') next = (index + 1) % TOOLS.length;
          else if (event.key === 'ArrowLeft') next = (index + TOOLS.length - 1) % TOOLS.length;
          else if (event.key === 'Home') next = 0;
          else if (event.key === 'End') next = TOOLS.length - 1;
          else return;
          event.preventDefault();
          const target = TOOLS[next]!;
          setTool(target.id);
          event.currentTarget.parentElement?.querySelector<HTMLButtonElement>(`#tool-${target.id}`)?.focus();
        }}
      >
        <GameIcon name={item.icon} size={18} />
        <span>{t(item.label)}</span>
        {item.id === 'chat' && controller.state.chat.unread > 0 && <span className="game-tools__unread">{controller.state.chat.unread}</span>}
        {item.id === 'trade' && (controller.state.game?.view.offers.filter((offer) => offer.status === 'open').length ?? 0) > 0 && <span className="game-tools__unread">{controller.state.game!.view.offers.filter((offer) => offer.status === 'open').length}</span>}
      </button>)}
    </div>
    {TOOLS.map((item) => <div key={item.id} id={`tool-panel-${item.id}`} role="tabpanel" aria-labelledby={`tool-${item.id}`} tabIndex={0} hidden={tool !== item.id} className="game-tools__panel" data-testid={`tool-panel-${item.id}`}>
      {item.id === 'trade' && <TradePanel controller={controller} />}
      {item.id === 'chat' && <ChatPanel controller={controller} />}
      {item.id === 'log' && <EventLog controller={controller} />}
      {item.id === 'help' && <HelpPanel controller={controller} />}
    </div>)}
  </section>;
}
