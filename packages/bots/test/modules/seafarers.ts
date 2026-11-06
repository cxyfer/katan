/**
 * Seafarers 的 ModuleTestKit（SF 計畫 §5 SF-3、§6.1）。
 *
 * 提供：
 * - conservation：資源守恆（19×5 與 24×5）、道路與船各 ≤ 15；
 * - hideDifferently：SF 無額外隱藏資訊；
 * - perturb：隨機擾動船、海盜位置、gold frame、freeRoads、moveRobber；
 * - responseCommands：宣告 `gold.choose`；
 * - mechanics：造船、移船、setup 放船、小島聚落與加分、gold 張數、強盜與海盜的移動、含船的最長路線。
 */

import {
  RESOURCES,
  requireProfile,
  topologyOf,
  type GameState,
  type ModulePending,
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
  private policyGoldChoices = 0;
  private robberMoves = 0;
  private pirateMoves = 0;
  private lastState: GameState | null = null;

  observe(step: MechanicsStep): void {
    this.lastState = step.after;
    const { level, command, source, after, events } = step;

    if (command.type === 'gold.choose' && source === 'policy') {
      this.policyGoldChoices += 1;
    }

    for (const event of events) {
      switch (event.type) {
        case 'ship.built': {
          this.shipsBuilt += 1;
          const e = event as { free?: boolean };
          if (!e.free) {
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
          const e = event as unknown as { vertex: number };
          const topo = topologyOf(after);
          const onSmallIsland = topo.vertices[e.vertex]?.hexes.some(
            (hex) => (after.board.layout.islands[hex] ?? 0) > 1,
          );
          if (onSmallIsland) {
            this.islandSettlements += 1;
          }
          break;
        }
        case 'gold.chosen': {
          const e = event as { resources?: unknown[] };
          this.goldCards += e.resources?.length ?? 0;
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
          const e = event as { pirate?: boolean };
          if (e.pirate) {
            this.pirateMoves += 1;
          } else {
            this.robberMoves += 1;
          }
          break;
        }
      }
    }
  }

  snapshot(): Readonly<Record<string, number>> {
    let longestRoadIncludesShips = 0;
    const holderId = this.lastState?.awards.longestRoad;
    if (holderId && this.lastState) {
      const hasShip = this.lastState.board.roads.some((r) => r?.player === holderId && r?.ship);
      if (hasShip) longestRoadIncludesShips = 1;
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
      policyGoldChoices: this.policyGoldChoices,
      robberMoves: this.robberMoves,
      pirateMoves: this.pirateMoves,
      longestRoadIncludesShips,
    };
  }
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

    if (state.turn.phase !== 'setup' && state.players.length > 0) {
      const p = state.players[rng.int(state.players.length)]!.id;
      const choice = rng.int(4);
      if (choice === 0) {
        const responders = [p];
        const other = state.players.find((pl) => pl.id !== p);
        if (other && rng.int(2) === 0) responders.push(other.id);
        const picks: Record<string, number> = {};
        for (const id of responders) {
          picks[id] = rng.int(2) + 1;
        }
        state.pending = {
          kind: 'seafarers.gold',
          module: 'seafarers',
          responders,
          data: { picks },
        } as unknown as ModulePending;
      } else if (choice === 1) {
        state.pending = {
          kind: 'freeRoads',
          actor: p,
          count: rng.int(2) + 1,
        } as unknown as ModulePending;
      } else if (choice === 2) {
        state.pending = {
          kind: 'moveRobber',
          actor: p,
        } as unknown as ModulePending;
      }
    }
  },

  mechanics(): MechanicsTally {
    return new SeafarersMechanicsTally();
  },
};
