/**
 * WebSocket endpoint. One socket per browser tab; the newest authenticated
 * connection controls a seat and older tabs are told they are superseded (§8.4).
 */

import { randomUUID } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocketServer, type WebSocket } from 'ws';
import type { ClientMessage, ServerMessage } from '@catan/protocol';
import type { ServerConfig } from './config.ts';
import type { SessionService } from './session.ts';
import { ServiceError, type RoomService, type Connection } from './rooms.ts';
import type { GameCoordinator } from './game.ts';
import type { ChatService } from './chat.ts';

export interface WsDeps {
  config: ServerConfig;
  sessions: SessionService;
  rooms: RoomService;
  games: GameCoordinator;
  chat: ChatService;
  log: (level: 'debug' | 'info' | 'warn' | 'error', message: string, meta?: unknown) => void;
}

export function createWebSocketServer(deps: WsDeps): {
  handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): void;
  close(): Promise<void>;
} {
  const server = new WebSocketServer({ noServer: true });

  server.on('connection', (socket: WebSocket, _req: IncomingMessage, context: { playerId: string }) => {
    const connection: Connection = {
      id: randomUUID(),
      playerId: context.playerId,
      roomId: null,
      send(message: ServerMessage) {
        if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(message));
      },
      close() {
        socket.close();
      },
    };

    // 同一條連線的訊息依序處理：取消訂閱後立刻訂閱別的房間時，兩者不能交錯。
    let messageQueue: Promise<void> = Promise.resolve();
    socket.on('message', (raw) => {
      messageQueue = messageQueue.then(() => handleRaw(raw)).catch(() => undefined);
    });

    function handleRaw(raw: unknown): Promise<void> {
      return (async () => {
        let parsed: ClientMessage;
        try {
          parsed = JSON.parse(String(raw)) as ClientMessage;
        } catch {
          connection.send({
            type: 'error',
            payload: { code: 'E_INVALID_JSON', messageId: 'error.E_INVALID_JSON' },
          });
          return;
        }
        try {
          await handleClientMessage(parsed);
        } catch (error) {
          deps.log('warn', 'ws message failed', { type: parsed.type, error: String(error) });
          // 服務層已分類的拒絕（例如訂閱時房間已關閉、不是成員）回它自己的錯誤碼。
          connection.send({
            type: 'error',
            payload:
              error instanceof ServiceError
                ? {
                    code: error.code,
                    messageId: error.messageId,
                    ...(error.params ? { params: error.params } : {}),
                  }
                : { code: 'E_WS_HANDLER', messageId: 'error.E_INTERNAL' },
          });
        }
      })();
    }

    async function handleClientMessage(message: ClientMessage): Promise<void> {
      switch (message.type) {
        case 'ping':
          connection.send({ type: 'pong', payload: { at: new Date().toISOString() } });
          return;
        case 'subscribe': {
          const roomId = message.payload?.roomId;
          if (!roomId) {
            // 沒有 roomId＝取消訂閱：把連線移出房間，presence 與推送隨之停止
            // （Bot 也只在房內有 live socket 時行動）。沒訂閱時冪等不做事。
            const previous = connection.roomId;
            if (previous) {
              await deps.rooms.unregisterConnection(connection);
              connection.roomId = null;
            }
            // client 等這則確認才送 HTTP /leave，所以到那時 server 已沒有這條連線；
            // 原本就沒訂閱時也回覆，roomId 為 null。
            connection.send({
              type: 'unsubscribed',
              payload: {
                roomId: previous,
                // 取消之後才讀：這是 client 離開時要帶回去的目前世代。
                entryEpoch: previous ? deps.rooms.entryEpochOf(previous, connection.playerId) : null,
              },
            });
            return;
          }
          await deps.rooms.requireMembership(roomId, context.playerId);
          if (connection.roomId && connection.roomId !== roomId) {
            await deps.rooms.unregisterConnection(connection);
          }
          connection.roomId = roomId;
          await deps.rooms.registerConnection(connection);
          connection.send({
            type: 'room',
            payload: await deps.rooms.view(roomId, context.playerId),
          });
          const room = await deps.rooms.requireRoom(roomId);
          if (room.game_id) {
            const snapshot = await deps.games.snapshot(room.game_id, context.playerId);
            connection.send({ type: 'snapshot', payload: snapshot });
          }
          return;
        }
        default:
          connection.send({
            type: 'error',
            payload: { code: 'E_UNSUPPORTED', messageId: 'error.E_UNSUPPORTED' },
          });
      }
    }

    socket.on('close', () => {
      void deps.rooms.unregisterConnection(connection);
    });
    socket.on('error', () => {
      void deps.rooms.unregisterConnection(connection);
    });

    connection.send({
      type: 'hello',
      payload: { playerId: context.playerId, locale: 'zh-Hant' },
    });
  });

  return {
    handleUpgrade(req, socket, head) {
      void (async () => {
        const identity = await deps.sessions.resolve(req.headers.cookie);
        if (!identity) {
          socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
          socket.destroy();
          return;
        }
        server.handleUpgrade(req, socket, head, (socket_) => {
          server.emit('connection', socket_, req, { playerId: identity.id });
        });
      })().catch(() => {
        socket.destroy();
      });
    },
    async close() {
      for (const client of server.clients) client.close(1001, 'server shutting down');
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
