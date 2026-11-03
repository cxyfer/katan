/** Board geometry for Explorers & Pirates: water, fog, ship ends, harbours. */

import { topologyOf } from '../../analysis.ts';
import type { GameState } from '../../types.ts';
import { epState, isFog, siteAt, type EpHarbor, type EpShip, type ExplorersPiratesState } from './state.ts';

/** An explored sea hex: open sea, a fish shoal or the Council of Catan. */
export function isWater(state: GameState, slot: ExplorersPiratesState, hex: number): boolean {
  return state.board.layout.terrain[hex] === 'sea' && !isFog(slot, hex);
}

/** An explored terrain hex (spice farms and gold fields included). */
export function isExploredLand(state: GameState, slot: ExplorersPiratesState, hex: number): boolean {
  const terrain = state.board.layout.terrain[hex];
  return terrain !== undefined && terrain !== 'sea' && !isFog(slot, hex);
}

/**
 * A sea route (EP25 p. 10: ships move along sea hex edges). Edges of the
 * frame count as well, as in CATAN – Seafarers: a boundary edge of an
 * explored hex is one. Edges with only unexplored hexes are not routes yet.
 */
export function isSeaRoute(state: GameState, edge: number): boolean {
  const slot = epState(state);
  const info = topologyOf(state).edges[edge];
  if (!info) return false;
  if (info.hexes.some((hex) => isWater(state, slot, hex))) return true;
  return info.hexes.length === 1 && !isFog(slot, info.hexes[0]!);
}

export function vertexTouchesFog(state: GameState, vertex: number): boolean {
  const slot = epState(state);
  return topologyOf(state).vertices[vertex]!.hexes.some((hex) => isFog(slot, hex));
}

/** Unexplored hexes at either end of an edge (EP25 p. 12: a ship there explores them). */
export function fogAtEnds(state: GameState, edge: number): number[] {
  const slot = epState(state);
  const topo = topologyOf(state);
  const out = new Set<number>();
  for (const vertex of topo.edges[edge]!.vertices) {
    for (const hex of topo.vertices[vertex]!.hexes) if (isFog(slot, hex)) out.add(hex);
  }
  return [...out].sort((a, b) => a - b);
}

export function shipEnds(state: GameState, ship: EpShip): readonly [number, number] {
  return topologyOf(state).edges[ship.edge]!.vertices;
}

/** Hexes one of the ship's ends touches (EP25 p. 11: "one end of the ship is adjacent to the hex"). */
export function hexesAtShip(state: GameState, ship: EpShip): number[] {
  const topo = topologyOf(state);
  const out = new Set<number>();
  for (const vertex of shipEnds(state, ship)) for (const hex of topo.vertices[vertex]!.hexes) out.add(hex);
  return [...out].sort((a, b) => a - b);
}

export function harborAt(slot: ExplorersPiratesState, vertex: number): EpHarbor | undefined {
  return slot.harbors.find((harbor) => harbor.vertex === vertex);
}

/** The player's harbour settlements at the ship's ends. */
export function harborsAtShip(state: GameState, ship: EpShip): EpHarbor[] {
  const slot = epState(state);
  return shipEnds(state, ship)
    .map((vertex) => harborAt(slot, vertex))
    .filter((harbor): harbor is EpHarbor => !!harbor && harbor.player === ship.player);
}

export function shipsOnEdge(slot: ExplorersPiratesState, edge: number): EpShip[] {
  return slot.ships.filter((ship) => ship.edge === edge);
}

/** Hexes that border the starting island (no pirate there, EP25 p. 8). */
export function bordersStartIsland(state: GameState, slot: ExplorersPiratesState, hex: number): boolean {
  const topo = topologyOf(state);
  const corners = new Set(topo.vertices.flatMap((vertex, index) => (vertex.hexes.includes(hex) ? [index] : [])));
  for (const vertex of corners) {
    if (topo.vertices[vertex]!.hexes.some((other) => slot.startIsland.includes(other))) return true;
  }
  return false;
}

/** Corners of a hex. */
export function cornersOf(state: GameState, hex: number): number[] {
  const topo = topologyOf(state);
  const out: number[] = [];
  topo.vertices.forEach((vertex, index) => {
    if (vertex.hexes.includes(hex)) out.push(index);
  });
  return out;
}

/**
 * The Council's anchors: its top and bottom intersections (EP25 p. 4,
 * EP25-M p. 17).
 */
export function councilAnchors(state: GameState, slot: ExplorersPiratesState): number[] {
  if (slot.council === null) return [];
  const topo = topologyOf(state);
  const centre = topo.hexes[slot.council]!;
  return cornersOf(state, slot.council).filter((vertex) => {
    const info = topo.vertices[vertex]!;
    return Math.abs(info.x - centre.x) < 1e-3;
  });
}

/** Coastal intersection: next to explored water or on the frame (EP25 p. 9). */
export function isCoastalVertex(state: GameState, vertex: number): boolean {
  const slot = epState(state);
  const info = topologyOf(state).vertices[vertex]!;
  if (info.hexes.some((hex) => isWater(state, slot, hex))) return true;
  return info.edges.some((edge) => topologyOf(state).edges[edge]!.hexes.length === 1);
}

/** A site the player may not build on yet: an uncaptured lair, or a spice farm without their crew. */
export function closedSite(state: GameState, hex: number, playerId: string): boolean {
  const site = siteAt(epState(state), hex);
  if (!site) return false;
  if (site.kind === 'lair') return !site.captured;
  if (site.kind === 'spice') return !site.crews.includes(playerId);
  return false;
}
