import { COSTS, RESOURCES } from '@catan/rules';
import { useLocale, useT } from '../i18n/context.tsx';
import { formatResourceMap } from '../i18n/format.ts';
import { Legend } from './Legend.tsx';
import type { TableController } from '../state/useTable.ts';

/** In-game help: costs, legend and the profile summary (docs/SPEC.md §8.4). */
export function HelpPanel({ controller }: { controller: TableController }) {
  const t = useT();
  const locale = useLocale();
  const profileId = controller.state.game?.view.profileId ?? '';
  const paired = profileId.includes('paired');

  return (
    <section className="panel" aria-labelledby="help-heading" data-testid="help-panel">
      <h2 id="help-heading">{t('play.help')}</h2>
      <h3>{t('play.helpCosts')}</h3>
      <ul className="cost-list">
        {(['road', 'settlement', 'city', 'devCard'] as const).map((piece) => (
          <li key={piece}>
            {t(`play.build.${piece}`)}: {formatResourceMap(locale, COSTS[piece])}
          </li>
        ))}
      </ul>
      <h3>{t('lobby.rulesSummary')}</h3>
      <p>
        {t(`profile.${profileId}`)} · {t('play.resultTarget', { target: controller.state.game?.view.victoryTarget ?? 10 })}
      </p>
      {paired && <p className="muted">{t('lobby.pairedNote')}</p>}
      <h3>{t('play.helpLegend')}</h3>
      <Legend />
      <h3>{t('play.awards')}</h3>
      <p className="muted">{RESOURCES.map((resource) => t(`resource.${resource}`)).join('、')}</p>
      {controller.state.game?.view.turn.setup && (
        <p className="muted">
          {t('play.phase.setup')} · {t('play.pending.remaining', { remaining: controller.state.game.view.turn.setup.remaining })}
        </p>
      )}
    </section>
  );
}
