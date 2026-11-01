/** 不經伺服器、直接以規則引擎驅動 Bot 對局的測試工具。 */

import {
  actionHints,
  applyCommand,
  createGame,
  PLAYER_COLORS,
  projectGame,
  seededRng,
  type Command,
  type GameState,
  type GameView,
  type Rng,
} from '@catan/rules';
import { botActingOrder } from '../src/order.ts';
import { botSeed } from '../src/seed.ts';
import type { BotLevel, BotPolicy, OfferPhase } from '../src/types.ts';

export interface BotSeat {
  id: string;
  level: BotLevel;
  policy: BotPolicy;
}

export function profileFor(players: number): string {
  return players >= 5 ? 'base-paired-2025' : 'base-2025';
}

export function newBotGame(
  players: number,
  seed: number,
  setupMode: 'fixed' | 'variable' = 'variable',
): { state: GameState; rng: Rng } {
  const rng = seededRng(seed);
  const state = createGame({
    profileId: profileFor(players),
    players: Array.from({ length: players }, (_, index) => ({
      id: `bot${index + 1}`,
      nickname: `Bot ${index + 1}`,
      color: PLAYER_COLORS[index]!,
    })),
    setupMode,
    rng,
  });
  return { state, rng };
}

/** 與伺服器相同的投影：自己座位的 view 加上 hints。 */
export function viewFor(state: GameState, playerId: string): GameView {
  return projectGame(state, playerId, { hints: actionHints(state, playerId) });
}

export interface Decision {
  actor: string;
  command: Command;
}

/** 依排程順序詢問各 Bot，回傳第一個非 null 的決策；全部在等待時回傳 null。 */
export function nextDecision(
  state: GameState,
  seats: readonly BotSeat[],
  offerPhases: (botId: string) => Readonly<Record<string, OfferPhase>> = () => ({}),
): Decision | null {
  const order = botActingOrder(
    viewFor(state, seats[0]!.id),
    seats.map((seat) => seat.id),
  );
  for (const id of order) {
    const seat = seats.find((candidate) => candidate.id === id)!;
    const command = seat.policy.decide(viewFor(state, id), {
      selfId: id,
      level: seat.level,
      seed: botSeed('test', id, state.seq),
      offerPhases: offerPhases(id),
    });
    if (command) return { actor: id, command };
  }
  return null;
}

export interface StepFailure {
  actor: string;
  command: Command;
  code: string;
  params: Record<string, unknown> | undefined;
}

/** 套用一個決策；被拒時回傳失敗細節，方便測試訊息定位。 */
export function applyDecision(
  state: GameState,
  decision: Decision,
  rng: Rng,
): { ok: true; state: GameState } | { ok: false; failure: StepFailure } {
  const outcome = applyCommand(state, decision.actor, decision.command, rng);
  if (outcome.ok) return { ok: true, state: outcome.state };
  return {
    ok: false,
    failure: { ...decision, code: outcome.error.code, params: outcome.error.params },
  };
}
