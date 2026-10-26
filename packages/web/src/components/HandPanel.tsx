import { RESOURCES } from '@catan/rules';
import { useT } from '../i18n/context.tsx';
import { formatNumber } from '../i18n/format.ts';
import { GameIcon, ResourceIcon } from './GameArt.tsx';
import type { TableController } from '../state/useTable.ts';

/** 手牌只呈現伺服器傳送給本人的資源，不推算其他玩家的內容。 */
export function HandPanel({ controller }: { controller: TableController }) {
  const t = useT();
  const { state } = controller;
  const selfId = state.session?.id ?? null;
  const self = state.game?.view.players.find((player) => player.id === selfId) ?? null;
  const resources = self?.resources;

  return (
    <section className="panel hand" aria-labelledby="hand-heading" data-testid="hand-panel">
      <h2 id="hand-heading"><GameIcon name="cards" size={18} />{t('play.hand')}<span className="badge">{formatNumber(state.locale, self?.handSize ?? 0)}</span></h2>
      {(!resources || self?.handSize === 0) && <p className="muted">{t('play.handEmpty')}</p>}
      {resources && (
        <ul className="resource-list">
          {RESOURCES.map((resource) => (
            <li key={resource} className={`resource-card resource-card--${resource}${!resources[resource] ? ' resource-card--empty' : ''}`} data-testid={`resource-${resource}`}>
              <span className="resource-card__art"><ResourceIcon resource={resource} size={76} /></span>
              <span className="resource-list__label">{t(`resource.${resource}`)}</span>
              <span className="resource-list__count">{formatNumber(state.locale, resources[resource] ?? 0)}</span>
            </li>
          ))}
        </ul>
      )}
      <p className="hand__summary muted">
        {t('play.handSize')}: {formatNumber(state.locale, self?.handSize ?? 0)} ·{' '}
        {t('play.ownScore')}: {formatNumber(state.locale, self?.ownScore ?? self?.publicScore ?? 0)}
      </p>
    </section>
  );
}
