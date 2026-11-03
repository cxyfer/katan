import { CARD_KINDS, type Resource } from '@catan/rules';
import { useT } from '../i18n/context.tsx';
import { blocksNewCommands } from '../state/commands.ts';
import { requiredActionFor } from '../state/pending.ts';
import { followUpsHeld, nameOf as resolveName, shownHand } from '../state/table.ts';
import type { TableController } from '../state/useTable.ts';
import { DevCardChoicePicker } from './DevCardChoicePicker.tsx';
import { DiscardPicker } from './DiscardPicker.tsx';
import { TbPrompt } from './tb/TbPrompt.tsx';
import { SeafarersPrompt } from './SeafarersPrompt.tsx';
import { CitiesKnightsPrompt } from './CitiesKnightsPrompt.tsx';
import { citiesKnightsView } from '../board/citiesKnights.ts';
import { moveBanditMessageId } from '../board/seafarersCitiesKnights.ts';
import { canPlayDevCard, ownYearOfPlenty } from './useDevCardChoice.ts';

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

  // 發展卡資源選擇：拖出壟斷／豐收之年後先在這裡選資源，確認才真正打出；
  // 豐收之年已打出（例如重新整理後）則直接選要領取的資源，不能再取消。
  const choice = state.devCardChoice;
  const plenty = rolling ? null : ownYearOfPlenty(state);
  const choiceBusy = blocksNewCommands(state.command) || (choice?.card === 'yearOfPlenty' && choice.queued.length > 0);
  // 已打出或失去出牌資格時不再顯示（useDevCardChoice 隨後清掉狀態），避免閃現一幀。
  const preplay = choice !== null && !plenty && !rolling && (choiceBusy || canPlayDevCard(state, choice.card));
  const bankTotal = Object.values(view.bank).reduce((sum, count) => sum + count, 0);
  const playMonopoly = async (resource: Resource) => {
    const receipt = await actions.submitCommand({ type: 'dev.playMonopoly', resource }, 'devCard.monopoly');
    if (receipt?.outcome === 'accepted') actions.setDevCardChoice(null);
  };
  const playYearOfPlenty = async (resources: Resource[]) => {
    // 先排好要領的資源，伺服器開啟領取步驟後由 useDevCardChoice 逐張送出。
    actions.setDevCardChoice({ card: 'yearOfPlenty', queued: resources });
    if (plenty) return;
    const receipt = await actions.submitCommand({ type: 'dev.playYearOfPlenty' }, 'devCard.yearOfPlenty');
    if (receipt?.outcome !== 'accepted') actions.setDevCardChoice({ card: 'yearOfPlenty', queued: [] });
  };

  if (preplay) {
    return (
      <section className="prompt prompt--mine" data-testid="required-action-prompt" data-mine="true"
        data-choice={choice.card} aria-labelledby="prompt-heading">
        <h2 id="prompt-heading">{t(`devCard.choice.title.${choice.card}`, { remaining: Math.min(2, bankTotal) })}</h2>
        <div className="prompt__body">
          <DevCardChoicePicker key={choice.card} card={choice.card} required={choice.card === 'monopoly' ? 1 : Math.min(2, bankTotal)}
            bank={view.bank} busy={choiceBusy}
            onCancel={() => actions.setDevCardChoice(null)}
            onSubmit={(resources) => void (choice.card === 'monopoly' ? playMonopoly(resources[0]!) : playYearOfPlenty(resources))} />
        </div>
      </section>
    );
  }

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
      {!rolling && <TbPrompt controller={controller} />}
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

      {plenty && (
        <div className="prompt__body">
          <DevCardChoicePicker key={plenty.remaining} card="yearOfPlenty" required={plenty.remaining} bank={view.bank} busy={choiceBusy}
            onSubmit={(resources) => void playYearOfPlenty(resources)} />
        </div>
      )}

      {pending && pending.kind === 'moveRobber' && (
        <p className="muted">{t(moveBanditMessageId(view))}</p>
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
