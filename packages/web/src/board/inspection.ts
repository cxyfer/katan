import type { PublicBoardView } from '@catan/rules';
import type { BoardGeometry } from './geometry.ts';
import type { WorldPoint } from './render-contract.ts';
import { geometryPointToWorld, targetsFromGeometry } from './projection.ts';
import type { TargetContext, TargetKind } from './targets.ts';
import { describeTarget } from './targets.ts';
import { vertexReference } from './references.ts';
import { t } from '../i18n/index.ts';
import { pipsFor, resourceOfTerrain } from './terrain.ts';
import { harborHitPoints, harborLabelPoint, harborPlacement, harborProbePoint } from './harbor.ts';

export interface BoardInspection { kind: TargetKind | 'harbor'; index: number }
export interface InspectionElement extends BoardInspection {
  world: WorldPoint;
  outline?: WorldPoint[];
  top?: WorldPoint;
  /** World corners projected into a screen-space hull for a pointer-only target. */
  hull?: WorldPoint[];
  /** Visible point used by the browser check, independent of the hull. */
  probe?: WorldPoint;
  pointerOnly?: boolean;
}

/** Public board positions only: no player hands or hidden scoring enter inspection. */
export function inspectionElements(geometry: BoardGeometry, board: PublicBoardView, renderer: 'svg' | 'r3f'): InspectionElement[] {
  const elements: InspectionElement[] = geometry.hexes.map((hex) => ({ kind: 'hex', index: hex.index,
    world: geometryPointToWorld(geometry, { x: hex.cx, y: hex.cy }),
    outline: hex.corners.map((point) => geometryPointToWorld(geometry, point)) }));
  for (const harbor of board.harbors) {
    if (renderer !== 'r3f') continue;
    const placement = harborPlacement(geometry, harbor.edge);
    if (!placement) continue;
    // The diorama pier and boat extend out of the coastal edge. This
    // pointer-only footprint sits under roads and buildings, which can cross
    // it in screen space; the plaque below stays the focusable target.
    const hull = harborHitPoints(geometry, harbor.edge);
    const probe = harborProbePoint(geometry, harbor.edge);
    if (hull && probe) elements.push({ kind: 'harbor', index: harbor.edge, world: harborLabelPoint(placement),
      hull, probe, pointerOnly: true });
  }
  for (const target of targetsFromGeometry(geometry, 'edge', board.roads.flatMap((road, index) => road ? [index] : []))) {
    elements.push({ ...target, outline: target.endpoints ? [...target.endpoints] : undefined });
  }
  // A tall settlement/city at a harbour endpoint can overlap the seaward
  // footprint in screen space. Keep the building above that pointer-only
  // footprint; the focusable plaque is appended after the buildings instead.
  for (const target of targetsFromGeometry(geometry, 'vertex', board.buildings.flatMap((building, index) => building ? [index] : []))) {
    elements.push({ ...target, top: { ...target.world, y: renderer === 'r3f' ? 0.8 : 0 } });
  }
  // Keep the focusable plaque above buildings: it is the harbour's keyboard
  // entry point and remains small enough not to swallow the settlement itself.
  for (const harbor of board.harbors) {
    const placement = harborPlacement(geometry, harbor.edge);
    if (!placement) continue;
    elements.push({ kind: 'harbor', index: harbor.edge,
      world: renderer === 'r3f' ? harborLabelPoint(placement) : placement.midpoint });
  }
  return elements;
}

export function inspectDescription(context: TargetContext, target: BoardInspection) {
  const { board, locale, topology } = context;
  const tr = (key: string, params?: Record<string, unknown>) => t(locale, key, params);
  const kind = target.kind === 'harbor' ? 'edge' : target.kind;
  const option = describeTarget(context, kind, target.index);
  const lines: string[] = [];
  let title = option.label;
  const fogRegion = target.kind === 'hex' ? context.fog?.get(target.index) : undefined;
  if (fogRegion) {
    // An unexplored hex: only its region is public.
    lines.push(tr('ep.fog.title', { region: tr(`ep.region.${fogRegion}`) }));
  } else if (target.kind === 'hex') {
    const terrain = board.terrain[target.index] ?? 'sea';
    const number = board.numbers[target.index];
    const pips = pipsFor(number);
    const resource = resourceOfTerrain(terrain);
    lines.push(tr('board.inspectResource', { resource: resource ? tr(`resource.${resource}`) : terrain === 'gold' ? tr('board.inspectChoice') : tr('board.inspectNone') }));
    lines.push(tr('board.inspectNumber', { number: number ?? '—' }));
    lines.push(tr('board.inspectProbability', { pips, percent: (pips / 36 * 100).toFixed(1) }));
    lines.push(tr(board.robber === target.index ? 'board.inspectBlocked' : 'board.inspectUnblocked'));
    const buildings = topology.vertices.flatMap((vertex, index) => vertex.hexes.includes(target.index) && board.buildings[index] ? [index] : []);
    for (const index of pips > 0 ? buildings : []) {
      const building = board.buildings[index]!;
      lines.push(tr('board.inspectProduction', { player: context.nameOf(building.player),
        piece: tr(building.city ? 'board.city' : 'board.settlement'), count: building.city ? 2 : 1 }));
    }
  } else if (target.kind === 'vertex') {
    const building = board.buildings[target.index];
    if (building) {
      title = `${tr(building.city ? 'board.city' : 'board.settlement')} · ${option.label}`;
      lines.push(tr('board.inspectOwner', { player: context.nameOf(building.player) }));
      lines.push(tr('board.inspectPoints', { points: building.city ? 2 : 1 }));
      lines.push(tr('board.inspectYield', { count: building.city ? 2 : 1 }));
    }
  } else {
    const road = board.roads[target.index];
    if (road) {
      title = `${tr('board.road')} · ${option.label}`;
      lines.push(tr('board.inspectOwner', { player: context.nameOf(road.player) }));
    }
    const harbor = board.harbors.find((item) => item.edge === target.index);
    if (harbor) {
      if (target.kind === 'harbor') title = tr('board.harbor', { place: option.label });
      lines.push(harbor.type === 'generic' ? tr('board.harborGeneric') : tr('board.harborResource', { resource: tr(`resource.${harbor.type}`) }));
      lines.push(tr('board.inspectHarborAccess'));
      const endpoints = topology.edges[target.index]?.vertices ?? [];
      lines.push(tr('board.inspectEndpoints', {
        vertices: endpoints.length > 0 ? endpoints.map((vertex) => vertexReference(context, vertex)).join(tr('board.referenceSeparator')) : '—',
      }));
    }
  }
  return { title, detail: option.detail, lines };
}
