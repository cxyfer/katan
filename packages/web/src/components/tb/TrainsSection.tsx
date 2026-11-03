import { useState } from 'react';
import { useT } from '../../i18n/context.tsx';
import { blocksNewCommands } from '../../state/commands.ts';
import { followUpsHeld, shownTradersBarbarians } from '../../state/table.ts';
import type { TableController } from '../../state/useTable.ts';
import { WagonEmblem } from './emblems.tsx';
import { tbPart } from './model.ts';

export interface TrainsView {
  oasis: number;
  starts: { vertex: number; edge: number }[];
  wagons: { edge: number; train: number }[];
  heads: Record<string, number>;
  supply: number;
  collected: boolean;
  betweenWagons: number[];
  vote: { bids: Record<string, { wool: number; grain: number }>; assignments: Record<string, number>; active: string } | null;
}

/** Wagon supply, the turn's collected wagon and the open vote (TB25 pp. 13–14). */
export function TrainsSection({ controller }: { controller: TableController }) {
  const t = useT();
  const view = shownTradersBarbarians(controller.state) ?? controller.state.game?.view;
  const trains = tbPart<TrainsView>(view, 'tb-merchant-trains');
  if (!view || !trains) return null;
  const isActive = view.turn.playerId === controller.state.session?.id;
  return (
    <section className="tb-section" data-testid="tb-trains" aria-labelledby="tb-trains-heading">
      <h3 id="tb-trains-heading"><WagonEmblem size={22} />{t('tb.trains.title')}</h3>
      <p>{t('tb.trains.supply', { count: trains.supply })}</p>
      {trains.collected && isActive && <p className="notice" data-testid="tb-wagon-collected">{t('tb.trains.collected')}</p>}
      <p className="muted">{t('tb.trains.between')}</p>
      {trains.vote && (
        <ul className="tb-list" data-testid="tb-wagon-bids">
          {Object.entries(trains.vote.bids).map(([id, bid]) => (
            <li key={id}>{t('tb.trains.bids', { player: view.players.find((player) => player.id === id)?.nickname ?? id, votes: bid.wool + bid.grain })}</li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** The viewer's bid in the voting round, shown in the mandatory prompt. */
export function WagonBidChoice({ controller }: { controller: TableController }) {
  const t = useT();
  const { state, actions } = controller;
  const self = state.game?.view.players.find((player) => player.id === state.session?.id);
  const [wool, setWool] = useState(0);
  const [grain, setGrain] = useState(0);
  const pending = state.game?.view.pending;
  if (!self || !pending || !('responders' in pending) || pending.responders[0] !== self.id) return null;
  const busy = blocksNewCommands(state.command) || followUpsHeld(state);
  const stepper = (label: string, value: number, max: number, set: (next: number) => void, id: string) => (
    <span className="trade-term__controls" role="group" aria-label={label}>
      {label}
      <button type="button" className="button button--chip" disabled={value <= 0} data-testid={`tb-bid-${id}-sub`} onClick={() => set(value - 1)}>−</button>
      <output data-testid={`tb-bid-${id}`}>{value}</output>
      <button type="button" className="button button--chip" disabled={value >= max} data-testid={`tb-bid-${id}-add`} onClick={() => set(value + 1)}>+</button>
    </span>
  );
  return (
    <div className="tb-actions" data-testid="tb-wagon-bid">
      {stepper(t('resource.wool'), wool, self.resources?.wool ?? 0, setWool, 'wool')}
      {stepper(t('resource.grain'), grain, self.resources?.grain ?? 0, setGrain, 'grain')}
      <button type="button" className="button" disabled={busy || wool + grain === 0} data-testid="tb-bid-submit"
        onClick={() => void actions.submitCommand({ type: 'tb.bidWagon', wool, grain }, 'tb.trains.bid')}>
        {t('tb.trains.bidSubmit', { wool, grain })}
      </button>
      <button type="button" className="button button--ghost" disabled={busy} data-testid="tb-bid-pass"
        onClick={() => void actions.submitCommand({ type: 'tb.bidWagon', wool: 0, grain: 0 }, 'tb.trains.pass')}>
        {t('tb.trains.pass')}
      </button>
    </div>
  );
}
