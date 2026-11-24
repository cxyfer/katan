/**
 * S10a：四島群島、未知海域、穿越荒漠的 variable setup 經由服務：建 variable 房、開始、
 * 版圖符合約束、設置階段跑完、重啟後 snapshot 還原版圖與狀態一致。
 */

import { rmSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getProfile, getTopology, type GameState } from '@katan/rules';
import { createClient, restartService, runSetupOverApi, startHarness, startedGame, type TestClient, type TestHarness } from './helpers.ts';

let harness: TestHarness;
beforeAll(async () => { harness = await startHarness(); });
afterAll(async () => { await harness.close(); });

const SCENARIOS = [
  ['sf-four-islands-2025', 'four-islands'],
  ['sf-fog-islands-2025', 'fog-islands'],
  ['sf-through-the-desert-2025', 'through-the-desert'],
] as const;

const isRed = (disc: number | null): boolean => disc === 6 || disc === 8;

describe('variable setup over the API', () => {
  it('lists fixed and variable for the three scenarios', async () => {
    const host = await harness.client('VarLister');
    const data = host.expectOk<{ profiles: { id: string; setupModes: string[] }[] }>(await host.get('/api/profiles'));
    for (const [id] of SCENARIOS) expect(data.profiles.find((profile) => profile.id === id)?.setupModes).toEqual(['fixed', 'variable']);
  });

  it('creates a variable room by ruleset parts and rejects an unsupported setup mode on other profiles', async () => {
    const host = await harness.client('VarHost');
    for (const [id, scenario] of SCENARIOS) {
      for (const capacity of [3, 4]) {
        const room = host.expectOk<{ profileId: string; setupMode: string }>(await host.post('/api/rooms', {
          visibility: 'private', capacity, setupMode: 'variable',
          ruleset: { expansions: ['seafarers'], scenario, variants: [] },
        }));
        expect(room).toMatchObject({ profileId: id, setupMode: 'variable' });
      }
    }
    // 其他劇本（世外部落只有 fixed）仍拒絕 variable。
    const response = await host.post('/api/rooms', {
      visibility: 'private', capacity: 4, setupMode: 'variable',
      ruleset: { expansions: ['seafarers'], scenario: 'forgotten-tribe', variants: [] },
    });
    host.expectError(response, 'E_UNSUPPORTED_COMBINATION');
  });

  for (const [id, scenario] of SCENARIOS) {
    for (const players of [3, 4]) {
      it(`${scenario} ${players} 人：開局的版圖是 variable 且符合約束，與 fixed 不同`, async () => {
        const { gameId } = await startedGame(harness, players, { profileId: id, setupMode: 'variable' });
        const row = (await harness.service.repo.findGame(gameId))!;
        const state = JSON.parse(row.state_json) as GameState;
        const layout = state.board.layout;
        const fixed = await startedGame(harness, players, { profileId: id, setupMode: 'fixed' });
        const fixedState = JSON.parse((await harness.service.repo.findGame(fixed.gameId))!.state_json) as GameState;
        expect(layout.numbers).not.toEqual(fixedState.board.layout.numbers);
        expect(layout.topologyId).toBe(fixedState.board.layout.topologyId);
        const land = layout.terrain.filter((tile) => tile !== 'sea').length;
        expect(land).toBe(fixedState.board.layout.terrain.filter((tile) => tile !== 'sea').length);
        if (scenario === 'four-islands') {
          layout.terrain.forEach((tile, hex) => {
            if (tile === 'forest' || tile === 'pasture') expect([2, 3, 11, 12]).not.toContain(layout.numbers[hex]);
          });
        }
        if (scenario === 'through-the-desert') {
          layout.numbers.forEach((disc, hex) => { if (isRed(disc)) expect(layout.terrain[hex]).not.toBe('gold'); });
        }
        expect(getProfile(id)!.setupModes).toContain('variable');
      });
    }
  }

  it('穿越荒漠 variable：設置跑完、重啟後 snapshot 還原，版圖與狀態逐位元一致', async () => {
    const local = await startHarness();
    let restarted: Awaited<ReturnType<typeof restartService>> | undefined;
    try {
      const { clients, gameId } = await startedGame(local, 4, { profileId: 'sf-through-the-desert-2025', setupMode: 'variable' });
      await runSetupOverApi(clients, gameId);
      const saved = (await local.service.repo.findGame(gameId))!.state_json;
      const before = JSON.parse(saved) as GameState;
      // 起始村落只在主島（島 1）：沒有任何建築碰到外地。
      const topology = getTopology(before.board.layout.topologyId);
      before.board.buildings.forEach((building, vertex) => {
        if (!building) return;
        const islands = topology.vertices[vertex]!.hexes.filter((hex) => before.board.layout.terrain[hex] !== 'sea').map((hex) => before.board.layout.islands[hex]);
        expect(islands.every((island) => island === 1)).toBe(true);
      });
      await local.service.close();
      restarted = await restartService(local);
      expect((await restarted.repo.findGame(gameId))!.state_json).toBe(saved);
      const base = `http://127.0.0.1:${restarted.port}`;
      const host: TestClient = Object.assign(createClient(base), { cookie: clients[0]!.cookie, playerId: clients[0]!.playerId });
      const view = host.expectOk<{ revision: number; view: { board: { topologyId: string } } }>(await host.get(`/api/games/${gameId}`));
      expect(view.view.board.topologyId).toBe(before.board.layout.topologyId);
    } finally {
      if (restarted) await restarted.close();
      else await local.service.close().catch(() => undefined);
      rmSync(local.dataDir, { recursive: true, force: true });
    }
  }, 60_000);
});
