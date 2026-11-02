import { useState } from 'react';
import { RESOURCES } from '@catan/rules';
import { useT } from '../i18n/context.tsx';
import { citiesKnightsHints, PROGRESS_TRACK, TRACKS } from '../board/citiesKnights.ts';
import { blocksNewCommands } from '../state/commands.ts';
import { followUpsHeld } from '../state/table.ts';
import type { TableController } from '../state/useTable.ts';
import { ResourceIcon } from './GameArt.tsx';
import { ProgressPrompt } from './CitiesKnightsProgress.tsx';
import { ProgressCardArt, TrackEmblem } from './SvgCitiesKnights.tsx';
import '../styles/cities-knights.css';

const PROGRESS_FRAME = 'citiesKnights.progressDiscard';

/**
 * Cities & Knights parts of the required-action prompt: the pillage and
 * retreat choices (also armed on the board), the tied defenders' deck
 * choice, the progress-card discard and the aqueduct resource. Renders
 * nothing in other games (no `hints.modules.citiesKnights`).
 */
export function CitiesKnightsPrompt({ controller }: { controller: TableController }) {
  const t = useT();
  const { state, actions } = controller;
  const view = state.game?.view ?? null;
  const ck = citiesKnightsHints(view);
  const selfId = state.session?.id ?? null;
  if (!view || !ck || !selfId || followUpsHeld(state)) return null;
  const blocked = blocksNewCommands(state.command);
  const pending = view.pending as { kind: string; responders?: string[]; data?: Record<string, unknown> } | null;
  const self = view.players.find((player) => player.id === selfId);
  const hand = self?.progressCards ?? [];
  const frameRequired = pending?.kind === PROGRESS_FRAME && pending.responders?.includes(selfId)
    ? ((pending.data?.required as Record<string, number> | undefined)?.[selfId] ?? 0) : 0;
  // On one's own turn a card drawn over the limit is discarded at once (CK25 p. 10).
  const ownTurnExcess = !pending && view.turn.playerId === selfId && view.turn.phase === 'action' ? ck.progressExcess : 0;
  const discard = frameRequired || ownTurnExcess;

  return <>
    <ProgressPrompt controller={controller} />
    {ck.pillage.length > 0 && (
      <div className="prompt__body ck-choice" data-testid="ck-pillage">
        <p className="muted">{t('ck.prompt.pillageHint')}</p>
        <ul className="resource-picker">
          {ck.pillage.map((vertex) => <li key={vertex}>
            <button type="button" className="button" data-testid={`ck-pillage-${vertex}`} disabled={blocked}
              onClick={() => void actions.submitCommand({ type: 'barbarians.pillage', vertex }, 'ck.prompt.pillage')}>
              {t('ck.prompt.cityAt', { vertex })}
            </button>
          </li>)}
        </ul>
      </div>
    )}
    {ck.retreat.length > 0 && (
      <div className="prompt__body ck-choice" data-testid="ck-retreat">
        <p className="muted">{t('ck.prompt.retreatHint')}</p>
        <ul className="resource-picker">
          {ck.retreat.map((vertex) => <li key={vertex}>
            <button type="button" className="button" data-testid={`ck-retreat-${vertex}`} disabled={blocked}
              onClick={() => void actions.submitCommand({ type: 'knight.retreat', vertex }, 'ck.prompt.retreat')}>
              {t('ck.prompt.intersection', { vertex })}
            </button>
          </li>)}
        </ul>
      </div>
    )}
    {ck.defenderDecks.length > 0 && (
      <div className="prompt__body ck-choice" data-testid="ck-defender-decks">
        <p className="muted">{t('ck.prompt.deckHint')}</p>
        <ul className="resource-picker">
          {TRACKS.filter((track) => ck.defenderDecks.includes(track)).map((track) => <li key={track}>
            <button type="button" className={`button ck-track-button ck-track-button--${track}`} data-testid={`ck-deck-${track}`} disabled={blocked}
              onClick={() => void actions.submitCommand({ type: 'barbarians.chooseDeck', track }, 'ck.prompt.deck')}>
              <svg viewBox="-9 -9 18 18" width="18" height="18" aria-hidden="true"><TrackEmblem track={track} size={12} color="currentColor" /></svg>
              {t(`ck.track.${track}`)}
            </button>
          </li>)}
        </ul>
      </div>
    )}
    {discard > 0 && hand.length > 0 && (
      <ProgressDiscard key={`${view.seq}`} required={discard} hand={hand} disabled={blocked}
        onSubmit={(cards) => void actions.submitCommand({ type: 'progress.discard', cards }, 'ck.prompt.progressDiscard')} />
    )}
    {ck.scienceBonus && (
      <div className="prompt__body ck-choice" data-testid="ck-science-bonus">
        <p className="muted">{t('ck.prompt.scienceHint')}</p>
        <ul className="resource-picker">
          {RESOURCES.map((resource) => <li key={resource}>
            <button type="button" className="button button--chip" data-testid={`ck-science-${resource}`}
              disabled={blocked || view.bank[resource] <= 0}
              onClick={() => void actions.submitCommand({ type: 'science.take', resource }, 'ck.prompt.science')}>
              <ResourceIcon resource={resource} size={20} />{t(`resource.${resource}`)}
            </button>
          </li>)}
        </ul>
        <button type="button" className="button button--ghost" data-testid="ck-science-skip" disabled={blocked}
          onClick={() => void actions.submitCommand({ type: 'science.take', resource: null }, 'ck.prompt.science')}>
          {t('ck.prompt.scienceSkip')}
        </button>
      </div>
    )}
  </>;
}

/** Choose `required` progress cards from the hand to put back under their decks. */
function ProgressDiscard({ required, hand, disabled, onSubmit }: {
  required: number; hand: readonly string[]; disabled: boolean; onSubmit: (cards: string[]) => void;
}) {
  const t = useT();
  const [picked, setPicked] = useState<number[]>([]);
  const toggle = (index: number) => setPicked((current) => current.includes(index)
    ? current.filter((entry) => entry !== index)
    : current.length < required ? [...current, index] : current);
  return (
    <div className="prompt__body ck-progress-discard" data-testid="ck-progress-discard">
      <p>{t('ck.prompt.progressPick', { count: required })}</p>
      <ul className="ck-progress-hand">
        {hand.map((card, index) => {
          const chosen = picked.includes(index);
          const track = PROGRESS_TRACK[card] ?? 'science';
          return <li key={`${card}-${index}`}>
            <button type="button" className="ck-progress-card" aria-pressed={chosen} data-testid={`ck-progress-pick-${index}`}
              data-card={card} onClick={() => toggle(index)}>
              <ProgressCardArt track={track} />
              <span className="ck-progress-card__name">{t(`ck.progress.${card}`)}</span>
            </button>
          </li>;
        })}
      </ul>
      <button type="button" className="button button--primary" data-testid="ck-progress-discard-submit"
        disabled={disabled || picked.length !== required} onClick={() => onSubmit(picked.map((index) => hand[index]!))}>
        {t('ck.prompt.progressConfirm', { count: required })}
      </button>
    </div>
  );
}
