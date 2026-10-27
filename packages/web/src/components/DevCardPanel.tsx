import { useState } from 'react';
import { RESOURCES, type Resource } from '@catan/rules';
import { useT } from '../i18n/context.tsx';
import type { TableController } from '../state/useTable.ts';

const PLAYABLE = new Set(['knight', 'roadBuilding', 'yearOfPlenty', 'monopoly']);

/**
 * Development-card panel. A card bought this turn is shown separately and is
 * not playable (docs/SPEC.md §4.4); the server still enforces this, the UI just
 * refuses to offer a move that cannot succeed.
 */
export function DevCardPanel({ controller, embedded = false }: { controller: TableController; embedded?: boolean }) {
  const t = useT();
  const { state, actions } = controller;
  const [monopolyResource, setMonopolyResource] = useState<Resource>('lumber');
  const selfId = state.session?.id ?? null;
  const view = state.game?.view ?? null;
  const self = view?.players.find((player) => player.id === selfId) ?? null;
  const isTurn = !!view && view.turn.playerId === selfId;
  const playable = isTurn && !view?.turn.devCardPlayed && view?.pending === null;
  const held = self?.devCards ?? [];
  const fresh = self?.newDevCards ?? [];

  const play = (card: string) => {
    if (card === 'knight') {
      actions.selectTarget({
        kind: 'hex',
        index: null,
        commandType: 'dev.playKnight',
        labelId: 'devCard.knight',
      });
      return;
    }
    if (card === 'monopoly') {
      void actions.submitCommand(
        { type: 'dev.playMonopoly', resource: monopolyResource },
        'devCard.monopoly',
      );
      return;
    }
    void actions.submitCommand({ type: `dev.play${card[0]!.toUpperCase()}${card.slice(1)}` }, `devCard.${card}`);
  };

  return (
    <section className={embedded ? 'devcards devcards--hand' : 'panel devcards'} aria-labelledby="devcards-heading" data-testid="devcards-panel">
      <h2 id="devcards-heading">{t('play.devCards')}</h2>
      {held.length === 0 && fresh.length === 0 && <p className="muted">{t('play.devCardsEmpty')}</p>}
      {held.length > 0 && (
        <ul className="card-list">
          {held.map((card, index) => (
            <li key={`${card}-${index}`} className="card-list__row">
              <span>{t(`devCard.${card}`)}</span>
              {PLAYABLE.has(card) && (
                <button
                  type="button"
                  className="button"
                  data-testid={`play-${card}-${index}`}
                  disabled={!playable}
                  onClick={() => play(card)}
                >
                  {t('play.playCard', { card: t(`devCard.${card}`) })}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {held.includes('monopoly') && (
        <div className="field field--inline">
          <label htmlFor="monopoly-resource">{t('devCard.monopoly')}</label>
          <select
            id="monopoly-resource"
            data-testid="monopoly-resource"
            value={monopolyResource}
            onChange={(event) => setMonopolyResource(event.target.value as Resource)}
          >
            {RESOURCES.map((resource) => (
              <option key={resource} value={resource}>
                {t(`resource.${resource}`)}
              </option>
            ))}
          </select>
        </div>
      )}
      {fresh.length > 0 && (
        <>
          <h3>{t('play.newDevCards')}</h3>
          <ul className="card-list" data-testid="new-devcards">
            {fresh.map((card, index) => (
              <li key={`new-${card}-${index}`}>{t(`devCard.${card}`)}</li>
            ))}
          </ul>
        </>
      )}
      {state.command?.status === 'unknown' && (
        <p className="muted" data-testid="devcard-unknown">
          {t('command.retryUnavailable')}
        </p>
      )}
    </section>
  );
}
