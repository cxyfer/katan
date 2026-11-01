import { useT } from '../../i18n/context.tsx';
import { nameOf } from '../../state/table.ts';
import { blocksNewCommands } from '../../state/commands.ts';
import type { TableController } from '../../state/useTable.ts';
import { BridgeEmblem, WealthEmblem } from './emblems.tsx';
import { tbHints, tbPart } from './model.ts';

export interface RiversView {
  bridgeSites: number[];
  paths: { hexes: number[]; sites: number[] }[];
  bridges: Record<string, number>;
  wealthiest: string | null;
  poor: string[];
}

/** Bridges and the wealth tiles (TB25 p. 12). */
export function RiversSection({ controller }: { controller: TableController }) {
  const t = useT();
  const { state, actions } = controller;
  const view = state.game?.view;
  const rivers = tbPart<RiversView>(view, 'tb-rivers');
  const hints = tbHints<{ targets: Record<string, number[]> }>(view, 'tb-rivers');
  if (!view || !rivers) return null;
  const name = nameOf(state);
  const selfId = state.session?.id ?? '';
  const sites = hints?.targets['tb.buildBridge'] ?? [];
  return (
    <section className="tb-section" data-testid="tb-rivers" aria-labelledby="tb-rivers-heading">
      <h3 id="tb-rivers-heading"><BridgeEmblem size={22} />{t('tb.rivers.title')}</h3>
      <p>{t('tb.rivers.bridges', { count: rivers.bridges[selfId] ?? 0 })}</p>
      <div className="tb-actions">
        <button type="button" className="button" data-testid="tb-build-bridge" disabled={blocksNewCommands(state.command) || sites.length === 0}
          onClick={() => actions.selectTarget({ kind: 'edge', index: null, commandType: 'tb.buildBridge', labelId: 'tb.rivers.build' })}>
          {t('tb.rivers.build')}
        </button>
      </div>
      <p className="tb-token" data-testid="tb-wealthiest"><WealthEmblem size={20} />
        {rivers.wealthiest ? t('tb.rivers.wealthiest', { player: name(rivers.wealthiest) }) : t('tb.rivers.wealthiestNone')}
      </p>
      <p className="tb-token" data-testid="tb-poor"><WealthEmblem size={20} poor />
        {t('tb.rivers.poor', { players: rivers.poor.map(name).join('、') })}
      </p>
    </section>
  );
}
