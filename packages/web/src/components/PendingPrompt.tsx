import { CARD_KINDS, RESOURCES } from '@catan/rules';
import { useT } from '../i18n/context.tsx';
import { requiredActionFor } from '../state/pending.ts';
import { followUpsHeld, nameOf as resolveName, shownHand } from '../state/table.ts';
import type { TableController } from '../state/useTable.ts';
import { DiscardPicker } from './DiscardPicker.tsx';
import { SeafarersPrompt } from './SeafarersPrompt.tsx';
import { CitiesKnightsPrompt } from './CitiesKnightsPrompt.tsx';
import { citiesKnightsView } from '../board/citiesKnights.ts';

/**
 * Mandatory-response prompt (docs/SPEC.md §4.4/§8.4).
 *
 * Rendered by the game layout itself — never inside a closable tool surface — so it
 * cannot be hidden by opening hand/trade/chat/help. It stays in the document
 * until the engine's pending effect is resolved.
 */
export function PendingPrompt({ controller }: { controller: TableController }) {
  const t = useT();
  const { state, actions } = controller;
  const view = state.game?.view ?? null;
  const selfId = state.session?.id ?? null;
  // 擲骰演出期間先只顯示「擲骰中」，點數揭曉後才給出棄牌、結束回合等後續選項。
  const rolling = followUpsHeld(state);
  const action = requiredActionFor(state);

  if (!view) return null;
  const pending = rolling ? null : view.pending;

  const nameOf = resolveName(state);

  const discard = pending && pending.kind === 'discard' ? pending : null;
  // The engine keeps the original `required` set after a player submits; only
  // `action.mine` (derived from `waitingFor`) decides whether this viewer still
  // owes a selection. Re-deriving it from `required` would reopen the picker
  // while the table waits for the remaining players.
  const discardMine = discard !== null && action?.kind === 'discard' && action.mine;
  const required = discardMine ? (discard.required[selfId ?? ''] ?? 0) : 0;

  return (
    <section
      className={`prompt${action?.mine ? ' prompt--mine' : ''}`}
      data-testid="required-action-prompt"
      data-mine={action?.mine ? 'true' : 'false'}
      data-rolling={rolling ? 'true' : undefined}
      aria-labelledby="prompt-heading"
    >
      <h2 id="prompt-heading">
        {action ? t(action.messageId, action.params) : t('play.waitingFor', { player: '—' })}
      </h2>
      {action && !action.mine && action.waitingFor.length > 0 && (
        <p className="muted" data-testid="prompt-waiting">
          {t('play.waitingForPlayers', {
            // 棄牌張數是公開資訊（required），列出來讓等待的人知道還要多久；
            // 陣列交給 interpolate 依語系的分隔符號串接。
            players: action.waitingFor
              .map((playerId) =>
                discard
                  ? t('play.pending.discardWaitingEntry', {
                      player: nameOf(playerId),
                      count: discard.required[playerId] ?? 0,
                    })
                  : nameOf(playerId),
              ),
          })}
        </p>
      )}

      {discardMine && discard && (
        <div className="prompt__body">
          <DiscardPicker
            required={required}
            // Cities & Knights: commodities count towards the 7 and may be discarded.
            hand={shownHand(state)}
            kinds={citiesKnightsView(view) ? CARD_KINDS : undefined}
            onSubmit={(resources) =>
              void actions.submitCommand({ type: 'pending.discard', resources }, 'play.pending.discardSubmit')
            }
          />
        </div>
      )}

      {pending && pending.kind === 'steal' && pending.actor === selfId && (
        <div className="prompt__body">
          <ul className="resource-picker" data-testid="steal-candidates">
            {pending.candidates.map((candidate) => (
              <li key={candidate}>
                <button
                  type="button"
                  className="button"
                  data-testid={`steal-${candidate}`}
                  onClick={() =>
                    void actions.submitCommand(
                      { type: 'pending.steal', victim: candidate },
                      'play.pending.steal',
                    )
                  }
                >
                  {nameOf(candidate)}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {pending && pending.kind === 'yearOfPlenty' && pending.actor === selfId && (
        <div className="prompt__body">
          <p>{t('play.pending.remaining', { remaining: pending.remaining })}</p>
          <ul className="resource-picker" data-testid="year-of-plenty">
            {RESOURCES.map((resource) => (
              <li key={resource}>
                <button
                  type="button"
                  className="button button--chip"
                  data-testid={`take-${resource}`}
                  onClick={() =>
                    void actions.submitCommand(
                      { type: 'pending.takeResource', resource },
                      'devCard.yearOfPlenty',
                    )
                  }
                >
                  {t(`resource.${resource}`)}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {pending && pending.kind === 'moveRobber' && (
        <p className="muted">{t('play.pending.moveRobber')}</p>
      )}
      {pending && pending.kind === 'freeRoads' && (
        <p className="muted">{t('play.pending.freeRoads', { remaining: pending.remaining })}</p>
      )}

      <SeafarersPrompt controller={controller} />
      <CitiesKnightsPrompt controller={controller} />

      {/* Mandatory turn actions stay inside the prompt so a player never
          has to open a secondary tool surface to act (docs/SPEC.md §8.1/§8.4). */}
      {!pending && action?.mine && action.kind === 'roll' && (
        <button
          type="button"
          className="button button--primary"
          data-testid="prompt-roll"
          onClick={() => void actions.submitCommand({ type: 'turn.roll' }, 'play.roll')}
        >
          {t('play.roll')}
        </button>
      )}
      {!pending && action?.mine && action.kind === 'turn' && view.hints?.canEndTurn && (
        <button
          type="button"
          className="button"
          data-testid="prompt-end-turn"
          onClick={() => void actions.submitCommand({ type: 'turn.end' }, 'play.endTurn')}
        >
          {t('play.endTurn')}
        </button>
      )}
    </section>
  );
}
