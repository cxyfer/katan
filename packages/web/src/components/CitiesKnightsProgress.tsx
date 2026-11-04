/**
 * Cities & Knights progress cards in the browser: the hand (each card with its
 * face, paraphrased effect and whether it can be played now, or why not), the
 * play flow of every card (direct, a choice in the panel, or a target on the
 * board), the Commercial Harbor offers, and the answers other cards ask for
 * (`ProgressPrompt`). Private card data only ever comes from the viewer's own
 * projection, so a dialog shows exactly what the server let this viewer see.
 */

import { useState } from 'react';
import { COMMODITIES, RESOURCES, type CardKind, type GameView } from '@catan/rules';
import { useLocale, useT } from '../i18n/context.tsx';
import { formatNumber } from '../i18n/format.ts';
import {
  cardFrameData, citiesKnightsHints, citiesKnightsView, PROGRESS_BOARD_TARGET, PROGRESS_TRACK,
  type CitiesKnightsHints, type CraneOption, type ProgressCardHint,
} from '../board/citiesKnights.ts';
import { blocksNewCommands } from '../state/commands.ts';
import { followUpsHeld, shownCitiesKnights, shownHand } from '../state/table.ts';
import type { TableController } from '../state/useTable.ts';
import { CardKindArt } from './CardKindArt.tsx';
import { CommodityEmblem, PipDieFace, TRACK_COLOR } from './SvgCitiesKnights.tsx';
import { ProgressCardFace } from './SvgProgressArt.tsx';
import '../styles/cities-knights.css';

const DIRECT = new Set(['irrigation', 'mining', 'roadBuilding', 'encouragement', 'sabotage', 'wedding', 'commercialHarbor']);
const BY_PLAYER = new Set(['guildDues', 'espionage', 'treason']);
const BY_KIND = new Set(['merchantFleet', 'resourceMonopoly', 'tradeMonopoly']);

type Submit = TableController['actions']['submitCommand'];

function selfOf(view: GameView, selfId: string | null) {
  return view.players.find((player) => player.id === selfId);
}

/** The viewer's resources and commodities as one card-count map. */
function ownCards(controller: TableController): Partial<Record<CardKind, number>> {
  return shownHand(controller.state) ?? {};
}

/** The progress hand and the card play flows (inside the C&K panel). */
export function ProgressHand({ controller }: { controller: TableController }) {
  const t = useT();
  const locale = useLocale();
  const { state, actions } = controller;
  const view = shownCitiesKnights(state);
  const ck = citiesKnightsView(view);
  const hints = citiesKnightsHints(view);
  const [active, setActive] = useState<string | null>(null);
  if (!view || !ck) return null;
  const selfId = state.session?.id ?? null;
  const self = selfOf(view, selfId);
  const blocked = blocksNewCommands(state.command) || followUpsHeld(state);
  const n = (value: number) => formatNumber(locale, value);
  const nameOf = (id: string) => view.players.find((player) => player.id === id)?.nickname ?? id;
  const held = self?.progressCards ?? [];
  // One row per held card kind; a card the hints do not list (stale projection) cannot be played.
  const cards: ProgressCardHint[] = [...new Set(held)].sort().map((card) => hints?.progress.find((hint) => hint.card === card) ?? {
    card, track: PROGRESS_TRACK[card] ?? 'science', count: held.filter((entry) => entry === card).length, playable: false, reason: 'pending', targets: {},
  });
  const current = cards.find((hint) => hint.card === active && hint.playable) ?? null;

  const play = (fields: Record<string, unknown>, card: string) => {
    setActive(null);
    void actions.submitCommand({ type: 'progress.play', card, ...fields }, `ck.progress.${card}`);
  };
  const start = (hint: ProgressCardHint) => {
    const board = PROGRESS_BOARD_TARGET[hint.card];
    if (DIRECT.has(hint.card)) {
      play({}, hint.card);
    } else if (board) {
      setActive(null);
      actions.selectTarget({ kind: board, index: null, commandType: 'progress.play', labelId: `ck.card.target.${hint.card}`, params: { card: hint.card }, field: board });
    } else {
      setActive(hint.card);
    }
  };

  return <>
    {held.length === 0
      ? <p className="muted">{t('ck.panel.progressEmpty')}</p>
      : <ul className="ck-progress-hand" data-testid="ck-progress-hand">
          {cards.map((hint) => (
            <li key={hint.card} className="ck-progress-card" data-testid={`ck-card-${hint.card}`} data-card={hint.card}
              data-playable={hint.playable ? 'true' : 'false'} data-reason={hint.reason ?? undefined}>
              <ProgressCardFace card={hint.card} dimmed={!hint.playable} />
              <span className="ck-progress-card__name">
                {t(`ck.progress.${hint.card}`)}{hint.count > 1 ? ` ×${n(hint.count)}` : ''}
              </span>
              <span className="ck-progress-card__text">{t(`ck.progressText.${hint.card}`)}</span>
              {hint.playable
                ? <button type="button" className="button button--primary ck-progress-card__play" data-testid={`ck-play-${hint.card}`}
                    disabled={blocked} aria-expanded={active === hint.card ? true : undefined} onClick={() => start(hint)}>
                    {t('ck.card.play')}
                  </button>
                : <span className="ck-progress-card__reason muted" data-testid={`ck-card-reason-${hint.card}`}>
                    {t(`ck.cardBlocked.${hint.reason ?? 'pending'}`)}
                  </span>}
            </li>
          ))}
        </ul>}
    {current && hints && (
      <ProgressPlayForm key={current.card} hint={current} view={view} disabled={blocked} nameOf={nameOf}
        onPlay={(fields) => play(fields, current.card)} onCancel={() => setActive(null)}
        onBoard={(selection) => { setActive(null); actions.selectTarget(selection); }} />
    )}
    {hints && <HarborOffers controller={controller} hints={hints} nameOf={nameOf} disabled={blocked} />}
    <TurnEffects view={view} selfId={selfId} nameOf={nameOf} />
  </>;
}

/** Cards that need a choice in the panel: Alchemy, Crane, Invention, Smithing, players and kinds. */
function ProgressPlayForm({ hint, view, disabled, nameOf, onPlay, onCancel, onBoard }: {
  hint: ProgressCardHint;
  view: GameView;
  disabled: boolean;
  nameOf: (id: string) => string;
  onPlay: (fields: Record<string, unknown>) => void;
  onCancel: () => void;
  onBoard: (selection: Parameters<TableController['actions']['selectTarget']>[0]) => void;
}) {
  const t = useT();
  const locale = useLocale();
  const n = (value: number) => formatNumber(locale, value);
  const [yellow, setYellow] = useState<number | null>(null);
  const [red, setRed] = useState<number | null>(null);
  const [picked, setPicked] = useState<number[]>([]);
  const card = hint.card;
  const toggle = (value: number, limit: number) => setPicked((current) => current.includes(value)
    ? current.filter((entry) => entry !== value)
    : current.length < limit ? [...current, value] : current);
  const ck = citiesKnightsView(view);
  let body: React.ReactNode = null;
  let ready = false;
  let fields: Record<string, unknown> = {};

  if (card === 'alchemy') {
    const row = (tone: 'yellow' | 'red', value: number | null, set: (value: number) => void) => (
      <fieldset className="ck-dice-row" data-testid={`ck-alchemy-${tone}`}>
        <legend>{t(`ck.card.die.${tone}`)}</legend>
        {[1, 2, 3, 4, 5, 6].map((face) => (
          <button key={face} type="button" className="ck-die-button" aria-pressed={value === face} data-testid={`ck-alchemy-${tone}-${face}`}
            aria-label={t('ck.card.dieFace', { die: t(`ck.card.die.${tone}`), value: n(face) })} onClick={() => set(face)}>
            <PipDieFace value={face} tone={tone} size={30} />
          </button>
        ))}
      </fieldset>
    );
    body = <>
      <p className="muted">{t('ck.card.choose.dice')}</p>
      {row('yellow', yellow, setYellow)}
      {row('red', red, setRed)}
      {yellow !== null && red !== null && <p data-testid="ck-alchemy-total">{t('ck.card.total', { total: n(yellow + red) })}</p>}
    </>;
    ready = yellow !== null && red !== null;
    fields = { dice: [yellow, red] };
  } else if (card === 'crane') {
    const options = hint.targets.tracks ?? [];
    const choose = (option: CraneOption) => {
      if (option.metropolis && option.sites.length > 1) {
        onBoard({ kind: 'vertex', index: null, commandType: 'progress.play', labelId: 'ck.card.target.crane', params: { card, track: option.track }, field: 'vertex' });
        return;
      }
      onPlay({ track: option.track, ...(option.metropolis ? { vertex: option.sites[0] } : {}) });
    };
    body = <>
      <p className="muted">{t('ck.card.choose.track')}</p>
      <ul className="resource-picker">
        {options.map((option) => <li key={option.track}>
          <button type="button" className={`button ck-track-button ck-track-button--${option.track}`} data-testid={`ck-crane-${option.track}`}
            disabled={disabled} style={{ ['--ck-track' as string]: TRACK_COLOR[option.track] }} onClick={() => choose(option)}>
            {t('ck.card.trackOption', { track: t(`ck.track.${option.track}`), level: n(option.level), cost: n(option.cost), commodity: t(`resource.${option.track === 'science' ? 'paper' : option.track === 'trade' ? 'cloth' : 'coin'}`) })}
          </button>
        </li>)}
      </ul>
    </>;
  } else if (card === 'invention') {
    const hexes = hint.targets.hexes ?? [];
    body = <>
      <p className="muted">{t('ck.card.choose.hexes')}</p>
      <ul className="resource-picker">
        {hexes.map((hex) => <li key={hex}>
          <button type="button" className="button button--chip" aria-pressed={picked.includes(hex)} data-testid={`ck-invention-${hex}`}
            onClick={() => toggle(hex, 2)}>
            {t('ck.card.hexLabel', { terrain: t(`terrain.${view.board.terrain[hex]}`), number: n(view.board.numbers[hex] ?? 0), hex: n(hex) })}
          </button>
        </li>)}
      </ul>
    </>;
    ready = picked.length === 2;
    fields = { hexes: picked };
  } else if (card === 'smithing') {
    const vertices = hint.targets.vertices ?? [];
    body = <>
      <p className="muted">{t('ck.card.choose.knights')}</p>
      <ul className="resource-picker">
        {vertices.map((vertex) => {
          const knight = ck?.knights.find((candidate) => candidate.vertex === vertex);
          return <li key={vertex}>
            <button type="button" className="button button--chip" aria-pressed={picked.includes(vertex)} data-testid={`ck-smithing-${vertex}`}
              onClick={() => toggle(vertex, 2)}>
              {t('ck.card.knightAt', { level: t(`ck.knight.${knight?.level ?? 1}`), vertex: n(vertex) })}
            </button>
          </li>;
        })}
      </ul>
    </>;
    ready = picked.length > 0;
    fields = { vertices: picked };
  } else if (BY_PLAYER.has(card)) {
    body = <>
      <p className="muted">{t('ck.card.choose.player')}</p>
      <ul className="resource-picker">
        {(hint.targets.players ?? []).map((id) => <li key={id}>
          <button type="button" className="button" data-testid={`ck-target-${id}`} disabled={disabled} onClick={() => onPlay({ target: id })}>
            {nameOf(id)}
          </button>
        </li>)}
      </ul>
    </>;
  } else if (BY_KIND.has(card)) {
    body = <>
      <p className="muted">{t('ck.card.choose.kind')}</p>
      <ul className="resource-picker">
        {(hint.targets.kinds ?? []).map((kind) => <li key={kind}>
          <button type="button" className="button button--chip" data-testid={`ck-kind-${kind}`} disabled={disabled} onClick={() => onPlay({ kind })}>
            {t(`resource.${kind}`)}
          </button>
        </li>)}
      </ul>
    </>;
  }

  const needsConfirm = card === 'alchemy' || card === 'invention' || card === 'smithing';
  return (
    <div className="ck-play-form" role="group" aria-label={t('ck.card.playing', { card: t(`ck.progress.${card}`) })} data-testid={`ck-play-form-${card}`}>
      <h4>{t('ck.card.playing', { card: t(`ck.progress.${card}`) })}</h4>
      {body}
      <div className="ck-play-form__actions">
        {needsConfirm && (
          <button type="button" className="button button--primary" data-testid="ck-play-confirm" disabled={disabled || !ready} onClick={() => onPlay(fields)}>
            {t('ck.card.confirm', { card: t(`ck.progress.${card}`) })}
          </button>
        )}
        <button type="button" className="button button--ghost" data-testid="ck-play-cancel" onClick={onCancel}>{t('app.cancel')}</button>
      </div>
    </div>
  );
}

/** Commercial Harbor: one resource offer to each other player, for the rest of the turn. */
function HarborOffers({ controller, hints, nameOf, disabled }: {
  controller: TableController; hints: CitiesKnightsHints; nameOf: (id: string) => string; disabled: boolean;
}) {
  const t = useT();
  const cards = ownCards(controller);
  const held = RESOURCES.filter((resource) => (cards[resource] ?? 0) > 0);
  const [resource, setResource] = useState<string | null>(null);
  if (hints.harborTargets.length === 0) return null;
  const chosen = resource && held.includes(resource as never) ? resource : (held[0] ?? null);
  return (
    <section className="ck-harbor" data-testid="ck-harbor">
      <h4>{t('ck.harbor.title')}</h4>
      <p className="muted">{t('ck.harbor.hint')}</p>
      {held.length === 0
        ? <p className="muted">{t('ck.harbor.noResource')}</p>
        : <>
            <ul className="resource-picker" aria-label={t('ck.harbor.resource')}>
              {held.map((kind) => <li key={kind}>
                <button type="button" className="button button--chip" aria-pressed={chosen === kind} data-testid={`ck-harbor-resource-${kind}`}
                  onClick={() => setResource(kind)}>
                  <span className="ck-chip-art"><CardKindArt card={kind} /></span>{t(`resource.${kind}`)}
                </button>
              </li>)}
            </ul>
            <ul className="resource-picker">
              {hints.harborTargets.map((id) => <li key={id}>
                <button type="button" className="button" data-testid={`ck-harbor-offer-${id}`} disabled={disabled || !chosen}
                  onClick={() => void controller.actions.submitCommand({ type: 'progress.harborOffer', to: id, resource: chosen }, 'ck.harbor.title')}>
                  {t('ck.harbor.offer', { player: nameOf(id) })}
                </button>
              </li>)}
            </ul>
          </>}
    </section>
  );
}

/** Public effects of cards played this turn: Alchemy dice, 2:1 kinds, the merchant. */
function TurnEffects({ view, selfId, nameOf }: { view: GameView; selfId: string | null; nameOf: (id: string) => string }) {
  const t = useT();
  const locale = useLocale();
  const ck = citiesKnightsView(view);
  const hints = citiesKnightsHints(view);
  if (!ck) return null;
  const n = (value: number) => formatNumber(locale, value);
  return <>
    {ck.alchemy && (
      <p className="ck-effect" data-testid="ck-alchemy-set">
        {t('ck.panel.alchemySet', { player: nameOf(ck.alchemy.player), yellow: n(ck.alchemy.dice[0]), red: n(ck.alchemy.dice[1]) })}
      </p>
    )}
    {hints && hints.twoForOne.length > 0 && (
      <p className="ck-effect" data-testid="ck-two-for-one">{t('ck.panel.twoForOne', { kinds: hints.twoForOne.map((kind) => t(`resource.${kind}`)) })}</p>
    )}
    <p className="muted" data-testid="ck-merchant-status">
      {ck.merchant
        ? t('ck.panel.merchant', { player: nameOf(ck.merchant.player), resource: merchantResource(view, ck.merchant.hex, t), you: ck.merchant.player === selfId ? t('ck.panel.merchantYou') : '' })
        : t('ck.panel.merchantNone')}
    </p>
  </>;
}

const TERRAIN_RESOURCE: Readonly<Record<string, string>> = { forest: 'lumber', hills: 'brick', pasture: 'wool', fields: 'grain', mountains: 'ore' };

function merchantResource(view: GameView, hex: number, t: (id: string) => string): string {
  const resource = TERRAIN_RESOURCE[view.board.terrain[hex] ?? ''];
  return resource ? t(`resource.${resource}`) : t('ck.panel.merchantNoResource');
}

// --- answers asked by other cards --------------------------------------------

/** Pick exactly `required` cards from a visible hand. */
function CardCountPicker({ hand, required, submitLabel, testId, disabled, onSubmit }: {
  hand: Partial<Record<CardKind, number>>; required: number; submitLabel: string; testId: string; disabled: boolean; onSubmit: (cards: CardKind[]) => void;
}) {
  const t = useT();
  const locale = useLocale();
  const n = (value: number) => formatNumber(locale, value);
  const [picked, setPicked] = useState<CardKind[]>([]);
  const kinds = [...RESOURCES, ...COMMODITIES] as CardKind[];
  const left = (kind: CardKind) => (hand[kind] ?? 0) - picked.filter((card) => card === kind).length;
  return (
    <div className="ck-card-picker" data-testid={testId}>
      <ul className="resource-picker">
        {kinds.filter((kind) => (hand[kind] ?? 0) > 0).map((kind) => <li key={kind}>
          <button type="button" className="button button--chip" data-testid={`${testId}-add-${kind}`}
            disabled={left(kind) <= 0 || picked.length >= required} onClick={() => setPicked((current) => [...current, kind])}>
            <span className="ck-chip-art"><CardKindArt card={kind} /></span>
            {t('ck.prompt.cardLeft', { card: t(`resource.${kind}`), count: n(left(kind)) })}
          </button>
        </li>)}
      </ul>
      <p data-testid={`${testId}-picked`}>
        {t('ck.prompt.picked', { cards: picked.length > 0 ? picked.map((card) => t(`resource.${card}`)) : ['—'], count: n(picked.length), required: n(required) })}
      </p>
      <div className="ck-play-form__actions">
        <button type="button" className="button button--ghost" data-testid={`${testId}-reset`} disabled={picked.length === 0} onClick={() => setPicked([])}>
          {t('play.pending.discardClear')}
        </button>
        <button type="button" className="button button--primary" data-testid={`${testId}-submit`} disabled={disabled || picked.length !== required}
          onClick={() => onSubmit(picked)}>
          {submitLabel}
        </button>
      </div>
    </div>
  );
}

interface FrameView { kind: string; responders: string[]; data: Record<string, unknown> }

/** Answers to progress cards addressed to the viewer (inside the required-action prompt). */
export function ProgressPrompt({ controller }: { controller: TableController }) {
  const t = useT();
  const locale = useLocale();
  const { state, actions } = controller;
  const view = state.game?.view ?? null;
  const selfId = state.session?.id ?? null;
  if (!view || !selfId || !citiesKnightsView(view) || followUpsHeld(state)) return null;
  const pending = view.pending as FrameView | null;
  if (!pending || !pending.kind?.startsWith('citiesKnights.') || !pending.responders?.includes(selfId)) return null;
  const blocked = blocksNewCommands(state.command);
  const n = (value: number) => formatNumber(locale, value);
  const nameOf = (id: unknown) => view.players.find((player) => player.id === id)?.nickname ?? String(id ?? '');
  const data = cardFrameData(view, pending.kind) ?? {};
  const submit: Submit = actions.submitCommand;
  const self = selfOf(view, selfId);

  switch (pending.kind) {
    case 'citiesKnights.harborExchange': {
      const commodities = COMMODITIES.filter((commodity) => (self?.commodities?.[commodity] ?? 0) > 0);
      return <div className="prompt__body ck-choice" data-testid="ck-harbor-answer">
        <p>{t('ck.prompt.harborHint', { player: nameOf(data.from), resource: data.resource ? t(`resource.${String(data.resource)}`) : '—' })}</p>
        <ul className="resource-picker">
          {commodities.map((commodity) => <li key={commodity}>
            <button type="button" className="button button--chip" data-testid={`ck-harbor-give-${commodity}`} disabled={blocked}
              onClick={() => void submit({ type: 'progress.harborAnswer', commodity }, 'ck.prompt.harbor')}>
              <CommodityEmblem commodity={commodity} size={18} />{t(`resource.${commodity}`)}
            </button>
          </li>)}
        </ul>
      </div>;
    }
    case 'citiesKnights.guildDues': {
      const hand = (data.hand ?? {}) as Partial<Record<CardKind, number>>;
      const count = Number(data.count ?? 0);
      return <div className="prompt__body ck-choice" data-testid="ck-guild-dues">
        <p>{t('ck.prompt.guildDuesHint', { player: nameOf(data.victim), count: n(count) })}</p>
        <CardCountPicker key={view.seq} hand={hand} required={count} testId="ck-guild-pick" disabled={blocked}
          submitLabel={t('ck.prompt.takeConfirm', { count: n(count) })}
          onSubmit={(cards) => void submit({ type: 'progress.takeCards', cards }, 'ck.prompt.take')} />
      </div>;
    }
    case 'citiesKnights.espionage': {
      const cards = (data.cards as string[] | undefined) ?? [];
      return <div className="prompt__body ck-choice" data-testid="ck-espionage">
        <p>{t('ck.prompt.espionageHint', { player: nameOf(data.victim) })}</p>
        <ul className="ck-progress-hand">
          {cards.map((card, index) => <li key={`${card}-${index}`}>
            <button type="button" className="ck-progress-card" data-testid={`ck-espionage-take-${card}`} disabled={blocked}
              onClick={() => void submit({ type: 'progress.takeProgress', card }, 'ck.prompt.take')}>
              <ProgressCardFace card={card} />
              <span className="ck-progress-card__name">{t(`ck.progress.${card}`)}</span>
            </button>
          </li>)}
        </ul>
        <button type="button" className="button button--ghost" data-testid="ck-espionage-none" disabled={blocked}
          onClick={() => void submit({ type: 'progress.takeProgress', card: null }, 'ck.prompt.take')}>
          {t('ck.prompt.takeNone')}
        </button>
      </div>;
    }
    case 'citiesKnights.sabotage':
    case 'citiesKnights.wedding': {
      const required = Number((data.required as Record<string, number> | undefined)?.[selfId] ?? 0);
      const sabotage = pending.kind === 'citiesKnights.sabotage';
      return <div className="prompt__body ck-choice" data-testid={sabotage ? 'ck-sabotage' : 'ck-wedding'}>
        <p>{t(sabotage ? 'ck.prompt.sabotageHint' : 'ck.prompt.weddingHint', { player: nameOf(data.actor), count: n(required) })}</p>
        <CardCountPicker key={view.seq} hand={ownCards(controller)} required={required} testId={sabotage ? 'ck-sabotage-pick' : 'ck-wedding-pick'}
          disabled={blocked} submitLabel={t(sabotage ? 'play.pending.discardConfirm' : 'ck.prompt.giveConfirm', { count: n(required) })}
          onSubmit={(cards) => void submit({ type: sabotage ? 'progress.sabotageDiscard' : 'progress.weddingGive', cards }, sabotage ? 'ck.progress.sabotage' : 'ck.progress.wedding')} />
      </div>;
    }
    case 'citiesKnights.treasonRemove': {
      const knights = (data.knights as number[] | undefined) ?? [];
      const ck = citiesKnightsView(view);
      return <div className="prompt__body ck-choice" data-testid="ck-treason-remove">
        <p className="muted">{t('ck.prompt.treasonRemoveHint', { player: nameOf(data.actor) })}</p>
        <ul className="resource-picker">
          {knights.map((vertex) => <li key={vertex}>
            <button type="button" className="button" data-testid={`ck-treason-remove-${vertex}`} disabled={blocked}
              onClick={() => void submit({ type: 'progress.treasonRemove', vertex }, 'ck.progress.treason')}>
              {t('ck.card.knightAt', { level: t(`ck.knight.${ck?.knights.find((knight) => knight.vertex === vertex)?.level ?? 1}`), vertex: n(vertex) })}
            </button>
          </li>)}
        </ul>
      </div>;
    }
    case 'citiesKnights.treasonPlace': {
      const levels = (data.levels as number[] | undefined) ?? [];
      const sites = (data.sites as number[] | undefined) ?? [];
      return <div className="prompt__body ck-choice" data-testid="ck-treason-place">
        <p className="muted">{t('ck.prompt.treasonPlaceHint', { level: t(`ck.knight.${Number(data.level ?? 1)}`) })}</p>
        {sites.length > 0 && <ul className="resource-picker">
          {levels.map((level) => <li key={level}>
            <button type="button" className="button" data-testid={`ck-treason-level-${level}`} disabled={blocked}
              aria-pressed={state.selection.commandType === 'progress.treasonPlace' && state.selection.params?.level === level}
              onClick={() => actions.selectTarget({ kind: 'vertex', index: null, commandType: 'progress.treasonPlace', labelId: 'ck.prompt.treasonPlace', params: { level }, field: 'vertex' })}>
              {t('ck.prompt.treasonLevel', { level: t(`ck.knight.${level}`) })}
            </button>
          </li>)}
        </ul>}
        <button type="button" className="button button--ghost" data-testid="ck-treason-skip" disabled={blocked}
          onClick={() => void submit({ type: 'progress.treasonPlace', vertex: null }, 'ck.progress.treason')}>
          {t('ck.prompt.treasonSkip')}
        </button>
      </div>;
    }
    case 'citiesKnights.diplomacyRoad':
      return <div className="prompt__body ck-choice" data-testid="ck-diplomacy-road">
        <p className="muted">{t('ck.prompt.diplomacyHint')}</p>
        <button type="button" className="button button--ghost" data-testid="ck-diplomacy-skip" disabled={blocked}
          onClick={() => void submit({ type: 'progress.diplomacyRoad', edge: null }, 'ck.progress.diplomacy')}>
          {t('ck.prompt.diplomacySkip')}
        </button>
      </div>;
    default:
      return null;
  }
}

/** Whether a card is played from the hand straight away (no further choice). */
export function isDirectCard(card: string): boolean {
  return DIRECT.has(card);
}

export { PROGRESS_TRACK };
