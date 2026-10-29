import { getTopology } from '@catan/rules';
import { describe, expect, it } from 'vitest';
import { buildGeometry } from '../src/board/geometry.ts';
import { createIslandPreviewBoard, ISLAND_PREVIEW_PLAYERS } from '../src/board/island-preview.ts';
import { roadInstances } from '../src/board/three/model-specs.ts';

describe('public island model display', () => {
  it('builds deterministic complete 19/30 tile boards with public display pieces', () => {
    for (const topologyId of ['hex-r2', 'hex-r56'] as const) {
      const board = createIslandPreviewBoard(topologyId);
      const topology = getTopology(topologyId);
      expect(board).toEqual(createIslandPreviewBoard(topologyId));
      expect(board.terrain).toHaveLength(topologyId === 'hex-r2' ? 19 : 30);
      expect(board.numbers).toHaveLength(topology.hexes.length);
      expect(board.buildings).toHaveLength(topology.vertices.length);
      expect(board.roads).toHaveLength(topology.edges.length);
      expect(board.buildings.filter(Boolean)).toHaveLength(8);
      expect(board.buildings.filter((piece) => piece?.city)).toHaveLength(4);
      const playerIds = new Set(ISLAND_PREVIEW_PLAYERS.map((player) => player.id));
      board.buildings.forEach((piece, index) => {
        if (!piece) return;
        expect(playerIds.has(piece.player)).toBe(true);
        expect(topology.vertices[index]!.hexes).toHaveLength(3);
        expect(topology.vertices[index]!.edges.some((edge) => board.roads[edge]?.player === piece.player)).toBe(true);
      });
      const roads = roadInstances(buildGeometry(topologyId), board, ISLAND_PREVIEW_PLAYERS, null);
      expect(roads.length).toBeGreaterThanOrEqual(8);
      roads.forEach((road) => {
        expect(Number.isFinite(road.rotationY)).toBe(true);
        expect(road.position.every(Number.isFinite)).toBe(true);
        expect(road.length).toBeGreaterThan(0);
      });
      expect(board.harbors).toHaveLength(topology.harborSlots.length);
      expect(board.terrain[board.robber]).toBe('desert');
    }
  });

  it('returns independent board arrays on each visit', () => {
    const first = createIslandPreviewBoard();
    const second = createIslandPreviewBoard();
    first.buildings.fill(null);
    first.terrain[0] = 'sea';
    expect(second.buildings.filter(Boolean)).toHaveLength(8);
    expect(second.terrain[0]).not.toBe('sea');
  });
});
