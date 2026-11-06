/** 不經伺服器、直接以規則引擎驅動 Bot 對局的測試工具。 */

import {
  actionHints,
  applyCommand,
  createGame,
  PLAYER_COLORS,
  projectGame,
  RESOURCES,
  seededRng,
  type GameState,
  type GameView,
  type Rng,
} from '@catan/rules';
import { botActingOrder } from '../src/order.ts';
import { botSeed } from '../src/seed.ts';
import type { BotCommand, BotLevel, BotPolicy, OfferPhase } from '../src/types.ts';

// 本套件不載入 Node 型別（src 不得使用 Node API）；計時只需要這個全域。
declare const performance: { now(): number };

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
  command: BotCommand;
}

export type OfferPhases = (botId: string, state: GameState) => Readonly<Record<string, OfferPhase>>;

/** 依排程順序詢問各 Bot，回傳第一個非 null 的決策；全部在等待時回傳 null。 */
export function nextDecision(
  state: GameState,
  seats: readonly BotSeat[],
  offerPhases: OfferPhases = () => ({}),
  onDecide?: (botId: string, elapsedMs: number) => void,
): Decision | null {
  const order = botActingOrder(
    viewFor(state, seats[0]!.id),
    seats.map((seat) => seat.id),
  );
  for (const id of order) {
    const seat = seats.find((candidate) => candidate.id === id)!;
    const view = viewFor(state, id);
    const started = performance.now();
    const command = seat.policy.decide(view, {
      selfId: id,
      level: seat.level,
      seed: botSeed('test', id, state.seq),
      offerPhases: offerPhases(id, state),
    });
    onDecide?.(id, performance.now() - started);
    if (command) return { actor: id, command };
  }
  return null;
}

/**
 * 以步數模擬報價階段（規格 §10）：報價建立後第一次輪詢為 collecting，下一次為
 * ready，之後為 expired。每當所有座位都在等待時，時鐘前進一格。
 */
export function createOfferClock(): { phases: OfferPhases; tick(state: GameState): void } {
  const age = new Map<string, number>();
  return {
    phases(botId, state) {
      const out: Record<string, OfferPhase> = {};
      for (const offer of state.offers) {
        if (offer.from !== botId || offer.status !== 'open') continue;
        const ticks = age.get(offer.id) ?? 0;
        out[offer.id] = ticks === 0 ? 'collecting' : ticks === 1 ? 'ready' : 'expired';
      }
      return out;
    },
    tick(state) {
      for (const offer of state.offers) {
        if (offer.status === 'open') age.set(offer.id, (age.get(offer.id) ?? 0) + 1);
      }
    },
  };
}

export interface StepFailure {
  actor: string;
  command: BotCommand;
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

export function botSeats(levels: readonly BotLevel[], policyFor: (level: BotLevel) => BotPolicy): BotSeat[] {
  return levels.map((level, index) => ({ id: `bot${index + 1}`, level, policy: policyFor(level) }));
}

export interface RunOptions {
  seats: readonly BotSeat[];
  seed: number;
  maxSteps?: number;
  setupMode?: 'fixed' | 'variable';
  /** 每個被接受的決策都會回呼一次（在套用之前）。 */
  onDecision?: (state: GameState, decision: Decision) => void;
}

export interface RunResult {
  state: GameState;
  steps: number;
  failure: StepFailure | null;
  /** 所有座位都在等待、且沒有報價可以推進時為 true。 */
  stalled: boolean;
  decide: { count: number; totalMs: number; maxMs: number };
}

/** 從開局跑到結束（或步數上限），每一步都由 Bot 決策並交給規則引擎驗證。 */
export function runBotGame(options: RunOptions): RunResult {
  const { seats, seed } = options;
  const maxSteps = options.maxSteps ?? 5000;
  let { state, rng } = newBotGame(seats.length, seed, options.setupMode);
  const clock = createOfferClock();
  const decide = { count: 0, totalMs: 0, maxMs: 0 };
  const onDecide = (_botId: string, elapsed: number): void => {
    decide.count += 1;
    decide.totalMs += elapsed;
    decide.maxMs = Math.max(decide.maxMs, elapsed);
  };
  let idle = 0;
  let steps = 0;
  while (steps < maxSteps && !state.result) {
    const decision = nextDecision(state, seats, clock.phases, onDecide);
    if (!decision) {
      // 只有在等報價回應時才允許等待；時鐘最多前進三格就一定會撤回。
      if (idle < 3 && state.offers.some((offer) => offer.status === 'open')) {
        clock.tick(state);
        idle += 1;
        continue;
      }
      return { state, steps, failure: null, stalled: true, decide };
    }
    idle = 0;
    options.onDecision?.(state, decision);
    const outcome = applyDecision(state, decision, rng);
    if (!outcome.ok) return { state, steps, failure: outcome.failure, stalled: false, decide };
    state = outcome.state;
    steps += 1;
  }
  return { state, steps, failure: null, stalled: false, decide };
}

/** 銀行加上所有手牌的資源總量，應等於 profile 的供應量。 */
export function supplyTotal(state: GameState): number {
  const hands = state.players.reduce(
    (sum, player) => sum + RESOURCES.reduce((inner, resource) => inner + player.resources[resource], 0),
    0,
  );
  return hands + RESOURCES.reduce((sum, resource) => sum + state.bank[resource], 0);
}
