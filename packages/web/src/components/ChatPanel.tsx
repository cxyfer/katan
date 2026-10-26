import { useMemo } from 'react';
import { useLocale, useT } from '../i18n/context.tsx';
import { formatDateTime } from '../i18n/format.ts';
import { translateNotice } from '../i18n/events.ts';
import { visibleMessages } from '../state/chat.ts';
import type { TableController } from '../state/useTable.ts';

/**
 * Room text chat (docs/SPEC.md §4.5 "Room text chat contract").
 *
 * - messages render as plain text; nothing is injected as HTML;
 * - local sends carry a client message id and a sending/sent/rejected/unknown
 *   status, and an unknown send is retried with the *same* id;
 * - muting is per viewer and only affects this list.
 */
export function ChatPanel({ controller }: { controller: TableController }) {
  const t = useT();
  const locale = useLocale();
  const { state, actions } = controller;
  const chat = state.chat;
  const selfId = state.session?.id ?? null;
  const messages = useMemo(() => visibleMessages(chat), [chat]);
  const nameOf = (playerId: string) =>
    state.room?.members.find((member) => member.playerId === playerId)?.nickname ??
    state.game?.view.players.find((player) => player.id === playerId)?.nickname ??
    playerId;

  const pending = chat.entries.filter((entry) => entry.status !== 'sent');

  return (
    <section className="panel chat" aria-labelledby="chat-heading" data-testid="chat-panel">
      <h2 id="chat-heading">
        {t('chat.heading')}
        {chat.unread > 0 && (
          <span className="badge" data-testid="chat-unread">
            {t('chat.unread', { count: chat.unread })}
          </span>
        )}
      </h2>
      <p className="muted">{t('chat.plainTextNote')}</p>

      <ol className="chat__log" data-testid="chat-log">
        {messages.length === 0 && <li className="muted">{t('chat.empty')}</li>}
        {messages.map((message) => (
          <li
            key={message.id}
            className={`chat__message chat__message--${message.kind}`}
            data-testid={`chat-message-${message.id}`}
          >
            <span className="chat__meta">
              {message.kind === 'system' ? t('chat.system') : `${message.nickname} · ${message.seat + 1}`} ·{' '}
              {formatDateTime(locale, message.createdAt)}
            </span>
            {/* Plain text only: React escapes the string, no HTML is rendered. */}
            <span className="chat__text">{message.text}</span>
            {message.kind === 'player' && message.playerId !== selfId && (
              <button
                type="button"
                className="button button--chip"
                data-testid={`mute-${message.playerId}`}
                aria-pressed={chat.muted.includes(message.playerId)}
                onClick={() => actions.toggleMute(message.playerId)}
              >
                {chat.muted.includes(message.playerId)
                  ? t('chat.unmute', { player: message.nickname })
                  : t('chat.mute', { player: message.nickname })}
              </button>
            )}
          </li>
        ))}
      </ol>

      {chat.hasMore && (
        <button
          type="button"
          className="button button--ghost"
          data-testid="chat-load-more"
          onClick={() => void actions.loadChat(undefined, chat.nextSeq)}
        >
          {t('chat.loadMore')}
        </button>
      )}

      {pending.length > 0 && (
        <ul className="chat__pending" data-testid="chat-pending">
          {pending.map((entry) => (
            <li key={entry.clientMessageId} data-status={entry.status}>
              <span className="chat__text">{entry.text}</span>{' '}
              <span className="muted">{t(`chat.${entry.status}`)}</span>
              {entry.error && <span className="error"> {translateNotice(locale, entry.error)}</span>}
              {(entry.status === 'unknown' || entry.status === 'rejected') && (
                <button
                  type="button"
                  className="button button--chip"
                  data-testid={`chat-retry-${entry.clientMessageId}`}
                  onClick={() => void actions.retryChat(entry.clientMessageId)}
                >
                  {t('chat.retry')}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      <form
        className="chat__compose"
        onSubmit={(event) => {
          event.preventDefault();
          const text = chat.draft;
          if (text.trim().length === 0) return;
          void actions.sendChat(text);
        }}
      >
        <label htmlFor="chat-input">{t('chat.heading')}</label>
        <textarea
          id="chat-input"
          data-testid="chat-input"
          value={chat.draft}
          maxLength={state.config?.limits.chatMaxLength ?? 400}
          placeholder={t('chat.placeholder')}
          onChange={(event) => actions.setChatDraft(event.target.value)}
          onKeyDown={(event) => {
            // Enter during IME composition must not send (docs/SPEC.md §8.7).
            if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              if (chat.draft.trim().length === 0) return;
              void actions.sendChat(chat.draft);
            }
          }}
        />
        <button type="submit" className="button" data-testid="chat-send">
          {t('chat.send')}
        </button>
      </form>
    </section>
  );
}
