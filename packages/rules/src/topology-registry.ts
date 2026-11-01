/**
 * Topology registry: topology ids are stable and regenerated deterministically.
 *
 * `hex-rN` and `hex-r56` are generated; scenario maps register an explicit
 * `TopologyDefinition` under their own id and are built on first use.
 */

import { ARCHIPELAGO_TOPOLOGY } from './sample-boards.ts';
import {
  buildPlayer56Topology,
  buildTopology,
  buildTopologyFromHexes,
  type BoardTopology,
  type TopologyDefinition,
} from './topology.ts';

const cache = new Map<string, BoardTopology>();
const definitions = new Map<string, TopologyDefinition>([[ARCHIPELAGO_TOPOLOGY.id, ARCHIPELAGO_TOPOLOGY]]);

export function getTopology(id: string): BoardTopology {
  const cached = cache.get(id);
  if (cached) return cached;
  const definition = definitions.get(id);
  const topology = definition
    ? buildTopologyFromHexes(definition)
    : id === 'hex-r56'
      ? buildPlayer56Topology(id)
      : (() => {
          const match = /^hex-r(\d+)$/.exec(id);
          if (!match) throw new Error(`unknown topology id: ${id}`);
          return buildTopology(Number(match[1]), id);
        })();
  cache.set(id, topology);
  return topology;
}

/** Registers an explicit board shape under a stable id (scenario maps). */
export function registerTopologyDefinition(definition: TopologyDefinition): void {
  const existing = definitions.get(definition.id);
  if (existing === definition) return;
  if (existing || /^hex-r(\d+|56)$/.test(definition.id)) {
    throw new Error(`topology id already registered: ${definition.id}`);
  }
  definitions.set(definition.id, definition);
}

export function registerTopology(topology: BoardTopology): void {
  cache.set(topology.id, topology);
}
