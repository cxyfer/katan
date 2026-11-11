/**
 * B-POLICY 擾動狀態測試（C&K 計畫 §6.1 fuzz）。
 *
 * 從真實對局取樣，再隨機改動手牌、commodity、進步卡、騎士、蠻族位置，並偶爾注入 13 種 C&K frame
 * （`citiesKnightsKit.perturb`；形狀依 rules 的實際投影）。
 * - 4 人（'ck-2025'）、6 人（'ck-paired-2025'），每格 1 個種子（種子 71 每 5 步、72 每 7 步取樣）
 * - standard、easy、fallback
 * - 各 150 個擾動狀態；擾動不得破壞守恆
 * - 斷言：不拋錯；回傳的指令被引擎接受；或回傳 null 且確實不欠動作（`botOwesAction` 為 null）。
 * - 另外：13 種 frame 各自佈置在真實狀態上，所有回應者的答案都被接受；進步卡超過上限的狀態一定先處理再結束回合。
 */

import { describe, expect, it } from 'vitest';
import { applyCommand, seededRng, type GameState } from '@catan/rules';
import { botOwesAction, fallbackPolicy } from '../src/fallback.ts';
import { createBotPolicy } from '../src/policy.ts';
import { botSeed } from '../src/seed.ts';
import type { BotLevel, BotPolicy } from '../src/types.ts';
import { GAME_TIMEOUT, botSeats, cloneState, mixedLevels, perturbState, runBotGame, viewFor } from './harness.ts';
import { citiesKnightsKit, STAGEABLE_FRAMES, stageFrame } from './modules/citiesKnights.ts';

declare const console: { log(...args: unknown[]): void };

const KITS = [citiesKnightsKit];
const FUZZ_VARIANTS_TARGET = 150;

function sample(profileId: string, players: number): GameState[] {
  const out: GameState[] = [];
  for (const [seed, every] of [
    [71, 5],
    [72, 7],
  ] as const) {
    const seats = botSeats(mixedLevels(players, seed), (level) => createBotPolicy(level));
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
  }
  return out;
}

const sampleCache = new Map<string, GameState[]>();
function samplesOf(profileId: string, players: number): GameState[] {
  const cached = sampleCache.get(profileId);
  if (cached) return cached;
  const states = sample(profileId, players);
  sampleCache.set(profileId, states);
  return states;
}

const POLICIES: readonly (readonly [string, BotPolicy, BotLevel])[] = [
  ['standard', createBotPolicy('standard'), 'standard'],
  ['easy', createBotPolicy('easy'), 'easy'],
  ['fallback', fallbackPolicy, 'standard'],
];

const CASES = [
  { profileId: 'ck-2025' as const, players: 4 },
  { profileId: 'ck-paired-2025' as const, players: 6 },
];

/** 對一個狀態的每個座位、每種策略要一個答案：被接受，或是 null 而且不欠動作。回傳問題描述。 */
function problemsOf(variant: GameState, tag: string): { checked: number; failures: string[]; commands: Record<string, number> } {
  const failures: string[] = [];
  const commands: Record<string, number> = {};
  let checked = 0;
  for (const player of variant.players) {
    for (const [name, policy, level] of POLICIES) {
      const ctx = { selfId: player.id, level, seed: botSeed('fuzz', player.id, variant.seq, tag), offerPhases: {} };
      const view = viewFor(variant, player.id);
      let command = null;
      try {
        command = policy.decide(view, ctx);
      } catch (error) {
        failures.push(`${tag} ${player.id} (${name}) threw: ${error instanceof Error ? error.stack : String(error)}`);
        continue;
      }
      checked += 1;
      if (command) {
        commands[command.type] = (commands[command.type] ?? 0) + 1;
        const outcome = applyCommand(variant, player.id, command, seededRng(1));
        if (!outcome.ok) {
          failures.push(
            `${tag} ${player.id} (${name}) rejected: ${JSON.stringify(command)} -> ${outcome.error.code} ${JSON.stringify(outcome.error.params ?? {})} [${variant.pending?.kind ?? variant.turn.phase}]`,
          );
        }
      } else {
        const owed = botOwesAction(view, player.id);
        if (owed !== null) failures.push(`${tag} ${player.id} (${name}) returned null while owing ${JSON.stringify(owed)}`);
      }
    }
  }
  return { checked, failures, commands };
}

describe('Cities & Knights fuzz perturbed states', () => {
  for (const { profileId, players } of CASES) {
    it(
      `issues only accepted commands or valid nulls from ${FUZZ_VARIANTS_TARGET} perturbed ${players}-player states (${profileId})`,
      () => {
        const baseStates = samplesOf(profileId, players);
        expect(baseStates.length).toBeGreaterThan(0);

        const rng = seededRng(players * 1000 + 7);
        const variants: GameState[] = [];
        while (variants.length < FUZZ_VARIANTS_TARGET) {
          variants.push(perturbState(baseStates[variants.length % baseStates.length]!, rng, KITS));
        }

        const conservationFailures = variants.map((variant) => citiesKnightsKit.conservation!(variant)).filter((problems) => problems.length > 0);
        expect(conservationFailures.slice(0, 3), 'the perturbation must keep supplies and pieces').toEqual([]);

        let checked = 0;
        const failures: string[] = [];
        const commands: Record<string, number> = {};
        const frames = new Set<string>();
        for (const [index, variant] of variants.entries()) {
          if (variant.pending) frames.add(variant.pending.kind);
          const result = problemsOf(variant, `#${index}`);
          checked += result.checked;
          failures.push(...result.failures);
          for (const [type, count] of Object.entries(result.commands)) commands[type] = (commands[type] ?? 0) + count;
        }

        console.log(
          `fuzz ${profileId} (${players}p): ${checked} decisions, frames ${[...frames].sort().join(',')}, commands ${JSON.stringify(commands)}`,
        );
        expect(failures.slice(0, 10)).toEqual([]);
        expect(checked).toBeGreaterThanOrEqual(FUZZ_VARIANTS_TARGET * players * POLICIES.length);
        // 擾動要讓策略走到 C&K 的指令，不只是 base 的。
        const ck = ['knight.recruit', 'knight.activate', 'city.improve', 'progress.play', 'progress.discard'].filter(
          (type) => (commands[type] ?? 0) > 0,
        );
        expect(ck.length, `C&K commands issued: ${JSON.stringify(commands)}`).toBeGreaterThanOrEqual(3);
      },
      GAME_TIMEOUT,
    );

    it(
      `answers every one of the 13 C&K frames staged on real states (${profileId})`,
      () => {
        const bases = samplesOf(profileId, players).filter((state) => state.turn.phase === 'action' && !state.pending);
        expect(bases.length).toBeGreaterThan(0);
        const rng = seededRng(players * 2000 + 11);
        const stagedBy: Record<string, number> = {};
        const failures: string[] = [];
        for (const kind of STAGEABLE_FRAMES) {
          for (let attempt = 0; attempt < bases.length * 3 && (stagedBy[kind] ?? 0) < 8; attempt++) {
            // 先擾動手牌與進步卡，frame 才有各種牌可以選。
            const variant = perturbState(bases[attempt % bases.length]!, rng, KITS);
            variant.pending = null;
            if (!stageFrame(variant, kind, rng)) continue;
            stagedBy[kind] = (stagedBy[kind] ?? 0) + 1;
            failures.push(...problemsOf(variant, `${kind}#${stagedBy[kind]}`).failures);
          }
        }
        console.log(`staged frames (${profileId} ${players}p): ${JSON.stringify(stagedBy)}`);
        expect(failures.slice(0, 10)).toEqual([]);
        const missing = STAGEABLE_FRAMES.filter((kind) => (stagedBy[kind] ?? 0) === 0);
        expect(missing, `frames never staged: ${missing.join(', ')}`).toEqual([]);
      },
      GAME_TIMEOUT,
    );

    it(`never ends a turn with too many progress cards, and always resolves the excess (${profileId})`, () => {
      const bases = samplesOf(profileId, players).filter((state) => state.turn.phase === 'action' && !state.pending);
      const rng = seededRng(players * 4000 + 3);
      let excessStates = 0;
      const failures: string[] = [];
      for (let attempt = 0; attempt < bases.length * 2; attempt++) {
        const variant = perturbState(bases[attempt % bases.length]!, rng, KITS);
        const actor = variant.players[variant.turn.seat]!;
        if (variant.pending || variant.turn.phase !== 'action') continue;
        if (actor.progressCards.length + (actor.newProgressCards?.length ?? 0) <= 4) continue;
        excessStates += 1;
        const policy = createBotPolicy(attempt % 2 === 0 ? 'standard' : 'easy');
        const command = policy.decide(viewFor(variant, actor.id), {
          selfId: actor.id,
          level: attempt % 2 === 0 ? 'standard' : 'easy',
          seed: attempt,
          offerPhases: {},
        });
        if (command?.type === 'turn.end') failures.push(`attempt ${attempt}: ended the turn with ${actor.progressCards.length} progress cards`);
        if (command) {
          const outcome = applyCommand(variant, actor.id, command, seededRng(1));
          if (!outcome.ok) failures.push(`attempt ${attempt}: rejected ${JSON.stringify(command)} -> ${outcome.error.code}`);
        }
      }
      expect(failures.slice(0, 5)).toEqual([]);
      expect(excessStates, 'perturbed states with progress-card excess').toBeGreaterThan(0);
    });
  }
});
