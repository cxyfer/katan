import { buildBaseLayout, getTopology, seededRng, type PublicBoardView } from '@catan/rules';
import type { BoardSceneInput } from './render-contract.ts';

export const ISLAND_PREVIEW_PLAYERS: BoardSceneInput['players'] = [
  { id: 'display-red', seat: 0, color: 'red' },
  { id: 'display-blue', seat: 1, color: 'blue' },
  { id: 'display-orange', seat: 2, color: 'orange' },
  { id: 'display-white', seat: 3, color: 'white' },
];

/** Deterministic public model display; it has no session, rules state or commands. */
export function createIslandPreviewBoard(topologyId: 'hex-r2' | 'hex-r56' = 'hex-r2'): PublicBoardView {
  const topology = getTopology(topologyId);
  const layout = buildBaseLayout({ topology, mode: 'fixed', rng: seededRng(7) });
  const board: PublicBoardView = {
    topologyId: layout.topologyId,
    terrain: layout.terrain.slice(), numbers: layout.numbers.slice(),
    harbors: layout.harbors.map(({ edge, type }) => ({ edge, type })),
    islands: layout.islands.slice(), robber: layout.robber, pirate: null,
    buildings: topology.vertices.map(() => null), roads: topology.edges.map(() => null),
  };
  const center = topology.hexes.reduce((sum, hex) => ({ x: sum.x + hex.x / topology.hexes.length,
    y: sum.y + hex.y / topology.hexes.length }), { x: 0, y: 0 });
  const candidates = topology.vertices.map((vertex, index) => ({ ...vertex, index }))
    .filter((vertex) => vertex.hexes.length === 3);
  const chosen: typeof candidates = [];
  // Spread the pieces through the interior so each roof and road stays legible.
  while (chosen.length < 8 && candidates.length) {
    candidates.sort((a, b) => {
      const separation = (vertex: typeof a) => chosen.length
        ? Math.min(...chosen.map((other) => Math.hypot(vertex.x - other.x, vertex.y - other.y)))
        : Math.hypot(vertex.x - center.x, vertex.y - center.y);
      return separation(b) - separation(a) || a.index - b.index;
    });
    const vertex = candidates.shift()!;
    chosen.push(vertex);
    const player = ISLAND_PREVIEW_PLAYERS[(chosen.length - 1) % ISLAND_PREVIEW_PLAYERS.length]!.id;
    board.buildings[vertex.index] = { player, city: chosen.length > 4 };
    for (const edge of vertex.edges.slice(0, 2)) {
      if (!board.roads[edge]) board.roads[edge] = { player, ship: false };
    }
  }
  return board;
}
