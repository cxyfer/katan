import { useEffect, useRef, useState, type ReactNode } from 'react';
import { RESOURCES, type Offer, type Resource } from '@catan/rules';
import { useLocale, useT } from '../i18n/context.tsx';
import { formatNumber, formatResourceMap } from '../i18n/format.ts';
import { Dialog } from './Dialog.tsx';
import { shownHand } from '../state/table.ts';
import type { TableController } from '../state/useTable.ts';
import '../styles/trade.css';

type Terms = Partial<Record<Resource, number>>;

function emptyTerms(): Terms {
  return {};
}

const TRADE_HINT_MS = 4000;

/** 依目前手牌算出條件還缺多少；手牌不可見（例如旁觀）時不做本地檢查。 */
export function tradeShortfall(owned: Partial<Record<Resource, number>> | undefined, needed: Terms): Terms | null {
  if (!owned) return null;
  const missing: Terms = {};
  for (const resource of RESOURCES) {
    const gap = (needed[resource] ?? 0) - (owned[resource] ?? 0);
    if (gap > 0) missing[resource] = gap;
  }
  return Object.keys(missing).length > 0 ? missing : null;
}

/** 本地提示只說明為何沒有送出，伺服器仍是資源是否足夠的最終裁決者。 */
interface TradeHint {
  id: number;
  /** `builder` 或提案 id，決定提示出現在哪個區塊旁。 */
  scope: string;
  text: string;
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
  const [give, setGive] = useState<Terms>(emptyTerms());
  const [want, setWant] = useState<Terms>(emptyTerms());
  const [hint, setHint] = useState<TradeHint | null>(null);
  const hintRef = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (!hint) return;
    // 提示可能落在可捲動面板的下緣之外，出現時捲入可視範圍（只在新提示時捲動一次）。
    hintRef.current?.scrollIntoView?.({ block: 'nearest' });
    const timer = globalThis.setTimeout(() => setHint(null), TRADE_HINT_MS);
    return () => globalThis.clearTimeout(timer);
  }, [hint]);
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
  // 與手牌顯示一致：擲骰演出期間以擲骰前的數量檢查，不提前透露產出。
  const owned = shownHand(state);
  const showHint = (scope: string, text: string) => setHint((current) => ({ id: (current?.id ?? 0) + 1, scope, text }));
  const hintFor = (scope: string) => hint?.scope === scope
    ? <p key={hint.id} ref={hintRef} className="notice notice--warning trade-hint" role="alert" data-testid={`trade-hint-${scope}`}>{hint.text}</p>
    : null;
  const draftEmpty = Object.keys(give).length === 0 && Object.keys(want).length === 0;
  const offers = view.offers.filter((offer) => offer.status === 'open' || offer.status === 'agreed');
  const others = view.players.filter((player) => player.id !== selfId);
  const nameOf = (playerId: string) =>
    playerId === 'all' ? t('play.tradeToAll') : (view.players.find((p) => p.id === playerId)?.nickname ?? playerId);

  const bump = (
    setter: (value: Terms) => void,
    terms: Terms,
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
            const sideLabel = t(side === 'give' ? 'play.tradeGive' : 'play.tradeWant');
            return (
              <fieldset key={side} className="trade-terms__side" data-testid={`trade-terms-${side}`}>
                <legend>{t(side === 'give' ? 'play.tradeGive' : 'play.tradeWant')}</legend>
                <ul className="term-list">
                  {RESOURCES.map((resource) => {
                    const amount = terms[resource] ?? 0;
                    const have = side === 'give' ? owned?.[resource] : undefined;
                    // 付出不可超過手牌；按鈕保持可按，用提示說明原因而非無聲停用。
                    const capped = have !== undefined && amount >= have;
                    return (
                      <li key={resource} className="trade-term">
                        <span className="trade-term__resource">
                          {t(`resource.${resource}`)}
                          {have !== undefined && (
                            <span
                              className={`trade-term__owned${amount > have ? ' trade-term__owned--over' : ''}`}
                              data-testid={`give-owned-${resource}`}
                            >
                              {t('play.tradeOwned', { count: formatNumber(locale, have) })}
                            </span>
                          )}
                        </span>
                        <div className="trade-term__controls">
                          <button
                            type="button"
                            className="button button--chip"
                            data-testid={`${side}-sub-${resource}`}
                            aria-label={`${sideLabel} ${t(`resource.${resource}`)} −`}
                            disabled={amount === 0}
                            onClick={() => bump(setter, terms, resource, -1)}
                          >
                            −
                          </button>
                          <output data-testid={`${side}-${resource}`} aria-label={`${sideLabel} ${t(`resource.${resource}`)}`}>
                            {formatNumber(locale, amount)}
                          </output>
                          <button
                            type="button"
                            className="button button--chip"
                            data-testid={`${side}-add-${resource}`}
                            aria-label={`${sideLabel} ${t(`resource.${resource}`)} +`}
                            aria-disabled={capped || undefined}
                            onClick={() => {
                              if (capped) {
                                showHint('builder', t('play.tradeGiveLimit', {
                                  count: formatNumber(locale, have),
                                  resource: t(`resource.${resource}`),
                                }));
                                return;
                              }
                              bump(setter, terms, resource, 1);
                            }}
                          >
                            +
                          </button>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </fieldset>
            );
          })}
        </div>
        {hintFor('builder')}
        <div className="trade-builder__actions">
          <button
            type="button"
            className="button button--ghost"
            data-testid="clear-offer"
            // 用 aria-disabled 而非 disabled：清空後焦點留在按鈕上，不會掉回 body。
            aria-disabled={draftEmpty || undefined}
            onClick={() => {
              if (draftEmpty) return;
              setGive(emptyTerms());
              setWant(emptyTerms());
              if (hint?.scope === 'builder') setHint(null);
            }}
          >
            {t('play.tradeClear')}
          </button>
          <button
            type="button"
            className="button button--primary"
            data-testid="create-offer"
            onClick={() => {
              // 草稿後手牌可能已減少（建造、被搶），送出前再對照一次。
              const missing = tradeShortfall(owned, give);
              if (missing) {
                showHint('builder', t('play.tradeGiveShort', { missing: formatResourceMap(locale, missing) }));
                return;
              }
              void actions.submitCommand({ type: 'trade.offer', to, give, want }, 'play.tradeNew');
            }}
          >
            {t('play.tradeCreate')}
          </button>
        </div>
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
            consentShortfall={tradeShortfall(owned, offer.want)}
            hint={hintFor(offer.id)}
            onShortfall={(missing) =>
              showHint(offer.id, t('play.tradeConsentShort', { missing: formatResourceMap(locale, missing) }))
            }
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
  consentShortfall,
  hint,
  onShortfall,
  onSubmit,
  onSettle,
}: {
  offer: Offer;
  selfId: string | null;
  nameOf: (playerId: string) => string;
  counterparty: string;
  setCounterparty: (value: string) => void;
  /** 接受者需付出提案的 `want`；不足時為缺少的數量。 */
  consentShortfall: Terms | null;
  hint: ReactNode;
  onShortfall: (missing: Terms) => void;
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
              aria-disabled={consentShortfall ? true : undefined}
              onClick={() => {
                if (consentShortfall) {
                  onShortfall(consentShortfall);
                  return;
                }
                onSubmit({ type: 'trade.respond', offerId: offer.id, response: 'consented' }, 'play.tradeConsent');
              }}
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
      {hint}
      <p className="muted">{t('play.tradeExpiresAtWindowEnd')}</p>
    </article>
  );
}
