import type { ComponentType } from 'react';
import { getProfile } from '@catan/rules';
import { useT } from '../../i18n/context.tsx';
import type { TableController } from '../../state/useTable.ts';
import { CoinsSection } from './CoinsSection.tsx';
import { FishingSection } from './FishingSection.tsx';
import { RiversSection } from './RiversSection.tsx';
import { TrainsSection } from './TrainsSection.tsx';
import { HarborsSection } from './HarborsSection.tsx';
import { tbView } from './model.ts';
import '../../styles/traders-barbarians.css';

/** Sections per T&B part id, shown when the game's projection has that part. */
const SECTIONS: readonly [string, ComponentType<{ controller: TableController }>][] = [
  ['tb-fishing', FishingSection],
  ['tb-rivers', RiversSection],
  ['tb-merchant-trains', TrainsSection],
  ['tb-coins', CoinsSection],
  ['harbors', HarborsSection],
];

/** Scenario/variant status and actions for Traders & Barbarians games. */
export function TbPanel({ controller }: { controller: TableController }) {
  const t = useT();
  const view = controller.state.game?.view;
  const slot = tbView(view);
  if (!view || !slot) return null;
  const sections = SECTIONS.filter(([part]) => part in slot);
  if (sections.length === 0) return null;
  return (
    <section className="panel tb-panel" aria-labelledby="tb-panel-heading" data-testid="tb-panel">
      <h2 id="tb-panel-heading">{t('expansion.tradersBarbarians')}</h2>
      {sections.map(([part, Section]) => <Section key={part} controller={controller} />)}
    </section>
  );
}

/** Rule summaries for the help panel: the scenario first, then its variants. */
export function TbHelp({ controller }: { controller: TableController }) {
  const t = useT();
  const view = controller.state.game?.view;
  const profile = view ? getProfile(view.profileId) : undefined;
  if (!view || !profile || !profile.expansions.includes('tradersBarbarians')) return null;
  const ids = [...(profile.scenario ? [profile.scenario] : []), ...profile.variants];
  return (
    <div className="tb-help" data-testid="tb-help">
      <h3>{t('expansion.tradersBarbarians')}</h3>
      {ids.map((id) => (
        <p key={id}><strong>{t(profile.scenario === id ? `scenario.${id}` : `variant.${id}`)}</strong> — {t(`tb.help.${id}`)}</p>
      ))}
    </div>
  );
}
