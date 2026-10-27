/** Topology registry: topology ids are stable and regenerated deterministically. */

import { buildPlayer56Topology, buildTopology, type BoardTopology } from './topology.ts';

const cache = new Map<string, BoardTopology>();

export function getTopology(id: string): BoardTopology {
  const cached = cache.get(id);
  if (cached) return cached;
  const topology = id === 'hex-r56'
    ? buildPlayer56Topology(id)
    : (() => {
        const match = /^hex-r(\d+)$/.exec(id);
        if (!match) throw new Error(`unknown topology id: ${id}`);
        return buildTopology(Number(match[1]), id);
      })();
  cache.set(id, topology);
  return topology;
}

export function registerTopology(topology: BoardTopology): void {
  cache.set(topology.id, topology);
}
