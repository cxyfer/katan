import { useEffect, useState, type CSSProperties } from 'react';
import { RESOURCES, type Resource } from '@catan/rules';
import { useT } from '../i18n/context.tsx';
import { formatNumber } from '../i18n/format.ts';
import { GameIcon, ResourceIcon } from './GameArt.tsx';
import { ResourceCardArt } from './ResourceCardArt.tsx';
import { DevCardPanel } from './DevCardPanel.tsx';
import type { TableController } from '../state/useTable.ts';

/** 手牌只呈現伺服器傳送給本人的資源；檢視卡片不送出遊戲命令。 */
export function HandPanel({ controller }: { controller: TableController }) {
  const t = useT();
  const [inspected, setInspected] = useState<Resource | null>(null);
  const { state } = controller;
  const selfId = state.session?.id ?? null;
  const self = state.game?.view.players.find((player) => player.id === selfId) ?? null;
  const resources = self?.resources;
  const developmentCount = (self?.devCardCount ?? 0) + (self?.newDevCardCount ?? 0);
  const totalHandCards = (self?.handSize ?? 0) + developmentCount;

  useEffect(() => {
    if (inspected === null) return;
    const handleKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      if (event.target instanceof Element && event.target.closest('[role="dialog"], dialog')) return;
      setInspected(null);
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [inspected]);

  return (
    <section className="panel hand" aria-labelledby="hand-heading" data-testid="hand-panel">
      <h2 id="hand-heading"><GameIcon name="cards" size={18} />{t('play.hand')}<span className="badge">{formatNumber(state.locale, totalHandCards)}</span></h2>
      {totalHandCards === 0 && <p className="hand__empty muted">{t('play.handEmpty')}</p>}
      <p id="hand-hint" className="hand__hint muted">{t('table.handHint')}</p>
      <ul className="resource-list">
        {RESOURCES.map((resource, index) => {
          const count = resources?.[resource];
          const countLabel = count === undefined ? '—' : formatNumber(state.locale, count);
          const isInspected = inspected === resource;
          return (
            <li
              key={resource}
              className={`resource-card resource-card--${resource}${count === 0 ? ' resource-card--empty' : ''}${count === undefined ? ' resource-card--missing' : ''}${isInspected ? ' resource-card--inspected' : ''}`}
              style={{ '--card-index': index, '--card-angle': `${(index - 2) * 6}deg` } as CSSProperties}
              data-testid={`resource-${resource}`}
            >
              <button
                type="button"
                className="resource-card__inspect"
                aria-label={t('table.resourceCard', { resource: t(`resource.${resource}`), count: countLabel })}
                aria-pressed={isInspected}
                aria-describedby={`hand-hint resource-use-${resource}`}
                onClick={() => setInspected((current) => current === resource ? null : resource)}
              >
                <span className="resource-card__corner"><ResourceIcon resource={resource} size={25} /></span>
                <span className="resource-card__art"><ResourceCardArt resource={resource} /></span>
                <span className="resource-list__label">{t(`resource.${resource}`)}</span>
                <span className="resource-list__count">{countLabel}</span>
                <span id={`resource-use-${resource}`} className="resource-card__use">{t(`table.resourceUse.${resource}`)}</span>
              </button>
            </li>
          );
        })}
      </ul>
      <div className="hand__development">
         <DevCardPanel controller={controller} embedded />
       </div>
       <p className="hand__summary muted">
        {t('play.handSize')}: {formatNumber(state.locale, totalHandCards)} ·{' '}
        {t('play.ownScore')}: {formatNumber(state.locale, self?.ownScore ?? self?.publicScore ?? 0)}
      </p>
    </section>
  );
}
