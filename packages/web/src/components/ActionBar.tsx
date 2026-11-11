import { RESOURCES } from '@catan/rules';
import { useLocale, useT } from '../i18n/context.tsx';
import { formatNumber, formatResourceMap } from '../i18n/format.ts';
import { deriveActions, groupActions, sharedReason, type ActionDescriptor } from '../state/actions.ts';
import { blocksNewCommands } from '../state/commands.ts';
import type { TableController } from '../state/useTable.ts';
import type { Selection } from '../state/table.ts';
import { GameIcon, ResourceIcon } from './GameArt.tsx';
import { isShipCommand } from '../board/seafarers.ts';

/** 每個動作的主圖示與角標；同一類棋子（騎士、船）以角標區分動詞，收合時也認得出來。 */
const ACTION_ICONS: Record<string, { icon: string; badge?: string }> = {
  roll: { icon: 'dice' },
  endTurn: { icon: 'flag' },
  'build.road': { icon: 'road' },
  'build.settlement': { icon: 'home' },
  'build.city': { icon: 'city' },
  'build.devCard': { icon: 'cards' },
  'build.wall': { icon: 'wall' },
  'ep.buildHarbor': { icon: 'anchor' },
  'build.ship': { icon: 'ship', badge: 'plus' },
  'ep.buildShip': { icon: 'ship', badge: 'plus' },
  'ship.move': { icon: 'ship', badge: 'arrow-right' },
  'knight.recruit': { icon: 'shield', badge: 'plus' },
  'knight.activate': { icon: 'shield', badge: 'bolt' },
  'knight.promote': { icon: 'shield', badge: 'chevron-up' },
  'knight.move': { icon: 'shield', badge: 'arrow-right' },
  'knight.displace': { icon: 'shield', badge: 'close' },
  'knight.chaseRobber': { icon: 'shield', badge: 'robber' },
  'knight.chasePirate': { icon: 'shield', badge: 'ship' },
};

function ActionGlyph({ id }: { id: string }) {
  const glyph = ACTION_ICONS[id] ?? { icon: 'home' };
  return (
    <span className="action-list__glyph" aria-hidden="true">
      <GameIcon name={glyph.icon} size={18} />
      {glyph.badge && <span className="action-list__badge"><GameIcon name={glyph.badge} size={10} /></span>}
    </span>
  );
}

/**
 * Action bar. Every disabled control shows *why* it is disabled, using the
 * reason ids produced by `deriveActions` (docs/SPEC.md §8.2/§8.4). When every
 * action in the bar (or in one group) shares a reason, it is shown once above
 * them; each action still keeps its own reason for assistive tech.
 */
export function ActionBar({ controller }: { controller: TableController }) {
  const t = useT();
  const locale = useLocale();
  const { state, actions } = controller;
  const selfId = state.session?.id ?? null;
  const descriptors = deriveActions(state, selfId);
  const blocked = blocksNewCommands(state.command);
  const groups = groupActions(descriptors);
  const panelReason = sharedReason(descriptors);

  const arm = (commandType: string | null, labelId: string) => {
    if (!commandType) return;
    const kind: Selection['kind'] = commandType.includes('road') || isShipCommand(commandType) ? 'edge' : 'vertex';
    actions.selectTarget({ kind, index: null, commandType, labelId: commandType === 'ship.pick' ? 'sf.move.pick' : labelId });
  };

  const item = (action: ActionDescriptor, shared: boolean) => {
    const reason = action.reasonId ? t(action.reasonId) : null;
    const isTurn = action.commandType === 'turn.roll' || action.commandType === 'turn.end';
    const isArming =
      action.commandType !== null &&
      state.selection.commandType === action.commandType &&
      state.selection.index === null;
    return (
      <li key={action.id} data-action={action.id} data-enabled={action.enabled ? 'true' : 'false'}
        className={isTurn ? 'action-list__turn' : undefined}>
        <button
          type="button"
          className={`button action-list__button${isArming ? ' action-list__button--armed' : ''}`}
          data-testid={`action-${action.id}`}
          data-enabled={action.enabled ? 'true' : 'false'}
          disabled={!action.enabled || blocked}
          aria-describedby={reason ? `reason-${action.id}` : action.targetCount > 0 ? `count-${action.id}` : undefined}
          onClick={() => {
            if (isTurn || action.commandType === 'build.devCard') {
              void actions.submitCommand({ type: action.commandType! }, action.labelId);
              return;
            }
            arm(action.commandType, action.labelId);
          }}
        >
          <ActionGlyph id={action.id} />
          <span className="action-list__text">
            <span className="action-list__label">{t(action.labelId)}</span>
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
          </span>
        </button>
        {reason && (
          <p className={`action-list__reason${shared ? ' action-list__reason--shared' : ''}`} id={`reason-${action.id}`} data-testid={`reason-${action.id}`}>
            {reason}
          </p>
        )}
        {!reason && action.targetCount > 0 && (
          <p className="action-list__count" id={`count-${action.id}`}>{t('play.legalTargets', { count: action.targetCount })}</p>
        )}
      </li>
    );
  };

  return (
    <section className="panel action-panel" aria-labelledby="actions-heading" data-testid="action-bar">
      <h2 id="actions-heading"><GameIcon name="home" size={17} />{t('table.actions')}</h2>
      {panelReason && <p className="action-panel__reason" data-testid="action-shared-reason">{t(panelReason)}</p>}
      <div className="action-groups">
        {groups.map((group) => {
          // 回合動作是單一主按鈕，原因直接寫在按鈕下方。
          const groupReason = panelReason || group.id === 'turn' ? null : group.sharedReasonId;
          return (
            <section key={group.id} className="action-group" data-group={group.id} aria-labelledby={`action-group-${group.id}`}>
              <h3 className="action-group__title" id={`action-group-${group.id}`}>{t(`table.actions.group.${group.id}`)}</h3>
              {groupReason && <p className="action-group__reason">{t(groupReason)}</p>}
              <ul className="action-list">
                {group.actions.map((action) => item(action, !!(panelReason || groupReason)))}
              </ul>
            </section>
          );
        })}
      </div>
    </section>
  );
}
