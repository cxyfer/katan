import { RESOURCES, type GameView } from '@katan/rules';
import { isFreeSpot, isLandEdge, type BoardModel } from '../board.ts';

/** 從公開盤面推算基本版對手在行動階段的建造位置與港口匯率。 */
export function rivalHints(model: BoardModel): NonNullable<GameView['hints']> {
  const { selfId, topo, harborAt, view: { board: { buildings, roads } } } = model;
  const bankRates = { lumber: 4, brick: 4, wool: 4, grain: 4, ore: 4 };
  const legalCities: number[] = [];
  const legalSettlements: number[] = [];
  const legalRoads: number[] = [];
  const connected = new Uint8Array(topo.vertices.length);
  const roadCandidates = new Uint8Array(topo.edges.length);
  let generic = false;
  for (let edge = 0; edge < topo.edges.length; edge++) {
    const road = roads[edge];
    if (road?.player !== selfId || road.ship) continue;
    const [from, to] = topo.edges[edge]!.vertices;
    connected[from] = 1;
    connected[to] = 1;
  }
  for (let vertex = 0; vertex < topo.vertices.length; vertex++) {
    const building = buildings[vertex];
    if (building) {
      if (building.player !== selfId) continue;
      if (!building.city) legalCities.push(vertex);
      const harbor = harborAt[vertex];
      if (harbor === 'generic') generic = true;
      else if (harbor) bankRates[harbor] = 2;
    } else {
      if (!connected[vertex]) continue;
      if (isFreeSpot(model, vertex)) legalSettlements.push(vertex);
    }
    for (const edge of topo.vertices[vertex]!.edges) {
      if (!roads[edge]) roadCandidates[edge] = 1;
    }
  }
  if (generic) {
    for (const resource of RESOURCES) bankRates[resource] = Math.min(bankRates[resource], 3);
  }
  for (let edge = 0; edge < topo.edges.length; edge++) {
    if (roadCandidates[edge] && isLandEdge(model, edge)) legalRoads.push(edge);
  }
  return { bankRates, legalSettlements, legalRoads, legalCities, canRoll: false, canEndTurn: false, pendingKind: null };
}
