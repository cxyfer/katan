/**
 * B-FAIR：Seafarers + Cities & Knights 隱藏資訊與公平性測試（SF+CK 計畫 §6.1）。
 *
 * 兩個只差在隱藏資訊（對手手牌的資源與 commodity 組成、進步卡身分、各牌組與發展卡堆的順序）的狀態，投影相同，
 * 決策也必須相同；決策不得修改傳入的投影。
 * - 4 人（'sf-ck-new-shores-2025'）、6 人（'sf-ck-new-shores-paired-2025'）
 * - standard、easy
 * - 種子 61、62；另外在真實對局的狀態上佈置 gold frame、三種 `bandit` frame（`pending.pirate` 時為 `'pirate'`、
 *   `cause === 'knight'` 時為 `'robber'`、首攻後擲出 7 時為 `'either'`）與「有騎士相鄰海盜」的行動階段（`stagePirateChase`）。
 * - 取樣必須包含：gold frame、三種 `bandit` frame、有騎士相鄰海盜的 action；每個 family 至少 100 次比較。
 * - 排除「行動者看得到對手牌」的 C&K frame（`guildDues`、`espionage`、`harborExchange` 的回應者，同 `ck-fair.test.ts`）。
 */

import { describe, expect, it } from 'vitest';
import {
  actionHints,
  CITIES_KNIGHTS,
  seededRng,
  type GameState,
  type GameView,
  type ModulePending,
  type Rng,
} from '@catan/rules';
import { createBotPolicy } from '../src/policy.ts';
import { botSeed } from '../src/seed.ts';
import { GAME_TIMEOUT, botSeats, cloneState, hideDifferently, mixedLevels, runBotGame, viewFor } from './harness.ts';
import { citiesKnightsKit } from './modules/citiesKnights.ts';
import { seafarersKit } from './modules/seafarers.ts';
import { sfckKit, stageBandit, stagePirateChase, type StagedBandit } from './modules/seafarersCitiesKnights.ts';

const KITS = [seafarersKit, citiesKnightsKit, sfckKit];

/** 行動者看得到對手牌的 frame：回應者的投影含受害者的手牌或進步卡，不納入比較。 */
const REVEALING_FRAMES: ReadonlySet<string> = new Set([
  'citiesKnights.guildDues',
  'citiesKnights.espionage',
  'citiesKnights.harborExchange',
]);

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

function seesOpponentCards(state: GameState, playerId: string): boolean {
  const frame = state.pending as ModulePending | null;
  return (
    frame !== null &&
    'module' in frame &&
    frame.module === CITIES_KNIGHTS &&
    REVEALING_FRAMES.has(frame.kind) &&
    frame.responders.includes(playerId)
  );
}

function snapshots(profileId: string, players: number, seed: number, every: number): GameState[] {
  const seats = botSeats(mixedLevels(players, seed), (level) => createBotPolicy(level));
  const out: GameState[] = [];
  let step = 0;
  runBotGame({
    seats,
    seed,
    profileId,
    kits: KITS,
    onDecision: (state) => {
      if (step++ % every === 0 && !state.result) out.push(cloneState(state));
    },
  });
  return out;
}

/** 組合層的 `bandit` hint（行動者才有）；沒有 frame 時為 null。 */
function banditOf(state: GameState): string | null {
  if (state.pending?.kind !== 'moveRobber') return null;
  const hints = actionHints(state, state.pending.actor).modules?.seafarersCitiesKnights as { bandit: string | null } | undefined;
  return hints?.bandit ?? null;
}

/** 行動者有騎士相鄰海盜：`pirateChase` 非空。 */
function hasPirateChase(state: GameState): boolean {
  const actor = state.players[state.turn.seat]!.id;
  const hints = actionHints(state, actor).modules?.seafarersCitiesKnights as { pirateChase?: unknown[] } | undefined;
  return (hints?.pirateChase?.length ?? 0) > 0;
}

/**
 * 在真實的行動階段狀態（沒有待決效果）上佈置：三種 `bandit` frame 各兩個、有騎士相鄰海盜的 action、gold frame。
 * 條件不足的佈置會略過，所以呼叫端要檢查每一種都佈置得出來。
 */
function stagedStates(states: readonly GameState[], rng: Rng): GameState[] {
  const bases = states.filter((state) => state.turn.phase === 'action' && !state.pending && !state.result);
  const out: GameState[] = [];
  const stage = (times: number, apply: (variant: GameState) => boolean): void => {
    let staged = 0;
    for (let attempt = 0; attempt < bases.length && staged < times; attempt++) {
      const variant = cloneState(bases[(attempt * 5 + out.length) % bases.length]!);
      if (!apply(variant)) continue;
      out.push(variant);
      staged += 1;
    }
  };
  for (const bandit of ['robber', 'pirate', 'either'] as const satisfies readonly StagedBandit[]) {
    stage(2, (variant) => stageBandit(variant, bandit, rng));
  }
  stage(3, (variant) => stagePirateChase(variant, rng) && hasPirateChase(variant));
  stage(2, (variant) => {
    const actor = variant.players[variant.turn.seat]!.id;
    const gold: ModulePending = { kind: 'seafarers.gold', module: 'seafarers', responders: [actor], data: { picks: { [actor]: 2 } } };
    variant.pending = gold;
    return true;
  });
  return out;
}

const CASES = [
  { profileId: 'sf-ck-new-shores-2025' as const, players: 4 },
  { profileId: 'sf-ck-new-shores-paired-2025' as const, players: 6 },
];

for (const { profileId, players } of CASES) {
  describe(`B-FAIR hidden information (${profileId}, ${players} players)`, () => {
    const collected = [...snapshots(profileId, players, 61, 7), ...snapshots(profileId, players, 62, 11)];
    const states = [...collected, ...stagedStates(collected, seededRng(players * 31))];

    it('collects mid-game states containing gold, the three bandit frames and a knight next to the pirate', () => {
      expect(states.length).toBeGreaterThan(40);
      const bandits = new Set(states.map(banditOf).filter((bandit) => bandit !== null));
      expect([...bandits].sort(), 'bandit hints in the sample').toEqual(['either', 'pirate', 'robber']);
      expect(states.some((state) => state.pending?.kind === 'seafarers.gold'), 'a gold frame').toBe(true);
      const chase = states.filter((state) => state.turn.phase === 'action' && !state.pending && hasPirateChase(state));
      expect(chase.length, 'actions with a knight next to the pirate').toBeGreaterThan(0);
      expect(
        states.some((state) => state.board.pirate !== null && state.board.layout.terrain[state.board.pirate] === 'sea'),
        'the pirate at sea',
      ).toBe(true);
    });

    for (const level of ['standard', 'easy'] as const) {
      it(
        `decides identically when only hidden information differs (${level})`,
        () => {
          const policy = createBotPolicy(level);
          let compared = 0;
          let excluded = 0;

          for (const state of states) {
            for (const player of state.players) {
              if (seesOpponentCards(state, player.id)) {
                excluded += 1;
                continue;
              }
              const { variant, changed } = hideDifferently(state, player.id, KITS);
              if (!changed) continue;

              const original = viewFor(state, player.id);
              const altered = viewFor(variant, player.id);
              expect(JSON.stringify(altered), `seq ${state.seq} ${player.id}: projection changed`).toBe(JSON.stringify(original));

              const ctx = { selfId: player.id, level, seed: botSeed('fair', player.id, state.seq), offerPhases: {} };
              expect(
                policy.decide(altered, ctx),
                `seq ${state.seq} ${player.id} ${state.pending?.kind ?? state.turn.phase}`,
              ).toEqual(policy.decide(original, ctx));
              compared += 1;
            }
          }
          expect(compared, `compared ${compared}, excluded ${excluded}`).toBeGreaterThanOrEqual(100);
        },
        GAME_TIMEOUT,
      );
    }

    it(
      'never mutates the projection it is given',
      () => {
        for (const level of ['standard', 'easy'] as const) {
          const policy = createBotPolicy(level);
          // 取樣的前段加上佈置的狀態（佈置的在最後）。
          const subset = [...states.slice(0, 30), ...states.slice(-12)];
          for (const state of subset) {
            for (const player of state.players) {
              const view: GameView = deepFreeze(viewFor(state, player.id));
              const ctx = deepFreeze({ selfId: player.id, level, seed: 7, offerPhases: {} });
              expect(() => policy.decide(view, ctx)).not.toThrow();
            }
          }
        }
      },
      GAME_TIMEOUT,
    );
  });
}
