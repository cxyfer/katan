/**
 * S10b：世外部落、布匹產地、卡坦奇觀的 variable setup 經由服務：建 variable 房、開始、版圖符合約束；
 * 布匹產地開局先由起始玩家選強盜（`robber` 階段），選擇前後重啟都能還原，snapshot 與投影一致。
 */

import { rmSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FT_VARIABLE_RESTRICTED, WC_VARIABLE_NO_RED, getProfile, getTopology, type GameState } from '@katan/rules';
import { createClient, restartService, runSetupOverApi, startHarness, startedGame, type TestClient, type TestHarness } from './helpers.ts';

let harness: TestHarness;
beforeAll(async () => { harness = await startHarness(); });
afterAll(async () => { await harness.close(); });

const SCENARIOS = [
  ['sf-forgotten-tribe-2025', 'forgotten-tribe'],
  ['sf-cloth-for-catan-2025', 'cloth-for-catan'],
  ['sf-wonders-of-catan-2025', 'wonders-of-catan'],
] as const;

const stateOf = async (h: TestHarness, gameId: string): Promise<GameState> =>
  JSON.parse((await h.service.repo.findGame(gameId))!.state_json) as GameState;

describe('variable setup over the API (S10b)', () => {
  it('lists fixed and variable for the three scenarios', async () => {
    const host = await harness.client('VarListerB');
    const data = host.expectOk<{ profiles: { id: string; setupModes: string[] }[] }>(await host.get('/api/profiles'));
    for (const [id] of SCENARIOS) expect(data.profiles.find((profile) => profile.id === id)?.setupModes).toEqual(['fixed', 'variable']);
  });

  it('creates a variable room by ruleset parts for 3 and 4 players', async () => {
    const host = await harness.client('VarHostB');
    for (const [id, scenario] of SCENARIOS) {
      for (const capacity of [3, 4]) {
        const room = host.expectOk<{ profileId: string; setupMode: string }>(await host.post('/api/rooms', {
          visibility: 'private', capacity, setupMode: 'variable',
          ruleset: { expansions: ['seafarers'], scenario, variants: [] },
        }));
        expect(room).toMatchObject({ profileId: id, setupMode: 'variable' });
      }
    }
  });

  for (const [id, scenario] of SCENARIOS) {
    for (const players of [3, 4]) {
      it(`${scenario} ${players} 人：開局版圖是 variable 且符合約束，與 fixed 不同`, async () => {
        const { gameId } = await startedGame(harness, players, { profileId: id, setupMode: 'variable' });
        const state = await stateOf(harness, gameId);
        const layout = state.board.layout;
        const fixed = await startedGame(harness, players, { profileId: id, setupMode: 'fixed' });
        const fixedState = await stateOf(harness, fixed.gameId);
        expect(layout.numbers).not.toEqual(fixedState.board.layout.numbers);
        expect(layout.topologyId).toBe(fixedState.board.layout.topologyId);
        expect(layout.terrain.filter((tile) => tile !== 'sea')).toHaveLength(fixedState.board.layout.terrain.filter((tile) => tile !== 'sea').length);
        expect(layout.islands).toEqual(fixedState.board.layout.islands);
        expect(getProfile(id)!.setupModes).toContain('variable');
        // 強盜：S6 在選擇前暫放 12 號格，S5、S8 在沙漠。
        if (scenario === 'cloth-for-catan') {
          expect(state.turn.setup!.stage).toBe('robber');
          expect(layout.numbers[state.board.robber]).toBe(12);
        } else {
          expect(state.turn.setup!.stage).toBe('building');
          expect(layout.terrain[state.board.robber]).toBe('desert');
        }
        const cellIndex = (cell: { q: number; r: number }) =>
          getTopology(layout.topologyId).hexes.findIndex((hex) => hex.q === cell.q && hex.r === cell.r);
        if (scenario === 'wonders-of-catan') {
          // 緊鄰沙漠的 2 格（森林 9、丘陵 4 的位置）都沒有紅色圓片。
          for (const cell of WC_VARIABLE_NO_RED) expect([6, 8]).not.toContain(layout.numbers[cellIndex(cell)]);
        }
        if (scenario === 'forgotten-tribe') {
          // 大島最右邊藍框的 3 格不放 5、6、8、9。
          for (const cell of FT_VARIABLE_RESTRICTED) expect([5, 6, 8, 9]).not.toContain(layout.numbers[cellIndex(cell)]);
        }
      });
    }
  }

  it('布匹產地 variable：選強盜 → 起始玩家才能選、只能選 12 號格、選完進起始村落', async () => {
    const { clients, gameId } = await startedGame(harness, 4, { profileId: 'sf-cloth-for-catan-2025', setupMode: 'variable' });
    const state = await stateOf(harness, gameId);
    const starter = clients.find((client) => client.playerId === state.players[state.turn.setup!.order[0]!]!.id)!;
    const other = clients.find((client) => client !== starter)!;
    const twelves = state.board.layout.numbers.flatMap((n, hex) => n === 12 ? [hex] : []);
    const view = starter.expectOk<{ revision: number; view: { turn: { setup: { stage: string } }; hints: { legalSettlements: number[]; modules: { seafarers: { robberChoice: number[] } } } } }>(await starter.get(`/api/games/${gameId}`));
    expect(view.view.turn.setup.stage).toBe('robber');
    expect(view.view.hints.modules.seafarers.robberChoice).toEqual(twelves);
    expect(view.view.hints.legalSettlements).toEqual([]);
    const post = (client: TestClient, command: unknown, revision: number, id: string) =>
      client.post(`/api/games/${gameId}/commands`, { commandId: id, expectedRevision: revision, command });
    // 規則拒絕的指令回 ok + outcome 'rejected'（revision 不變）。
    const rejected = (response: Awaited<ReturnType<typeof post>>, code: string) => {
      const data = starter.expectOk<{ outcome: string; revision: number; error?: { messageId: string } }>(response as never);
      expect(data).toMatchObject({ outcome: 'rejected', revision: view.revision, error: { messageId: `error.${code}` } });
    };
    rejected(await post(other, { type: 'cloth.robber', hex: twelves[0] }, view.revision, 'c-other'), 'E_NOT_YOUR_TURN');
    rejected(await post(starter, { type: 'cloth.robber', hex: state.board.layout.numbers.findIndex((n) => n === 5) }, view.revision, 'c-bad'), 'E_ILLEGAL_TARGET');
    rejected(await post(starter, { type: 'setup.placeBuilding', vertex: 0 }, view.revision, 'c-early'), 'E_WRONG_PHASE');
    const target = twelves.find((hex) => hex !== state.board.robber)!;
    const receipt = starter.expectOk<{ revision: number }>((await post(starter, { type: 'cloth.robber', hex: target }, view.revision, 'c-ok')) as never);
    const after = await stateOf(harness, gameId);
    expect(after.board.robber).toBe(target);
    expect(after.turn.setup!.stage).toBe('building');
    const next = starter.expectOk<{ view: { hints: { legalSettlements: number[] } } }>(await starter.get(`/api/games/${gameId}`));
    expect(next.view.hints.legalSettlements.length).toBeGreaterThan(0);
    expect(receipt.revision).toBeGreaterThan(view.revision);
  });

  it('布匹產地 variable：選強盜前與設置跑完後重啟，snapshot 逐位元一致，投影的 stage 與強盜相同', async () => {
    const local = await startHarness();
    let restarted: Awaited<ReturnType<typeof restartService>> | undefined;
    try {
      const { clients, gameId } = await startedGame(local, 4, { profileId: 'sf-cloth-for-catan-2025', setupMode: 'variable' });
      const beforeChoice = (await local.service.repo.findGame(gameId))!.state_json;
      expect((JSON.parse(beforeChoice) as GameState).turn.setup!.stage).toBe('robber');
      await local.service.close();
      restarted = await restartService(local);
      expect((await restarted.repo.findGame(gameId))!.state_json).toBe(beforeChoice);
      const base = `http://127.0.0.1:${restarted.port}`;
      const host: TestClient = Object.assign(createClient(base), { cookie: clients[0]!.cookie, playerId: clients[0]!.playerId });
      const pre = host.expectOk<{ view: { turn: { setup: { stage: string } } } }>(await host.get(`/api/games/${gameId}`));
      expect(pre.view.turn.setup.stage).toBe('robber');
      // 重啟後的服務仍可選強盜並跑完設置。
      const reclients = clients.map((client) => Object.assign(createClient(base), { cookie: client.cookie, playerId: client.playerId })) as TestClient[];
      const done = await runSetupOverApi(reclients, gameId);
      expect(done.view.turn.phase).not.toBe('setup');
      const saved = (await restarted.repo.findGame(gameId))!.state_json;
      const state = JSON.parse(saved) as GameState;
      expect(state.board.layout.numbers[state.board.robber]).toBe(12);
      await restarted.close();
      restarted = await restartService(local);
      expect((await restarted.repo.findGame(gameId))!.state_json).toBe(saved);
      const base2 = `http://127.0.0.1:${restarted.port}`;
      const again: TestClient = Object.assign(createClient(base2), { cookie: clients[0]!.cookie, playerId: clients[0]!.playerId });
      const view = again.expectOk<{ view: { board: { robber: number; topologyId: string } } }>(await again.get(`/api/games/${gameId}`));
      expect(view.view.board.robber).toBe(state.board.robber);
    } finally {
      if (restarted) await restarted.close();
      else await local.service.close().catch(() => undefined);
      rmSync(local.dataDir, { recursive: true, force: true });
    }
  }, 90_000);

  for (const [id, scenario] of SCENARIOS.filter(([, name]) => name !== 'cloth-for-catan')) {
    it(`${scenario} variable：設置跑完、重啟後 snapshot 一致`, async () => {
      const local = await startHarness();
      let restarted: Awaited<ReturnType<typeof restartService>> | undefined;
      try {
        const { clients, gameId } = await startedGame(local, 4, { profileId: id, setupMode: 'variable' });
        await runSetupOverApi(clients, gameId);
        const saved = (await local.service.repo.findGame(gameId))!.state_json;
        await local.service.close();
        restarted = await restartService(local);
        expect((await restarted.repo.findGame(gameId))!.state_json).toBe(saved);
      } finally {
        if (restarted) await restarted.close();
        else await local.service.close().catch(() => undefined);
        rmSync(local.dataDir, { recursive: true, force: true });
      }
    }, 60_000);
  }
});
