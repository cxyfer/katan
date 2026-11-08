/**
 * Cities & Knights rules module (CK25 / CK56-25), core rules (P2).
 *
 * Commodities, the event die and barbarians, knights, city walls, city
 * improvements and metropolises, and holding progress cards live in this
 * directory. Progress-card effects are the next phase: cards are drawn,
 * shown to their owner and discarded at the hand limit, but no command plays
 * them. The base engine supplies the turn structure, trading and the robber;
 * the base development cards and Largest Army do not exist here (CK25 p. 3).
 * See README.md in the parent directory for the hooks.
 */

import { playerById, topologyOf } from '../../analysis.ts';
import { bankView } from '../../bank-view.ts';
import { COMMODITIES, type GameState, type ModulePending } from '../../types.ts';
import type { ModuleViewContext, PublicModulePendingView, RulesModule } from '../types.ts';
import { setModuleState } from '../state.ts';
import {
  DEFENDER_FRAME,
  PILLAGE_FRAME,
  barbarianStrength,
  chooseDefenderDeck,
  choosePillage,
  knightContributions,
  pillageableCities,
} from './barbarians.ts';
import {
  allowCity,
  buildWall,
  improveCity,
  improvementOptions,
  wallSites,
  wallsOf,
} from './cities.ts';
import {
  ABILITY_LEVEL,
  ACTIVATE_COST,
  BARBARIAN_TRACK_LENGTH,
  CITIES_KNIGHTS,
  KNIGHT_COST,
  PROGRESS_HAND_LIMIT,
  PROMOTE_COST,
  TRACKS,
  WALL_COST,
  WALL_HAND_BONUS,
} from './constants.ts';
import { RESOLVE_ROLL_FRAME, beforeProduction, resumeRoll, rollDice } from './dice.ts';
import {
  DISPLACED_FRAME,
  activateKnight,
  adjacentToRobber,
  canAct,
  canPromote,
  chaseRobber,
  displaceKnight,
  displaceTargets,
  knightReach,
  knightsInSupply,
  moveKnight,
  promoteKnight,
  recruitKnight,
  recruitSites,
  retreatKnight,
  retreatOptions,
  vertexOccupant,
} from './knights.ts';
import { SCIENCE_FRAME, modifyProduction, scienceAfterProduction, takeScienceBonus } from './production.ts';
import {
  PROGRESS_DISCARD_FRAME,
  discardProgress,
  initProgressDecks,
  progressLimitVeto,
  progressVpOf,
} from './progress.ts';
import { ckState, ckView, initialCitiesKnightsState, knightAt } from './state.ts';
import { diplomacyRoad, sabotageDiscard, takeProgress, treasonPlace, treasonRemove, weddingAnswer } from './cards-politics.ts';
import { harborAnswer, harborOffer, takeCards } from './cards-trade.ts';
import { harborHint, playProgress, progressHints, projectCardFrame } from './cards.ts';
import { merchantVp, twoForOneKinds } from './merchant.ts';

export const citiesKnightsModule: RulesModule = {
  id: CITIES_KNIGHTS,

  initGame(state, ctx) {
    setModuleState(state, CITIES_KNIGHTS, initialCitiesKnightsState(state));
    for (const commodity of COMMODITIES) state.commodityBank[commodity] = ctx.profile.commodityBankPerType;
    initProgressDecks(state, ctx);
  },

  // Round 2 places a city instead of the second settlement (CK25 p. 5).
  setupBuilding(_state, step) {
    return step.round === 2 ? 'city' : undefined;
  },

  rollDice,
  beforeProduction,
  modifyProduction,

  afterProduction(state, roll, ctx) {
    if (roll.total === 7 && ckState(state).attacks === 0) {
      ctx.kit.emit(state, 'ck.robberIdle', { playerId: ctx.kit.currentPlayer(state).id });
    }
    scienceAfterProduction(state, roll, ctx);
  },

  discardLimit(state, player, base) {
    return base + WALL_HAND_BONUS * wallsOf(state, player.id);
  },

  robberInactive(state) {
    return ckView(state).attacks === 0;
  },

  // Trade level 3: any 2 identical commodities for 1 card (CK25 p. 8); the
  // merchant's resource and a Merchant Fleet's named kind at 2:1 (CK25 pp. 7, 15).
  bankRate(state, playerId, card, rate) {
    const commodity = (COMMODITIES as readonly string[]).includes(card);
    if (commodity && playerById(state, playerId)!.improvements.trade >= ABILITY_LEVEL) return Math.min(rate, 2);
    if (twoForOneKinds(state, playerId).includes(card)) return Math.min(rate, 2);
    return rate;
  },

  vertexBlocker(state, vertex) {
    return vertexOccupant(state, vertex);
  },

  allowBuilding(state, _playerId, vertex) {
    return !knightAt(state, vertex);
  },

  allowCity(state, playerId, vertex) {
    return allowCity(state, playerId, vertex);
  },

  afterBoardChange(state) {
    const slot = ckState(state);
    // A toppled city that was upgraded again stands up.
    slot.toppled = slot.toppled.filter((vertex) => {
      const building = state.board.buildings[vertex];
      return !!building && !building.city;
    });
  },

  resumePending(state, frame, ctx) {
    if (frame.kind === RESOLVE_ROLL_FRAME) resumeRoll(state, frame, ctx);
  },

  beforeEndTurn: progressLimitVeto,

  disabledCommands: ['build.devCard', 'dev.playKnight', 'dev.playRoadBuilding', 'dev.playYearOfPlenty', 'dev.playMonopoly'],

  commands: {
    'build.wall': buildWall,
    'city.improve': improveCity,
    'knight.recruit': recruitKnight,
    'knight.activate': activateKnight,
    'knight.promote': promoteKnight,
    'knight.move': moveKnight,
    'knight.displace': displaceKnight,
    'knight.chaseRobber': chaseRobber,
    'knight.retreat': retreatKnight,
    'barbarians.pillage': choosePillage,
    'barbarians.chooseDeck': chooseDefenderDeck,
    'progress.discard': discardProgress,
    'science.take': takeScienceBonus,
    'progress.play': playProgress,
    'progress.harborOffer': harborOffer,
    'progress.harborAnswer': harborAnswer,
    'progress.takeCards': takeCards,
    'progress.takeProgress': takeProgress,
    'progress.sabotageDiscard': sabotageDiscard,
    'progress.weddingGive': weddingAnswer,
    'progress.treasonRemove': treasonRemove,
    'progress.treasonPlace': treasonPlace,
    'progress.diplomacyRoad': diplomacyRoad,
  },
  pendingCommands: [
    'knight.retreat',
    'barbarians.pillage',
    'barbarians.chooseDeck',
    'progress.discard',
    'science.take',
    'progress.harborAnswer',
    'progress.takeCards',
    'progress.takeProgress',
    'progress.sabotageDiscard',
    'progress.weddingGive',
    'progress.treasonRemove',
    'progress.treasonPlace',
    'progress.diplomacyRoad',
  ],

  score(state, playerId) {
    const view = ckView(state);
    const metropolises = TRACKS.filter((track) => view.metropolises[track]?.player === playerId).length;
    return 2 * metropolises + (playerById(state, playerId)?.defenders ?? 0) + progressVpOf(state, playerId) + merchantVp(state, playerId);
  },

  project(state) {
    return projectCitiesKnights(state);
  },

  projectPending(state, frame, viewerId, ctx) {
    return projectFrame(state, frame, viewerId, ctx);
  },

  actionHints(state, playerId, ctx) {
    return citiesKnightsHints(state, playerId, ctx);
  },
};

/** Public C&K table state. Progress hands and deck order never appear here. */
export function projectCitiesKnights(state: GameState) {
  const view = ckView(state);
  return {
    barbarian: { position: view.barbarian, length: BARBARIAN_TRACK_LENGTH, attacks: view.attacks },
    barbarianStrength: barbarianStrength(state),
    defenderStrength: Object.values(knightContributions(state)).reduce((sum, value) => sum + value, 0),
    robberActive: view.attacks > 0,
    knights: view.knights.map((knight) => ({
      player: knight.player,
      vertex: knight.vertex,
      level: knight.level,
      active: knight.active,
      // Activated in the current action window: cannot act in it.
      fresh: knight.activatedIn === state.windowId,
      promoted: knight.promotedIn === state.windowId,
    })),
    walls: view.walls.map((vertex) => ({ vertex, player: state.board.buildings[vertex]?.player ?? null })),
    metropolises: Object.fromEntries(TRACKS.map((track) => [track, view.metropolises[track] ? { ...view.metropolises[track]! } : null])),
    toppled: view.toppled.slice(),
    progressVp: Object.fromEntries(state.players.map((player) => [player.id, (view.progressVp[player.id] ?? []).slice()])),
    progressCounts: Object.fromEntries(state.players.map((player) => [player.id, player.progressCards.length])),
    decks: Object.fromEntries(TRACKS.map((track) => [track, state.progressDecks[track].length])),
    // 與 `GameView.bank` 相同只到上限：丟棄的商品不能從前後差還原（#137）。
    commodityBank: bankView(state.commodityBank),
    lastRoll: view.lastRoll ? { ...view.lastRoll } : null,
    lastAttack: view.lastAttack
      ? { ...view.lastAttack, contributions: { ...view.lastAttack.contributions }, pillaged: view.lastAttack.pillaged.map((entry) => ({ ...entry })) }
      : null,
    handLimit: PROGRESS_HAND_LIMIT,
    merchant: view.merchant ? { ...view.merchant } : null,
    // Played cards are public: the Alchemy dice, the named fleet kinds, the open harbor offers.
    alchemy: view.alchemy && view.alchemy.windowId === state.windowId ? { player: view.alchemy.player, dice: view.alchemy.dice.slice() } : null,
    fleets: (view.fleets ?? []).filter((fleet) => fleet.windowId === state.windowId).map((fleet) => ({ player: fleet.player, kind: fleet.kind })),
    harbor: view.harbor && view.harbor.windowId === state.windowId ? { player: view.harbor.player, offers: { ...view.harbor.offers } } : null,
  };
}

function projectFrame(state: GameState, frame: ModulePending, _viewerId: string, _ctx: ModuleViewContext): PublicModulePendingView {
  const base = { kind: frame.kind, module: frame.module, responders: frame.responders.slice() };
  switch (frame.kind) {
    case PILLAGE_FRAME:
      return { ...base, data: { cities: Object.fromEntries(frame.responders.map((id) => [id, pillageableCities(state, id)])) } };
    case DISPLACED_FRAME: {
      const data = frame.data as { knight: { player: string; level: number; active: boolean }; from: number };
      return { ...base, data: { player: data.knight.player, level: data.knight.level, active: data.knight.active, from: data.from, options: retreatOptions(state, frame) } };
    }
    case PROGRESS_DISCARD_FRAME:
      return { ...base, data: { required: { ...(frame.data.required as Record<string, number>) } } };
    case DEFENDER_FRAME:
      return { ...base, data: { decks: TRACKS.filter((track) => state.progressDecks[track].length > 0) } };
    default:
      // The science bonus and the roll continuation carry no public data.
      return { ...base, data: projectCardFrame(state, frame, _viewerId) ?? {} };
  }
}

/** Advisory targets for the viewer's own actions. */
export function citiesKnightsHints(state: GameState, playerId: string, ctx: ModuleViewContext) {
  const isTurn = state.players[state.turn.seat]?.id === playerId;
  const inAction = isTurn && state.turn.phase === 'action' && !state.pending;
  const view = ckView(state);
  const player = playerById(state, playerId)!;
  const knights = inAction
    ? view.knights.filter((knight) => knight.player === playerId).map((knight) => ({
        vertex: knight.vertex,
        level: knight.level,
        active: knight.active,
        canActivate: !knight.active,
        canPromote: canPromote(state, knight),
        canAct: canAct(state, knight),
        moves: canAct(state, knight) ? knightReach(state, playerId, knight.vertex).moves : [],
        displace: canAct(state, knight) ? displaceTargets(state, knight) : [],
        chase: canAct(state, knight) && view.attacks > 0 && adjacentToRobber(state, knight),
      }))
    : [];
  const frame = state.pending as ModulePending | null;
  const responding = !!frame && 'module' in frame && frame.module === CITIES_KNIGHTS && frame.responders.includes(playerId);
  return {
    recruitSites: inAction && knightsInSupply(state, playerId, 1) > 0 ? recruitSites(state, playerId) : [],
    knightSupply: { 1: knightsInSupply(state, playerId, 1), 2: knightsInSupply(state, playerId, 2), 3: knightsInSupply(state, playerId, 3) },
    knights,
    wallSites: inAction ? wallSites(state, playerId) : [],
    improvements: inAction ? improvementOptions(state, playerId) : [],
    commodityRates: Object.fromEntries(COMMODITIES.map((commodity) => [commodity, twoForOneKinds(state, playerId).includes(commodity) ? 2 : commodityRate(state, playerId)])),
    costs: { wall: WALL_COST, knight: KNIGHT_COST, promote: PROMOTE_COST, activate: ACTIVATE_COST },
    progressExcess: Math.max(0, player.progressCards.length - PROGRESS_HAND_LIMIT),
    retreat: responding && frame!.kind === DISPLACED_FRAME ? retreatOptions(state, frame!) : [],
    pillage: responding && frame!.kind === PILLAGE_FRAME ? pillageableCities(state, playerId) : [],
    defenderDecks: responding && frame!.kind === DEFENDER_FRAME && frame!.responders[0] === playerId
      ? TRACKS.filter((track) => state.progressDecks[track].length > 0)
      : [],
    scienceBonus: responding && frame!.kind === SCIENCE_FRAME && frame!.responders[0] === playerId,
    progress: progressHints(state, playerId, ctx),
    harborTargets: harborHint(state, playerId),
    twoForOne: twoForOneKinds(state, playerId),
  };
}

function commodityRate(state: GameState, playerId: string): number {
  // Mirrors the engine's supply rate: 4:1, a 3:1 port, trade level 3 at 2:1.
  const generic = state.board.layout.harbors.some((harbor) => harbor.type === 'generic' && portOwned(state, playerId, harbor.edge));
  const rate = generic ? 3 : 4;
  return playerById(state, playerId)!.improvements.trade >= ABILITY_LEVEL ? Math.min(rate, 2) : rate;
}

function portOwned(state: GameState, playerId: string, edge: number): boolean {
  const vertices = topologyOf(state).edges[edge]?.vertices ?? [];
  return vertices.some((vertex) => state.board.buildings[vertex]?.player === playerId);
}
