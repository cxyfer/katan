/** 棋盤位置以「資源（骰子）」描述，取代玩家看不到的地圖編號。 */

import { describe, expect, it } from 'vitest';
import { getTopology, type PublicBoardView } from '@catan/rules';
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
});
