import { useT } from '../../i18n/context.tsx';
import { playerColorHex } from '../../board/terrain.ts';
import { nameOf } from '../../state/table.ts';
import { blocksNewCommands } from '../../state/commands.ts';
import { followUpsHeld, shownTradersBarbarians } from '../../state/table.ts';
import type { TableController } from '../../state/useTable.ts';
import { BarbarianEmblem, CastleEmblem, KnightEmblem } from './emblems.tsx';
import { tbHints, tbPart } from './model.ts';

export interface BarbariansView {
  castle: number;
  castleEdges: number[];
  coastal: number[];
  barbarians: Record<string, number>;
  conquered: number[];
  conqueredBuildings: number[];
  supply: number;
  knights: { player: string; edge: number }[];
  knightsLeft: Record<string, number>;
  prisoners: Record<string, number>;
  deckCount: number;
  discard: string[];
}

interface BarbariansHints {
  canBuildCard: boolean;
  knightMoves: { from: number; targets: number[]; boosted: number[] }[];
  treasonMoves: [number, number][];
  stealVictims: string[];
}

/** Knights, prisoners, the coast and the scenario's development cards (TB25 pp. 15–18). */
export function BarbariansSection({ controller }: { controller: TableController }) {
  const t = useT();
  const { state, actions } = controller;
  const view = shownTradersBarbarians(state) ?? state.game?.view;
  const ba = tbPart<BarbariansView>(view, 'tb-barbarian-attack');
  const hints = tbHints<BarbariansHints>(view, 'tb-barbarian-attack');
  if (!view || !ba) return null;
  const busy = blocksNewCommands(state.command) || followUpsHeld(state);
  const onCoast = Object.values(ba.barbarians).reduce((sum, count) => sum + count, 0);
  return (
    <section className="tb-section" data-testid="tb-barbarians" aria-labelledby="tb-ba-heading">
      <h3 id="tb-ba-heading"><BarbarianEmblem size={22} />{t('tb.ba.title')}</h3>
      <p>{t('tb.ba.barbarians', { count: onCoast, supply: ba.supply })} · {t('tb.ba.conquered', { count: ba.conquered.length })}</p>
      {hints?.canBuildCard && (
        <div className="tb-actions">
          <button type="button" className="button" disabled={busy} data-testid="tb-ba-build"
            onClick={() => void actions.submitCommand({ type: 'tb.buildBaCard' }, 'tb.ba.build')}>
            <CastleEmblem size={18} />{t('tb.ba.build')}
          </button>
        </div>
      )}
      <p className="muted">{t('tb.ba.deck', { deck: ba.deckCount, discard: ba.discard.length })}</p>
      <ul className="tb-list">
        {view.players.map((player) => (
          <li key={player.id}><KnightEmblem size={16} color={playerColorHex(player.color)} />
            {t('tb.ba.knights', { player: player.nickname, count: ba.knightsLeft[player.id] ?? 0, prisoners: ba.prisoners[player.id] ?? 0 })}
          </li>
        ))}
      </ul>
    </section>
  );
}

/** End-of-turn knight moves: pick a knight, then its destination on the board. */
export function KnightMovesChoice({ controller }: { controller: TableController }) {
  const t = useT();
  const { state, actions } = controller;
  const hints = tbHints<BarbariansHints>(state.game?.view, 'tb-barbarian-attack');
  const busy = blocksNewCommands(state.command) || followUpsHeld(state);
  const arm = (from: number, boost: boolean) => actions.selectTarget({
    kind: 'edge', index: null, commandType: 'tb.moveKnight', labelId: boost ? 'tb.ba.moveFar' : 'tb.ba.move',
    extra: { from, boost }, field: 'to', targetsKey: `tb.moveKnight:${from}:${boost ? 1 : 0}`,
  });
  return (
    <div className="tb-actions" data-testid="tb-knight-moves">
      {(hints?.knightMoves ?? []).map((move) => (
        <span key={move.from} className="tb-token">
          {t('tb.ba.knightAt', { edge: move.from })}
          <button type="button" className="button button--chip" disabled={busy || move.targets.length === 0}
            data-testid={`tb-knight-move-${move.from}`} onClick={() => arm(move.from, false)}>{t('tb.ba.move')}</button>
          <button type="button" className="button button--chip" disabled={busy || move.boosted.length === 0}
            data-testid={`tb-knight-far-${move.from}`} onClick={() => arm(move.from, true)}>{t('tb.ba.moveFar')}</button>
        </span>
      ))}
      <button type="button" className="button" disabled={busy} data-testid="tb-knights-done"
        onClick={() => void actions.submitCommand({ type: 'tb.endKnights' }, 'tb.ba.endKnights')}>{t('tb.ba.endKnights')}</button>
    </div>
  );
}

/** Steal after a 7 without a robber. */
export function BaStealChoice({ controller }: { controller: TableController }) {
  const t = useT();
  const { state, actions } = controller;
  const hints = tbHints<BarbariansHints>(state.game?.view, 'tb-barbarian-attack');
  const name = nameOf(state);
  return (
    <div className="tb-actions" data-testid="tb-ba-steal">
      {(hints?.stealVictims ?? []).map((id) => (
        <button key={id} type="button" className="button" disabled={blocksNewCommands(state.command) || followUpsHeld(state)} data-testid={`tb-ba-steal-${id}`}
          onClick={() => void actions.submitCommand({ type: 'tb.baSteal', victim: id }, 'tb.ba.stealFrom')}>
          {t('tb.ba.stealFrom', { player: name(id) })}
        </button>
      ))}
    </div>
  );
}

/** Treason: one barbarian move at a time (source → destination). */
export function TreasonChoice({ controller }: { controller: TableController }) {
  const t = useT();
  const { state, actions } = controller;
  const view = shownTradersBarbarians(state) ?? state.game?.view;
  const hints = tbHints<BarbariansHints>(view, 'tb-barbarian-attack');
  const label = (hex: number) => hex < 0 ? t('tb.ba.fromSupply')
    : `${t(`terrain.${view?.board.terrain[hex] ?? 'sea'}`)} · ${t('tb.ba.hexLabel', { number: view?.board.numbers[hex] ?? '—' })}`;
  return (
    <div className="tb-actions" data-testid="tb-treason">
      {(hints?.treasonMoves ?? []).map(([from, to]) => (
        <button key={`${from}-${to}`} type="button" className="button button--ghost" disabled={blocksNewCommands(state.command) || followUpsHeld(state)}
          data-testid={`tb-treason-${from}-${to}`}
          onClick={() => void actions.submitCommand({ type: 'tb.baTreason', from, to }, 'tb.ba.treasonMove')}>
          {label(from)} → {label(to)}
        </button>
      ))}
    </div>
  );
}
