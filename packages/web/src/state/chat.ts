/**
 * Room chat state (docs/SPEC.md §4.5 "Room text chat contract").
 *
 * Local entries are keyed by `clientMessageId` so a retry reuses the same id
 * and the server's deduplication collapses it; an incoming server message that
 * echoes a local id replaces that local entry rather than adding a duplicate.
 */

import type { ChatMessageView, Notice } from '@catan/protocol';

export type ChatSendStatus = 'sending' | 'sent' | 'rejected' | 'unknown';

export interface ChatEntry {
  clientMessageId: string;
  text: string;
  status: ChatSendStatus;
  message: ChatMessageView | null;
  error: Notice | null;
}

export interface ChatState {
  entries: ChatEntry[];
  server: ChatMessageView[];
  /** Sequence cursor for `?after=`. */
  nextSeq: number;
  hasMore: boolean;
  open: boolean;
  unread: number;
  /** Viewer-local mute list; never hides engine events or required actions. */
  muted: string[];
  loading: boolean;
  draft: string;
}

export function initialChatState(): ChatState {
  return {
    entries: [],
    server: [],
    nextSeq: 0,
    hasMore: false,
    open: false,
    unread: 0,
    muted: [],
    loading: false,
    draft: '',
  };
}

export type ChatEvent =
  | { kind: 'draft'; text: string }
  | { kind: 'local-send'; clientMessageId: string; text: string }
  | { kind: 'send-accepted'; clientMessageId: string; message: ChatMessageView }
  | { kind: 'send-rejected'; clientMessageId: string; error: Notice }
  | { kind: 'send-unknown'; clientMessageId: string; error: Notice }
  | { kind: 'retry-send'; clientMessageId: string }
  | { kind: 'server-message'; message: ChatMessageView; selfId: string | null }
  | { kind: 'page'; messages: ChatMessageView[]; nextSeq: number; hasMore: boolean }
  | { kind: 'loading'; loading: boolean }
  | { kind: 'open' }
  | { kind: 'close' }
  | { kind: 'mark-read' }
  | { kind: 'mute'; playerId: string }
  | { kind: 'unmute'; playerId: string };

function upsertEntry(entries: ChatEntry[], next: ChatEntry): ChatEntry[] {
  const index = entries.findIndex((entry) => entry.clientMessageId === next.clientMessageId);
  if (index === -1) return [...entries, next];
  const copy = entries.slice();
  copy[index] = next;
  return copy;
}

function isDuplicate(list: ChatMessageView[], message: ChatMessageView): boolean {
  return list.some(
    (candidate) =>
      candidate.id === message.id ||
      (message.clientMessageId !== undefined &&
        candidate.clientMessageId === message.clientMessageId),
  );
}

/** Merges a page/message into the ordered server log without duplicates. */
function mergeServer(list: ChatMessageView[], incoming: ChatMessageView[]): ChatMessageView[] {
  const out = list.slice();
  for (const message of incoming) {
    if (isDuplicate(out, message)) continue;
    out.push(message);
  }
  return out.sort((a, b) => a.seq - b.seq);
}

export function chatReducer(state: ChatState, event: ChatEvent): ChatState {
  switch (event.kind) {
    case 'draft':
      return { ...state, draft: event.text };
    case 'local-send':
      return {
        ...state,
        draft: '',
        entries: upsertEntry(state.entries, {
          clientMessageId: event.clientMessageId,
          text: event.text,
          status: 'sending',
          message: null,
          error: null,
        }),
      };
    case 'send-accepted':
      return {
        ...state,
        entries: upsertEntry(state.entries, {
          clientMessageId: event.clientMessageId,
          text: event.message.text,
          status: 'sent',
          message: event.message,
          error: null,
        }),
        server: mergeServer(state.server, [event.message]),
        nextSeq: Math.max(state.nextSeq, event.message.seq + 1),
      };
    case 'send-rejected':
      return {
        ...state,
        entries: state.entries.map((entry) =>
          entry.clientMessageId === event.clientMessageId
            ? { ...entry, status: 'rejected', error: event.error }
            : entry,
        ),
      };
    case 'send-unknown':
      return {
        ...state,
        entries: state.entries.map((entry) =>
          entry.clientMessageId === event.clientMessageId
            ? { ...entry, status: 'unknown', error: event.error }
            : entry,
        ),
      };
    case 'retry-send':
      return {
        ...state,
        entries: state.entries.map((entry) =>
          entry.clientMessageId === event.clientMessageId
            ? { ...entry, status: 'sending', error: null }
            : entry,
        ),
      };
    case 'server-message': {
      const { message } = event;
      const already = isDuplicate(state.server, message);
      const fromSelf = event.selfId !== null && message.playerId === event.selfId;
      return {
        ...state,
        server: already ? state.server : mergeServer(state.server, [message]),
        nextSeq: Math.max(state.nextSeq, message.seq + 1),
        unread: !state.open && !fromSelf ? state.unread + 1 : state.unread,
        entries: message.clientMessageId
          ? state.entries.map((entry) =>
              entry.clientMessageId === message.clientMessageId
                ? { ...entry, status: 'sent', message, error: null }
                : entry,
            )
          : state.entries,
      };
    }
    case 'page':
      return {
        ...state,
        server: mergeServer(state.server, event.messages),
        nextSeq: Math.max(state.nextSeq, event.nextSeq),
        hasMore: event.hasMore,
        loading: false,
      };
    case 'loading':
      return { ...state, loading: event.loading };
    case 'open':
      return { ...state, open: true, unread: 0 };
    case 'close':
      return { ...state, open: false };
    case 'mark-read':
      return { ...state, unread: 0 };
    case 'mute':
      return state.muted.includes(event.playerId)
        ? state
        : { ...state, muted: [...state.muted, event.playerId] };
    case 'unmute':
      return { ...state, muted: state.muted.filter((id) => id !== event.playerId) };
    default:
      return state;
  }
}

export function isMuted(state: ChatState, playerId: string): boolean {
  return state.muted.includes(playerId);
}

/** Visible server messages after applying this viewer's personal mute list. */
export function visibleMessages(state: ChatState): ChatMessageView[] {
  return state.server.filter((message) => !state.muted.includes(message.playerId));
}
