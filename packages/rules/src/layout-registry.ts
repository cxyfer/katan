/**
 * Layout/scenario registry. A profile names its builder with `layoutId`;
 * `createGame` asks that builder for the board instead of hard-coding the
 * base layout. A builder may pick a different registered topology than the
 * profile default (for example a per-player-count scenario map) by returning
 * a layout with that `topologyId`.
 *
 * Builders follow the engine's randomness rule: they draw only from the
 * passed `Rng`, and the resulting layout is stored in the snapshot.
 */

import { explorersPiratesLayout } from './explorers-pirates-boards.ts';
import { buildBaseLayout } from './layout.ts';
import type { ProfileDefinition, SetupMode } from './profiles.ts';
import type { Rng } from './rng.ts';
import { newShoresLayout } from './seafarers-boards.ts';
import { getTopology } from './topology-registry.ts';
import type { BoardTopology } from './topology.ts';
import type { BoardLayout } from './types.ts';

export interface LayoutContext {
  profile: ProfileDefinition;
  /** The profile's default topology. */
  topology: BoardTopology;
  mode: SetupMode;
  playerCount: number;
  rng: Rng;
}

export type LayoutBuilder = (context: LayoutContext) => BoardLayout;

const builders = new Map<string, LayoutBuilder>([
  // B25 / B56-25 fixed and variable boards, unchanged.
  ['base', ({ topology, mode, rng }) => buildBaseLayout({ topology, mode, rng })],
  // SF25 pp. 4–5 / SF56-25 p. 4 Heading for New Shores maps.
  ['sf-new-shores', (context) => newShoresLayout(context, getTopology)],
  // EP25 pp. 6–7 / EP25-M pp. 4–16 Explorers & Pirates mission maps.
  ['explorers-pirates', (context) => explorersPiratesLayout(context, getTopology)],
]);

export function registerLayoutBuilder(id: string, builder: LayoutBuilder): void {
  if (builders.has(id)) throw new Error(`layout builder already registered: ${id}`);
  builders.set(id, builder);
}

export function getLayoutBuilder(id: string): LayoutBuilder | undefined {
  return builders.get(id);
}

/** Builds the starting layout for a profile and checks it fits its topology. */
export function buildProfileLayout(
  profile: ProfileDefinition,
  options: { mode: SetupMode; playerCount: number; rng: Rng },
): BoardLayout {
  const builder = builders.get(profile.layoutId);
  if (!builder) throw new Error(`profile ${profile.id} has no registered layout builder: ${profile.layoutId}`);
  const layout = builder({ profile, topology: getTopology(profile.topologyId), ...options });
  const topology = getTopology(layout.topologyId);
  const hexes = topology.hexes.length;
  if (layout.terrain.length !== hexes || layout.numbers.length !== hexes || layout.islands.length !== hexes) {
    throw new Error(`layout ${profile.layoutId} does not match topology ${layout.topologyId}`);
  }
  return layout;
}
