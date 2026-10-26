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
import type { RoomService, Connection } from './rooms.ts';
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

    socket.on('message', (raw) => {
      void (async () => {
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
          connection.send({
            type: 'error',
            payload: {
              code: 'E_WS_HANDLER',
              messageId: 'error.E_INTERNAL',
            },
          });
        }
      })();
    });

    async function handleClientMessage(message: ClientMessage): Promise<void> {
      switch (message.type) {
        case 'ping':
          connection.send({ type: 'pong', payload: { at: new Date().toISOString() } });
          return;
        case 'subscribe': {
          const roomId = message.payload.roomId;
          if (!roomId) return;
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
