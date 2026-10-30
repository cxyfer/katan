import { useEffect, useState, type CSSProperties } from 'react';
import { RESOURCES, type Resource } from '@catan/rules';
import { useT } from '../i18n/context.tsx';
import { followUpsHeld } from '../state/table.ts';
import type { TableController } from '../state/useTable.ts';
import { GameIcon } from './GameArt.tsx';

const PLAYABLE = new Set(['knight', 'roadBuilding', 'yearOfPlenty', 'monopoly']);
const CARD_ICONS: Record<string, string> = { knight: 'shield', roadBuilding: 'trade', yearOfPlenty: 'sparkles', monopoly: 'book', victoryPoint: 'crown' };

/** 新購卡與勝利點數卡只顯示狀態；伺服器仍是出牌規則的唯一權威。 */
export function DevCardPanel({ controller, embedded = false, handStyle, handExpanded }: {
  controller: TableController; embedded?: boolean; handStyle?: (index: number) => CSSProperties; handExpanded?: boolean;
}) {
  const t = useT();
  const { state, actions } = controller;
  const [monopolyResource, setMonopolyResource] = useState<Resource>('lumber');
  const [inspected, setInspected] = useState<string | null>(null);
  useEffect(() => { if (handExpanded === false) setInspected(null); }, [handExpanded]);
  const selfId = state.session?.id ?? null;
  const view = state.game?.view ?? null;
  const self = view?.players.find((player) => player.id === selfId) ?? null;
  // 擲骰演出期間一律不可用，避免由是否待處理（七點）透露點數。
  const playable = !!view && !followUpsHeld(state) && view.turn.playerId === selfId && !view.turn.devCardPlayed && view.pending === null;
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
  const choice = (id: string, testId = 'monopoly-resource') => <select id={id} data-testid={testId} className="development-card__choice"
    aria-label={t('devCard.monopoly')} value={monopolyResource}
    onChange={(event) => setMonopolyResource(event.target.value as Resource)}>
    {RESOURCES.map((resource) => <option key={resource} value={resource}>{t(`resource.${resource}`)}</option>)}
  </select>;

  const cardView = (card: string, index: number, isNew: boolean) => {
    const id = `${isNew ? 'new' : 'held'}-${index}`;
    const face = <>
      <span className="development-card__art"><GameIcon name={CARD_ICONS[card] ?? 'book'} size={44} /></span>
      <strong className="development-card__name">{t(`devCard.${card}`)}</strong>
      <span className="development-card__state">{isNew ? t('play.newDevCards') : t('table.heldCards')}</span>
    </>;
    return <li onBlurCapture={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setInspected(null); }} key={`${card}-${index}`} style={handStyle?.(index + (isNew ? held.length : 0))}
      className={`development-card development-card--${card}${embedded ? ' hand-fan__card' : ''}${isNew ? ' development-card--new' : ''}${inspected === id ? ' development-card--inspected' : ''}`}>
      {embedded ? <button type="button" className="development-card__inspect" aria-pressed={inspected === id}
        aria-label={`${t('table.inspectCard', { card: t(`devCard.${card}`) })} · ${isNew ? t('play.newDevCards') : t('table.heldCards')}`}
        onClick={() => setInspected((current) => current === id ? null : id)}>{face}</button> : face}
      {embedded && !isNew && card === 'monopoly' && choice(`monopoly-resource-${index}`, index === held.indexOf('monopoly') ? 'monopoly-resource' : `monopoly-resource-${index}`)}
      {!isNew && PLAYABLE.has(card) && <button type="button" className="button development-card__play"
        data-testid={`play-${card}-${index}`} disabled={!playable} onClick={() => play(card)}>
        {t('play.playCard', { card: t(`devCard.${card}`) })}
      </button>}
    </li>;
  };

  return (
    <section className={embedded ? 'devcards devcards--hand' : 'panel devcards'} aria-labelledby="devcards-heading" data-testid="devcards-panel">
      <h2 id="devcards-heading" className={embedded ? 'visually-hidden' : undefined}>{t('play.devCards')}</h2>
      {held.length === 0 && fresh.length === 0 && <p className="muted">{t('play.devCardsEmpty')}</p>}
      <div className="development-lists" tabIndex={!embedded && held.length + fresh.length > 0 ? 0 : undefined}>
        {held.length > 0 && <ul className="card-list" aria-label={t('play.devCards')}>{held.map((card, index) => cardView(card, index, false))}</ul>}
        {fresh.length > 0 && <ul className="card-list" data-testid="new-devcards" aria-label={t('play.newDevCards')}>{fresh.map((card, index) => cardView(card, index, true))}</ul>}
      </div>
      {!embedded && held.includes('monopoly') && <div className="field field--inline">
        <label htmlFor="monopoly-resource">{t('devCard.monopoly')}</label>{choice('monopoly-resource')}
      </div>}
      {state.command?.status === 'unknown' && <p className="muted" data-testid="devcard-unknown">{t('command.retryUnavailable')}</p>}
    </section>
  );
}
