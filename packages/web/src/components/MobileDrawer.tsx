import { useT } from '../i18n/context.tsx';
import type { DrawerPanel } from '../state/table.ts';
import type { TableController } from '../state/useTable.ts';
import { ActionBar } from './ActionBar.tsx';
import { ChatPanel } from './ChatPanel.tsx';
import { DevCardPanel } from './DevCardPanel.tsx';
import { HandPanel } from './HandPanel.tsx';
import { HelpPanel } from './HelpPanel.tsx';
import { TradePanel } from './TradePanel.tsx';

const PANELS: readonly DrawerPanel[] = ['hand', 'trade', 'chat', 'help'];

/**
 * One secondary drawer at a time (docs/SPEC.md §8.1).
 *
 * The drawer is a complementary region, not a modal: it never covers the
 * required-action prompt, connectivity or the way back to the board, and its
 * panel content is rendered here *instead of* the desktop sidebars so the DOM
 * never contains two copies of a control.
 */
export function MobileDrawer({ controller }: { controller: TableController }) {
  const t = useT();
  const { state, actions } = controller;
  const drawer = state.drawer;

  return (
    <aside
      className="drawer"
      data-testid="mobile-drawer"
      data-open={drawer === 'none' ? 'false' : 'true'}
      aria-label={t('drawer.open', { panel: t('board.heading') })}
    >
      <div className="drawer__tabs" role="tablist" aria-label={t('board.heading')}>
        {PANELS.map((panel) => (
          <button
            key={panel}
            type="button"
            role="tab"
            aria-selected={drawer === panel}
            className={`button button--tab${drawer === panel ? ' button--tab--active' : ''}`}
            data-testid={`drawer-tab-${panel}`}
            onClick={() => actions.setDrawer(drawer === panel ? 'none' : panel)}
          >
            {t(`drawer.${panel}`)}
          </button>
        ))}
        <button
          type="button"
          className="button button--ghost"
          data-testid="drawer-close"
          onClick={() => actions.setDrawer('none')}
        >
          {t('drawer.close')}
        </button>
      </div>

      {drawer !== 'none' && (
        <div className="drawer__content" data-testid="drawer-content" data-panel={drawer}>
          {drawer === 'hand' && (
            <>
              <HandPanel controller={controller} />
              <DevCardPanel controller={controller} />
              <ActionBar controller={controller} />
            </>
          )}
          {drawer === 'trade' && <TradePanel controller={controller} />}
          {drawer === 'chat' && <ChatPanel controller={controller} />}
          {drawer === 'help' && <HelpPanel controller={controller} />}
        </div>
      )}
    </aside>
  );
}
