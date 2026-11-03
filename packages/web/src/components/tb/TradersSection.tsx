import { useT } from '../../i18n/context.tsx';
import { formatResourceMap } from '../../i18n/format.ts';
import { useLocale } from '../../i18n/context.tsx';
import { nameOf } from '../../state/table.ts';
import { blocksNewCommands } from '../../state/commands.ts';
import { followUpsHeld, shownTradersBarbarians } from '../../state/table.ts';
import type { TableController } from '../../state/useTable.ts';
import { BarbarianEmblem, CommodityEmblem, WagonEmblem } from './emblems.tsx';
import { tbHints, tbPart } from './model.ts';

export interface TradersView {
  sites: { id: string; hex: number; plaza: number; needs: string[] }[];
  xEdges: number[];
  barbarians: number[];
  stackCounts: Record<string, number>;
  wagons: Record<string, { vertex: number; level: number; cargo: string | null; delivered: number }>;
  levels: { mp: number; driveOff: number; value: number }[];
  upgradeCosts: Record<string, number>[];
  swift: string[];
}

interface TradersHints {
  steps: number[];
  driveOff: number[];
  moveBarbarian: boolean;
  canUpgrade: boolean;
  canPlayKnight: boolean;
  canPlaySwift: boolean;
}

/** Arms the board to pick a barbarian's new edge (7, Knight card or drive-off). */
function useBarbarianArm(controller: TableController) {
  return (commandType: string, from: number, labelId: string, fromField = 'from') => controller.actions.selectTarget({
    kind: 'edge', index: null, commandType, labelId, extra: { [fromField]: from }, field: 'to', targetsKey: `tb.barbarian:${from}`,
  });
}

/** Wagon board, commodity sites and the scenario's cards (TB25 pp. 20–23). */
export function TradersSection({ controller }: { controller: TableController }) {
  const t = useT();
  const locale = useLocale();
  const { state, actions } = controller;
  const view = shownTradersBarbarians(state) ?? state.game?.view;
  const traders = tbPart<TradersView>(view, 'tb-traders-barbarians');
  const hints = tbHints<TradersHints>(view, 'tb-traders-barbarians');
  const arm = useBarbarianArm(controller);
  if (!view || !traders) return null;
  const selfId = state.session?.id ?? '';
  const wagon = traders.wagons[selfId];
  const busy = blocksNewCommands(state.command) || followUpsHeld(state);
  const name = nameOf(state);
  const info = wagon ? traders.levels[wagon.level - 1]! : null;
  const cost = wagon ? traders.upgradeCosts[wagon.level - 1] : undefined;
  return (
    <section className="tb-section" data-testid="tb-traders" aria-labelledby="tb-traders-heading">
      <h3 id="tb-traders-heading"><WagonEmblem size={22} color="#c9a46a" />{t('tb.traders.title')}</h3>
      {wagon && info && (
        <>
          <p data-testid="tb-wagon-level">{t('tb.traders.wagon', { level: wagon.level, mp: info.mp, value: info.value })}</p>
          <p className="tb-token" data-testid="tb-wagon-cargo">
            {wagon.cargo ? <><CommodityEmblem size={20} commodity={wagon.cargo} />{t('tb.traders.cargo', { commodity: t(`tb.term.${wagon.cargo}`) })}</> : t('tb.traders.empty')}
          </p>
        </>
      )}
      <div className="tb-actions">
        {hints?.canUpgrade && cost && (
          <button type="button" className="button" disabled={busy} data-testid="tb-upgrade-wagon"
            onClick={() => void actions.submitCommand({ type: 'tb.upgradeWagon' }, 'tb.traders.upgrade')}>
            {t('tb.traders.upgrade', { cost: formatResourceMap(locale, cost) })}
          </button>
        )}
        {hints?.canPlaySwift && (
          <button type="button" className="button" disabled={busy} data-testid="tb-play-swift"
            onClick={() => void actions.submitCommand({ type: 'tb.playSwiftJourney' }, 'tb.traders.playSwift')}>{t('tb.traders.playSwift')}</button>
        )}
      </div>
      {hints?.canPlayKnight && (
        <div className="tb-actions" data-testid="tb-play-knight">
          <span>{t('tb.traders.playKnight')}</span>
          {traders.barbarians.map((edge) => (
            <button key={edge} type="button" className="button button--chip" disabled={busy} data-testid={`tb-knight-barbarian-${edge}`}
              onClick={() => arm('tb.playKnight', edge, 'tb.traders.playKnight')}>
              <BarbarianEmblem size={16} />{t('tb.traders.barbarian', { edge })}
            </button>
          ))}
        </div>
      )}
      <ul className="tb-list">
        {traders.sites.map((site) => (
          <li key={site.id}>{t('tb.traders.needs', {
            site: t(`tb.term.${site.id}`), needs: site.needs.map((need) => t(`tb.term.${need}`)).join('、'), count: traders.stackCounts[site.id] ?? 0,
          })}</li>
        ))}
        {view.players.map((player) => {
          const other = traders.wagons[player.id];
          return other ? <li key={player.id}>{t('tb.traders.delivered', { player: name(player.id), level: other.level, delivered: other.delivered })}
            {other.cargo && <CommodityEmblem size={16} commodity={other.cargo} />}</li> : null;
        })}
      </ul>
    </section>
  );
}

/** The 7: choose which barbarian moves (its destination is picked on the board). */
export function MoveBarbarianChoice({ controller }: { controller: TableController }) {
  const t = useT();
  const traders = tbPart<TradersView>(controller.state.game?.view, 'tb-traders-barbarians');
  const arm = useBarbarianArm(controller);
  return (
    <div className="tb-actions" data-testid="tb-move-barbarian">
      {(traders?.barbarians ?? []).map((edge) => (
        <button key={edge} type="button" className="button" data-testid={`tb-barbarian-${edge}`}
          onClick={() => arm('tb.moveBarbarian', edge, 'tb.traders.moveThis')}>
          <BarbarianEmblem size={16} />{t('tb.traders.barbarian', { edge })}
        </button>
      ))}
    </div>
  );
}

/** End-of-turn wagon move: steps are picked on the board; boost, drive off or stop here. */
export function WagonMoveChoice({ controller }: { controller: TableController }) {
  const t = useT();
  const { state, actions } = controller;
  const pending = state.game?.view.pending;
  const hints = tbHints<TradersHints>(state.game?.view, 'tb-traders-barbarians');
  const arm = useBarbarianArm(controller);
  const busy = blocksNewCommands(state.command) || followUpsHeld(state);
  const data = pending && 'data' in pending ? (pending.data as { mp?: number; boosted?: boolean }) : {};
  return (
    <div className="tb-actions" data-testid="tb-wagon-move">
      <span data-testid="tb-wagon-mp">{t('tb.traders.mp', { mp: data.mp ?? 0 })}</span>
      {!data.boosted && (
        <button type="button" className="button" disabled={busy} data-testid="tb-wagon-boost"
          onClick={() => void actions.submitCommand({ type: 'tb.wagonBoost' }, 'tb.traders.boost')}>{t('tb.traders.boost')}</button>
      )}
      {(hints?.driveOff ?? []).map((edge) => (
        <button key={edge} type="button" className="button button--ghost" disabled={busy} data-testid={`tb-drive-off-${edge}`}
          onClick={() => arm('tb.driveOff', edge, 'tb.traders.driveOff', 'barbarian')}>{t('tb.traders.driveOff')}</button>
      ))}
      <button type="button" className="button" disabled={busy} data-testid="tb-wagon-stop"
        onClick={() => void actions.submitCommand({ type: 'tb.wagonStop' }, 'tb.traders.stop')}>{t('tb.traders.stop')}</button>
    </div>
  );
}
