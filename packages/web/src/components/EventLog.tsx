import { useMemo } from 'react';
import { useLocale, useT } from '../i18n/context.tsx';
import { translateEvent } from '../i18n/events.ts';
import { formatDice, formatNumber } from '../i18n/format.ts';
import { nameOf, shownEvents } from '../state/table.ts';
import type { TableController } from '../state/useTable.ts';

/**
 * Public event log. Engine events and player chat are deliberately rendered in
 * separate regions so a user-authored message can never look like an
 * authoritative game event (docs/SPEC.md §4.5).
 */
export function EventLog({ controller }: { controller: TableController }) {
  const t = useT();
  const locale = useLocale();
  const { state } = controller;
  const nameResolver = useMemo(() => nameOf(state), [state]);
  // 擲骰演出期間不列出擲骰與其後的事件，點數揭曉後才補上。
  const { events, diceHidden } = shownEvents(state);
  const recent = events.slice(-40).reverse();

  return (
    <section className="panel" aria-labelledby="log-heading" data-testid="event-log">
      <h2 id="log-heading">{t('play.events')}</h2>
      {!diceHidden && state.game?.view.turn.dice && (
        <p className="muted" data-testid="last-dice">
          {t('play.dice')}: {formatDice(state.game.view.turn.dice)} ·{' '}
          {t('play.diceTotal', {
            total: (state.game.view.turn.dice[0] ?? 0) + (state.game.view.turn.dice[1] ?? 0),
          })}
        </p>
      )}
      {recent.length === 0 ? (
        <p className="muted">{t('play.noEvents')}</p>
      ) : (
        <ol className="event-log" data-testid="event-list">
          {recent.map((event) => {
            const translated = translateEvent(locale, event, nameResolver);
            return (
              <li key={`${event.seq}-${event.type}`} data-event={event.type}>
                <span className="event-log__seq">{formatNumber(locale, event.seq)}</span>{' '}
                {translated.text}
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
