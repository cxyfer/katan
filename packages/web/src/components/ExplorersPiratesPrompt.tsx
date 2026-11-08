import { RESOURCES, type EpCargo, type Resource } from '@catan/rules';
import { useLocale, useT } from '../i18n/context.tsx';
import { formatNumber, formatResourceMap } from '../i18n/format.ts';
import {
  EP_CREW_COST,
  EP_FRAME,
  EP_SETTLER_COST,
  epHints,
  epView,
  shipNumber,
  type EpHints,
  type EpShipHints,
  type EpView,
} from '../board/explorersPirates.ts';
import { hexReference, vertexReference, viewReferenceContext, type ReferenceContext } from '../board/references.ts';
import { blocksNewCommands } from '../state/commands.ts';
import { followUpsHeld, nameOf as resolveName, shownHand } from '../state/table.ts';
import type { TableController } from '../state/useTable.ts';
import { ResourceIcon } from './GameArt.tsx';
import { CargoChip } from './SvgExplorersPirates.tsx';
import '../styles/explorers-pirates.css';

const SIZE: Record<EpCargo, number> = { settler: 2, fish: 2, crew: 1, spice: 1 };

function hasRoom(cargo: readonly EpCargo[], piece: EpCargo): boolean {
  return cargo.reduce((sum, entry) => sum + SIZE[entry], 0) + SIZE[piece] <= 2;
}

/** Pieces of a full holder whose removal makes room for `piece` (one piece goes, EP25 p. 10). */
function removableFor(cargo: readonly EpCargo[], piece: EpCargo): EpCargo[] {
  return [...new Set(cargo)].filter((candidate) => {
    const rest = cargo.slice();
    rest.splice(rest.indexOf(candidate), 1);
    return hasRoom(rest, piece);
  });
}

type Submit = (payload: { type: string; [field: string]: unknown }, labelId: string) => void;

/**
 * Explorers & Pirates parts of the turn prompt: the setup steps, the pirate's
 * victim, the Action phase's coin trades and piece building, and the
 * Movement phase's per-ship actions. Board targets (placements, ship steps,
 * the pirate's hex) arm themselves through `boardIntent`; everything here is
 * a plain button, so each choice is reachable in the SVG and the 3D board.
 */
export function ExplorersPiratesPrompt({ controller }: { controller: TableController }) {
  const t = useT();
  const locale = useLocale();
  const { state, actions } = controller;
  const view = state.game?.view ?? null;
  const ep = epHints(view);
  const slot = epView(view);
  const selfId = state.session?.id ?? null;
  if (!view || !ep || !slot || !selfId || followUpsHeld(state)) return null;
  const blocked = blocksNewCommands(state.command);
  const nameOf = resolveName(state);
  const submit: Submit = (payload, labelId) => void actions.submitCommand(payload, labelId);
  const arm = (kind: 'vertex' | 'edge' | 'hex', commandType: string, labelId: string, params?: Record<string, unknown>) =>
    actions.selectTarget({ kind, index: null, commandType, labelId, ...(params ? { params } : {}) });
  const armed = state.selection.commandType;
  const places = viewReferenceContext(locale, view);

  const pending = view.pending;
  if (pending?.kind === EP_FRAME) {
    if (ep.robCandidates.length === 0) return null;
    return (
      <div className="prompt__body ep-prompt" data-testid="ep-rob">
        <p className="muted">{t('ep.pirate.rob')}</p>
        <ul className="resource-picker ep-prompt__choices">
          {ep.robCandidates.map((id) => (
            <li key={id}><button type="button" className="button" data-testid={`ep-rob-${id}`} disabled={blocked}
              onClick={() => submit({ type: 'ep.robPlayer', victim: id }, 'ep.pirate.rob')}>{nameOf(id)}</button></li>
          ))}
        </ul>
      </div>
    );
  }
  if (pending) return null;

  if (ep.setup) {
    const route = ep.setup.step === 'route';
    return (
      <div className="prompt__body ep-prompt" data-testid="ep-setup" data-step={ep.setup.step}>
        <p className="muted">{t(`ep.setup.${ep.setup.step}Hint`)}</p>
        {route && ep.setup.ship.length > 0 && ep.setup.road.length > 0 && (
          armed === 'ep.setupRoad'
            ? <button type="button" className="button" data-testid="ep-setup-ship" onClick={() => actions.cancelSelection()}>{t('ep.setup.shipFirst')}</button>
            : <button type="button" className="button" data-testid="ep-setup-road" onClick={() => arm('edge', 'ep.setupRoad', 'ep.setup.road')}>{t('ep.setup.roadFirst')}</button>
        )}
      </div>
    );
  }

  if (!ep.phase) return null;
  return (
    <div className="prompt__body ep-prompt" data-testid="ep-turn" data-phase={ep.phase}>
      <p className="ep-prompt__phase" data-testid="ep-phase">
        <strong>{t(ep.phase === 'action' ? 'ep.phase.action' : 'ep.phase.movement')}</strong>
        <span>{t('ep.gold.count', { gold: slot.players[selfId]?.gold ?? 0 })}</span>
      </p>
      {ep.phase === 'action'
        ? <ActionPhase controller={controller} ep={ep} slot={slot} selfId={selfId} submit={submit} arm={arm} blocked={blocked} places={places} />
        : <MovementPhase controller={controller} ep={ep} slot={slot} selfId={selfId} submit={submit} arm={arm} blocked={blocked} places={places} />}
    </div>
  );
}

interface PhaseProps {
  controller: TableController;
  ep: EpHints;
  slot: EpView;
  selfId: string;
  submit: Submit;
  arm: (kind: 'vertex' | 'edge' | 'hex', commandType: string, labelId: string, params?: Record<string, unknown>) => void;
  blocked: boolean;
  /** 以資源與點數描述港口與海域，不顯示地圖編號。 */
  places: ReferenceContext;
}

function ActionPhase({ controller, ep, slot, selfId, submit, arm, blocked, places }: PhaseProps) {
  const t = useT();
  const locale = useLocale();
  const hand = shownHand(controller.state) ?? {};
  const have = (resource: Resource) => hand[resource] ?? 0;
  const gold = slot.players[selfId]?.gold ?? 0;
  const bank = controller.state.game?.view.bank;
  const ownShips = slot.ships.filter((ship) => ship.player === selfId);
  const holders: { key: string; label: string; cargo: EpCargo[]; field: Record<string, unknown> }[] = [
    ...ep.pieceHarbors.map((vertex) => ({
      key: `h${vertex}`, label: t('ep.holder.harbor', { place: vertexReference(places, vertex) }),
      cargo: slot.harbors.find((harbor) => harbor.vertex === vertex)?.cargo ?? [], field: { harbor: vertex },
    })),
    ...ep.pieceShips.map((id) => ({
      key: id, label: t('ep.holder.ship', { number: shipNumber(slot, id) }),
      cargo: ownShips.find((ship) => ship.id === id)?.cargo ?? [], field: { ship: id },
    })),
  ];
  const pieceRow = (piece: 'settler' | 'crew') => {
    const left = piece === 'settler' ? ep.settlersLeft : ep.crewsLeft;
    if (piece === 'crew' && !slot.pirates) return null;
    const cost = piece === 'settler' ? EP_SETTLER_COST : EP_CREW_COST;
    const affordable = RESOURCES.every((resource) => have(resource) >= (cost[resource] ?? 0));
    const anyRoom = holders.some((holder) => hasRoom(holder.cargo, piece));
    return (
      <section className="ep-prompt__group" data-testid={`ep-build-${piece}`}>
        <h3>{t(`ep.build.${piece}`)} <span className="muted">{formatResourceMap(locale, cost)} · {t('ep.left', { count: left })}</span></h3>
        {holders.length === 0 ? <p className="muted">{t('ep.holder.none')}</p> : (
          <ul className="ep-prompt__choices">
            {holders.map((holder) => {
              const room = hasRoom(holder.cargo, piece);
              const type = piece === 'settler' ? 'ep.buildSettler' : 'ep.buildCrew';
              const disabled = blocked || left <= 0 || !affordable;
              if (room || anyRoom) {
                return <li key={holder.key}>
                  <button type="button" className="button button--chip" data-testid={`ep-build-${piece}-${holder.key}`}
                    disabled={disabled || !room} onClick={() => submit({ type, ...holder.field }, `ep.build.${piece}`)}>
                    {holder.label}{holder.cargo.map((entry, index) => <CargoChip key={index} piece={entry} />)}
                  </button>
                </li>;
              }
              // Every holder is full: one button per piece that may go back to make room.
              const removable = removableFor(holder.cargo, piece);
              if (removable.length === 0) {
                return <li key={holder.key}>
                  <button type="button" className="button button--chip" data-testid={`ep-build-${piece}-${holder.key}`} disabled>
                    {holder.label}{holder.cargo.map((entry, index) => <CargoChip key={index} piece={entry} />)}
                  </button>
                </li>;
              }
              return removable.map((remove) => <li key={`${holder.key}-${remove}`}>
                <button type="button" className="button button--chip" data-testid={`ep-build-${piece}-${holder.key}-remove-${remove}`}
                  disabled={disabled} onClick={() => submit({ type, ...holder.field, remove }, `ep.build.${piece}`)}>
                  {holder.label}{holder.cargo.map((entry, index) => <CargoChip key={index} piece={entry} />)}
                  <span className="muted"> {t('ep.holder.replace', { piece: t(`ep.piece.${remove}`) })}</span>
                </button>
              </li>);
            })}
          </ul>
        )}
      </section>
    );
  };
  return <>
    <section className="ep-prompt__group" data-testid="ep-buy">
      <h3>{t('ep.trade.buy', { left: ep.goldBuysLeft })}</h3>
      <ul className="ep-prompt__resources">
        {RESOURCES.map((resource) => {
          // 銀行沒有這種資源時買不到（投影的 0 是確切值，#137），停用並說明原因。
          const empty = (bank?.[resource] ?? 0) <= 0;
          const label = t('ep.trade.buyOne', { resource: t(`resource.${resource}`) });
          const reason = empty ? t('bank.empty', { resource: t(`resource.${resource}`) }) : undefined;
          return <li key={resource}><button type="button" className="button button--chip" data-testid={`ep-buy-${resource}`}
            disabled={blocked || ep.goldBuysLeft <= 0 || gold < 2 || empty} aria-label={reason ? `${label} — ${reason}` : label} title={reason}
            onClick={() => submit({ type: 'ep.buyResource', receive: resource }, 'ep.trade.buyLabel')}>
            <ResourceIcon resource={resource} size={18} />
          </button></li>;
        })}
      </ul>
    </section>
    <section className="ep-prompt__group" data-testid="ep-sell">
      <h3>{t('ep.trade.sell')}</h3>
      <ul className="ep-prompt__resources">
        {RESOURCES.map((resource) => (
          <li key={resource}><button type="button" className="button button--chip" data-testid={`ep-sell-${resource}`}
            disabled={blocked || have(resource) < 3 || slot.goldSupply <= 0} aria-label={t('ep.trade.sellThree', { resource: t(`resource.${resource}`) })}
            onClick={() => submit({ type: 'ep.sellForGold', give: resource }, 'ep.trade.sellLabel')}>
            <ResourceIcon resource={resource} size={18} />
          </button></li>
        ))}
      </ul>
    </section>
    {ep.fastGoldLeft > 0 && (
      <section className="ep-prompt__group" data-testid="ep-fast-gold">
        <h3>{t('ep.trade.fastGold', { left: ep.fastGoldLeft })}</h3>
        <ul className="ep-prompt__resources">
          {RESOURCES.map((resource) => (
            <li key={resource}><button type="button" className="button button--chip" data-testid={`ep-fast-${resource}`}
              disabled={blocked || have(resource) < 1} aria-label={t('ep.trade.fastOne', { resource: t(`resource.${resource}`) })}
              onClick={() => submit({ type: 'ep.fastGold', give: resource }, 'ep.trade.fastLabel')}>
              <ResourceIcon resource={resource} size={18} />
            </button></li>
          ))}
        </ul>
      </section>
    )}
    {pieceRow('settler')}
    {pieceRow('crew')}
    {ep.shipReplace && ownShips.length > 0 && (
      <section className="ep-prompt__group" data-testid="ep-rebuild-ship">
        <h3>{t('ep.build.rebuild')}</h3>
        <ul className="ep-prompt__choices">
          {ownShips.map((ship) => (
            <li key={ship.id}><button type="button" className="button button--chip" data-testid={`ep-rebuild-${ship.id}`}
              disabled={blocked || have('lumber') < 1 || have('wool') < 1}
              onClick={() => arm('edge', 'ep.buildShip', 'ep.build.ship', { replace: ship.id })}>
              {t('ep.holder.ship', { number: shipNumber(slot, ship.id) })}{ship.cargo.map((entry, index) => <CargoChip key={index} piece={entry} />)}
            </button></li>
          ))}
        </ul>
      </section>
    )}
    <button type="button" className="button button--primary ep-prompt__primary" data-testid="ep-start-movement"
      disabled={blocked || !ep.canStartMovement} onClick={() => submit({ type: 'ep.startMovement' }, 'ep.phase.start')}>
      {t('ep.phase.start')}
    </button>
    <p className="muted ep-prompt__note">{t('ep.phase.startNote', { count: formatNumber(locale, ownShips.length) })}</p>
  </>;
}

function ExtraMoves({ ep, slot, submit, blocked, wool }: Pick<PhaseProps, 'ep' | 'slot' | 'submit' | 'blocked'> & { wool: number }) {
  const t = useT();
  const ships = ep.ships.filter((ship) => !ship.extra && !ship.done);
  if (ships.length === 0) return null;
  return (
    <section className="ep-prompt__group" data-testid="ep-extra-move">
      <h3>{t('ep.move.extra')}</h3>
      <ul className="ep-prompt__choices">
        {ships.map((ship) => (
          <li key={ship.id}><button type="button" className="button button--chip" data-testid={`ep-extra-${ship.id}`}
            disabled={blocked || wool < 1} onClick={() => submit({ type: 'ep.extraMove', ship: ship.id }, 'ep.move.extra')}>
            {t('ep.holder.ship', { number: shipNumber(slot, ship.id) })}
          </button></li>
        ))}
      </ul>
    </section>
  );
}

function MovementPhase({ controller, ep, slot, selfId, submit, arm, blocked, places }: PhaseProps) {
  const t = useT();
  const wool = shownHand(controller.state)?.wool ?? 0;
  void selfId;
  return <>
    {ep.stranded && <p className="ep-prompt__warning" data-testid="ep-stranded">{t('ep.move.strandedHint')}</p>}
    {ep.fishRoll && (
      <button type="button" className="button" data-testid="ep-fish-roll" disabled={blocked}
        onClick={() => submit({ type: 'ep.fishRoll' }, 'ep.fish.roll')}>{t('ep.fish.roll')}</button>
    )}
    <ul className="ep-prompt__ships">
      {ep.ships.map((ship) => <ShipCard key={ship.id} ship={ship} slot={slot} submit={submit} arm={arm} blocked={blocked}
        armed={controller.state.selection} places={places} />)}
    </ul>
    <ExtraMoves ep={ep} slot={slot} submit={submit} blocked={blocked} wool={wool} />
    <p className="muted ep-prompt__note">{t('ep.move.endNote')}</p>
  </>;
}

function ShipCard({ ship, slot, submit, arm, blocked, armed, places }: Pick<PhaseProps, 'slot' | 'submit' | 'arm' | 'blocked' | 'places'> & {
  ship: EpShipHints; armed: TableController['state']['selection'];
}) {
  const t = useT();
  const view = slot.ships.find((candidate) => candidate.id === ship.id);
  if (!view) return null;
  const number = shipNumber(slot, ship.id);
  const sailing = armed.commandType === 'ep.moveShip' && armed.params?.ship === ship.id;
  const harborCargo = (vertex: number) => slot.harbors.find((harbor) => harbor.vertex === vertex)?.cargo ?? [];
  const button = (key: string, label: string, onClick: () => void, disabled = false) => (
    <button key={key} type="button" className="button button--chip" data-testid={`ep-${key}-${ship.id}`} disabled={blocked || disabled} onClick={onClick}>{label}</button>
  );
  return (
    <li className="ep-ship" data-testid={`ep-ship-${ship.id}`} data-done={ship.done ? 'true' : 'false'}>
      <div className="ep-ship__head">
        <strong>{t('ep.holder.ship', { number })}</strong>
        <span className="ep-ship__cargo">{view.cargo.length === 0 ? <span className="muted">{t('ep.cargo.empty')}</span>
          : view.cargo.map((piece, index) => <CargoChip key={index} piece={piece} labelled />)}</span>
        <span className="muted">{ship.done ? t('ep.move.done') : t('ep.move.left', { count: ship.movesLeft })}</span>
      </div>
      <div className="ep-ship__actions">
        {ship.steps.length > 0 && !ship.done && button('sail', sailing ? t('ep.move.sailing') : t('ep.move.sail'),
          () => arm('edge', 'ep.moveShip', 'ep.move.step', { ship: ship.id }), sailing)}
        {ship.found.length > 0 && button('found', t('ep.action.found'), () => arm('vertex', 'ep.found', 'ep.action.found', { ship: ship.id }))}
        {ship.harbors.flatMap((vertex) => [
          ...[...new Set(harborCargo(vertex))].filter((piece) => hasRoom(view.cargo, piece)).map((piece) =>
            button(`load-${piece}-${vertex}`, t('ep.action.load', { piece: t(`ep.piece.${piece}`) }),
              () => submit({ type: 'ep.load', ship: ship.id, harbor: vertex, piece }, 'ep.action.loadLabel'))),
          ...[...new Set(view.cargo)].filter((piece) => hasRoom(harborCargo(vertex), piece)).map((piece) =>
            button(`unload-${piece}-${vertex}`, t('ep.action.unload', { piece: t(`ep.piece.${piece}`) }),
              () => submit({ type: 'ep.unload', ship: ship.id, harbor: vertex, piece }, 'ep.action.unloadLabel'))),
          ...(view.cargo.length + harborCargo(vertex).length > 0
            ? [button(`swap-${vertex}`, t('ep.action.swap'), () => submit({ type: 'ep.swap', ship: ship.id, harbor: vertex }, 'ep.action.swap'))]
            : []),
        ])}
        {ship.dropCrew.map((hex) => button(`drop-${hex}`, t('ep.action.dropCrew', { site: t(`ep.site.${slot.sites.find((site) => site.hex === hex)?.kind ?? 'lair'}`), place: hexReference(places, hex) }),
          () => submit({ type: 'ep.dropCrew', ship: ship.id, hex }, 'ep.action.dropLabel')))}
        {ship.pickCrew.map((hex) => button(`pick-${hex}`, t('ep.action.pickCrew', { place: hexReference(places, hex) }),
          () => submit({ type: 'ep.pickCrew', ship: ship.id, hex }, 'ep.action.pickLabel')))}
        {ship.loadFish.map((hex) => button(`fish-${hex}`, t('ep.action.loadFish', { place: hexReference(places, hex) }),
          () => submit({ type: 'ep.loadFish', ship: ship.id, hex }, 'ep.action.fishLabel')))}
        {ship.loadSpice.map((hex) => button(`spice-${hex}`, t('ep.action.loadSpice', { place: hexReference(places, hex) }),
          () => submit({ type: 'ep.loadSpice', ship: ship.id, hex }, 'ep.action.spiceLabel')))}
        {ship.deliver && button('deliver', t('ep.action.deliver'), () => submit({ type: 'ep.deliver', ship: ship.id }, 'ep.action.deliver'))}
        {ship.chase && button('chase', t('ep.action.chase'), () => submit({ type: 'ep.chase', ship: ship.id }, 'ep.action.chase'))}
      </div>
    </li>
  );
}
