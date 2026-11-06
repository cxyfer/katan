/**
 * Target description and ambiguity handling (docs/SPEC.md §8.2).
 *
 * Two jobs:
 * 1. turn a raw vertex/edge/hex index into a *textual* board reference that a
 *    screen reader or a keyboard user can act on. The reference names the
 *    surrounding tiles by resource and dice number (see `references.ts`),
 *    never by the internal map index players cannot see;
 * 2. detect when several legal targets sit so close together that a click or a
 *    touch would be ambiguous, and hand back the cluster so the UI can show a
 *    magnified view or a candidate list instead of guessing.
 */

import { t } from '../i18n/index.ts';
import { distance, type Point } from './geometry.ts';
import { edgeReference, hexReference, vertexReference, type ReferenceContext } from './references.ts';
import { pipsFor, terrainLetter, terrainSymbol } from './terrain.ts';

export type TargetKind = 'vertex' | 'edge' | 'hex';

export interface TargetOption {
  kind: TargetKind;
  index: number;
  /** Textual board reference in resource (dice) form, e.g. "Lumber (6), Brick (8), Grain (5)". */
  label: string;
  /** Harbour, occupancy and production notes, e.g. "2:1 Wool · Empty". */
  detail: string;
}

export interface TargetContext extends ReferenceContext {
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

function terrainLabel(context: TargetContext, hex: number): string {
  if (context.fog?.has(hex)) return t(context.locale, 'board.tileUnexplored');
  const terrain = context.board.terrain[hex] ?? 'sea';
  return `${t(context.locale, `terrain.${terrain}`)} ${terrainSymbol(terrain)}${terrainLetter(terrain)}`;
}

function option(kind: TargetKind, index: number, label: string, parts: string[]): TargetOption {
  return { kind, index, label, detail: parts.join(' · ') };
}

export function describeVertex(context: TargetContext, index: number): TargetOption {
  const vertex = context.topology.vertices[index];
  const parts: string[] = [];
  for (const edge of vertex?.edges ?? []) {
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
  return option('vertex', index, vertexReference(context, index), parts);
}

export function describeEdge(context: TargetContext, index: number): TargetOption {
  const parts: string[] = [];
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
  return option('edge', index, edgeReference(context, index), parts);
}

export function describeHex(context: TargetContext, index: number): TargetOption {
  const parts = [terrainLabel(context, index)];
  const pips = context.fog?.has(index) ? 0 : pipsFor(context.board.numbers[index] ?? null);
  if (pips > 0) parts.push(t(context.locale, 'board.productionPips', { count: pips }));
  if (context.board.robber === index) parts.push(t(context.locale, 'board.robber'));
  if (context.board.pirate === index) parts.push(t(context.locale, 'board.pirate'));
  return option('hex', index, hexReference(context, index), parts);
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
