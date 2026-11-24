/**
 * Seafarers rules module (SF25 / SF56-25, Heading for New Shores).
 *
 * Ships, ship movement, the pirate, gold fields and the island bonus live in
 * this directory; the base engine supplies the turn structure, sea-aware
 * placement and the Longest Trade Route (roads and ships join only at an own
 * building). See README.md in the parent directory for the hooks.
 */

import { scoreOf, topologyOf } from '../../analysis.ts';
import { bankView } from '../../bank-view.ts';
import type { GameState } from '../../types.ts';
import type { ModuleViewContext, PublicModulePendingView, RulesModule } from '../types.ts';
import { afterProduction as goldProduction, chooseGold, goldRequired, GOLD_FRAME, projectGold, skipEmptySupply } from './gold.ts';
import { activateFog, chooseFog, exploreAtEdge, FOG_FRAME, initialFog, projectFogFrame } from './fog.ts';
import {
  clothPoints,
  clothVictims,
  closedTribeShip,
  establishTrade,
  exhaustionWinners,
  hasTribeRoute,
  initCloth,
  isClothForCatan,
  isSmallIslandHex,
  produceCloth,
  projectCloth,
  stealCloth,
} from './cloth.ts';
import { allowBuilding, claimIslands } from './islands.ts';
import { moveBandit, pirateTargets } from './pirate.ts';
import {
  buildShip,
  buildableShipEdges,
  countShips,
  legalShipEdges,
  movableShips,
  moveShip,
  setupShip,
} from './ships.ts';
import { SEAFARERS, initialSeafarersState, seafarersState, seafarersView } from './state.ts';
import { HARBOR_FRAME, activateHarborFrame, harborChoices, initTribe, isForgottenTribe, offerHarbors, placeHarbor, projectHarborFrame, projectTribe } from './tribe.ts';
import { WORLD_HARBOR_COMMAND, initWorld, isNewWorld, placeWorldHarbor, projectWorld, regenerateWorld, worldHints } from './world.ts';
import { setModuleState } from '../state.ts';

/**
 * The `seafarers.gold` pending frame as a viewer sees it (`projectGold`): the
 * entitlements are public, so every seat gets the same `picks`, one entry per
 * remaining responder.
 */
export interface SeafarersGoldPendingView extends PublicModulePendingView {
  kind: typeof GOLD_FRAME;
  module: typeof SEAFARERS;
  data: { picks: Record<string, number> };
}

/** Public Seafarers state, published as `GameView.modules.seafarers`. */
export function projectSeafarers(state: GameState) {
  const slot = seafarersView(state);
  return {
    islandBonus: Object.fromEntries(Object.entries(slot.islands).map(([id, islands]) => [id, islands.slice()])),
    islandClaims: (slot.claims ?? []).map((claim) => ({ ...claim })),
    shipsBuiltThisTurn: slot.built.slice(),
    shipMoved: slot.moved,
    // 只有島嶼獎勵排除 home 的劇本（四島群島、新世界）在設置結束後才有；其餘劇本不帶此欄，投影不變。
    ...(slot.home ? { home: Object.fromEntries(Object.entries(slot.home).map(([id, islands]) => [id, islands.slice()])) } : {}),
    // 未知海域：尚未翻開的空格（公開）；剩餘板塊與圓片的牌庫不投影。
    ...(slot.fog ? { fog: slot.fog.hexes.slice() } : {}),
    // 世外部落的禮物、VP 標記與暫存港口（發展牌禮物不含身分）；其餘劇本不帶此欄。
    ...(slot.tribe ? { tribe: projectTribe(slot.tribe) } : {}),
    // 布匹產地的部落、供應堆、各玩家布匹與貿易關係（全部公開）；其餘劇本不帶此欄。
    ...(slot.cloth ? { cloth: projectCloth(slot.cloth) } : {}),
    // 新世界：現在抽到的港口與已放數量（尚未抽的港口不投影）。
    ...(slot.world ? { world: projectWorld(slot.world, state) } : {}),
  };
}

export type SeafarersView = ReturnType<typeof projectSeafarers>;

/** Advisory legal targets, published as `ActionHints.modules.seafarers`. */
export function seafarersHints(state: GameState, playerId: string, ctx: ModuleViewContext) {
  const isTurn = state.players[state.turn.seat]?.id === playerId;
  const inAction = isTurn && state.turn.phase === 'action' && !state.pending;
  const freeRoads = state.pending?.kind === 'freeRoads' && state.pending.actor === playerId;
  const setup = state.turn.setup;
  const setupShipStep = !!setup && setup.stage === 'road' && state.players[setup.order[setup.index] ?? -1]?.id === playerId;
  const robberMove = state.pending?.kind === 'moveRobber' && state.pending.actor === playerId;
  const view = seafarersView(state);
  const required = goldRequired(state, playerId);
  const harbor = harborChoices(state, playerId);
  const tribeHints = {
    /** 世外部落：輪到此玩家放港口時，暫存的港口種類與可放的邊。 */
    harborChoices: harbor,
    /**
     * 棋盤目標（與 Traders & Barbarians 同一種慣例）：`targets` 依指令列出合法的邊；
     * 只有一種暫存港口時 `board` 讓棋盤自動進入「選邊」，多種時由提示先選港口種類。
     */
    targets: harbor.edges.length > 0 ? { 'harbor.place': harbor.edges } : ({} as Record<string, number[]>),
    board: harbor.harbors.length === 1 && harbor.edges.length > 0
      ? { kind: 'edge' as const, commandType: 'harbor.place', labelId: 'sf.harbor.place', targets: harbor.edges, extra: { harbor: harbor.harbors[0]! } }
      : null,
  };
  return {
    legalShips: inAction || freeRoads ? buildableShipEdges(state, playerId, ctx.profile.pieces.ships) : [],
    setupShips: setupShipStep ? legalShipEdges(state, playerId, { setupVertex: setup!.lastVertex }) : [],
    movableShips: inAction && !view.moved ? movableShips(state, playerId) : [],
    shipMoved: view.moved,
    // 布匹產地：沒有通到部落的通路就不能移動海盜（SF25 p. 14）。
    pirateTargets: (robberMove || isTurn) && (!view.cloth || hasTribeRoute(state, playerId)) ? pirateTargets(state) : [],
    robberTargets: robberMove || isTurn
      ? topologyOf(state).hexes.map((_, hex) => hex).filter((hex) =>
        state.board.layout.terrain[hex] !== 'sea' && hex !== state.board.robber && robberHexAllowed(state, hex, ctx))
      : [],
    // 世外部落才有港口放置的提示欄位；其他劇本（New Shores 等）的鍵集合與 sf-2025.2 時相同（D7）。
    ...(view.tribe ? tribeHints : {}),
    // 布匹產地才有偷布匹的提示欄位（偷海盜的對象時可改偷布匹的玩家）；其他劇本的鍵集合不變（D7）。
    ...(view.cloth ? { clothVictims: state.pending?.kind === 'steal' && state.pending.actor === playerId && state.pending.pirate
      ? clothVictims(state, state.pending.candidates) : [] as string[] } : {}),
    // 新世界設置階段的港口：只有輪到的玩家有選邊提示；其他劇本不帶這些鍵。
    ...(view.world ? worldHints(state, playerId) : {}),
    goldRequired: required,
    /**
     * 金礦作答所需的銀行存量：每種 `min(存量, goldRequired)`，只給當下作答的玩家（其他人
     * 全為 0）。`GameView.bank` 只到 `BANK_VIEW_CAP`，金礦卻可能要拿更多同種的牌（#137）。
     */
    goldBank: bankView(state.bank, required),
  };
}

export type SeafarersHints = ReturnType<typeof seafarersHints>;

/** 世外部落：強盜只能移到有數字圓片的格（7 與騎士都一樣，SF25 p. 12）。 */
function robberHexAllowed(state: GameState, hex: number, ctx: ModuleViewContext): boolean {
  // 布匹產地：強盜不可移到四座小島（SF25 p. 14）。
  if (isClothForCatan(ctx)) return !isSmallIslandHex(state, hex);
  return !isForgottenTribe(ctx) || state.board.layout.numbers[hex] !== null;
}

export const seafarersModule: RulesModule = {
  id: SEAFARERS,

  initGame(state, ctx) {
    const slot = initialSeafarersState(state);
    const fog = initialFog(state, { profile: ctx.profile });
    if (fog) slot.fog = fog;
    if (isForgottenTribe(ctx)) initTribe(state, ctx, slot);
    if (isClothForCatan(ctx)) {
      initCloth(state, slot);
      // 第三輪（SF25 p. 14）：前兩輪之後，從起始玩家起順時針每人再放一個村落加一條路或船。
      const setup = state.turn.setup!;
      setup.order = [...setup.order, ...state.players.map((player) => player.seat)];
      setup.third = false;
    }
    if (isNewWorld(ctx)) initWorld(state, ctx, slot);
    setModuleState(state, SEAFARERS, slot);
  },

  // 建造路之後探索；船在 `ships.ts` 的建造與設置指令裡探索。
  afterBuild(state, build, ctx) {
    if (build.piece === 'road' && !build.setup && build.edge !== undefined) exploreAtEdge(state, build.playerId, build.edge, ctx);
  },

  // 起始資源按第三個村落發；前兩個村落不收資源。
  setupStartingResources(_state, step, ctx) {
    return !isClothForCatan(ctx) || step.third === true;
  },

  // 每 2 枚布匹 1 分（餘數不計），全程計入。
  score(state, playerId) {
    return clothPoints(state, playerId);
  },

  // 不使用最長道路。
  awardRules(_state, rules, ctx) {
    return isClothForCatan(ctx) ? { ...rules, minLongestRoad: Number.POSITIVE_INFINITY } : rules;
  },

  // 通往部落的通路中的船不可移動；延伸或分叉出去的船照一般規則。
  shipMoveBlocked(state, playerId, edge) {
    return closedTribeShip(state, playerId, edge);
  },

  // 回合結束時 ≥5 個部落沒有布匹：最高分勝，平手比布匹，仍平手共同勝利（D12）。
  onEndTurn(state, _actorId, ctx) {
    const winners = exhaustionWinners(state, (id) => scoreOf(state, id, { includeHidden: true }));
    if (!winners) return 'continue';
    ctx.kit.endGame(state, winners, 'clothExhausted');
    return 'defer';
  },

  robberTargets(state, _actorId, targets, ctx) {
    return targets.filter((hex) => robberHexAllowed(state, hex, ctx));
  },

  regenerate: regenerateWorld,

  afterProduction(state, roll, ctx) {
    // 布匹先於金礦結算（SF25 p. 14）；擲骰者拿到布匹可能剛好湊到目標分，先判勝再開金礦選擇。
    if (produceCloth(state, roll, ctx)) ctx.kit.checkVictory(state);
    if (state.result) return;
    goldProduction(state, roll, ctx);
  },
  moveBandit,
  allowBuilding,

  freeRouteTargets(state, playerId, ctx, options) {
    const pieces = Math.max(0, ctx.profile.pieces.ships - countShips(state, playerId));
    const targets = buildableShipEdges(state, playerId, ctx.profile.pieces.ships);
    return options?.grantAllAvailable && targets.length > 0 ? pieces : Math.min(targets.length, pieces);
  },

  legalShips(state, playerId, ctx) {
    return buildableShipEdges(state, playerId, ctx.profile.pieces.ships);
  },

  // A ship another module placed (C&K Diplomacy) counts as built in this
  // window: it may not move in it (SF25 p. 2; CK25 p. 12 "only then build").
  shipPlaced(state, _playerId, edge) {
    seafarersState(state).built.push(edge);
  },

  afterBoardChange(state, ctx) {
    claimIslands(state, ctx);
    // 布匹產地：新連上部落的玩家建立貿易關係並拿 1 枚布匹。
    establishTrade(state, ctx);
    // 暫存的港口：每次盤面變動重新檢查有沒有合法位置（世外部落）。
    offerHarbors(state, ctx);
  },

  commands: {
    'build.ship': buildShip,
    'ship.move': moveShip,
    'setup.placeShip': setupShip,
    'gold.choose': chooseGold,
    'fog.choose': chooseFog,
    'harbor.place': placeHarbor,
    'cloth.steal': stealCloth,
    [WORLD_HARBOR_COMMAND]: placeWorldHarbor,
  },
  pendingCommands: ['build.ship', 'gold.choose', 'fog.choose', 'harbor.place', 'cloth.steal'],

  activatePending(state, frame, ctx) {
    if (frame.kind === GOLD_FRAME) skipEmptySupply(state, frame, ctx);
    if (frame.kind === FOG_FRAME) activateFog(state, frame, ctx);
    if (frame.kind === HARBOR_FRAME) activateHarborFrame(state, frame, ctx);
  },

  project: projectSeafarers,

  projectPending(state, frame, viewerId, ctx) {
    if (frame.kind === GOLD_FRAME) return projectGold(state, frame, viewerId, ctx);
    if (frame.kind === FOG_FRAME) return projectFogFrame(state, frame);
    if (frame.kind === HARBOR_FRAME) return projectHarborFrame(state, frame);
    return { kind: frame.kind, module: frame.module, responders: frame.responders.slice(), data: {} };
  },

  actionHints: seafarersHints,
};
