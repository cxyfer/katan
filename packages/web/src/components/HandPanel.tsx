import { RESOURCES } from '@catan/rules';
import { useT } from '../i18n/context.tsx';
import { formatNumber } from '../i18n/format.ts';
import { RESOURCE_GLYPH } from '../board/terrain.ts';
import type { TableController } from '../state/useTable.ts';

/** Own hand: exact resource identities are only ever sent to their holder. */
export function HandPanel({ controller }: { controller: TableController }) {
  const t = useT();
  const { state } = controller;
  const selfId = state.session?.id ?? null;
  const self = state.game?.view.players.find((player) => player.id === selfId) ?? null;
  const resources = self?.resources;

  return (
    <section className="panel" aria-labelledby="hand-heading" data-testid="hand-panel">
      <h2 id="hand-heading">{t('play.hand')}</h2>
      {!resources || self?.handSize === 0 ? (
        <p className="muted">{t('play.handEmpty')}</p>
      ) : (
        <ul className="resource-list">
          {RESOURCES.map((resource) => (
            <li key={resource} data-testid={`resource-${resource}`}>
              <span className="resource-list__glyph" aria-hidden="true">
                {RESOURCE_GLYPH[resource]}
              </span>
              <span className="resource-list__label">{t(`resource.${resource}`)}</span>
              <span className="resource-list__count">
                {formatNumber(state.locale, resources[resource] ?? 0)}
              </span>
            </li>
          ))}
        </ul>
      )}
      <p className="muted">
        {t('play.handSize')}: {formatNumber(state.locale, self?.handSize ?? 0)} ·{' '}
        {t('play.ownScore')}: {formatNumber(state.locale, self?.ownScore ?? self?.publicScore ?? 0)}
      </p>
    </section>
  );
}
