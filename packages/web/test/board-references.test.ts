/** 棋盤位置以「資源（骰子）」描述，取代玩家看不到的地圖編號。 */

import { describe, expect, it } from 'vitest';
import { createGame, getTopology, projectGame, seededRng, type PublicBoardView } from '@catan/rules';
import { epView, fogRegions } from '../src/board/explorersPirates.ts';
import { createIslandPreviewBoard } from '../src/board/island-preview.ts';
import { boardReference, tileRef, type ReferenceContext, type ReferenceKind } from '../src/board/references.ts';
import { describeHex, describeVertex } from '../src/board/targets.ts';
import { fixedBoard } from '../src/test/fixtures.ts';

const KINDS: readonly ReferenceKind[] = ['hex', 'vertex', 'edge'];

function contextFor(board: PublicBoardView, locale: 'en' | 'zh-Hant' = 'en', fog?: ReferenceContext['fog']): ReferenceContext {
  return { locale, topology: getTopology(board.topologyId), board, fog };
}

function countOf(context: ReferenceContext, kind: ReferenceKind): number {
  if (kind === 'vertex') return context.topology.vertices.length;
  if (kind === 'edge') return context.topology.edges.length;
  return context.topology.hexes.length;
}

describe('board references', () => {
  const board = fixedBoard();
  const en = contextFor(board);
  const zh = contextFor(board, 'zh-Hant');

  it('names hexes, intersections and paths by resource and dice number', () => {
    expect(boardReference(en, 'hex', 0)).toBe('Ore (10)');
    expect(boardReference(en, 'hex', board.terrain.indexOf('desert'))).toBe('Desert');
    // 依產出機率排序：6 的機率最高，2 最低。
    expect(boardReference(en, 'vertex', 0)).toBe('Wool (6), Ore (10), Wool (2)');
    expect(boardReference(en, 'edge', 0)).toBe('Between Wool (6) and Ore (10)');
    expect(boardReference(zh, 'vertex', 0)).toBe('羊毛（6）、礦石（10）、羊毛（2）');
    expect(boardReference(zh, 'edge', 0)).toBe('羊毛（6）與礦石（10）之間');
  });

  it('gives every position on the base board a distinct description without map indices', () => {
    for (const kind of KINDS) {
      const labels = Array.from({ length: countOf(en, kind) }, (_, index) => boardReference(en, kind, index));
      expect(new Set(labels).size, kind).toBe(labels.length);
      for (const label of labels) expect(label).not.toMatch(/Intersection|Path|Hex|\d+(?![\d,]*\))/);
    }
  });

  it('adds the nearest other tile only where the tiles alone would repeat', () => {
    // 兩個交點都只接觸礦石（10），以各自最近的另一塊地區分。
    expect(boardReference(en, 'vertex', 3)).toBe('Ore (10) · near Grain (12)');
    expect(boardReference(en, 'vertex', 4)).toBe('Ore (10) · near Wool (2)');
    expect(boardReference(zh, 'edge', 2)).toBe('礦石（10）沿岸，靠近小麥（12）');
    // 羊毛（2）只有一個外緣交點，本身已唯一，不加提示。
    expect(boardReference(en, 'vertex', 8)).toBe('Wool (2)');
  });

  it('lists extra production numbers and names non-resource terrain without its letter code', () => {
    const extra = { ...board, extraNumbers: [{ hex: 0, number: 3 }] };
    expect(tileRef(contextFor(extra), 0)).toBe('Ore (10, 3)');
    expect(tileRef(contextFor(extra, 'zh-Hant'), 0)).toBe('礦石（10、3）');
    const terrain = board.terrain.slice();
    terrain[0] = 'gold';
    terrain[2] = 'lake';
    const special = contextFor({ ...board, terrain });
    expect(tileRef(special, 0)).toBe('Gold (10)');
    expect(tileRef(special, 2)).toBe(`Lake (${board.numbers[2]})`);
  });

  it('describes sea positions by the land they are next to', () => {
    const archipelago = createIslandPreviewBoard('sample-archipelago');
    const context = contextFor(archipelago);
    const land = (hex: number) => archipelago.terrain[hex] !== 'sea';
    const coastalSea = context.topology.hexes.findIndex((_, hex) => !land(hex)
      && context.topology.vertices.some((vertex) => vertex.hexes.includes(hex) && vertex.hexes.some(land)));
    expect(boardReference(context, 'hex', coastalSea)).toMatch(/^Sea · near .+\(\d+\)/);
    const seaEdge = context.topology.edges.findIndex((edge) => edge.hexes.length === 2 && !edge.hexes.some(land)
      && edge.vertices.some((vertex) => context.topology.vertices[vertex]!.hexes.some(land)));
    expect(boardReference(context, 'edge', seaEdge)).toMatch(/^Open sea · near /);
  });

  it('never reveals an unexplored hex, even through its neighbours', () => {
    const fog = new Map([[0, 'parrot' as const]]);
    const context = { ...contextFor(board, 'en', fog), nameOf: (id: string) => id };
    expect(boardReference(context, 'hex', 0)).toMatch(/^Unexplored/);
    expect(describeHex(context, 0).detail).not.toMatch(/Mountains|outcomes/);
    expect(describeVertex(context, 0).label).toBe('Wool (6), Wool (2)');
    for (const kind of KINDS) {
      for (let index = 0; index < countOf(context, kind); index += 1) {
        expect(boardReference(context, kind, index)).not.toContain('Ore (10)');
      }
    }
  });

  it.each(['sf-new-shores-2025', 'ep-land-ho-2025', 'ep-pirate-lairs-2025', 'tb-traders-barbarians-2025'])(
    'never gives two positions the same name on the %s board',
    (profileId) => {
      const players = Array.from({ length: 4 }, (_, seat) => ({
        id: `p${seat}`, nickname: `P${seat}`, color: (['red', 'blue', 'orange', 'white'] as const)[seat]!,
      }));
      const state = createGame({ profileId, players, setupMode: profileId.startsWith('tb-') ? 'variable' : 'fixed', rng: seededRng(4) });
      const view = projectGame(state, 'p0');
      const fog = fogRegions(epView(view));
      for (const locale of ['en', 'zh-Hant'] as const) {
        const context = contextFor(view.board, locale, fog.size > 0 ? fog : undefined);
        for (const kind of KINDS) {
          const labels = Array.from({ length: countOf(context, kind) }, (_, index) => boardReference(context, kind, index));
          const repeated = labels.filter((label, index) => labels.indexOf(label) !== index);
          expect(repeated, `${profileId} ${locale} ${kind}`).toEqual([]);
        }
      }
    },
  );

  it('orders positions that still look alike from top to bottom, then left to right', () => {
    const context = contextFor(createIslandPreviewBoard('sample-archipelago'));
    const labels = Array.from({ length: context.topology.edges.length }, (_, index) => boardReference(context, 'edge', index));
    const alike = labels.map((label, index) => ({ label, index })).filter(({ label }) => /#\d+ of \d+ alike/.test(label));
    expect(alike.length).toBeGreaterThan(0);
    for (const { label, index } of alike) {
      const [, n, total] = label.match(/#(\d+) of (\d+) alike/)!.map(Number);
      const group = alike.filter((other) => other.label.replace(/ \(#\d+ of \d+ alike\)$/, '') === label.replace(/ \(#\d+ of \d+ alike\)$/, ''));
      expect(group).toHaveLength(total!);
      const ordered = [...group].sort((a, b) => context.topology.edges[a.index]!.y - context.topology.edges[b.index]!.y
        || context.topology.edges[a.index]!.x - context.topology.edges[b.index]!.x);
      expect(ordered[n! - 1]!.index).toBe(index);
    }
  });

  it('describes paths and plazas inside a Traders & Barbarians site tile as inside, not as coast', () => {
    const players = Array.from({ length: 4 }, (_, seat) => ({
      id: `p${seat}`, nickname: `P${seat}`, color: (['red', 'blue', 'orange', 'white'] as const)[seat]!,
    }));
    const state = createGame({ profileId: 'tb-traders-barbarians-2025', players, setupMode: 'variable', rng: seededRng(4) });
    const board = projectGame(state, 'p0').board;
    const context = contextFor(board);
    const interiorEdges = context.topology.edges.flatMap((edge, index) => edge.interior ? [index] : []);
    const interiorVertices = context.topology.vertices.flatMap((vertex, index) => vertex.interior ? [index] : []);
    expect(interiorEdges.length).toBeGreaterThan(0);
    expect(interiorVertices.length).toBeGreaterThan(0);
    for (const index of interiorEdges) expect(boardReference(context, 'edge', index)).toMatch(/^Inside /);
    for (const index of interiorVertices) expect(boardReference(context, 'vertex', index)).toMatch(/^Inside /);
    expect(boardReference(contextFor(board, 'zh-Hant'), 'edge', interiorEdges[0]!)).toMatch(/內部/);
  });
});
