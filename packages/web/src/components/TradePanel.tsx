import { useState } from 'react';
import { RESOURCES, type Offer, type Resource } from '@catan/rules';
import { useLocale, useT } from '../i18n/context.tsx';
import { formatNumber, formatResourceMap } from '../i18n/format.ts';
import { Dialog } from './Dialog.tsx';
import type { TableController } from '../state/useTable.ts';
import '../styles/trade.css';

function emptyTerms(): Partial<Record<Resource, number>> {
  return {};
}

/**
 * Structured player offers (docs/SPEC.md §4.5).
 *
 * Offers are negotiation, not proof of inventory: nothing is reserved, the
 * displayed revision is the one consent binds to, and only a settle command
 * moves cards.
 */
export function TradePanel({ controller, embedded = false }: { controller: TableController; embedded?: boolean }) {
  const t = useT();
  const locale = useLocale();
  const { state, actions } = controller;
  const view = state.game?.view ?? null;
  const selfId = state.session?.id ?? null;
  const [give, setGive] = useState<Partial<Record<Resource, number>>>(emptyTerms());
  const [want, setWant] = useState<Partial<Record<Resource, number>>>(emptyTerms());
  const [to, setTo] = useState<string>('all');
  const [counterparty, setCounterparty] = useState<string>('');
  /**
   * Settlement is irreversible once the server commits it, so it goes through
   * an explicit confirmation dialog that names the exact terms
   * (docs/SPEC.md §8.2). The dialog returns focus to the settle button.
   */
  const [pendingSettle, setPendingSettle] = useState<
    { offerId: string; terms: string; counterparty: string } | null
  >(null);

  if (!view) return null;
  const offers = view.offers.filter((offer) => offer.status === 'open' || offer.status === 'agreed');
  const others = view.players.filter((player) => player.id !== selfId);
  const nameOf = (playerId: string) =>
    playerId === 'all' ? t('play.tradeToAll') : (view.players.find((p) => p.id === playerId)?.nickname ?? playerId);

  const bump = (
    setter: (value: Partial<Record<Resource, number>>) => void,
    terms: Partial<Record<Resource, number>>,
    resource: Resource,
    delta: number,
  ) => {
    const next = { ...terms };
    const value = (next[resource] ?? 0) + delta;
    if (value <= 0) delete next[resource];
    else next[resource] = value;
    setter(next);
  };

  return (
    <section className={`panel trade-panel${embedded ? ' trade-panel--embedded' : ''}`} aria-labelledby="trade-heading" data-testid="trade-panel">
      <h2 id="trade-heading" className={embedded ? 'visually-hidden' : undefined}>{t('play.trade')}</h2>

      <div className="trade-builder">
        <h3>{t('play.tradeNew')}</h3>
        <div className="field">
          <label htmlFor="offer-to">{t('play.tradeTo')}</label>
          <select
            id="offer-to"
            data-testid="offer-to"
            value={to}
            onChange={(event) => setTo(event.target.value)}
          >
            <option value="all">{t('play.tradeToAll')}</option>
            {others.map((player) => (
              <option key={player.id} value={player.id}>
                {player.nickname}
              </option>
            ))}
          </select>
        </div>
        <div className="trade-terms" data-testid="trade-terms">
          {(['give', 'want'] as const).map((side) => {
            const terms = side === 'give' ? give : want;
            const setter = side === 'give' ? setGive : setWant;
            return (
              <fieldset key={side} className="trade-terms__side" data-testid={`trade-terms-${side}`}>
                <legend>{t(side === 'give' ? 'play.tradeGive' : 'play.tradeWant')}</legend>
                <ul className="term-list">
                  {RESOURCES.map((resource) => (
                    <li key={resource} className="trade-term">
                      <span className="trade-term__resource">{t(`resource.${resource}`)}</span>
                      <div className="trade-term__controls">
                        <button
                          type="button"
                          className="button button--chip"
                          data-testid={`${side}-sub-${resource}`}
                          aria-label={`${t(side === 'give' ? 'play.tradeGive' : 'play.tradeWant')} ${t(`resource.${resource}`)} −`}
                          disabled={(terms[resource] ?? 0) === 0}
                          onClick={() => bump(setter, terms, resource, -1)}
                        >
                          −
                        </button>
                        <output data-testid={`${side}-${resource}`} aria-label={`${t(side === 'give' ? 'play.tradeGive' : 'play.tradeWant')} ${t(`resource.${resource}`)}`}>
                          {formatNumber(locale, terms[resource] ?? 0)}
                        </output>
                        <button
                          type="button"
                          className="button button--chip"
                          data-testid={`${side}-add-${resource}`}
                          aria-label={`${t(side === 'give' ? 'play.tradeGive' : 'play.tradeWant')} ${t(`resource.${resource}`)} +`}
                          onClick={() => bump(setter, terms, resource, 1)}
                        >
                          +
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              </fieldset>
            );
          })}
        </div>
        <button
          type="button"
          className="button button--primary"
          data-testid="create-offer"
          onClick={() =>
            void actions.submitCommand({ type: 'trade.offer', to, give, want }, 'play.tradeNew')
          }
        >
          {t('play.tradeCreate')}
        </button>
        <p className="muted">{t('play.tradeNoReservation')}</p>
      </div>

      <div className="offer-list" data-testid="offer-list">
        {offers.length === 0 && <p className="muted">{t('play.tradeNoOffers')}</p>}
        {offers.map((offer) => (
          <OfferRow
            key={offer.id}
            offer={offer}
            selfId={selfId}
            nameOf={nameOf}
            counterparty={counterparty}
            setCounterparty={setCounterparty}
            onSubmit={(command, labelId) => void actions.submitCommand(command, labelId)}
            onSettle={(offer) =>
              setPendingSettle({
                offerId: offer.id,
                terms: `${formatResourceMap(locale, offer.give)} → ${formatResourceMap(locale, offer.want)}`,
                counterparty,
              })
            }
          />
        ))}
      </div>

      {pendingSettle && (
        <Dialog
          title={t('play.tradeSettle')}
          testId="settle-dialog"
          onClose={() => setPendingSettle(null)}
        >
          <p data-testid="settle-dialog-terms">{pendingSettle.terms}</p>
          <p className="muted">{t('play.tradeExpiresAtWindowEnd')}</p>
          <div className="offer__actions">
            <button
              type="button"
              className="button button--primary"
              data-testid="confirm-settle"
              onClick={() => {
                const request = pendingSettle;
                setPendingSettle(null);
                void actions.submitCommand(
                  {
                    type: 'trade.settle',
                    offerId: request.offerId,
                    ...(request.counterparty ? { counterparty: request.counterparty } : {}),
                  },
                  'play.tradeSettle',
                );
              }}
            >
              {t('play.tradeSettle')}
            </button>
            <button
              type="button"
              className="button button--ghost"
              data-testid="cancel-settle"
              onClick={() => setPendingSettle(null)}
            >
              {t('app.cancel')}
            </button>
          </div>
        </Dialog>
      )}

    </section>
  );
}

function OfferRow({
  offer,
  selfId,
  nameOf,
  counterparty,
  setCounterparty,
  onSubmit,
  onSettle,
}: {
  offer: Offer;
  selfId: string | null;
  nameOf: (playerId: string) => string;
  counterparty: string;
  setCounterparty: (value: string) => void;
  onSubmit: (command: { type: string } & Record<string, unknown>, labelId: string) => void;
  onSettle: (offer: Offer) => void;
}) {
  const t = useT();
  const locale = useLocale();
  const isMine = offer.from === selfId;
  const isRecipient = offer.to === 'all' ? !isMine : offer.to === selfId;
  const consented = Object.entries(offer.responses)
    .filter(([, response]) => response === 'consented')
    .map(([playerId]) => playerId);
  const canSettle =
    isMine &&
    (offer.to === 'all' ? consented.length > 0 : offer.responses[offer.to] === 'consented');

  return (
    <article className="offer" data-testid={`offer-${offer.id}`}>
      <header>
        <strong>{t('play.tradeOfferFrom', { player: nameOf(offer.from) })}</strong>{' '}
        <span className="muted">
          {offer.to === 'all' ? t('play.tradeToAll') : t('play.tradeOfferTo', { player: nameOf(offer.to) })}
        </span>
      </header>
      <p>
        {t('play.tradeGive')}: {formatResourceMap(locale, offer.give)} · {t('play.tradeWant')}:{' '}
        {formatResourceMap(locale, offer.want)}
      </p>
      <p className="muted">
        {t(`play.tradeStatus.${offer.status}`)} · {t('play.tradeRevision', { revision: offer.revision })}
      </p>
      <ul className="response-list">
        {Object.entries(offer.responses).map(([playerId, response]) => (
          <li key={playerId}>
            {nameOf(playerId)}: {t(`play.tradeResponse.${response}`)}
          </li>
        ))}
      </ul>
      <div className="offer__actions">
        {isRecipient && offer.status === 'open' && (
          <>
            <button
              type="button"
              className="button"
              data-testid={`decline-${offer.id}`}
              onClick={() => onSubmit({ type: 'trade.respond', offerId: offer.id, response: 'declined' }, 'play.tradeDecline')}
            >
              {t('play.tradeDecline')}
            </button>
            <button
              type="button"
              className="button"
              data-testid={`interested-${offer.id}`}
              onClick={() => onSubmit({ type: 'trade.respond', offerId: offer.id, response: 'interested' }, 'play.tradeInterested')}
            >
              {t('play.tradeInterested')}
            </button>
            <button
              type="button"
              className="button button--primary"
              data-testid={`consent-${offer.id}`}
              onClick={() => onSubmit({ type: 'trade.respond', offerId: offer.id, response: 'consented' }, 'play.tradeConsent')}
            >
              {t('play.tradeConsent')}
            </button>
          </>
        )}
        {isMine && (
          <>
            <button
              type="button"
              className="button"
              data-testid={`revise-${offer.id}`}
              onClick={() =>
                onSubmit(
                  { type: 'trade.revise', offerId: offer.id, give: offer.want, want: offer.give },
                  'play.tradeRevise',
                )
              }
            >
              {t('play.tradeRevise')}
            </button>
            <button
              type="button"
              className="button"
              data-testid={`withdraw-${offer.id}`}
              onClick={() => onSubmit({ type: 'trade.withdraw', offerId: offer.id }, 'play.tradeWithdraw')}
            >
              {t('play.tradeWithdraw')}
            </button>
          </>
        )}
        {canSettle && (
          <>
            {offer.to === 'all' && (
              <label>
                {t('play.tradeTo')}
                <select
                  data-testid={`counterparty-${offer.id}`}
                  value={counterparty}
                  onChange={(event) => setCounterparty(event.target.value)}
                >
                  <option value="">—</option>
                  {consented.map((playerId) => (
                    <option key={playerId} value={playerId}>
                      {nameOf(playerId)}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <button
              type="button"
              className="button button--primary"
              data-testid={`settle-${offer.id}`}
              onClick={() => onSettle(offer)}
            >
              {t('play.tradeSettle')}
            </button>
          </>
        )}
      </div>
      <p className="muted">{t('play.tradeExpiresAtWindowEnd')}</p>
    </article>
  );
}
