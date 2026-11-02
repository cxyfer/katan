/**
 * Explorers & Pirates rules module (EP25 / EP25-M, CN3085, 2025).
 *
 * Standalone E&P for 3–4 players, one profile per mission set (Land Ho!,
 * Pirate Lairs, Fish for Catan, Spices for Catan, Explorers & Pirates). The
 * base engine supplies production, the 7's discards, roads, settlements and
 * supply trades; this module adds the Movement phase, harbour settlements,
 * ships with cargo, exploration, coins, pirate ships and the missions. See
 * README.md in the parent directory for the hooks.
 */

import { topologyOf } from '../../analysis.ts';
import type { CommandOutcome, GameState, ModulePending } from '../../types.ts';
import type { EpMission } from '../../explorers-pirates-boards.ts';
import type { ModuleCommand, RulesModule } from '../types.ts';
import { EP_PIECES, epPoints, goldOf, harborsOf, piecesInPlay, plainSettlements, scenarioOf, trackLeader, TRACK_VALUES } from './core.ts';
import {
  abilityCount,
  buildHarbor,
  buildPiece,
  buildShip,
  buyResource,
  extraMove,
  fastGold,
  harborTargets,
  modifyProduction,
  pieceTargets,
  sellForGold,
  shipTargets,
  startMovement,
} from './economy.ts';
import { closedSite, councilAnchors, harborsAtShip, hexesAtShip, vertexTouchesFog } from './geometry.ts';
import { resolveCaptures } from './lairs.ts';
import {
  activeShipStranded,
  atCouncil,
  deliver,
  dropCrew,
  finishActiveShip,
  fishRoll,
  foundSettlement,
  foundTargets,
  loadFish,
  loadSpice,
  movesLeft,
  moveShip,
  pickCrew,
  stepTargets,
  swapCargo,
  transfer,
} from './movement.ts';
import {
  canChase,
  chaseNumbers,
  chasePirate,
  framePirateFrom,
  PIRATE_FRAME,
  pirateTargets,
  placePirate,
  robPlayer,
  sevenRobberStep,
  type PirateFrameData,
} from './pirate.ts';
import {
  initGame,
  setupHarbor,
  setupHarborTargets,
  setupRoad,
  setupRoadTargets,
  setupSettlementCommand,
  setupSettlementTargets,
  setupShip,
  setupShipTargets,
  setupStep,
} from './setup.ts';
import { EXPLORERS_PIRATES, epState, hasRoom, isFog, viewTurn, type EpShip } from './state.ts';

/** Base commands an E&P game never accepts: its own setup replaces them. */
const BASE_SETUP = new Set(['setup.placeBuilding', 'setup.placeRoad']);
/** Trading and building end with the Movement phase (EP25 p. 8). */
const ACTION_ONLY = new Set([
  'build.road', 'build.settlement', 'build.city', 'build.devCard',
  'trade.bank', 'trade.offer', 'trade.revise', 'trade.settle',
]);

function copy<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function fail(code: string): CommandOutcome {
  return { ok: false, error: { code, params: {} } } as CommandOutcome;
}

function vetoCommand(state: GameState, actorId: string, command: ModuleCommand): CommandOutcome | undefined {
  if (BASE_SETUP.has(command.type)) return fail('E_INVALID_COMMAND');
  if (state.turn.phase !== 'action') return undefined;
  if (viewTurn(state).phase === 'movement' && ACTION_ONLY.has(command.type)) return fail('E_EP_MOVEMENT_PHASE');
  // The ship in motion may not stay on an edge already holding two ships.
  if (command.type === 'turn.end' && state.players[state.turn.seat]?.id === actorId && activeShipStranded(state)) {
    return fail('E_EP_EDGE_FULL');
  }
  return undefined;
}

export const explorersPiratesModule: RulesModule = {
  id: EXPLORERS_PIRATES,

  initGame,
  modifyProduction,
  sevenRobberStep,
  vetoCommand,

  allowBuilding(state, playerId, vertex, options) {
    // The module places every setup piece itself.
    if (options.setup) return false;
    if (vertexTouchesFog(state, vertex)) return false;
    if (topologyOf(state).vertices[vertex]!.hexes.some((hex) => closedSite(state, hex, playerId))) return false;
    return plainSettlements(state, playerId) < EP_PIECES.settlements;
  },

  roadAllowed(state, playerId, edge) {
    const slot = epState(state);
    const hexes = topologyOf(state).edges[edge]!.hexes;
    if (hexes.some((hex) => isFog(slot, hex))) return false;
    return !hexes.some((hex) => closedSite(state, hex, playerId));
  },

  // No Longest Road or Largest Army in E&P.
  awardRules(_state, rules) {
    return { ...rules, minLongestRoad: Number.POSITIVE_INFINITY, minLargestArmy: Number.POSITIVE_INFINITY };
  },

  // Supply trades are 3:1 (EP25 p. 9); there are no harbour tokens.
  bankRate(_state, _playerId, _card, rate) {
    return Math.min(rate, 3);
  },

  // Domestic trades may include coins (EP25 p. 9, EP25-M p. 5).
  tradeGoods: {
    ids: () => ['gold'],
    balance: (state, playerId, good) => (good === 'gold' ? goldOf(epState(state), playerId) : 0),
    transfer: (state, from, to, good, amount) => {
      if (good !== 'gold') return;
      const slot = epState(state);
      slot.gold[from] = goldOf(slot, from) - amount;
      slot.gold[to] = goldOf(slot, to) + amount;
    },
  },

  onEndTurn(state, _actorId, ctx) {
    finishActiveShip(state);
    resolveCaptures(state, ctx);
    ctx.kit.checkVictory(state);
    return 'continue';
  },

  commands: {
    'ep.setupHarbor': setupHarbor,
    'ep.setupSettlement': setupSettlementCommand,
    'ep.setupRoad': setupRoad,
    'ep.setupShip': setupShip,
    'ep.buildHarbor': buildHarbor,
    'ep.buildShip': buildShip,
    'ep.buildSettler': buildPiece('settler'),
    'ep.buildCrew': buildPiece('crew'),
    'ep.sellForGold': sellForGold,
    'ep.buyResource': buyResource,
    'ep.fastGold': fastGold,
    'ep.extraMove': extraMove,
    'ep.startMovement': startMovement,
    'ep.moveShip': moveShip,
    'ep.load': transfer('load'),
    'ep.unload': transfer('unload'),
    'ep.swap': swapCargo,
    'ep.found': foundSettlement,
    'ep.dropCrew': dropCrew,
    'ep.pickCrew': pickCrew,
    'ep.loadSpice': loadSpice,
    'ep.loadFish': loadFish,
    'ep.deliver': deliver,
    'ep.fishRoll': fishRoll,
    'ep.chase': chasePirate,
    'ep.placePirate': placePirate,
    'ep.robPlayer': robPlayer,
  },
  pendingCommands: ['ep.placePirate', 'ep.robPlayer'],

  score(state, playerId) {
    const points = epPoints(state, playerId);
    // A harbour settlement is a base settlement (1 VP) plus 1 (EP25 p. 9).
    return points.harbors + Object.values(points.missions).reduce((sum, value) => sum + (value ?? 0), 0);
  },

  project(state) {
    return projectState(state);
  },

  projectPending(_state, frame) {
    if (frame.kind !== PIRATE_FRAME) return { kind: frame.kind, module: frame.module, responders: frame.responders.slice(), data: {} };
    const data = frame.data as unknown as PirateFrameData;
    return {
      kind: frame.kind,
      module: frame.module,
      responders: frame.responders.slice(),
      data: { stage: data.stage, cause: data.cause, candidates: (data.candidates ?? []).slice() },
    };
  },

  actionHints(state, playerId) {
    return hintsFor(state, playerId);
  },
};

// -- projection ----------------------------------------------------------------------

function projectState(state: GameState) {
  const slot = epState(state);
  const turn = viewTurn(state);
  const scenario = scenarioOf(state);
  const regionLeft = (region: 'parrot' | 'goose') =>
    Object.values(slot.pools[region].tiles).reduce((sum, value) => sum + (value ?? 0), 0);
  const tracks: Partial<Record<EpMission, unknown>> = {};
  for (const [mission, track] of Object.entries(slot.tracks) as [EpMission, NonNullable<(typeof slot.tracks)[EpMission]>][]) {
    tracks[mission] = {
      positions: { ...track.positions },
      arrivals: { ...track.arrivals },
      leader: trackLeader(slot, mission),
      values: TRACK_VALUES[mission].slice(),
    };
  }
  return {
    scenario: slot.scenario,
    /** Current step of the variable setup (public), or null. */
    setupStep: setupStep(state),
    missions: scenario.missions.slice(),
    pirates: scenario.pirates,
    victoryTarget: scenario.victoryTarget,
    fog: slot.fog.map((entry) => ({ ...entry })),
    regionsLeft: { parrot: regionLeft('parrot'), goose: regionLeft('goose') },
    council: slot.council,
    anchors: councilAnchors(state, slot),
    harborMarks: slot.harborMarks.slice(),
    startIsland: slot.startIsland.slice(),
    sites: slot.sites.map((site) => copy(site)),
    ships: slot.ships.map((ship) => ({ id: ship.id, player: ship.player, edge: ship.edge, cargo: ship.cargo.slice() })),
    harbors: slot.harbors.map((harbor) => ({ vertex: harbor.vertex, player: harbor.player, cargo: harbor.cargo.slice() })),
    goldSupply: slot.goldSupply,
    fishSupply: slot.fishSupply,
    lairTokensLeft: slot.lairTokens.length,
    pirate: slot.pirate ? { ...slot.pirate } : null,
    tracks,
    turn: {
      phase: turn.phase,
      active: turn.active,
      ships: copy(turn.ships),
      goldBuys: turn.goldBuys,
      fastGold: turn.fastGold,
      fishRolled: turn.fishRolled,
    },
    players: Object.fromEntries(state.players.map((player) => {
      const points = epPoints(state, player.id);
      return [player.id, {
        gold: goldOf(slot, player.id),
        harborPoints: points.harbors,
        missionPoints: points.missions,
        supply: {
          harbors: EP_PIECES.harbors - harborsOf(slot, player.id).length,
          settlements: EP_PIECES.settlements - plainSettlements(state, player.id),
          ships: EP_PIECES.ships - slot.ships.filter((ship) => ship.player === player.id).length,
          settlers: EP_PIECES.settlers - piecesInPlay(state, player.id, 'settler'),
          crews: scenario.pirates ? EP_PIECES.crews - piecesInPlay(state, player.id, 'crew') : 0,
        },
        abilities: {
          swift: abilityCount(state, player.id, 'swift'),
          fastGold: abilityCount(state, player.id, 'fastGold'),
          pirateBonus: abilityCount(state, player.id, 'pirateBonus'),
        },
        chaseNumbers: scenario.pirates ? chaseNumbers(state, player.id) : [],
      }];
    })),
  };
}

export type ExplorersPiratesView = ReturnType<typeof projectState>;

// -- hints ---------------------------------------------------------------------------

function shipHints(state: GameState, ship: EpShip, movement: boolean) {
  const slot = epState(state);
  const turn = viewTurn(state);
  const record = turn.ships[ship.id];
  const sites = hexesAtShip(state, ship).flatMap((hex) => slot.sites.filter((site) => site.hex === hex));
  const crewAboard = ship.cargo.includes('crew');
  return {
    id: ship.id,
    movesLeft: movement ? movesLeft(state, ship, turn) : 0,
    steps: movement ? stepTargets(state, ship) : [],
    done: !!record?.done,
    extra: !!record?.extra,
    found: movement ? foundTargets(state, ship) : [],
    harbors: movement ? harborsAtShip(state, ship).map((harbor) => harbor.vertex) : [],
    dropCrew: movement && crewAboard
      ? sites.filter((site) => (site.kind === 'lair' && !site.captured && site.crews.length < 3)
        || (site.kind === 'spice' && !site.crews.includes(ship.player))).map((site) => site.hex)
      : [],
    pickCrew: movement && hasRoom(ship.cargo, 'crew')
      ? sites.filter((site) => site.kind === 'lair' && site.captured && site.crews.includes(ship.player)).map((site) => site.hex)
      : [],
    loadSpice: movement && hasRoom(ship.cargo, 'spice')
      ? sites.filter((site) => site.kind === 'spice' && site.crews.includes(ship.player) && site.sacks.includes(ship.player)).map((site) => site.hex)
      : [],
    loadFish: movement && hasRoom(ship.cargo, 'fish')
      ? sites.filter((site) => site.kind === 'shoal' && site.fish).map((site) => site.hex)
      : [],
    deliver: movement && atCouncil(state, ship) && ship.cargo.some((piece) => piece === 'fish' || piece === 'spice'),
    chase: movement && canChase(state, ship),
  };
}

function hintsFor(state: GameState, playerId: string) {
  const slot = epState(state);
  const isTurn = state.players[state.turn.seat]?.id === playerId;
  const pending = state.pending;
  const myPirate = pending?.kind === PIRATE_FRAME && (pending as ModulePending).responders[0] === playerId
    ? (pending as ModulePending).data as unknown as PirateFrameData
    : null;
  const step = setupStep(state);
  const setup = state.turn.setup;
  const setupMine = !!setup && state.players[setup.order[setup.index] ?? -1]?.id === playerId;
  const playing = isTurn && state.turn.phase === 'action' && !pending;
  const turn = viewTurn(state);
  const action = playing && turn.phase === 'action';
  const movement = playing && turn.phase === 'movement';
  const scenario = scenarioOf(state);
  const ownShips = slot.ships.filter((ship) => ship.player === playerId);
  const targets = action ? pieceTargets(state, playerId) : [];
  return {
    phase: playing ? turn.phase : null,
    setup: setupMine && step
      ? {
          step,
          harbor: step === 'harbor' ? setupHarborTargets(state) : [],
          settlement: step === 'settlement' ? setupSettlementTargets(state) : [],
          road: step === 'route' ? setupRoadTargets(state, playerId) : [],
          ship: step === 'route' ? setupShipTargets(state, playerId) : [],
        }
      : null,
    harbors: action ? harborTargets(state, playerId) : [],
    shipEdges: action ? shipTargets(state, playerId) : [],
    shipReplace: ownShips.length >= EP_PIECES.ships,
    pieceHarbors: targets.flatMap((holder) => ('harbor' in holder ? [holder.harbor.vertex] : [])),
    pieceShips: targets.flatMap((holder) => ('ship' in holder ? [holder.ship.id] : [])),
    settlersLeft: EP_PIECES.settlers - piecesInPlay(state, playerId, 'settler'),
    crewsLeft: scenario.pirates ? EP_PIECES.crews - piecesInPlay(state, playerId, 'crew') : 0,
    goldBuysLeft: action ? Math.max(0, 2 - turn.goldBuys) : 0,
    fastGoldLeft: action ? Math.max(0, abilityCount(state, playerId, 'fastGold') - turn.fastGold) : 0,
    canStartMovement: action,
    fishRoll: movement && scenario.missions.includes('fish') && !turn.fishRolled,
    /** The ship in motion is on an edge with two other ships and must move on. */
    stranded: movement && activeShipStranded(state),
    ships: playing ? ownShips.map((ship) => shipHints(state, ship, movement)) : [],
    pirateTargets: myPirate?.stage === 'place' ? pirateTargets(state, framePirateFrom(state, myPirate)) : [],
    robCandidates: myPirate?.stage === 'rob' ? (myPirate.candidates ?? []).slice() : [],
  };
}

export type ExplorersPiratesHints = ReturnType<typeof hintsFor>;
