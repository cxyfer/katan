/**
 * B-FAIR：Cities & Knights 隱藏資訊與公平性測試（C&K 計畫 §6.1）。
 *
 * 兩個只差在隱藏資訊（對手手牌的資源與 commodity 組成、進步卡身分、各牌組的順序）的狀態，投影相同，
 * 決策也必須相同；決策不得修改傳入的投影。
 * - 4 人（'ck-2025'）、6 人（'ck-paired-2025'）
 * - standard、easy
 * - 種子 61、62；另外在真實對局的狀態上佈置 13 種 C&K frame（`stageFrame`）
 * - 排除三種「行動者看得到對手牌」的狀態（計畫 §6.1）：`guildDues`、`espionage` 與 `harborExchange` 的回應者，
 *   他們看得到受害者的手牌或進步卡，投影本來就會隨隱藏資訊改變；其他座位在這些 frame 裡仍然比較。
 * - 每個 family 至少 40 個狀態、100 次比較。
 */

import { describe, expect, it } from 'vitest';
import { CITIES_KNIGHTS, seededRng, type GameState, type GameView, type ModulePending } from '@catan/rules';
import { createBotPolicy } from '../src/policy.ts';
import { botSeed } from '../src/seed.ts';
import { GAME_TIMEOUT, botSeats, cloneState, hideDifferently, mixedLevels, runBotGame, viewFor } from './harness.ts';
import { citiesKnightsKit, STAGEABLE_FRAMES, stageFrame } from './modules/citiesKnights.ts';

const KITS = [citiesKnightsKit];

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

/** 這個座位在這個狀態是否看得到對手的牌（那就不能拿隱藏資訊的差異來比較）。 */
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
  const levels = mixedLevels(players, seed);
  const seats = botSeats(levels, (level) => createBotPolicy(level));
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

/**
 * 在行動階段、沒有待決效果的真實狀態上，逐一佈置 13 種 C&K frame（每種盡量佈置兩次，用不同的狀態與亂數）。
 * `stageFrame` 的條件不足（例如沒有人持有進步卡）時略過，所以不是每種都一定佈置得出來。
 */
function stagedFrames(states: readonly GameState[], seed: number): GameState[] {
  const rng = seededRng(seed);
  const bases = states.filter((state) => state.turn.phase === 'action' && !state.pending && !state.result);
  const out: GameState[] = [];
  for (const kind of STAGEABLE_FRAMES) {
    let staged = 0;
    for (let attempt = 0; attempt < bases.length && staged < 2; attempt++) {
      const variant = cloneState(bases[(attempt * 7 + out.length) % bases.length]!);
      if (stageFrame(variant, kind, rng)) {
        out.push(variant);
        staged += 1;
      }
    }
  }
  return out;
}

const CASES = [
  { profileId: 'ck-2025' as const, players: 4 },
  { profileId: 'ck-paired-2025' as const, players: 6 },
];

for (const { profileId, players } of CASES) {
  describe(`B-FAIR hidden information (${profileId}, ${players} players)`, () => {
    const collected = [...snapshots(profileId, players, 61, 7), ...snapshots(profileId, players, 62, 11)];
    const states = [...collected, ...stagedFrames(collected, players * 31)];

    it('collects at least 40 mid-game states, with the C&K frames staged on real states', () => {
      expect(states.length).toBeGreaterThanOrEqual(40);
      const kinds = new Set(states.map((state) => state.pending?.kind).filter((kind) => kind !== undefined));
      // 計畫的 13 種 frame 在真實盤面上多數佈置得出來；條件不足的少數允許缺席（見 `stageFrame`）。
      const staged = STAGEABLE_FRAMES.filter((kind) => kinds.has(kind as never));
      expect(staged.length, `staged frame kinds: ${staged.join(', ')}`).toBeGreaterThanOrEqual(10);
      expect(kinds.has('citiesKnights.pillage' as never) || kinds.has('citiesKnights.scienceBonus' as never)).toBe(true);
    });

    it('contains states with progress cards, knights and commodities in the hidden hands', () => {
      const progress = states.some((state) => state.players.some((player) => player.progressCards.length > 0));
      const commodities = states.some((state) =>
        state.players.some((player) => Object.values(player.commodities).some((count) => count > 0)),
      );
      const knights = states.some((state) => {
        const slot = state.moduleState?.[CITIES_KNIGHTS] as { knights?: unknown[] } | undefined;
        return (slot?.knights?.length ?? 0) > 0;
      });
      expect(progress, 'a hidden progress card').toBe(true);
      expect(commodities, 'a hidden commodity').toBe(true);
      expect(knights, 'a knight on the board').toBe(true);
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

              const ctx = {
                selfId: player.id,
                level,
                seed: botSeed('fair', player.id, state.seq),
                offerPhases: {},
              };
              expect(policy.decide(altered, ctx), `seq ${state.seq} ${player.id} ${state.pending?.kind ?? state.turn.phase}`).toEqual(
                policy.decide(original, ctx),
              );
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
          for (const state of states.filter((_, index) => index % 3 === 0).slice(0, 40)) {
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
