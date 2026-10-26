import { useMemo } from 'react';
import { COSTS, getTopology } from '@catan/rules';
import { useLocale, useT } from '../i18n/context.tsx';
import { formatResourceMap } from '../i18n/format.ts';
import { describeTarget } from '../board/targets.ts';
import { nameOf } from '../state/table.ts';
import type { TableController } from '../state/useTable.ts';

const COST_BY_COMMAND: Record<string, Partial<Record<string, number>> | null> = {
  'build.road': COSTS.road,
  'build.settlement': COSTS.settlement,
  'build.city': COSTS.city,
  'setup.placeBuilding': null,
  'setup.placeRoad': null,
  'pending.moveRobber': null,
  'dev.playKnight': null,
};

/**
 * `browse → select → preview → submitting → confirmed/rejected` (docs/SPEC.md
 * §8.2). The preview names the target, the cost and the consequence, and can
 * always be cancelled before submission without spending anything.
 */
export function SelectionPreview({ controller }: { controller: TableController }) {
  const t = useT();
  const locale = useLocale();
  const { state, actions } = controller;
  const view = state.game?.view;
  const selection = state.selection;
  const nameResolver = useMemo(() => nameOf(state), [state]);

  if (!view || !selection.kind || selection.index === null) return null;
  const topology = getTopology(view.board.topologyId);
  const option = describeTarget(
    { locale, topology, board: view.board, nameOf: nameResolver },
    selection.kind,
    selection.index,
  );
  const cost = selection.commandType ? COST_BY_COMMAND[selection.commandType] ?? null : null;

  return (
    <section className="preview" aria-labelledby="preview-heading" data-testid="selection-preview">
      <h3 id="preview-heading">{t('play.selectionTitle')}</h3>
      <p data-testid="preview-target">
        {t('play.selectionTarget', { target: `${option.label} — ${option.detail}` })}
      </p>
      <p>{t('play.selectionCost', { cost: cost ? formatResourceMap(locale, cost) : t('app.none') })}</p>
      <p className="muted">
        {t('play.selectionConsequence', {
          consequence: t(selection.labelId ?? 'play.confirmPlacement'),
        })}
      </p>
      <div className="preview__actions">
        <button
          type="button"
          className="button button--primary"
          data-testid="confirm-selection"
          onClick={() => void actions.confirmSelection()}
        >
          {t('play.confirmPlacement')}
        </button>
        <button
          type="button"
          className="button button--ghost"
          data-testid="cancel-selection"
          onClick={() => actions.cancelSelection()}
        >
          {t('play.cancelSelection')}
        </button>
      </div>
    </section>
  );
}
