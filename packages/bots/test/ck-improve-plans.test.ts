/**
 * C&K 改良計畫（#172）：計畫清單只含「現在買得了」的改良，主軌道不選滿級或沒有大都市點的軌道。
 *
 * - (a) 下一級會拿大都市、但自己的城市都已經有大都市（rules `blocked = 'no-site'`）：計畫清單不含它，
 *   次佳的計畫成為 `plans[0]`，而且能執行。
 * - (b) 主軌道滿級：改選還沒滿級的軌道，清單不為空，指令被接受。
 * - (c) 三軌全滿：清單為空、不 throw，`mainTrack` 仍回傳有效軌道。
 * - 與 rules 的 `hints.improvements` 對照：滿級與 `no-site` 的軌道與 `trackOptions` 的缺項一致。
 */

import { describe, expect, it } from 'vitest';
import {
  actionHints,
  applyCommand,
  CK_TRACKS,
  projectGame,
  seededRng,
  type Command,
  type GameState,
  type GameView,
} from '@catan/rules';
import { ckState } from '../../rules/src/modules/citiesKnights/state.ts';
import { emptyCkGame, giveCommodities, hints, setBuilding, setImprovement, spreadVertices } from '../../rules/test/ck-helpers.ts';
import { boardModel } from '../src/board.ts';
import { turnContext } from '../src/heuristic.ts';
import { citiesKnightsBotModule } from '../src/modules/citiesKnights/index.ts';
import { consideredOptions, lacksMetropolisSite, mainTrack, trackOptions } from '../src/modules/citiesKnights/improve.ts';
import { IMPROVE_PLAN, citiesKnightsPlanStep } from '../src/modules/citiesKnights/plans.ts';
import { createBotPolicy } from '../src/policy.ts';
import type { BotCommand, BotContext, BotLevel } from '../src/types.ts';

type Track = (typeof CK_TRACKS)[number];

function viewOf(state: GameState, playerId: string): GameView {
  return projectGame(state, playerId, { hints: actionHints(state, playerId) });
}

const ctxFor = (selfId: string, level: BotLevel): BotContext => ({ selfId, level, seed: 1, offerPhases: {} });

function turnOf(state: GameState, level: BotLevel = 'standard', selfId = 'p1') {
  return turnContext(viewOf(state, selfId), ctxFor(selfId, level), level);
}

function modelOf(state: GameState, selfId = 'p1') {
  return boardModel(viewOf(state, selfId), selfId, [citiesKnightsBotModule]);
}

function improvePlans(state: GameState, level: BotLevel = 'standard') {
  return turnOf(state, level).economy.plans.filter((plan) => plan.kind.startsWith(IMPROVE_PLAN));
}

function decide(state: GameState, level: BotLevel = 'standard'): BotCommand | null {
  return createBotPolicy(level).decide(viewOf(state, 'p1'), ctxFor('p1', level));
}

/** 指令必須被引擎接受。 */
function expectAccepted(state: GameState, command: BotCommand | null | undefined): void {
  expect(command, 'p1 has a command').not.toBeNull();
  const outcome = applyCommand(state, 'p1', command as Command, seededRng(1));
  expect(outcome.ok, `${JSON.stringify(command)} → ${outcome.ok ? 'ok' : outcome.error.code}`).toBe(true);
}

/** p1 有 `cities` 座城市；`metropolises` 把各軌道的大都市放在 p1 依序的城市上。 */
function game(options: {
  cities: number;
  levels?: Partial<Record<Track, number>>;
  metropolises?: Partial<Record<Track, 'p1' | 'p2'>>;
  hand?: Parameters<typeof giveCommodities>[2];
}): GameState {
  const state = emptyCkGame(4, 0, 'action');
  const vertices = spreadVertices(state, options.cities + 1);
  const cities = vertices.slice(0, options.cities);
  for (const vertex of cities) setBuilding(state, 'p1', vertex, true);
  // p2 的城市放在最後一個點，讓「別人持有的大都市」有地方站。
  setBuilding(state, 'p2', vertices[options.cities]!, true);
  for (const [track, level] of Object.entries(options.levels ?? {}) as [Track, number][]) setImprovement(state, 'p1', track, level);
  let next = 0;
  for (const [track, holder] of Object.entries(options.metropolises ?? {}) as [Track, 'p1' | 'p2'][]) {
    const vertex = holder === 'p1' ? cities[next++]! : vertices[options.cities]!;
    ckState(state).metropolises[track] = { player: holder, vertex };
  }
  if (options.hand) giveCommodities(state, 'p1', options.hand);
  return state;
}

/** rules 判定下一級已不能買（滿級或沒有大都市點）的軌道。 */
function rulesUnavailable(state: GameState): Track[] {
  const options = hints(state, 'p1').improvements as { track: Track; blocked: string | null }[];
  return options.filter((option) => option.blocked === 'max-level' || option.blocked === 'no-site').map((option) => option.track);
}

/** 與 rules 對照：bot 的 `trackOptions` 恰好缺少那些軌道。 */
function expectMatchesRules(state: GameState): void {
  const present = trackOptions(modelOf(state)).map((option) => option.track);
  const missing = CK_TRACKS.filter((track) => !present.includes(track));
  expect([...missing].sort()).toEqual([...rulesUnavailable(state)].sort());
}

describe('C&K improvement plans skip steps the rules block (#172)', () => {
  describe('(a) the next level awards a metropolis but every city already holds one', () => {
    // science 4（大都市在唯一的城市上）、trade 3：trade 的下一級（4）會拿大都市，但沒有空的城市。
    // 手上 cloth 4（付得起）與 coin 1：舊版把 trade 排在 plans[0]（score 2.55、eta 0），永遠買不下去。
    const build = () =>
      game({
        cities: 1,
        levels: { science: 4, trade: 3 },
        metropolises: { science: 'p1' },
        hand: { cloth: 4, coin: 1 },
      });

    it('rules block the trade step as no-site and the bot sees no free site', () => {
      const state = build();
      const trade = (hints(state, 'p1').improvements as { track: string; blocked: string | null; metropolis: boolean }[]).find((o) => o.track === 'trade')!;
      expect(trade).toMatchObject({ blocked: 'no-site', metropolis: true });
      expect(lacksMetropolisSite(modelOf(state))).toBe(true);
      expectMatchesRules(state);
    });

    it('drops the blocked plan; the best executable plan is plans[0] and its step is accepted', () => {
      const state = build();
      const plans = improvePlans(state);
      expect(plans.map((plan) => plan.kind)).not.toContain(`${IMPROVE_PLAN}.trade`);
      expect(plans.length).toBeGreaterThan(0);
      expect(plans[0]!.kind).toBe(`${IMPROVE_PLAN}.politics`);
      const turn = turnOf(state);
      const command = citiesKnightsPlanStep(turn, plans[0]!) as BotCommand | null;
      expect(command).not.toBeNull();
      expectAccepted(state, command);
    });

    it('does not pick a track without a metropolis site as the main track', () => {
      const state = game({ cities: 1, levels: { science: 4, trade: 3 }, metropolises: { science: 'p1' }, hand: { cloth: 6 } });
      // trade 的下一級買不了：就算 cloth 最多，也不能是主軌道（easy 看持有量，standard 看產能與投入）。
      expect(mainTrack(modelOf(state), 'easy')).not.toBe('trade');
      expect(mainTrack(modelOf(state), 'standard')).not.toBe('trade');
      expect(trackOptions(modelOf(state)).some((option) => option.track === 'trade')).toBe(false);
      expect(consideredOptions(modelOf(state), 'standard').some((option) => option.track === 'trade')).toBe(false);
    });

    it('easy plays its next-best track instead of stalling on the blocked one', () => {
      const state = build();
      const plans = improvePlans(state, 'easy');
      expect(plans.map((plan) => plan.kind)).toEqual([`${IMPROVE_PLAN}.politics`]);
      expectAccepted(state, decide(state, 'easy'));
    });

    it('also blocks stealing a level-5 metropolis when every own city is occupied', () => {
      // p2 在 trade 持有 4 級大都市；p1 的唯一城市已有 science 大都市。trade 5 級要搶 p2 的，但沒有點可放。
      const state = game({
        cities: 1,
        levels: { science: 4, trade: 4 },
        metropolises: { science: 'p1', trade: 'p2' },
        hand: { cloth: 5 },
      });
      setImprovement(state, 'p2', 'trade', 4);
      expect(hints(state, 'p1').improvements.find((o: { track: string }) => o.track === 'trade').blocked).toBe('no-site');
      expectMatchesRules(state);
      expect(improvePlans(state).map((plan) => plan.kind)).not.toContain(`${IMPROVE_PLAN}.trade`);
    });

    it('keeps a metropolis step when a free city exists', () => {
      const state = game({ cities: 2, levels: { science: 4, trade: 3 }, metropolises: { science: 'p1' }, hand: { cloth: 4 } });
      expect(lacksMetropolisSite(modelOf(state))).toBe(false);
      expect(improvePlans(state).map((plan) => plan.kind)).toContain(`${IMPROVE_PLAN}.trade`);
      expectMatchesRules(state);
    });
  });

  describe('(b) the main track is already at the maximum level', () => {
    // 三座城市各持有一個大都市；trade 5 級（滿級）、science 與 politics 4 級（下一級 5 不會再拿大都市）。
    // 舊版主軌道選 trade（已投入最多），沒有 main 項目，science 與 politics 又被「非主軌道只升到 3 級」濾掉：清單為空。
    const build = () =>
      game({
        cities: 3,
        levels: { trade: 5, science: 4, politics: 4 },
        metropolises: { trade: 'p1', science: 'p1', politics: 'p1' },
        // cloth 很多：舊版的主軌道分數（產能 + 手牌 + 投入）因此落在滿級的 trade。
        hand: { cloth: 8, paper: 5, coin: 5 },
      });

    it('rules agree: trade is maxed, the other two can still be improved', () => {
      const state = build();
      expect(rulesUnavailable(state)).toEqual(['trade']);
      expectMatchesRules(state);
    });

    it('picks another track as main and keeps the plan list non-empty', () => {
      const state = build();
      for (const level of ['standard', 'easy'] as const) {
        const main = mainTrack(modelOf(state), level);
        expect(main, `${level} main`).not.toBe('trade');
        const options = trackOptions(modelOf(state), level);
        expect(options.filter((option) => option.main).map((option) => option.track), `${level} main option`).toEqual([main]);
        expect(improvePlans(state, level).length, `${level} plans`).toBeGreaterThan(0);
      }
    });

    it('the policy improves a non-maxed track and the command is accepted', () => {
      // 手牌在上限內（超過上限時會先去銀行換牌，是 #173 的範圍）：politics 5 級付得起。
      const state = game({
        cities: 3,
        levels: { trade: 5, science: 4, politics: 4 },
        metropolises: { trade: 'p1', science: 'p1', politics: 'p1' },
        hand: { coin: 5 },
      });
      const command = decide(state);
      expect(command).toMatchObject({ type: 'city.improve', track: 'politics' });
      expectAccepted(state, command);
    });

    it('a main track whose next level takes a metropolis keeps the role while a free city exists', () => {
      const state = game({ cities: 2, levels: { science: 3 }, hand: { paper: 4 } });
      // science 的下一級（4）會拿大都市，而且有空城市：easy 看持有量，仍選 science 當主軌道。
      expect(trackOptions(modelOf(state), 'easy').find((option) => option.track === 'science')).toMatchObject({ metropolis: true, main: true });
      expect(mainTrack(modelOf(state), 'easy')).toBe('science');
    });
  });

  describe('(c) every track is maxed', () => {
    const build = () =>
      game({
        cities: 3,
        levels: { trade: 5, science: 5, politics: 5 },
        metropolises: { trade: 'p1', science: 'p1', politics: 'p1' },
        hand: { paper: 5, cloth: 5, coin: 5 },
      });

    it('has an empty plan list and no options, without throwing', () => {
      const state = build();
      expect(rulesUnavailable(state).sort()).toEqual([...CK_TRACKS].sort());
      for (const level of ['standard', 'easy'] as const) {
        expect(improvePlans(state, level)).toEqual([]);
        expect(trackOptions(modelOf(state), level)).toEqual([]);
        expect(consideredOptions(modelOf(state), level)).toEqual([]);
      }
    });

    it('mainTrack still answers with a valid track (callers like the defender deck pick need one)', () => {
      const state = build();
      for (const level of ['standard', 'easy'] as const) expect(CK_TRACKS).toContain(mainTrack(modelOf(state), level));
    });

    it('the policy does not try to improve', () => {
      const state = build();
      const command = decide(state);
      expect(command === null || command.type !== 'city.improve').toBe(true);
    });
  });

  describe('states where nothing is blocked keep the old behaviour', () => {
    it('without any city there is no improve plan, and no track is excluded from the options', () => {
      const state = emptyCkGame(4, 0, 'action');
      giveCommodities(state, 'p1', { paper: 3 });
      expect(lacksMetropolisSite(modelOf(state))).toBe(false);
      expect(improvePlans(state)).toEqual([]);
      expect(trackOptions(modelOf(state)).map((option) => option.track)).toEqual([...CK_TRACKS]);
    });

    it('a fresh city offers all three tracks and the main track is the best-scoring one', () => {
      const state = game({ cities: 1, hand: { paper: 1, cloth: 1, coin: 1 } });
      expect(trackOptions(modelOf(state)).map((option) => option.track)).toEqual([...CK_TRACKS]);
      expectMatchesRules(state);
    });
  });
});
