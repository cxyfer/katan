import { useT } from '../../i18n/context.tsx';
import { nameOf } from '../../state/table.ts';
import type { TableController } from '../../state/useTable.ts';
import { tbPart, type HarborsView } from './model.ts';
import { StrongestPortsEmblem } from './emblems.tsx';

/** Strongest Ports status: holder and each player's VP on harbours. */
export function HarborsSection({ controller }: { controller: TableController }) {
  const t = useT();
  const view = controller.state.game?.view;
  const harbors = tbPart<HarborsView>(view, 'harbors');
  if (!view || !harbors) return null;
  const name = nameOf(controller.state);
  return (
    <section className="tb-section" data-testid="tb-harbors" aria-labelledby="tb-harbors-heading">
      <h3 id="tb-harbors-heading"><StrongestPortsEmblem size={22} />{t('tb.harbors.title')}</h3>
      <p data-testid="tb-harbors-holder">
        {harbors.holder ? t('tb.harbors.holder', { player: name(harbors.holder) }) : t('tb.harbors.none')}
      </p>
      <ul className="tb-list">
        {view.players.map((player) => (
          <li key={player.id}>{t('tb.harbors.points', { player: player.nickname, points: harbors.portPoints[player.id] ?? 0 })}</li>
        ))}
      </ul>
    </section>
  );
}
