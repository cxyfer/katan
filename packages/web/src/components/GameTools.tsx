import { useCallback, useEffect, useRef, useState } from 'react';
import { useT } from '../i18n/context.tsx';
import { formatNumber } from '../i18n/format.ts';
import type { TableController } from '../state/useTable.ts';
import { ChatPanel } from './ChatPanel.tsx';
import { EventLog } from './EventLog.tsx';
import { ExchangePanel } from './ExchangePanel.tsx';
import { GameIcon } from './GameArt.tsx';
import { HelpPanel } from './HelpPanel.tsx';
import { TradePanel } from './TradePanel.tsx';

const TOOLS = [
  { id: 'trade', label: 'drawer.trade', icon: 'trade' },
  { id: 'exchange', label: 'drawer.exchange', icon: 'anchor' },
  { id: 'chat', label: 'drawer.chat', icon: 'chat' },
  { id: 'log', label: 'play.events', icon: 'scroll' },
  { id: 'help', label: 'drawer.help', icon: 'book' },
] as const;
type Tool = (typeof TOOLS)[number]['id'];

/** 次要面板保留掛載，開關與切換都不丟失交易表單等區域草稿。 */
export function GameTools({ controller }: { controller: TableController }) {
  const t = useT();
  const [tool, setTool] = useState<Tool | null>(null);
  const openerRef = useRef<HTMLButtonElement | null>(null);
  const { dispatch, state } = controller;
  const chatOpen = tool === 'chat';
  const active = TOOLS.find((item) => item.id === tool);
  const openOffers = state.game?.view.offers.filter((offer) => offer.status === 'open').length ?? 0;
  const close = useCallback(() => {
    setTool(null);
    openerRef.current?.focus();
  }, []);

  useEffect(() => {
    dispatch({ type: 'chat', event: { kind: chatOpen ? 'open' : 'close' } });
    return () => dispatch({ type: 'chat', event: { kind: 'close' } });
  }, [chatOpen, dispatch]);

  useEffect(() => {
    if (tool === null) return;
    const handleKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      if (event.target instanceof Element && event.target.closest('[role="dialog"], dialog')) return;
      event.preventDefault();
      close();
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [tool, close]);

  return (
    <section className="game-tools" aria-label={t('table.tools')} data-open={tool !== null ? 'true' : 'false'}>
      <nav className="game-tools__tabs" aria-label={t('table.tools')}>
        {TOOLS.map((item, index) => (
          <button
            key={item.id}
            id={`tool-${item.id}`}
            type="button"
            aria-label={t(item.label)}
            title={t(item.label)}
            aria-expanded={tool === item.id}
            aria-controls={`tool-panel-${item.id}`}
            data-testid={`tool-tab-${item.id}`}
            className={`game-tools__tab${tool === item.id ? ' game-tools__tab--active' : ''}`}
            onClick={(event) => {
              openerRef.current = event.currentTarget;
              if (tool === item.id) close();
              else setTool(item.id);
            }}
            onKeyDown={(event) => {
              let next = index;
              if (event.key === 'ArrowRight' || event.key === 'ArrowDown') next = (index + 1) % TOOLS.length;
              else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') next = (index + TOOLS.length - 1) % TOOLS.length;
              else if (event.key === 'Home') next = 0;
              else if (event.key === 'End') next = TOOLS.length - 1;
              else return;
              event.preventDefault();
              const target = TOOLS[next]!;
              event.currentTarget.parentElement?.querySelector<HTMLButtonElement>(`#tool-${target.id}`)?.focus();
            }}
          >
            <GameIcon name={item.icon} size={18} />
            <span>{t(item.label)}</span>
            {item.id === 'chat' && state.chat.unread > 0 && <span className="game-tools__unread">{formatNumber(state.locale, state.chat.unread)}</span>}
            {item.id === 'trade' && openOffers > 0 && <span className="game-tools__unread">{formatNumber(state.locale, openOffers)}</span>}
          </button>
        ))}
      </nav>
      <div className="game-tools__surface" hidden={tool === null} data-tool={tool ?? undefined}>
        <header className="game-tools__header">
          <h2 className="game-tools__title">{active ? t(active.label) : t('table.tools')}</h2>
          <button type="button" className="button button--ghost game-tools__close" aria-label={t('table.closePanel')} title={t('table.closePanel')} onClick={close} data-testid="tool-close">
            <GameIcon name="close" size={18} />
            <span>{t('table.closePanel')}</span>
          </button>
        </header>
        {TOOLS.map((item) => (
          <section key={item.id} id={`tool-panel-${item.id}`} aria-labelledby={`tool-${item.id}`} hidden={tool !== item.id} className="game-tools__panel" data-testid={`tool-panel-${item.id}`}>
            {item.id === 'trade' && <TradePanel controller={controller} embedded />}
            {item.id === 'exchange' && <ExchangePanel controller={controller} />}
            {item.id === 'chat' && <ChatPanel controller={controller} />}
            {item.id === 'log' && <EventLog controller={controller} />}
            {item.id === 'help' && <HelpPanel controller={controller} />}
          </section>
        ))}
      </div>
    </section>
  );
}
