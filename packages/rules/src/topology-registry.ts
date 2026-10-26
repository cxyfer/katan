/** Topology registry: topology ids are stable and regenerated deterministically. */

import { buildTopology, type BoardTopology } from './topology.ts';

const cache = new Map<string, BoardTopology>();

export function getTopology(id: string): BoardTopology {
  const cached = cache.get(id);
  if (cached) return cached;
  const match = /^hex-r(\d+)$/.exec(id);
  if (!match) throw new Error(`unknown topology id: ${id}`);
  const topology = buildTopology(Number(match[1]), id);
  cache.set(id, topology);
  return topology;
}

export function registerTopology(topology: BoardTopology): void {
  cache.set(topology.id, topology);
}
