/**
 * Seafarers 的 ModuleTestKit（SF 計畫 §5 SF-3、§6.1）。
 *
 * 提供：
 * - conservation：資源守恆（19×5 與 24×5）、道路與船各 ≤ 15；
 * - hideDifferently：SF 無額外隱藏資訊；
 * - perturb：隨機擾動船、海盜位置、gold frame、freeRoads、moveRobber；並約半數的擲骰前狀態會佈置成
 *   「騎士打海盜」情境（見 `stageKnightPirate`），讓 fuzz 確實走到移動海盜的指令；
 * - responseCommands：宣告 `gold.choose`；
 * - mechanics：造船、移船、setup 放船、小島聚落與加分、gold 張數、強盜與海盜的移動、含船的最長路線。
 */

import {
  isLandHex,
  longestRouteLength,
  RESOURCES,
  requireProfile,
  topologyOf,
  type FreeRoadsPending,
  type GameState,
  type ModulePending,
  type MoveRobberPending,
  type Rng,
} from '@catan/rules';
import type { MechanicsStep, MechanicsTally, ModuleTestKit } from './types.ts';

class SeafarersMechanicsTally implements MechanicsTally {
  private shipsBuilt = 0;
  private paidShips = 0;
  private standardPaidShips = 0;
  private easyPaidShips = 0;
  private shipsMoved = 0;
  private standardShipsMoved = 0;
  private setupShips = 0;
  private islandSettlements = 0;
  private islandBonuses = 0;
  private goldCards = 0;
  /** 策略輪次中送出 gold.choose 的次數；包含策略自行作答與保底代答的答案。 */
  private goldChoices = 0;
  private robberMoves = 0;
  private pirateMoves = 0;
  private lastState: GameState | null = null;

  observe(step: MechanicsStep): void {
    this.lastState = step.after;
    const { level, command, source, after, events } = step;

    if (command.type === 'gold.choose' && source === 'policy') {
      this.goldChoices += 1;
    }

    for (const event of events) {
      switch (event.type) {
        case 'ship.built': {
          this.shipsBuilt += 1;
          if (event.params.free !== true) {
            this.paidShips += 1;
            if (source === 'policy') {
              if (level === 'standard') this.standardPaidShips += 1;
              if (level === 'easy') this.easyPaidShips += 1;
            }
          }
          break;
        }
        case 'setup.ship': {
          this.setupShips += 1;
          break;
        }
        case 'ship.moved': {
          this.shipsMoved += 1;
          if (source === 'policy' && level === 'standard') {
            this.standardShipsMoved += 1;
          }
          break;
        }
        case 'island.bonus': {
          this.islandBonuses += 1;
          break;
        }
        case 'build.settlement': {
          const vertex = event.params.vertex;
          if (typeof vertex === 'number') {
            const topo = topologyOf(after);
            const onSmallIsland = topo.vertices[vertex]?.hexes.some(
              (hex) => (after.board.layout.islands[hex] ?? 0) > 1,
            );
            if (onSmallIsland) {
              this.islandSettlements += 1;
            }
          }
          break;
        }
        case 'gold.chosen': {
          const resources = event.params.resources;
          if (Array.isArray(resources)) {
            this.goldCards += resources.length;
          }
          break;
        }
        case 'robber.moved': {
          this.robberMoves += 1;
          break;
        }
        case 'pirate.moved': {
          this.pirateMoves += 1;
          break;
        }
        case 'dev.knight': {
          if (event.params.pirate !== true) {
            this.robberMoves += 1;
          }
          break;
        }
      }
    }
  }

  snapshot(): Readonly<Record<string, number>> {
    let longestRoadIncludesShips = 0;
    const holderId = this.lastState?.awards?.longestRoad;
    if (holderId && this.lastState) {
      const withShips = longestRouteLength(this.lastState, holderId, true);
      const withoutShips = longestRouteLength(this.lastState, holderId, false);
      if (withShips > withoutShips) longestRoadIncludesShips = 1;
    }

    return {
      shipsBuilt: this.shipsBuilt,
      paidShips: this.paidShips,
      standardPaidShips: this.standardPaidShips,
      easyPaidShips: this.easyPaidShips,
      shipsMoved: this.shipsMoved,
      standardShipsMoved: this.standardShipsMoved,
      setupShips: this.setupShips,
      islandSettlements: this.islandSettlements,
      islandBonuses: this.islandBonuses,
      goldCards: this.goldCards,
      goldChoices: this.goldChoices,
      robberMoves: this.robberMoves,
      pirateMoves: this.pirateMoves,
      longestRoadIncludesShips,
    };
  }
}

/** 佈置「騎士打海盜」情境的機率：擲骰前、沒有待決效果的狀態中，每 KNIGHT_PIRATE_ODDS 個佈置 1 個。 */
const KNIGHT_PIRATE_ODDS = 2;
/** 情境中行動者至少湊齊的船料（木材＋羊毛各一艘船），銀行不夠時盡量補。 */
const SHIP_MATERIAL = 3;

/**
 * 行動者船隊「開放端」前方的海域：開放端是沒有自己的建築、也沒有接自己別艘船的船端頂點。
 * 該頂點周圍的三個 hex 中，不鄰接這艘船的那一個，同時鄰接往前延伸的兩條邊，海盜停在那裡
 * 就把這個船端的前進路線全部擋住。只看幾何，不借用 bot 的評分，測試不會跟著策略的內部公式繞圈。
 */
function routeBlockingSeas(state: GameState, actorId: string): number[] {
  const topo = topologyOf(state);
  const { roads, buildings } = state.board;
  const out = new Set<number>();
  roads.forEach((road, edge) => {
    if (!road || !road.ship || road.player !== actorId) return;
    const own = topo.edges[edge]!;
    for (const vertex of own.vertices) {
      if (buildings[vertex]?.player === actorId) continue;
      const info = topo.vertices[vertex]!;
      const linked = info.edges.some((other) => {
        const piece = roads[other];
        return other !== edge && !!piece && piece.ship && piece.player === actorId;
      });
      if (linked) continue;
      for (const hex of info.hexes) {
        if (!own.hexes.includes(hex) && !isLandHex(state, hex) && hex !== state.board.pirate) out.add(hex);
      }
    }
  });
  return [...out].sort((x, y) => x - y);
}

/** 從牌堆（沒有時從別人手上）取一張騎士給行動者；都沒有時回 false。總牌數與騎士數不變。 */
function giveKnight(state: GameState, actorIdx: number): boolean {
  const actor = state.players[actorIdx]!;
  if (actor.devCards.includes('knight')) return true;
  const deckIdx = state.devDeck.indexOf('knight');
  if (deckIdx >= 0) {
    state.devDeck.splice(deckIdx, 1);
    actor.devCards.push('knight');
    return true;
  }
  for (const other of state.players) {
    if (other === actor) continue;
    const held = other.devCards.indexOf('knight');
    if (held >= 0) {
      other.devCards.splice(held, 1);
      actor.devCards.push('knight');
      return true;
    }
  }
  return false;
}

/**
 * 「出騎士卡、移動海盜」的情境（issue #133）：隨機擾動幾乎不會同時湊齊騎士、擲骰前階段、沒有待決效果、
 * 而且海盜正好擋住行動者的航線，所以這條路徑在 fuzz 中的覆蓋曾經是 0。
 *
 * 只佈置擲骰前、沒有待決效果的狀態（騎士只能在擲骰前/行動階段打出，bot 只在擲骰前打），
 * 其餘維持原本的隨機擾動：
 * - 行動者持有可打的騎士，而且本回合尚未打過發展卡；
 * - 海盜移到行動者船隊開放端前方的海域（`routeBlockingSeas`；沒有船、沒有海域可擋就不佈置）；
 * - 行動者的木材、羊毛從銀行補到 `SHIP_MATERIAL`（資源總量不變），船才付得起，騎士才值得打。
 * 回傳是否佈置了情境；是否真的走到移動海盜仍由 bot 自己決定（`odds` 為 1 時一律佈置）。
 */
export function stageKnightPirate(state: GameState, rng: Rng, odds = KNIGHT_PIRATE_ODDS): boolean {
  if (state.turn.phase !== 'preroll' || state.pending) return false;
  if (odds > 1 && rng.int(odds) !== 0) return false;
  const actor = state.players[state.turn.seat];
  if (!actor) return false;
  const seas = routeBlockingSeas(state, actor.id);
  if (seas.length === 0 || !giveKnight(state, state.turn.seat)) return false;
  state.board.pirate = seas[rng.int(seas.length)]!;
  state.turn.devCardPlayed = false;
  for (const resource of ['lumber', 'wool'] as const) {
    const take = Math.min(Math.max(0, SHIP_MATERIAL - actor.resources[resource]), state.bank[resource]);
    actor.resources[resource] += take;
    state.bank[resource] -= take;
  }
  return true;
}

export const seafarersKit: ModuleTestKit = {
  id: 'seafarers',
  responseCommands: ['gold.choose'],

  conservation(state: GameState): readonly string[] {
    const problems: string[] = [];
    const profile = requireProfile(state.profileId);
    const expectedBank = profile.bankPerResource;

    for (const resource of RESOURCES) {
      const total =
        state.bank[resource] +
        state.players.reduce((sum, player) => sum + (player.resources[resource] ?? 0), 0);
      if (total !== expectedBank) {
        problems.push(`resource ${resource} supply ${total} != ${expectedBank}`);
      }
      if (state.bank[resource] < 0) {
        problems.push(`bank ${resource} < 0: ${state.bank[resource]}`);
      }
      for (const player of state.players) {
        if (player.resources[resource] < 0) {
          problems.push(`${player.id} ${resource} < 0: ${player.resources[resource]}`);
        }
      }
    }

    const maxRoads = profile.pieces.roads;
    const maxShips = profile.pieces.ships;
    for (const player of state.players) {
      const roads = state.board.roads.filter((r) => r && r.player === player.id && !r.ship).length;
      const ships = state.board.roads.filter((r) => r && r.player === player.id && r.ship).length;
      if (roads > maxRoads) problems.push(`${player.id} has ${roads} roads > ${maxRoads}`);
      if (ships > maxShips) problems.push(`${player.id} has ${ships} ships > ${maxShips}`);
    }

    return problems;
  },

  hideDifferently(_variant: GameState, _viewerId: string): boolean {
    return false;
  },

  perturb(state: GameState, rng: Rng): void {
    const seaHexes: (number | null)[] = [null];
    state.board.layout.terrain.forEach((terrain, hex) => {
      if (terrain === 'sea') seaHexes.push(hex);
    });
    state.board.pirate = seaHexes[rng.int(seaHexes.length)]!;

    const slot = state.moduleState?.seafarers as { moved?: boolean; built?: number[] } | undefined;
    if (slot) {
      slot.moved = rng.int(2) === 0;
      if (rng.int(3) === 0 && slot.built) {
        slot.built = [];
      }
    }

    const currentActor = state.players[state.turn.seat]?.id;
    const staged = stageKnightPirate(state, rng);
    if (!staged && state.turn.phase !== 'setup' && currentActor) {
      const choice = rng.int(4);
      if (choice === 0) {
        const responders = [currentActor];
        const other = state.players.find((pl) => pl.id !== currentActor);
        if (other && rng.int(2) === 0) responders.push(other.id);
        const picks: Record<string, number> = {};
        for (const id of responders) {
          picks[id] = rng.int(2) + 1;
        }
        const goldPending: ModulePending = {
          kind: 'seafarers.gold',
          module: 'seafarers',
          responders,
          data: { picks },
        };
        state.pending = goldPending;
      } else if (choice === 1) {
        const remaining = rng.int(2) + 1;
        const freeRoadsPending: FreeRoadsPending = {
          kind: 'freeRoads',
          actor: currentActor,
          remaining,
          granted: remaining,
        };
        state.pending = freeRoadsPending;
      } else if (choice === 2) {
        const moveRobberPending: MoveRobberPending = {
          kind: 'moveRobber',
          actor: currentActor,
          cause: 'seven',
          pirate: false,
        };
        state.pending = moveRobberPending;
      }
    }

    if (
      !state.pending &&
      (state.turn.phase === 'preroll' || state.turn.phase === 'action') &&
      !state.turn.devCardPlayed &&
      currentActor &&
      rng.int(2) === 0
    ) {
      const actorPlayer = state.players[state.turn.seat];
      if (actorPlayer) {
        const knightIdx = state.devDeck.indexOf('knight');
        if (knightIdx >= 0) {
          state.devDeck.splice(knightIdx, 1);
          actorPlayer.devCards.push('knight');
        }
      }
    }
  },

  mechanics(): MechanicsTally {
    return new SeafarersMechanicsTally();
  },
};
