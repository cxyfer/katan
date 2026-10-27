import { useState } from 'react';
import { RESOURCES, type Resource } from '@catan/rules';
import { useT } from '../i18n/context.tsx';
import type { TableController } from '../state/useTable.ts';
import { GameIcon } from './GameArt.tsx';

const PLAYABLE = new Set(['knight', 'roadBuilding', 'yearOfPlenty', 'monopoly']);
const CARD_ICONS: Record<string, string> = { knight: 'shield', roadBuilding: 'trade', yearOfPlenty: 'sparkles', monopoly: 'book', victoryPoint: 'crown' };

/** 新購卡與勝利點數卡只顯示狀態；伺服器仍是出牌規則的唯一權威。 */
export function DevCardPanel({ controller, embedded = false }: { controller: TableController; embedded?: boolean }) {
  const t = useT();
  const { state, actions } = controller;
  const [monopolyResource, setMonopolyResource] = useState<Resource>('lumber');
  const selfId = state.session?.id ?? null;
  const view = state.game?.view ?? null;
  const self = view?.players.find((player) => player.id === selfId) ?? null;
  const playable = !!view && view.turn.playerId === selfId && !view.turn.devCardPlayed && view.pending === null;
  const held = self?.devCards ?? [];
  const fresh = self?.newDevCards ?? [];

  const play = (card: string) => {
    if (card === 'knight') {
      actions.selectTarget({ kind: 'hex', index: null, commandType: 'dev.playKnight', labelId: 'devCard.knight' });
      return;
    }
    if (card === 'monopoly') {
      void actions.submitCommand({ type: 'dev.playMonopoly', resource: monopolyResource }, 'devCard.monopoly');
      return;
    }
    void actions.submitCommand({ type: `dev.play${card[0]!.toUpperCase()}${card.slice(1)}` }, `devCard.${card}`);
  };

  const cardView = (card: string, index: number, isNew: boolean) => (
    <li key={`${card}-${index}`} className={`development-card development-card--${card}${isNew ? ' development-card--new' : ''}`}>
      <span className="development-card__art"><GameIcon name={CARD_ICONS[card] ?? 'book'} size={44} /></span>
      <strong className="development-card__name">{t(`devCard.${card}`)}</strong>
      <span className="development-card__state">{isNew ? t('play.newDevCards') : t('table.heldCards')}</span>
      {!isNew && PLAYABLE.has(card) && <button type="button" className="button development-card__play"
        data-testid={`play-${card}-${index}`} disabled={!playable} onClick={() => play(card)}>
        {t('play.playCard', { card: t(`devCard.${card}`) })}
      </button>}
    </li>
  );

  return (
    <section className={embedded ? 'devcards devcards--hand' : 'panel devcards'} aria-labelledby="devcards-heading" data-testid="devcards-panel">
      <h2 id="devcards-heading">{t('play.devCards')}</h2>
      {held.length === 0 && fresh.length === 0 && <p className="muted">{t('play.devCardsEmpty')}</p>}
      <div className="development-lists" tabIndex={held.length + fresh.length > 0 ? 0 : undefined} aria-label={t('play.devCards')}>
        {held.length > 0 && <ul className="card-list">{held.map((card, index) => cardView(card, index, false))}</ul>}
        {fresh.length > 0 && <ul className="card-list" data-testid="new-devcards" aria-label={t('play.newDevCards')}>{fresh.map((card, index) => cardView(card, index, true))}</ul>}
      </div>
      {held.includes('monopoly') && <div className="field field--inline">
        <label htmlFor="monopoly-resource">{t('devCard.monopoly')}</label>
        <select id="monopoly-resource" data-testid="monopoly-resource" value={monopolyResource}
          onChange={(event) => setMonopolyResource(event.target.value as Resource)}>
          {RESOURCES.map((resource) => <option key={resource} value={resource}>{t(`resource.${resource}`)}</option>)}
        </select>
      </div>}
      {state.command?.status === 'unknown' && <p className="muted" data-testid="devcard-unknown">{t('command.retryUnavailable')}</p>}
    </section>
  );
}
