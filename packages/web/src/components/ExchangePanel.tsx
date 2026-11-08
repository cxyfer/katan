import { useState } from 'react';
import { CARD_KINDS, RESOURCES, type CardKind } from '@catan/rules';
import { citiesKnightsHints, citiesKnightsView, isCommodityCard } from '../board/citiesKnights.ts';
import { useT } from '../i18n/context.tsx';
import { shownBank, shownCitiesKnights, tableHoldReason } from '../state/table.ts';
import type { TableController } from '../state/useTable.ts';
import '../styles/trade.css';

/** 銀行／港口兌換獨立於玩家提案，保留各自的未送出選擇。 */
export function ExchangePanel({ controller }: { controller: TableController }) {
  const t = useT();
  const { state, actions } = controller;
  const [give, setGive] = useState<CardKind>('lumber');
  const [receive, setReceive] = useState<CardKind>('brick');
  const view = state.game?.view;
  if (!view) return null;
  // Cities & Knights: commodities trade with the supply too (their rates come from the module hints).
  const ck = citiesKnightsHints(view);
  const kinds: readonly CardKind[] = ck ? CARD_KINDS : RESOURCES;
  const rateOf = (card: CardKind) => isCommodityCard(card) ? ck?.commodityRates[card] ?? 4 : view.hints?.bankRates?.[card] ?? 4;
  const rates = view.hints?.bankRates;
  const sameResource = give === receive;
  // 投影的存量只到上限（#137），但「0」仍是確切值：銀行沒有就不送出注定被拒的兌換。
  // 擲骰演出期間用擲骰前的存量，產出讓某堆歸零時不先透露點數。
  const bank = shownBank(state);
  const commodityBank = citiesKnightsView(shownCitiesKnights(state))?.commodityBank;
  const supplyOf = (card: CardKind) => (isCommodityCard(card) ? commodityBank?.[card] : bank?.[card]) ?? 0;
  const receiveEmpty = !sameResource && supplyOf(receive) <= 0;
  // 全桌暫停（§4.8）或房間尚未載入時不開放兌換。
  const holdReason = tableHoldReason(state);

  return (
    <section className="panel exchange-panel" aria-labelledby="exchange-heading" data-testid="exchange-panel">
      <h2 id="exchange-heading">{t('play.bankTrade')}</h2>
      <div className="exchange-terms">
        <div className="field">
          <label htmlFor="bank-give">{t('play.bankTradeGive')}</label>
          <select id="bank-give" data-testid="bank-give" value={give}
            onChange={(event) => setGive(event.target.value as CardKind)}>
            {kinds.map((resource) => (
              <option key={resource} value={resource}>
                {t(`resource.${resource}`)} ({rateOf(resource)}:1)
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="bank-receive">{t('play.bankTradeReceive')}</label>
          <select id="bank-receive" data-testid="bank-receive" value={receive}
            onChange={(event) => setReceive(event.target.value as CardKind)}>
            {kinds.map((resource) => (
              <option key={resource} value={resource}>{t(`resource.${resource}`)}</option>
            ))}
          </select>
        </div>
      </div>
      {rates && (
        <p className="muted" data-testid="bank-rate">
          {t('play.bankTradeRate', { resource: t(`resource.${give}`), rate: rateOf(give) })}
        </p>
      )}
      {sameResource && <p className="error" role="alert">{t('play.bankTradeSame')}</p>}
      {receiveEmpty && <p className="muted" id="bank-empty" data-testid="bank-empty">{t('bank.empty', { resource: t(`resource.${receive}`) })}</p>}
      {holdReason && <p className="muted" id="bank-hold" data-testid="bank-hold">{t(holdReason)}</p>}
      <button type="button" className="button button--primary" data-testid="bank-submit" disabled={sameResource || receiveEmpty || holdReason !== null}
        aria-describedby={[receiveEmpty && 'bank-empty', holdReason && 'bank-hold'].filter(Boolean).join(' ') || undefined}
        onClick={() => void actions.submitCommand({ type: 'trade.bank', give, receive }, 'play.bankTrade')}>
        {t('play.bankTradeSubmit')}
      </button>
    </section>
  );
}
