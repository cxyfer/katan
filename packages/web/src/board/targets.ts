/**
 * Target description and ambiguity handling (docs/SPEC.md §8.2).
 *
 * Two jobs:
 * 1. turn a raw vertex/edge/hex index into a *textual* board reference that a
 *    screen reader or a keyboard user can act on;
 * 2. detect when several legal targets sit so close together that a click or a
 *    touch would be ambiguous, and hand back the cluster so the UI can show a
 *    magnified view or a candidate list instead of guessing.
 */

import type { Locale } from '@catan/protocol';
import type { BoardTopology, PublicBoardView } from '@catan/rules';
import { t } from '../i18n/index.ts';
import { distance, type Point } from './geometry.ts';
import { pipsFor, terrainLetter, terrainSymbol } from './terrain.ts';

export type TargetKind = 'vertex' | 'edge' | 'hex';

export interface TargetOption {
  kind: TargetKind;
  index: number;
  /** Message id for the short label. */
  labelId: string;
  labelParams: Record<string, unknown>;
  /** Fully rendered short label, e.g. "Intersection 12". */
  label: string;
  /** Textual board reference, e.g. "between hexes 4, 5, 6 · on a 2:1 wool harbour". */
  detail: string;
}

export interface TargetContext {
  locale: Locale;
  topology: BoardTopology;
  board: PublicBoardView;
  nameOf: (playerId: string) => string;
  /** True when the viewer owns the piece at the target. */
  isSelf?: (playerId: string) => boolean;
}

function harborText(context: TargetContext, edge: number): string | null {
  const harbor = context.board.harbors.find((candidate) => candidate.edge === edge);
  if (!harbor) return null;
  if (harbor.type === 'generic') return t(context.locale, 'board.harborGeneric');
  return t(context.locale, 'board.harborResource', {
    resource: t(context.locale, `resource.${harbor.type}`),
  });
}

function hexList(context: TargetContext, hexes: readonly number[]): string {
  return t(context.locale, 'board.betweenHexes', { hexes: hexes.join(', ') });
}

function terrainLabel(context: TargetContext, hex: number): string {
  const terrain = context.board.terrain[hex] ?? 'sea';
  const number = context.board.numbers[hex];
  const symbol = terrainSymbol(terrain);
  const letter = terrainLetter(terrain);
  const name = t(context.locale, `terrain.${terrain}`);
  return number ? `${name} ${symbol}${letter} · ${number}` : `${name} ${symbol}${letter}`;
}

export function describeVertex(context: TargetContext, index: number): TargetOption {
  const vertex = context.topology.vertices[index];
  const hexes = vertex?.hexes ?? [];
  const parts: string[] = [];
  if (hexes.length > 0) parts.push(hexList(context, hexes));
  const edges = vertex?.edges ?? [];
  for (const edge of edges) {
    const harbor = harborText(context, edge);
    if (harbor) parts.push(harbor);
  }
  const building = context.board.buildings[index];
  if (building) {
    const kind = building.city ? 'board.city' : 'board.settlement';
    parts.push(
      t(context.locale, 'board.occupiedBy', {
        player: context.nameOf(building.player),
      }) + ` · ${t(context.locale, kind)}`,
    );
  } else {
    parts.push(t(context.locale, 'board.emptyTarget'));
  }
  return {
    kind: 'vertex',
    index,
    labelId: 'board.vertex',
    labelParams: { index },
    label: t(context.locale, 'board.vertex', { index }),
    detail: parts.join(' · '),
  };
}

export function describeEdge(context: TargetContext, index: number): TargetOption {
  const edge = context.topology.edges[index];
  const hexes = edge?.hexes ?? [];
  const parts: string[] = [];
  if (hexes.length === 1) {
    parts.push(`${t(context.locale, 'board.hex', { index: hexes[0] ?? 0 })}`);
  } else if (hexes.length > 1) {
    parts.push(hexList(context, hexes));
  }
  const harbor = harborText(context, index);
  if (harbor) parts.push(harbor);
  const road = context.board.roads[index];
  if (road) {
    parts.push(
      t(context.locale, 'board.occupiedBy', { player: context.nameOf(road.player) }) +
        ` · ${t(context.locale, 'board.road')}`,
    );
  } else {
    parts.push(t(context.locale, 'board.emptyTarget'));
  }
  return {
    kind: 'edge',
    index,
    labelId: 'board.edge',
    labelParams: { index },
    label: t(context.locale, 'board.edge', { index }),
    detail: parts.join(' · '),
  };
}

export function describeHex(context: TargetContext, index: number): TargetOption {
  const parts = [terrainLabel(context, index)];
  const pips = pipsFor(context.board.numbers[index] ?? null);
  if (pips > 0) parts.push(t(context.locale, 'board.productionPips', { count: pips }));
  if (context.board.robber === index) parts.push(t(context.locale, 'board.robber'));
  return {
    kind: 'hex',
    index,
    labelId: 'board.hex',
    labelParams: { index },
    label: t(context.locale, 'board.hex', { index }),
    detail: parts.join(' · '),
  };
}

export function describeTarget(
  context: TargetContext,
  kind: TargetKind,
  index: number,
): TargetOption {
  if (kind === 'vertex') return describeVertex(context, index);
  if (kind === 'edge') return describeEdge(context, index);
  return describeHex(context, index);
}

/**
 * Groups candidate indices whose projected points are closer than
 * `minDistance`. A single-element group is unambiguous and can be committed by
 * a direct click; a multi-element group must go through the picker.
 */
export function ambiguousClusters(
  candidates: readonly number[],
  points: ReadonlyMap<number, Point>,
  minDistance: number,
): number[][] {
  const remaining = candidates.filter((index) => points.has(index));
  const clusters: number[][] = [];
  const seen = new Set<number>();
  for (const index of remaining) {
    if (seen.has(index)) continue;
    const group = [index];
    seen.add(index);
    const origin = points.get(index)!;
    for (const other of remaining) {
      if (seen.has(other)) continue;
      if (distance(origin, points.get(other)!) < minDistance) {
        group.push(other);
        seen.add(other);
      }
    }
    group.sort((a, b) => a - b);
    clusters.push(group);
  }
  return clusters;
}

/**
 * Given a clicked candidate, returns the cluster it belongs to when that
 * cluster is ambiguous, otherwise `null` (commit immediately).
 */
export function ambiguousWith(
  clicked: number,
  candidates: readonly number[],
  points: ReadonlyMap<number, Point>,
  minDistance: number,
): number[] | null {
  if (!points.has(clicked)) return null;
  const origin = points.get(clicked)!;
  const group = candidates
    .filter((index) => points.has(index) && distance(origin, points.get(index)!) < minDistance)
    .sort((a, b) => a - b);
  return group.length > 1 ? group : null;
}
