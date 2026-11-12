/**
 * B-POLICY 擾動狀態測試（SF+CK 計畫 §6.1 fuzz）。
 *
 * 從真實對局取樣，再隨機改動手牌、commodity、進步卡、騎士、蠻族位置、船、海盜位置、gold frame、freeRoads，並依序套用
 * `[seafarersKit, citiesKnightsKit, sfckKit]` 的擾動：SF kit 無條件把海盜放到海格、也會佈置 `moveRobber cause:'seven'`，
 * 這兩種狀態在首攻前不可能出現，由組合 kit（最後執行）修補，再加上首攻前後、海盜位置、船端的騎士（自己的與對手的）、
 * 騎士相鄰海盜與三種 `bandit` frame 的擾動。
 * - 4 人（'sf-ck-new-shores-2025'）、6 人（'sf-ck-new-shores-paired-2025'），每格 1 個種子組（種子 71 每 5 步、72 每 7 步取樣）
 * - standard、easy、fallback
 * - 各 150 個擾動狀態；擾動不得破壞三個 kit 的守恆與組合不變量
 * - 斷言：不拋錯；回傳的指令被引擎接受；或回傳 null 且確實不欠動作（`botOwesAction` 為 null）；
 *   每次 `pending.moveRobber` 的目標都在 `banditTargets(view, self, botModulesOf(profile))` 內，直接呼叫各模組的
 *   `robberTargets` 也不 throw。
 * - 另外：擾動確實走到首攻前後、三種 `bandit` frame、船端的騎士與「騎士相鄰海盜」的行動階段。
 */

import { describe, expect, it } from 'vitest';
import { actionHints, applyCommand, requireProfile, seededRng, type GameState } from '@catan/rules';
import { emptySfckGame } from '../../rules/test/sfck-helpers.ts';
import { banditTargets, defaultBanditTargets } from '../src/base/robber.ts';
import { botOwesAction, fallbackPolicy } from '../src/fallback.ts';
import type { BanditTarget } from '../src/modules/types.ts';
import { createBotPolicy } from '../src/policy.ts';
import { botSeed } from '../src/seed.ts';
import { botModulesOf } from '../src/support.ts';
import type { BotLevel, BotPolicy } from '../src/types.ts';
import { GAME_TIMEOUT, botSeats, cloneState, mixedLevels, perturbState, runBotGame, viewFor } from './harness.ts';
import { citiesKnightsKit } from './modules/citiesKnights.ts';
import { seafarersKit } from './modules/seafarers.ts';
import { sfckKit, stageBandit, stagePirateChase } from './modules/seafarersCitiesKnights.ts';

declare const console: { log(...args: unknown[]): void };

/** 明列三個 kit，組合 kit 最後：`perturb` 依陣列順序套用。 */
const KITS = [seafarersKit, citiesKnightsKit, sfckKit];
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
  { profileId: 'sf-ck-new-shores-2025' as const, players: 4 },
  { profileId: 'sf-ck-new-shores-paired-2025' as const, players: 6 },
];

const conservationOf = (state: GameState): string[] => KITS.flatMap((kit) => (kit.conservation?.(state) ?? []).map((problem) => `${kit.id}: ${problem}`));

interface Coverage {
  checked: number;
  failures: string[];
  commands: Record<string, number>;
  /** 每個 `pending.moveRobber` 決策的目標都落在 fold 集合內的次數（依 `bandit` hint 分）。 */
  moveRobber: Record<string, number>;
  /** 被規則接受的 `knight.chasePirate`（依策略分）；之後的 `pirate` frame 的 fold 只剩海格與外框，已檢查過。 */
  chases: Record<string, number>;
}

/** 對一個狀態的每個座位、每種策略要一個答案：被接受，或是 null 而且不欠動作；盜賊目標必須在 fold 內。 */
function problemsOf(variant: GameState, profileId: string, tag: string): Coverage {
  const modules = botModulesOf(requireProfile(profileId));
  const failures: string[] = [];
  const commands: Record<string, number> = {};
  const moveRobber: Record<string, number> = {};
  const chases: Record<string, number> = {};
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
        if (command.type === 'knight.chasePirate') {
          // 只有 standard 追擊海盜：easy 不追擊，保底永遠不送 knight 指令。
          if (name !== 'standard') failures.push(`${tag} ${player.id} (${name}) chased the pirate`);
          if (outcome.ok) {
            chases[name] = (chases[name] ?? 0) + 1;
            const after = viewFor(outcome.state, player.id);
            const bandit = (actionHints(outcome.state, player.id).modules?.seafarersCitiesKnights as { bandit: string | null } | undefined)?.bandit;
            const folded = banditTargets(after, player.id, modules);
            if (bandit !== 'pirate') failures.push(`${tag} ${player.id} (${name}) chased the pirate but the frame hint is ${String(bandit)}`);
            if (folded.length === 0) failures.push(`${tag} ${player.id} (${name}) the pirate fold after the chase is empty`);
            for (const target of folded) {
              if (target !== null && after.board.terrain[target] !== 'sea') failures.push(`${tag} ${player.id} (${name}) the pirate fold after the chase holds land hex ${target}`);
            }
          }
        }
        if (command.type === 'pending.moveRobber') {
          const hex = command.hex as BanditTarget;
          const targets = banditTargets(view, player.id, modules);
          const bandit = (actionHints(variant, player.id).modules?.seafarersCitiesKnights as { bandit: string | null } | undefined)?.bandit ?? 'none';
          if (!targets.includes(hex)) failures.push(`${tag} ${player.id} (${name}) moved a bandit to ${String(hex)}, outside the ${bandit} fold ${JSON.stringify(targets)}`);
          else moveRobber[`${name}.${bandit}`] = (moveRobber[`${name}.${bandit}`] ?? 0) + 1;
        }
      } else {
        const owed = botOwesAction(view, player.id);
        if (owed !== null) failures.push(`${tag} ${player.id} (${name}) returned null while owing ${JSON.stringify(owed)}`);
      }
    }
    // 直接呼叫各模組的 `robberTargets`：不得 throw（`banditTargets` 會吞掉例外，所以要在這裡直接測）。
    const view = viewFor(variant, player.id);
    for (const module of modules) {
      try {
        module.robberTargets?.(view, player.id, defaultBanditTargets(view));
      } catch (error) {
        failures.push(`${tag} ${player.id}: ${module.id}.robberTargets threw ${String(error)}`);
      }
    }
  }
  return { checked, failures, commands, moveRobber, chases };
}

const merge = (into: Record<string, number>, from: Record<string, number>): void => {
  for (const [key, count] of Object.entries(from)) into[key] = (into[key] ?? 0) + count;
};

describe('Seafarers + Cities & Knights fuzz perturbed states', () => {
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

        // 擾動不得破壞三個 kit 的守恆與組合不變量（首攻前的盜賊、`moveRobber` frame、海盜位置、商人）。
        const broken = variants.map((variant) => conservationOf(variant)).filter((problems) => problems.length > 0);
        expect(broken.slice(0, 3), 'the perturbation must keep supplies, pieces and the bandit invariants').toEqual([]);

        let checked = 0;
        const failures: string[] = [];
        const commands: Record<string, number> = {};
        const moveRobber: Record<string, number> = {};
        const chases: Record<string, number> = {};
        const frames = new Set<string>();
        const bandits = new Set<string>();
        let beforeAttack = 0;
        let afterAttack = 0;
        let pirateAtSea = 0;
        let pirateChase = 0;
        for (const [index, variant] of variants.entries()) {
          if (variant.pending) frames.add(variant.pending.kind);
          const slot = variant.moduleState?.citiesKnights as { attacks: number } | undefined;
          if ((slot?.attacks ?? 0) === 0) beforeAttack += 1;
          else afterAttack += 1;
          if (variant.board.pirate !== null) pirateAtSea += 1;
          for (const player of variant.players) {
            const hints = actionHints(variant, player.id).modules?.seafarersCitiesKnights as
              | { bandit: string | null; pirateChase: unknown[] }
              | undefined;
            if (hints?.bandit) bandits.add(hints.bandit);
            if ((hints?.pirateChase.length ?? 0) > 0) pirateChase += 1;
          }
          const result = problemsOf(variant, profileId, `#${index}`);
          checked += result.checked;
          failures.push(...result.failures);
          merge(commands, result.commands);
          merge(moveRobber, result.moveRobber);
          merge(chases, result.chases);
        }

        console.log(
          `fuzz ${profileId} (${players}p): ${checked} decisions; before/after the first attack ${beforeAttack}/${afterAttack}, pirate on the board ${pirateAtSea}, bandit frames ${[...bandits].sort().join(',')}, pirate-chase windows ${pirateChase}, frames ${[...frames].sort().join(',')}, moveRobber answers ${JSON.stringify(moveRobber)}, accepted chases ${JSON.stringify(chases)}, commands ${JSON.stringify(commands)}`,
        );
        expect(failures.slice(0, 10)).toEqual([]);
        // 策略確實送出指令（平均每個狀態至少一個），不是全部回 null 就算通過；每個決策都檢查過（拋錯會進 failures）。
        const issued = Object.values(commands).reduce((sum, count) => sum + count, 0);
        expect(issued, `commands issued over ${checked} decisions`).toBeGreaterThanOrEqual(FUZZ_VARIANTS_TARGET);
        expect(checked).toBe(FUZZ_VARIANTS_TARGET * players * POLICIES.length);
        // 擾動要同時走到首攻前與首攻後、三種 bandit frame、騎士相鄰海盜的行動階段。
        expect(beforeAttack, 'perturbed states before the first attack').toBeGreaterThan(0);
        expect(afterAttack, 'perturbed states after the first attack').toBeGreaterThan(0);
        expect(pirateAtSea, 'perturbed states with the pirate on the board').toBeGreaterThan(0);
        expect([...bandits].sort(), 'bandit hints reached by the perturbation').toEqual(['either', 'pirate', 'robber']);
        expect(pirateChase, 'windows with a knight next to the pirate').toBeGreaterThan(0);
        // 每種策略都在 moveRobber frame 裡作答過，而且都落在 fold 內（失敗已在上面回報）。
        for (const name of ['standard', 'easy', 'fallback']) {
          const answered = Object.entries(moveRobber).filter(([key]) => key.startsWith(`${name}.`)).reduce((sum, [, count]) => sum + count, 0);
          expect(answered, `${name} answers to a moveRobber frame`).toBeGreaterThan(0);
        }
        // 擾動要讓策略走到 C&K 的指令，不只是 base 的。
        const ck = ['knight.recruit', 'knight.activate', 'city.improve', 'progress.play', 'progress.discard'].filter(
          (type) => (commands[type] ?? 0) > 0,
        );
        expect(ck.length, `C&K commands issued: ${JSON.stringify(commands)}`).toBeGreaterThanOrEqual(3);
      },
      GAME_TIMEOUT,
    );

    it(
      `answers each bandit frame staged on real states with a target inside the fold (${profileId})`,
      () => {
        const bases = samplesOf(profileId, players).filter((state) => state.turn.phase === 'action' && !state.pending);
        expect(bases.length).toBeGreaterThan(0);
        const rng = seededRng(players * 2000 + 11);
        const stagedBy: Record<string, number> = {};
        const failures: string[] = [];
        for (const bandit of ['robber', 'pirate', 'either'] as const) {
          for (let attempt = 0; attempt < bases.length * 2 && (stagedBy[bandit] ?? 0) < 12; attempt++) {
            // 先擾動手牌與盤面（含組合 kit），再佈置 frame，frame 才有各種局面可以選。
            const variant = perturbState(bases[attempt % bases.length]!, rng, KITS);
            variant.pending = null;
            if (!stageBandit(variant, bandit, rng)) continue;
            stagedBy[bandit] = (stagedBy[bandit] ?? 0) + 1;
            expect(conservationOf(variant), `${bandit}#${stagedBy[bandit]} conservation`).toEqual([]);
            const hint = (actionHints(variant, variant.players[variant.turn.seat]!.id).modules?.seafarersCitiesKnights as { bandit: string }).bandit;
            expect(hint, `${bandit}#${stagedBy[bandit]} bandit hint`).toBe(bandit);
            failures.push(...problemsOf(variant, profileId, `${bandit}#${stagedBy[bandit]}`).failures);
          }
        }
        console.log(`staged bandit frames (${profileId} ${players}p): ${JSON.stringify(stagedBy)}`);
        expect(failures.slice(0, 10)).toEqual([]);
        for (const bandit of ['robber', 'pirate', 'either']) expect(stagedBy[bandit] ?? 0, `${bandit} frames staged`).toBeGreaterThan(0);
      },
      GAME_TIMEOUT,
    );

    it(
      `answers a knight next to the pirate: every policy stays legal, and the chase is offered (${profileId})`,
      () => {
        const bases = samplesOf(profileId, players).filter((state) => state.turn.phase === 'action' && !state.pending);
        const rng = seededRng(players * 3000 + 17);
        let staged = 0;
        const policyChases: Record<string, number> = {};
        const failures: string[] = [];
        for (let attempt = 0; attempt < bases.length * 8 && staged < 200; attempt++) {
          const variant = perturbState(bases[attempt % bases.length]!, rng, KITS);
          variant.pending = null;
          variant.turn.phase = 'action';
          if (!stagePirateChase(variant, rng)) continue;
          const actor = variant.players[variant.turn.seat]!.id;
          const hints = actionHints(variant, actor).modules?.seafarersCitiesKnights as { pirateChase: number[] };
          if (hints.pirateChase.length === 0) continue;
          staged += 1;
          expect(conservationOf(variant), `chase#${staged} conservation`).toEqual([]);
          const answered = problemsOf(variant, profileId, `chase#${staged}`);
          failures.push(...answered.failures);
          merge(policyChases, answered.chases);
          // 規則接受 hint 列出的追擊，而且之後的 frame 是 `pirate`，fold 只剩海格與外框。
          const chased = applyCommand(variant, actor, { type: 'knight.chasePirate', vertex: hints.pirateChase[0]! }, seededRng(1));
          if (!chased.ok) {
            failures.push(`chase#${staged} the hinted chase was rejected: ${chased.error.code}`);
            continue;
          }
          const view = viewFor(chased.state, actor);
          const targets = banditTargets(view, actor, botModulesOf(requireProfile(profileId)));
          expect(targets.length, `chase#${staged} the pirate fold is never empty`).toBeGreaterThan(0);
          for (const target of targets) {
            expect(target === null || view.board.terrain[target] === 'sea', `chase#${staged} target ${String(target)} is not sea or the frame`).toBe(true);
          }
          failures.push(...problemsOf(chased.state, profileId, `chased#${staged}`).failures);
        }
        console.log(`pirate-chase states (${profileId} ${players}p): ${staged}, accepted chases by the policies ${JSON.stringify(policyChases)}`);
        expect(failures.slice(0, 10)).toEqual([]);
        expect(staged, 'staged knight-next-to-pirate windows').toBeGreaterThan(0);
      },
      GAME_TIMEOUT,
    );

    it(`repairs the first-attack states the Seafarers perturbation breaks (${profileId})`, () => {
      const bases = samplesOf(profileId, players).filter((state) => (state.moduleState?.citiesKnights as { attacks: number }).attacks === 0);
      expect(bases.length, 'sampled states before the first attack').toBeGreaterThan(0);
      const rng = seededRng(players * 4000 + 3);
      let brokenWithoutRepair = 0;
      for (let attempt = 0; attempt < 60; attempt++) {
        const base = bases[attempt % bases.length]!;
        // 沒有組合 kit：SF kit 在首攻前把海盜放到海上，或佈置 `moveRobber`，組合守恆會失敗。
        const without = cloneState(base);
        seafarersKit.perturb!(without, rng);
        if ((sfckKit.conservation?.(without) ?? []).length > 0) brokenWithoutRepair += 1;
        // 有組合 kit（最後執行）：守恆一定成立。
        const full = perturbState(base, rng, KITS);
        const problems = conservationOf(full);
        expect(problems, `attempt ${attempt}`).toEqual([]);
      }
      // 沒有修補就會壞：這個測試確實在守門。
      expect(brokenWithoutRepair, 'states the Seafarers perturbation alone leaves impossible').toBeGreaterThan(0);
    });
  }
});

describe('the combination kit', () => {
  // 審查者的做法：`stagePirateChase` 之後真的送出 `knight.chasePirate`，得到 `pirate: true` 的 `moveRobber` frame；
  // SF kit 的擾動無條件把海盜放到 `[null, ...海格]` 之一，組合 kit（最後執行）要把不在場的海盜補回海格。
  it('repairs a pirate moveRobber frame whose pirate the Seafarers perturbation moved off the board', () => {
    const rng = seededRng(97);
    const start = emptySfckGame(4);
    expect(stagePirateChase(start, rng)).toBe(true);
    const actor = start.players[start.turn.seat]!.id;
    const chase = (actionHints(start, actor).modules?.seafarersCitiesKnights as { pirateChase: number[] }).pirateChase;
    expect(chase.length, 'the staged knight stands next to the pirate').toBeGreaterThan(0);
    const outcome = applyCommand(start, actor, { type: 'knight.chasePirate', vertex: chase[0]! }, seededRng(1));
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    const chased = outcome.state;
    expect(chased.pending).toMatchObject({ kind: 'moveRobber', actor, cause: 'knight', pirate: true });
    expect(conservationOf(chased), 'the real frame after the chase').toEqual([]);

    // 海盜被擾動到外框：組合守恆會抓到，修補之後要回到海格上。
    const offBoard = cloneState(chased);
    offBoard.board.pirate = null;
    expect(sfckKit.conservation!(offBoard).join(' ')).toContain('pirate moveRobber frame while the pirate is off the board');
    sfckKit.perturb!(offBoard, seededRng(1));
    expect(conservationOf(offBoard)).toEqual([]);

    // 整條擾動鏈（SF、C&K、組合）重複 600 次：SF kit 把海盜放到外框而 frame 還在的狀態，每一個都修補回來。
    let offBoardByTheSeafarersKit = 0;
    let frameKept = 0;
    for (let attempt = 0; attempt < 600; attempt++) {
      const alone = cloneState(chased);
      seafarersKit.perturb!(alone, rng);
      if (alone.pending?.kind === 'moveRobber' && alone.pending.pirate === true) {
        frameKept += 1;
        if (alone.board.pirate === null) offBoardByTheSeafarersKit += 1;
      }
      expect(conservationOf(perturbState(chased, rng, KITS)), `attempt ${attempt}`).toEqual([]);
    }
    expect(frameKept, 'attempts where the pirate frame survives the Seafarers perturbation').toBeGreaterThan(0);
    expect(offBoardByTheSeafarersKit, 'attempts where the Seafarers kit moved the pirate off the board').toBeGreaterThan(0);
  });

  it('flags the states the combination can never reach', () => {
    const base = samplesOf('sf-ck-new-shores-2025', 4).find((state) => (state.moduleState?.citiesKnights as { attacks: number }).attacks === 0)!;
    expect(sfckKit.conservation!(base), 'a real state before the first attack').toEqual([]);

    const pirate = cloneState(base);
    pirate.board.pirate = pirate.board.layout.terrain.findIndex((terrain) => terrain === 'sea');
    expect(sfckKit.conservation!(pirate).join(' ')).toContain('pirate');

    const robber = cloneState(base);
    robber.board.robber = robber.board.layout.robber;
    expect(sfckKit.conservation!(robber).join(' ')).toContain('robber');

    const frame = cloneState(base);
    frame.pending = { kind: 'moveRobber', actor: frame.players[0]!.id, cause: 'seven', pirate: false };
    expect(sfckKit.conservation!(frame).join(' ')).toContain('moveRobber frame before the first attack');

    // 追擊海盜的 frame 要求海盜在場上，而且只有騎士追擊。
    const attacked = cloneState(base);
    (attacked.moduleState!.citiesKnights as { attacks: number }).attacks = 1;
    attacked.board.robber = attacked.board.layout.robber;
    attacked.pending = { kind: 'moveRobber', actor: attacked.players[0]!.id, cause: 'knight', pirate: true };
    expect(sfckKit.conservation!(attacked).join(' ')).toContain('off the board');
    attacked.board.pirate = attacked.board.layout.terrain.findIndex((terrain) => terrain === 'sea');
    expect(sfckKit.conservation!(attacked)).toEqual([]);
    attacked.pending = { kind: 'moveRobber', actor: attacked.players[0]!.id, cause: 'seven', pirate: true };
    expect(sfckKit.conservation!(attacked).join(' ')).toContain('only a knight chases the pirate');

    // 首攻前沒有盜賊移動，也就沒有偷牌的 frame。
    const steal = cloneState(base);
    steal.pending = { kind: 'steal', actor: steal.players[0]!.id, candidates: [steal.players[1]!.id] } as unknown as GameState['pending'];
    expect(sfckKit.conservation!(steal).join(' ')).toContain('steal frame before the first attack');

    // 海盜在陸地上、商人在金礦上。
    const land = cloneState(attacked);
    land.pending = null;
    land.board.pirate = land.board.layout.terrain.findIndex((terrain) => terrain !== 'sea');
    expect(sfckKit.conservation!(land).join(' ')).toContain('not on a sea hex');
    const merchant = cloneState(attacked);
    merchant.pending = null;
    const gold = merchant.board.layout.terrain.findIndex((terrain) => terrain === 'gold');
    (merchant.moduleState!.citiesKnights as { merchant?: { player: string; hex: number } }).merchant = { player: merchant.players[0]!.id, hex: gold };
    expect(sfckKit.conservation!(merchant).join(' ')).toContain('gold field');
  });
});
