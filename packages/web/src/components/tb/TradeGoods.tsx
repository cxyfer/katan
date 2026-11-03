import type { GameView, Offer } from '@catan/rules';
import { useT } from '../../i18n/context.tsx';
import { epView } from '../../board/explorersPirates.ts';
import { tbPart } from './model.ts';

/**
 * Non-resource goods in domestic offers (Traders & Barbarians gold). The
 * rules module decides which goods exist; the trade panel only adds a
 * stepper per good and shows them in offer terms.
 */

export type Goods = Record<string, number>;

/** Goods the current game lets players trade. */
export function tradeGoodsOf(view: GameView | null | undefined): string[] {
  return epView(view) || tbPart(view, 'tb-coins') ? ['gold'] : [];
}

export function goodsBalance(view: GameView | null | undefined, playerId: string | null, good: string): number | undefined {
  if (!playerId || good !== 'gold') return undefined;
  return epView(view)?.players[playerId]?.gold ?? tbPart<{ gold: Record<string, number> }>(view, 'tb-coins')?.gold[playerId];
}

export function goodsTotal(goods: Goods): number {
  return Object.values(goods).reduce((sum, amount) => sum + amount, 0);
}

/** The offer's goods from the viewer's side (recipients see them swapped). */
export function viewerGoods(offer: Pick<Offer, 'from' | 'to' | 'giveGoods' | 'wantGoods'>, selfId: string | null): { give?: Goods; want?: Goods } {
  if (selfId && offer.from !== selfId && (offer.to === 'all' || offer.to === selfId)) return { give: offer.wantGoods, want: offer.giveGoods };
  return { give: offer.giveGoods, want: offer.wantGoods };
}

export function GoodsStepper({ side, goods, available, value, onChange, prefix = 'tb' }: {
  side: 'give' | 'want';
  goods: readonly string[];
  /** Holdings for the give side (caps the stepper); undefined for want. */
  available: (good: string) => number | undefined;
  value: Goods;
  onChange: (next: Goods) => void;
  prefix?: 'ep' | 'tb';
}) {
  const t = useT();
  if (goods.length === 0) return null;
  return (
    <ul className="term-list tb-goods" data-testid={`${side}-goods`}>
      {goods.map((good) => {
        const goodNameKey = `${prefix}.trade.goodName.${good}`;
        const amount = value[good] ?? 0;
        const have = side === 'give' ? available(good) : undefined;
        const set = (next: number) => {
          const out = { ...value };
          if (next <= 0) delete out[good];
          else out[good] = next;
          onChange(out);
        };
        return (
          <li key={good} className="trade-term">
            <span className="trade-term__resource">
              {t(goodNameKey)}
              {have !== undefined && <span className="trade-term__owned">{t('play.tradeOwned', { count: have })}</span>}
            </span>
            <div className="trade-term__controls">
              <button type="button" className="button button--chip" data-testid={`${side}-sub-${good}`} disabled={amount === 0}
                aria-label={`${t(goodNameKey)} −`} onClick={() => set(amount - 1)}>−</button>
              <output data-testid={`${side}-${good}`}>{amount}</output>
              <button type="button" className="button button--chip" data-testid={`${side}-add-${good}`}
                disabled={have !== undefined && amount >= have}
                aria-label={`${t(goodNameKey)} +`} onClick={() => set(amount + 1)}>+</button>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
