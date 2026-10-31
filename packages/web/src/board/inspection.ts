import type { PublicBoardView } from '@catan/rules';
import type { BoardGeometry } from './geometry.ts';
import type { WorldPoint } from './render-contract.ts';
import { geometryPointToWorld, targetsFromGeometry } from './projection.ts';
import type { TargetContext, TargetKind } from './targets.ts';
import { describeTarget } from './targets.ts';
import { t } from '../i18n/index.ts';
import { pipsFor, resourceOfTerrain } from './terrain.ts';
import { harborHitOutline, harborLabelPoint, harborPlacement } from './harbor.ts';

export interface BoardInspection { kind: TargetKind | 'harbor'; index: number }
export interface InspectionElement extends BoardInspection { world: WorldPoint; outline?: WorldPoint[]; top?: WorldPoint }

/** Public board positions only: no player hands or hidden scoring enter inspection. */
export function inspectionElements(geometry: BoardGeometry, board: PublicBoardView, renderer: 'svg' | 'r3f'): InspectionElement[] {
  const elements: InspectionElement[] = geometry.hexes.map((hex) => ({ kind: 'hex', index: hex.index,
    world: geometryPointToWorld(geometry, { x: hex.cx, y: hex.cy }),
    outline: hex.corners.map((point) => geometryPointToWorld(geometry, point)) }));
  for (const target of targetsFromGeometry(geometry, 'edge', board.roads.flatMap((road, index) => road ? [index] : []))) {
    elements.push({ ...target, outline: target.endpoints ? [...target.endpoints] : undefined });
  }
  for (const target of targetsFromGeometry(geometry, 'vertex', board.buildings.flatMap((building, index) => building ? [index] : []))) {
    elements.push({ ...target, top: { ...target.world, y: renderer === 'r3f' ? 0.8 : 0 } });
  }
  for (const harbor of board.harbors) {
    const placement = harborPlacement(geometry, harbor.edge);
    if (!placement) continue;
    // The diorama pier and boat extend out of the coastal edge. SVG keeps the
    // compact token, while 3D projects the whole footprint as one hit region.
    const world = renderer === 'r3f' ? harborLabelPoint(placement) : placement.midpoint;
    const outline = renderer === 'r3f' ? harborHitOutline(geometry, harbor.edge) ?? undefined : undefined;
    elements.push({ kind: 'harbor', index: harbor.edge, world, ...(outline ? { outline } : {}) });
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
  let relatedHexes: number[] = [];
  if (target.kind === 'hex') {
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
    relatedHexes = topology.vertices[target.index]?.hexes ?? [];
    if (building) {
      title = `${tr(building.city ? 'board.city' : 'board.settlement')} · ${option.label}`;
      lines.push(tr('board.inspectOwner', { player: context.nameOf(building.player) }));
      lines.push(tr('board.inspectPoints', { points: building.city ? 2 : 1 }));
      lines.push(tr('board.inspectYield', { count: building.city ? 2 : 1 }));
    }
  } else {
    relatedHexes = topology.edges[target.index]?.hexes ?? [];
    const road = board.roads[target.index];
    if (road) {
      title = `${tr('board.road')} · ${option.label}`;
      lines.push(tr('board.inspectOwner', { player: context.nameOf(road.player) }));
    }
    const harbor = board.harbors.find((item) => item.edge === target.index);
    if (harbor) {
      if (target.kind === 'harbor') title = tr('board.harbor', { edge: target.index });
      lines.push(harbor.type === 'generic' ? tr('board.harborGeneric') : tr('board.harborResource', { resource: tr(`resource.${harbor.type}`) }));
      lines.push(tr('board.inspectHarborAccess'));
      lines.push(tr('board.inspectEndpoints', { vertices: topology.edges[target.index]?.vertices.join(', ') ?? '—' }));
    }
  }
  return { title, detail: option.detail, lines, relatedHexes };
}
