import { RESOURCES } from '@catan/rules';
import { useLocale, useT } from '../i18n/context.tsx';
import { formatNumber, formatResourceMap } from '../i18n/format.ts';
import { deriveActions } from '../state/actions.ts';
import { blocksNewCommands } from '../state/commands.ts';
import type { TableController } from '../state/useTable.ts';
import type { Selection } from '../state/table.ts';
import { GameIcon, ResourceIcon } from './GameArt.tsx';
import { isShipCommand } from '../board/seafarers.ts';

/**
 * Action bar. Every disabled control shows *why* it is disabled, using the
 * reason ids produced by `deriveActions` (docs/SPEC.md §8.2/§8.4).
 */
export function ActionBar({ controller }: { controller: TableController }) {
  const t = useT();
  const locale = useLocale();
  const { state, actions } = controller;
  const selfId = state.session?.id ?? null;
  const descriptors = deriveActions(state, selfId);
  const blocked = blocksNewCommands(state.command);

  const arm = (commandType: string | null, labelId: string) => {
    if (!commandType) return;
    const kind: Selection['kind'] = commandType.includes('road') || isShipCommand(commandType) ? 'edge' : 'vertex';
    actions.selectTarget({ kind, index: null, commandType, labelId: commandType === 'ship.pick' ? 'sf.move.pick' : labelId });
  };

  return (
    <section className="panel action-panel" aria-labelledby="actions-heading" data-testid="action-bar">
      <h2 id="actions-heading"><GameIcon name="home" size={17} />{t('table.build')}</h2>
      <ul className="action-list">
        {descriptors.map((action) => {
          const reason = action.reasonId ? t(action.reasonId) : null;
          const isArming =
            action.commandType !== null &&
            state.selection.commandType === action.commandType &&
            state.selection.index === null;
          return (
            <li key={action.id} data-action={action.id} className={action.commandType === 'turn.roll' || action.commandType === 'turn.end' ? 'action-list__turn' : undefined}>
              <button
                type="button"
                className={`button action-list__button${isArming ? ' action-list__button--armed' : ''}`}
                data-testid={`action-${action.id}`}
                data-enabled={action.enabled ? 'true' : 'false'}
                disabled={!action.enabled || blocked}
                aria-describedby={reason ? `reason-${action.id}` : undefined}
                onClick={() => {
                  if (action.commandType === 'turn.roll' || action.commandType === 'turn.end' || action.commandType === 'build.devCard') {
                    void actions.submitCommand({ type: action.commandType }, action.labelId);
                    return;
                  }
                  arm(action.commandType, action.labelId);
                }}
              >
                <span className="action-list__label"><GameIcon name={action.commandType === 'turn.roll' ? 'dice' : action.commandType === 'turn.end' ? 'flag' : action.id === 'build.devCard' ? 'cards' : action.id === 'build.road' ? 'trade' : action.id === 'build.city' ? 'crown' : action.id === 'build.ship' || action.id === 'ship.move' || action.id === 'ep.buildShip' ? 'ship' : action.id === 'ep.buildHarbor' ? 'anchor' : 'home'} size={18} />{t(action.labelId)}</span>
                {action.cost && (
                  <span className="action-list__cost" role="group" aria-label={t('play.cost', { cost: formatResourceMap(locale, action.cost) })}>
                    {RESOURCES.filter((resource) => (action.cost?.[resource] ?? 0) > 0).map((resource) => (
                      <span key={resource} className={`action-list__cost-chip action-list__cost-chip--${resource}`} aria-hidden="true">
                        <ResourceIcon resource={resource} size={22} />
                        <span>{formatNumber(locale, action.cost?.[resource] ?? 0)}</span>
                      </span>
                    ))}
                  </span>
                )}
              </button>
              {reason && (
                <p className="action-list__reason" id={`reason-${action.id}`} data-testid={`reason-${action.id}`}>
                  {reason}
                </p>
              )}
              {!reason && action.targetCount > 0 && (
                <p className="action-list__count">{t('play.legalTargets', { count: action.targetCount })}</p>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
