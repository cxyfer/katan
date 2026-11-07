/**
 * harness 自己的守門測試：看門狗與仿 BotDriver 模式必須抓得到故意卡住的假策略與假模組，
 * 否則它們只是「沒出事」的證明，而不是「出事會被抓到」的證明。另外鎖住守恆、擾動、機制計數與
 * 視窗統計經 `ModuleTestKit` 介面運作，而且沒有 kit 時不影響 base。
 */

import { describe, expect, it } from 'vitest';
import { botResponseCommands, createFallbackPolicy, fallbackPolicy } from '../src/index.ts';
import { createBotPolicy } from '../src/policy.ts';
import type { BotModule } from '../src/modules/types.ts';
import type { BotLevel, BotPolicy } from '../src/types.ts';
import {
  allowedResponseCommands,
  botSeats,
  cloneState,
  conservationProblems,
  createWatchdog,
  DEFAULT_LIMITS,
  GAME_TIMEOUT,
  hideDifferently,
  limitsFor,
  mixedLevels,
  naiveModule,
  newBotGame,
  nextDecision,
  perturbState,
  responseCommandDrift,
  runBotGame,
  viewFor,
  waitingOnOwnOffers,
  type BotSeat,
} from './harness.ts';
import { kitsOf, type ModuleTestKit } from './modules/types.ts';
import { requireProfile, RESOURCES, seededRng, type GameState } from '@catan/rules';


const fallbackSeats = (players: number): BotSeat[] =>
  botSeats(Array.from({ length: players }, () => 'standard' as const), () => fallbackPolicy);

/** 假策略：永遠沒有動作（BotDriver 會悄悄改用保底）。 */
const idlePolicy: BotPolicy = { decide: () => null };

describe('progress watchdog', () => {
  it('counts rolls since any player last reached a personal best', () => {
    const watchdog = createWatchdog(3);
    expect(watchdog.roll([2, 2])).toBe(false); // 第一次擲骰：全部創新高
    expect(watchdog.stagnant).toBe(0);
    expect(watchdog.roll([2, 2])).toBe(false);
    expect(watchdog.roll([2, 2])).toBe(false);
    expect(watchdog.stagnant).toBe(2);
    expect(watchdog.roll([2, 3])).toBe(false); // 任一位創新高就歸零
    expect(watchdog.stagnant).toBe(0);
    expect(watchdog.longest).toBe(2);
  });

  it('does not reset when a score only recovers to its old high', () => {
    // 失去城市、最長道路易手都會讓分數下降；回到原本的高點不是進度。
    const watchdog = createWatchdog(3);
    watchdog.roll([5, 4]);
    expect(watchdog.roll([3, 4])).toBe(false);
    expect(watchdog.roll([5, 4])).toBe(false);
    expect(watchdog.stagnant).toBe(2);
    expect(watchdog.roll([5, 4])).toBe(true);
    // 超過先前的最高分才算。
    expect(watchdog.roll([6, 4])).toBe(false);
    expect(watchdog.stagnant).toBe(0);
  });

  it('trips on a deliberately stuck policy that never builds', () => {
    // 假策略：只擲骰與結束回合（保底），永遠不得分；沒有看門狗時會一直跑到步數上限。
    const run = runBotGame({ seats: fallbackSeats(3), seed: 1, watchdogRolls: 8, maxSteps: 2000 });
    expect(run.watchdog).not.toBeNull();
    expect(run.watchdog!.rolls).toBe(8);
    expect(run.failure).toBeNull();
    expect(run.state.result).toBeNull();
    // 開局後的第一次擲骰就創新高（每人 2 分），之後 8 次沒有進度：一共擲 9 次。
    expect(run.steps).toBe(run.watchdog!.steps);
    expect(run.steps).toBeLessThan(200);

    const unguarded = runBotGame({ seats: fallbackSeats(3), seed: 1, watchdogRolls: null, maxSteps: 400 });
    expect(unguarded.watchdog).toBeNull();
    expect(unguarded.steps).toBe(400);
    expect(unguarded.longestStagnation).toBe(0);
  }, GAME_TIMEOUT);

  it('trips when every seat idles and the fallback only rolls and ends', () => {
    // 假策略一直閒置，BotDriver 改用保底：整桌卡在無進度的回合循環。
    const seats = botSeats(['standard', 'standard', 'standard'], () => idlePolicy);
    const run = runBotGame({ seats, seed: 2, watchdogRolls: 6, maxSteps: 2000 });
    expect(run.watchdog?.rolls).toBe(6);
    expect(run.state.result).toBeNull();
    // 同時被仿 BotDriver 模式標出來：這些指令全都是保底送的。
    expect(run.idleFallbacks.length).toBe(run.steps);
  }, GAME_TIMEOUT);

  it('does not trip on a healthy game, and records the longest stagnation', () => {
    const seats = botSeats(mixedLevels(3, 8), (level) => createBotPolicy(level));
    const run = runBotGame({ seats, seed: 8 });
    expect(run.watchdog).toBeNull();
    expect(run.state.result?.reason).toBe('victory');
    expect(run.longestStagnation).toBeGreaterThan(0);
    expect(run.longestStagnation).toBeLessThan(limitsFor('base-2025').watchdogRolls);
  }, GAME_TIMEOUT);

  it('takes the step cap and N from the profile', () => {
    expect(limitsFor('base-2025')).toEqual(DEFAULT_LIMITS);
    expect(limitsFor('base-paired-2025')).toEqual(DEFAULT_LIMITS);
    expect(DEFAULT_LIMITS).toEqual({ maxSteps: 5000, watchdogRolls: 60 });
  });
});

describe('BotDriver mode', () => {
  it('flags a policy that idles while the fallback has an action, and keeps playing on the fallback', () => {
    const seats = botSeats(['standard', 'standard', 'standard'], () => idlePolicy);
    const run = runBotGame({ seats, seed: 3, watchdogRolls: null, maxSteps: 60 });
    expect(run.idleFallbacks.length).toBe(60);
    expect(run.steps).toBe(60);
    expect(run.stuck).toBeNull();
    expect(run.failure).toBeNull();
    // 每一筆都記下當時的欠動作判斷（botOwesAction），和保底的判定一致。
    for (const idle of run.idleFallbacks) expect(idle.owed, `${idle.actor} ${idle.command}`).not.toBeNull();
    expect(run.idleFallbacks[0]).toMatchObject({ seq: expect.any(Number), actor: 'bot1', command: 'setup.placeBuilding' });
  }, GAME_TIMEOUT);

  it('without BotDriver mode the same idle policy just stalls (the old harness behaviour)', () => {
    const seats = botSeats(['standard', 'standard', 'standard'], () => idlePolicy);
    const run = runBotGame({ seats, seed: 3, driverMode: false, watchdogRolls: null });
    expect(run.steps).toBe(0);
    expect(run.stalled).toBe(true);
    expect(run.idleFallbacks).toEqual([]);
  }, GAME_TIMEOUT);

  it('reports both-idle as stuck, with the seat that owes an action', () => {
    // 假模組：duty 回 null 表示「歸我管、但這次不送」，保底不再替 base 送 turn.roll。
    const silentDuty: BotModule = { id: 'fake.silent', duty: () => null };
    const seats = botSeats(['standard', 'standard', 'standard'], () => idlePolicy);
    const run = runBotGame({
      seats,
      seed: 4,
      watchdogRolls: null,
      fallback: createFallbackPolicy([silentDuty]),
    });
    expect(run.stalled).toBe(true);
    expect(run.stuck).toMatchObject({ phase: 'preroll', owed: [{ id: 'bot1', action: 'preroll' }] });
    expect(run.failure).toBeNull();
    // 開局放置都由保底完成（策略一直閒置），所以閒置保底的次數等於已套用的步數。
    expect(run.idleFallbacks.length).toBe(run.steps);
    expect(run.state.result).toBeNull();
  }, GAME_TIMEOUT);

  /** 跑一局真實對局，取第一個有 open 報價的狀態（報價的提出者就是行動者）。 */
  const stateWithOpenOffer = (): GameState => {
    let captured: GameState | null = null;
    const seats = botSeats(mixedLevels(4, 2), (level) => createBotPolicy(level));
    runBotGame({
      seats,
      seed: 2,
      maxSteps: 500,
      onDecision: (state) => {
        if (!captured && state.offers.some((offer) => offer.status === 'open')) captured = cloneState(state);
      },
    });
    expect(captured, 'a game with an open offer within 500 steps').not.toBeNull();
    return captured!;
  };

  it('knows when the actor still waits on its own open offer', () => {
    const state = stateWithOpenOffer();
    const offer = state.offers.find((candidate) => candidate.status === 'open')!;
    const phases = (phase: 'collecting' | 'ready' | 'expired') => ({ [offer.id]: phase });
    expect(waitingOnOwnOffers(state, offer.from, phases('collecting'))).toBe(true);
    expect(waitingOnOwnOffers(state, offer.from, phases('ready'))).toBe(true);
    expect(waitingOnOwnOffers(state, offer.from, phases('expired'))).toBe(false);
    // 缺漏的 offerId 視為 expired（BotContext 的語意）。
    expect(waitingOnOwnOffers(state, offer.from, {})).toBe(false);
    const other = state.players.find((player) => player.id !== offer.from)!.id;
    expect(waitingOnOwnOffers(state, other, phases('collecting'))).toBe(false);
  }, GAME_TIMEOUT);

  it('does not ask the fallback while the actor waits on its own open offer', () => {
    // 直接對 nextDecision 斷言：拿掉它裡面的豁免，這個測試就會失敗。
    const state = stateWithOpenOffer();
    const offer = state.offers.find((candidate) => candidate.status === 'open')!;
    const actor = offer.from;
    const seats = botSeats(
      state.players.map(() => 'standard' as const),
      () => idlePolicy,
    );
    const asked: string[] = [];
    const spy: BotPolicy = {
      decide: (_view, ctx) => {
        asked.push(ctx.selfId);
        return ctx.selfId === actor ? { type: 'turn.end' } : null;
      },
    };
    const phasesOf = (phase: 'collecting' | 'ready' | 'expired') => (botId: string) =>
      botId === actor ? { [offer.id]: phase } : {};

    // 報價還在收集：行動者策略閒置是正常的，保底不能替它代勞；其他座位照常問保底。
    expect(nextDecision(state, seats, phasesOf('collecting'), undefined, spy)).toBeNull();
    expect(asked).not.toContain(actor);
    expect(asked.sort()).toEqual(state.players.map((player) => player.id).filter((id) => id !== actor).sort());

    // 報價已過期：行動者欠動作，保底代為送出（source 標示為 fallback）。
    asked.length = 0;
    expect(nextDecision(state, seats, phasesOf('expired'), undefined, spy)).toEqual({
      actor,
      command: { type: 'turn.end' },
      source: 'fallback',
    });
    expect(asked).toContain(actor);

    // 沒有保底（driverMode: false 的語意）時，永遠不問保底。
    expect(nextDecision(state, seats, phasesOf('expired'))).toBeNull();
  }, GAME_TIMEOUT);

  it('stops at the first rejected command and counts it', () => {
    const bad: BotPolicy = { decide: (view, ctx) => (view.turn.playerId === ctx.selfId ? { type: 'turn.end' } : null) };
    const run = runBotGame({ seats: botSeats(['standard', 'standard', 'standard'], () => bad), seed: 5 });
    expect(run.rejections).toBe(1);
    expect(run.failure).toMatchObject({ actor: 'bot1', command: { type: 'turn.end' } });
    expect(run.steps).toBe(0);
  }, GAME_TIMEOUT);
});

describe('fake modules through the real policy skeleton', () => {
  // 行動階段 duty 回 null：「歸我管、但這次不送」，所以骨架與保底都不再送 turn.end。
  const silentInAction: BotModule = {
    id: 'fake.silent-action',
    duty: (view) => (view.turn.phase === 'action' ? null : undefined),
  };
  const actorOf = (state: GameState): string => state.players[state.turn.seat]!.id;

  it('reports stuck, owing an action, when the module is given to both the policy and the fallback', () => {
    const seats = botSeats(mixedLevels(3, 1), (level) => createBotPolicy(level, { modules: [silentInAction] }));
    const run = runBotGame({
      seats,
      seed: 1,
      watchdogRolls: null,
      fallback: createFallbackPolicy([silentInAction]),
    });
    expect(run.stuck).not.toBeNull();
    expect(run.stalled).toBe(true);
    expect(run.stuck!.phase).toBe('action');
    expect(run.stuck!.owed).toEqual([{ id: actorOf(run.state), action: 'action' }]);
    expect(run.failure).toBeNull();
    expect(run.state.result).toBeNull();
  }, GAME_TIMEOUT);

  it('flags idle fallbacks when only the policy has the module and the fallback uses the registry', () => {
    const seats = botSeats(mixedLevels(3, 1), (level) => createBotPolicy(level, { modules: [silentInAction] }));
    const run = runBotGame({ seats, seed: 1, watchdogRolls: null, maxSteps: 300 });
    // 策略在行動階段閒置，保底（registry 沒有這個模組）補上 turn.end：BotDriver 會悄悄這樣做。
    expect(run.idleFallbacks.length).toBeGreaterThan(0);
    expect(run.idleFallbacks[0]).toMatchObject({ command: 'turn.end', owed: 'action' });
    expect(run.idleFallbacks.every((idle) => idle.command === 'turn.end')).toBe(true);
    expect(run.stuck).toBeNull();
    expect(run.failure).toBeNull();
    expect(run.steps).toBe(300);
  }, GAME_TIMEOUT);

  it('trips the watchdog on a module whose actions always pick turn.end', () => {
    // 每個行動階段都只結束回合，永遠不建造：沒有任何玩家創新高。
    const spin: BotModule = { id: 'fake.spin', actions: () => [{ item: { type: 'turn.end' }, score: 1e9 }] };
    const seats = botSeats(mixedLevels(4, 1), (level) => createBotPolicy(level, { modules: [spin] }));
    const run = runBotGame({ seats, seed: 1 });
    expect(run.watchdog).not.toBeNull();
    expect(run.watchdog!.rolls).toBe(limitsFor('base-2025').watchdogRolls);
    expect(run.state.result).toBeNull();
    expect(run.stuck).toBeNull();
    expect(run.failure).toBeNull();
    expect(run.steps).toBeLessThan(2000);
  }, GAME_TIMEOUT);
});

describe('module test kits', () => {
  const fakeKit = (overrides: Partial<ModuleTestKit> = {}): ModuleTestKit => ({ id: 'fake', ...overrides });

  it('picks the kits a profile runs, in rule-module order', () => {
    const a = fakeKit({ id: 'a' });
    const b = fakeKit({ id: 'b' });
    expect(kitsOf({ ruleModules: ['b', 'x', 'a'] }, [a, b])).toEqual([b, a]);
    expect(kitsOf({ ruleModules: [] }, [a, b])).toEqual([]);
  });

  it('adds module conservation to the base resource check', () => {
    const { state } = newBotGame({ profileId: 'base-2025', players: 3, seed: 1 });
    expect(conservationProblems(state)).toEqual([]);
    const leaky = cloneState(state);
    leaky.bank[RESOURCES[0]!] -= 1;
    expect(conservationProblems(leaky)).toEqual([expect.stringContaining('resource supply')]);
    const kit = fakeKit({ conservation: () => ['ships 16 > 15'] });
    expect(conservationProblems(state, [kit])).toEqual(['fake: ships 16 > 15']);
    const run = runBotGame({ seats: fallbackSeats(3), seed: 1, watchdogRolls: null, maxSteps: 30, kits: [kit] });
    expect(run.conservation).toEqual(['fake: ships 16 > 15']);
  }, GAME_TIMEOUT);

  it('runs hideDifferently and perturb of every kit, after the base ones', () => {
    const { state } = newBotGame({ profileId: 'base-2025', players: 3, seed: 1 });
    const seen: string[] = [];
    const kit = fakeKit({
      hideDifferently: (_variant, viewerId) => {
        seen.push(`hide ${viewerId}`);
        return true;
      },
      perturb: (_next, rng) => {
        seen.push(`perturb ${rng.int(1000)}`);
      },
    });
    // 沒有可交換的資源、發展卡，牌庫也只剩空的：base 沒有改動，kit 的改動仍然算數。
    const bare = cloneState(state);
    bare.devDeck = [];
    expect(hideDifferently(bare, 'bot1').changed).toBe(false);
    expect(hideDifferently(bare, 'bot1', [kit]).changed).toBe(true);
    perturbState(state, seededRng(9), [kit]);
    expect(seen).toEqual(['hide bot1', expect.stringMatching(/^perturb \d+$/)]);
    // 沒有 kit 時，擾動只消耗 base 的亂數，結果與有空 kit 清單時相同。
    expect(perturbState(state, seededRng(9))).toEqual(perturbState(state, seededRng(9), []));
  });

  it('accumulates mechanics from the events of each step, not from state.log', () => {
    let events = 0;
    const kit = fakeKit({
      mechanics: () => ({
        observe: (step) => {
          events += step.events.length;
        },
        snapshot: () => ({ events }),
      }),
    });
    const seats = botSeats(mixedLevels(4, 1), (level) => createBotPolicy(level));
    const run = runBotGame({ seats, seed: 1, kits: [kit] });
    expect(run.mechanics).toEqual({ 'fake.events': events });
    // state.log 只留最後一段（engine.ts:123、:251）；逐步累計的總數必須超過它。
    expect(events).toBeGreaterThan(run.state.log.length);
  }, GAME_TIMEOUT);

  it('tells policy commands from fallback rescues and gives the level of each seat', () => {
    const counts: Record<string, number> = {};
    const kit = fakeKit({
      mechanics: () => ({
        observe: (step) => {
          const key = `${step.level}.${step.source}`;
          counts[key] = (counts[key] ?? 0) + 1;
        },
        snapshot: () => counts,
      }),
    });
    const seats = botSeats(['standard', 'easy', 'standard'], () => idlePolicy);
    const run = runBotGame({ seats, seed: 6, watchdogRolls: null, maxSteps: 20, kits: [kit] });
    expect(run.mechanics['fake.standard.fallback']).toBeGreaterThan(0);
    expect(run.mechanics['fake.easy.fallback']).toBeGreaterThan(0);
    expect(Object.keys(run.mechanics).some((key) => key.endsWith('.policy'))).toBe(false);
  }, GAME_TIMEOUT);

  it('merges response commands and reports kits that drift from the registered module', () => {
    const profile = requireProfile('base-2025');
    const kit = fakeKit({ responseCommands: ['fake.respond'] });
    expect(allowedResponseCommands(profile).has('fake.respond')).toBe(false);
    expect(allowedResponseCommands(profile, [kit]).has('fake.respond')).toBe(true);
    for (const type of botResponseCommands(profile)) expect(allowedResponseCommands(profile, [kit]).has(type)).toBe(true);
    // base 沒有註冊 `fake.respond`：kit 宣告了但模組沒有，視為漂移。
    expect(responseCommandDrift(profile, [kit])).toEqual(['fake: fake.respond']);
    expect(responseCommandDrift(profile, [])).toEqual([]);
  });
});

describe('window statistics', () => {
  it('counts the most commands one seat sends in one action window', () => {
    const perWindow = new Map<string, number>();
    const seats = botSeats(mixedLevels(3, 1), (level) => createBotPolicy(level));
    const run = runBotGame({
      seats,
      seed: 1,
      onDecision: (state, decision) => {
        const key = `${state.windowId}:${decision.actor}`;
        perWindow.set(key, (perWindow.get(key) ?? 0) + 1);
      },
    });
    expect(run.maxWindowCommands).toBe(Math.max(...perWindow.values()));
    expect(run.maxWindowCommands).toBeGreaterThan(1);
  }, GAME_TIMEOUT);
});

describe('naive seats', () => {
  it('keep only the duty of a module', () => {
    const full: BotModule = {
      id: 'fake',
      supports: () => true,
      duty: () => null,
      actions: () => [],
      planStep: () => null,
      pacing: { 'fake.act': 10 },
      maxCommandsPerWindow: 80,
      responseCommands: ['fake.act'],
    };
    expect(Object.keys(naiveModule(full)).sort()).toEqual(
      ['duty', 'id', 'maxCommandsPerWindow', 'pacing', 'responseCommands', 'supports'],
    );
    expect(Object.keys(naiveModule({ id: 'bare' }))).toEqual(['id']);
  });

  it('plays a base game exactly like a seat with no modules', () => {
    const play = (policyFor: (level: BotLevel) => BotPolicy) => {
      const commands: string[] = [];
      runBotGame({
        seats: botSeats(mixedLevels(3, 9), policyFor),
        seed: 9,
        onDecision: (_state, decision) => commands.push(JSON.stringify(decision.command)),
      });
      return commands;
    };
    expect(play((level) => createBotPolicy(level, { modules: [{ id: 'fake' }].map(naiveModule) }))).toEqual(
      play((level) => createBotPolicy(level, { modules: [] })),
    );
  }, GAME_TIMEOUT);
});

describe('viewFor', () => {
  it('keeps the signature (state, playerId) and projects with hints', () => {
    const { state } = newBotGame({ profileId: 'base-2025', players: 3, seed: 1 });
    const view = viewFor(state, 'bot1');
    expect(view.hints).toBeDefined();
    expect(view.turn.playerId).toBe('bot1');
  });
});
