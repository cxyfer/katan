import { useState } from 'react';
import { RESOURCES, type Resource } from '@catan/rules';
import { useLocale, useT } from '../i18n/context.tsx';
import { formatResourceList } from '../i18n/format.ts';
import { requiredActionFor } from '../state/pending.ts';
import { followUpsHeld } from '../state/table.ts';
import type { TableController } from '../state/useTable.ts';

/**
 * Mandatory-response prompt (docs/SPEC.md §4.4/§8.4).
 *
 * Rendered by the game layout itself — never inside a closable tool surface — so it
 * cannot be hidden by opening hand/trade/chat/help. It stays in the document
 * until the engine's pending effect is resolved.
 */
export function PendingPrompt({ controller }: { controller: TableController }) {
  const t = useT();
  const locale = useLocale();
  const { state, actions } = controller;
  const view = state.game?.view ?? null;
  const selfId = state.session?.id ?? null;
  // 擲骰演出期間先只顯示「擲骰中」，點數揭曉後才給出棄牌、結束回合等後續選項。
  const rolling = followUpsHeld(state);
  const action = requiredActionFor(state);
  const [discardPick, setDiscardPick] = useState<Resource[]>([]);

  if (!view) return null;
  const pending = rolling ? null : view.pending;

  const nameOf = (playerId: string) =>
    view.players.find((player) => player.id === playerId)?.nickname ?? playerId;

  const required = pending && pending.kind === 'discard' ? (pending.required[selfId ?? ''] ?? 0) : 0;
  const selected = discardPick.length;

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
            players: action.waitingFor.map(nameOf).join('、'),
          })}
        </p>
      )}

      {pending && pending.kind === 'discard' && required > 0 && (
        <div className="prompt__body">
          <p data-testid="discard-counts">
            {t('play.pending.discardRequired', { required })} ·{' '}
            {t('play.pending.discardSelected', { selected })}
          </p>
          {selected > 0 && (
            <p className="muted" data-testid="discard-picked">
              {formatResourceList(locale, discardPick)}
            </p>
          )}
          <ul className="resource-picker">
            {RESOURCES.map((resource) => (
              <li key={resource}>
                <button
                  type="button"
                  className="button button--chip"
                  data-testid={`discard-add-${resource}`}
                  disabled={selected >= required}
                  onClick={() => setDiscardPick((current) => [...current, resource])}
                >
                  {t(`resource.${resource}`)} +
                </button>
              </li>
            ))}
          </ul>
          <button
            type="button"
            className="button button--ghost"
            data-testid="discard-reset"
            onClick={() => setDiscardPick([])}
          >
            {t('app.cancel')}
          </button>
          <button
            type="button"
            className="button button--primary"
            data-testid="discard-submit"
            disabled={selected !== required}
            onClick={() => {
              void actions.submitCommand(
                { type: 'pending.discard', resources: discardPick },
                'play.pending.discard',
              );
              setDiscardPick([]);
            }}
          >
            {t('play.pending.discardSubmit')}
          </button>
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
