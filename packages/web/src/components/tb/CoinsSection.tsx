import { RESOURCES } from '@catan/rules';
import { useT } from '../../i18n/context.tsx';
import { blocksNewCommands } from '../../state/commands.ts';
import { followUpsHeld, shownBank, shownTradersBarbarians } from '../../state/table.ts';
import type { TableController } from '../../state/useTable.ts';
import { CoinEmblem } from './emblems.tsx';
import { tbHints, tbPart } from './model.ts';

export interface CoinsView {
  gold: Record<string, number>;
  supply: number;
  purchasesLeft: number;
  goldPerResource: number;
}

/** Gold holdings and the supply trades (TB25 p. 12). */
export function CoinsSection({ controller }: { controller: TableController }) {
  const t = useT();
  const { state, actions } = controller;
  const view = shownTradersBarbarians(state) ?? state.game?.view;
  const coins = tbPart<CoinsView>(view, 'tb-coins');
  const hints = tbHints<{ canTrade: boolean; sellRates: Record<string, number> }>(view, 'tb-coins');
  if (!view || !coins) return null;
  const selfId = state.session?.id ?? '';
  const self = view.players.find((player) => player.id === selfId);
  const mine = coins.gold[selfId] ?? 0;
  const busy = blocksNewCommands(state.command) || followUpsHeld(state);
  return (
    <section className="tb-section" data-testid="tb-coins" aria-labelledby="tb-coins-heading">
      <h3 id="tb-coins-heading"><CoinEmblem size={22} />{t('tb.coins.title')}</h3>
      {self && <p data-testid="tb-gold-mine"><strong>{t('tb.coins.mine', { gold: mine })}</strong></p>}
      {hints?.canTrade && (
        <>
          <p className="muted">{t('tb.coins.buyLeft', { count: coins.purchasesLeft })}</p>
          <div className="tb-actions" data-testid="tb-gold-buy">
            {RESOURCES.map((resource) => (
              <button key={resource} type="button" className="button" data-testid={`tb-buy-${resource}`}
                disabled={busy || mine < coins.goldPerResource || coins.purchasesLeft <= 0 || (shownBank(state)?.[resource] ?? 0) <= 0}
                onClick={() => void actions.submitCommand({ type: 'tb.buyResource', resource }, 'tb.coins.title')}>
                {t('tb.coins.buy', { resource: t(`resource.${resource}`), gold: coins.goldPerResource })}
              </button>
            ))}
          </div>
          <div className="tb-actions" data-testid="tb-gold-sell">
            {RESOURCES.map((resource) => {
              const rate = hints.sellRates[resource] ?? 4;
              return (
                <button key={resource} type="button" className="button button--ghost" data-testid={`tb-sell-${resource}`}
                  disabled={busy || (self?.resources?.[resource] ?? 0) < rate || coins.supply <= 0}
                  onClick={() => void actions.submitCommand({ type: 'tb.sellResources', resource }, 'tb.coins.title')}>
                  {t('tb.coins.sell', { resource: t(`resource.${resource}`), rate })}
                </button>
              );
            })}
          </div>
        </>
      )}
      <ul className="tb-list">
        {view.players.map((player) => <li key={player.id}>{t('tb.coins.player', { player: player.nickname, gold: coins.gold[player.id] ?? 0 })}</li>)}
      </ul>
      <p className="muted">{t('tb.coins.supply', { gold: coins.supply })}</p>
    </section>
  );
}
