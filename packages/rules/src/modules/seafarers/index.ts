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
import type { CommandOutcome, GameState } from '../../types.ts';
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
import { CLOTH_ROBBER_COMMAND, chooseClothRobber, initRobberChoice, robberChoiceHints, robberChoicePhase } from './robber-choice.ts';
import {
  fortressLocked,
  initPirateIslands,
  isPirateIslands,
  lineShipFixed,
  lockedFortresses,
  pirateLineHints,
  projectPirateIslands,
  roadAllowed as pirateRoadAllowed,
} from './pirateIslands.ts';
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
import {
  buildWonder,
  chooseWonder,
  claimableWonders,
  initWonders,
  isWondersOfCatan,
  nextLevelCost,
  projectWonders,
  wonderCause,
} from './wonders.ts';
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
    // 海盜巢穴的堡壘、beachhead、各玩家船線與航道（全部公開）；其餘劇本不帶此欄。
    ...(slot.pirateIslands ? { pirateIslands: projectPirateIslands(state, slot.pirateIslands) } : {}),
    // 新世界：現在抽到的港口與已放數量（尚未抽的港口不投影）。
    ...(slot.world ? { world: projectWorld(slot.world, state) } : {}),
    // 卡坦奇觀的標記、各玩家的奇觀與層數（全部公開）；其餘劇本不帶此欄。
    ...(slot.wonders ? { wonders: projectWonders(slot.wonders) } : {}),
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
    // 海盜巢穴：海盜只沿航道前進（S7b），玩家不能搬它。
    pirateTargets: !view.pirateIslands && (robberMove || isTurn) && (!view.cloth || hasTribeRoute(state, playerId)) ? pirateTargets(state) : [],
    robberTargets: robberMove || isTurn
      ? topologyOf(state).hexes.map((_, hex) => hex).filter((hex) =>
        state.board.layout.terrain[hex] !== 'sea' && hex !== state.board.robber && robberHexAllowed(state, hex, ctx))
      : [],
    // 世外部落才有港口放置的提示欄位；其他劇本（New Shores 等）的鍵集合與 sf-2025.2 時相同（D7）。
    ...(view.tribe ? tribeHints : {}),
    // 布匹產地才有偷布匹的提示欄位（偷海盜的對象時可改偷布匹的玩家）；其他劇本的鍵集合不變（D7）。
    ...(view.cloth ? { clothVictims: state.pending?.kind === 'steal' && state.pending.actor === playerId && state.pending.pirate
      ? clothVictims(state, state.pending.candidates) : [] as string[],
      // variable setup 的選強盜：只有起始玩家在 `robber` 階段有可選的 12 號格（`board` 讓棋盤自動進入選格）。
      ...(robberChoicePhase(state) ? robberChoiceHints(state, playerId) : {}) } : {}),
    // 海盜巢穴：自己船線的下一個目標與端點（棋盤用來標出目標）；其他劇本不帶此鍵（D7）。
    ...(view.pirateIslands ? { pirateLine: pirateLineHints(state, playerId) } : {}),
    // 新世界設置階段的港口：只有輪到的玩家有選邊提示；其他劇本不帶這些鍵。
    ...(view.world ? worldHints(state, playerId) : {}),
    // 卡坦奇觀才有奇觀提示欄位：可認領的奇觀與能否蓋下一層（只對自己的行動階段）；其他劇本的鍵集合不變（D7）。
    ...(view.wonders ? { wonders: wonderHints(state, playerId, ctx, inAction) } : {}),
    goldRequired: required,
    /**
     * 金礦作答所需的銀行存量：每種 `min(存量, goldRequired)`，只給當下作答的玩家（其他人
     * 全為 0）。`GameView.bank` 只到 `BANK_VIEW_CAP`，金礦卻可能要拿更多同種的牌（#137）。
     */
    goldBank: bankView(state.bank, required),
  };
}

export type SeafarersHints = ReturnType<typeof seafarersHints>;

/** 卡坦奇觀的提示：現在可認領的奇觀，以及能否付得起並蓋下一層。 */
function wonderHints(state: GameState, playerId: string, ctx: ModuleViewContext, inAction: boolean): { claimable: string[]; buildable: boolean } {
  if (!inAction) return { claimable: [], buildable: false };
  const cost = nextLevelCost(state, playerId);
  const player = state.players.find((candidate) => candidate.id === playerId);
  const affordable = !!cost && !!player && Object.entries(cost).every(([resource, amount]) => player.resources[resource as keyof typeof player.resources] >= (amount ?? 0));
  return { claimable: claimableWonders(state, playerId, ctx), buildable: affordable };
}

/** 世外部落：強盜只能移到有數字圓片的格（7 與騎士都一樣，SF25 p. 12）。 */
function robberHexAllowed(state: GameState, hex: number, ctx: ModuleViewContext): boolean {
  // 海盜巢穴：強盜放回盒子，沒有任何格可以放。
  if (isPirateIslands(ctx)) return false;
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
      // variable setup：起始村落之前先由起始玩家在 12 號圓片格中選強盜（SF25 p. 15）。
      initRobberChoice(state, ctx);
      // 第三輪（SF25 p. 14）：前兩輪之後，從起始玩家起順時針每人再放一個村落加一條路或船。
      const setup = state.turn.setup!;
      setup.order = [...setup.order, ...state.players.map((player) => player.seat)];
      setup.third = false;
    }
    if (isPirateIslands(ctx)) initPirateIslands(state, slot);
    if (isNewWorld(ctx)) initWorld(state, ctx, slot);
    if (isWondersOfCatan(ctx)) initWonders(state, slot);
    setModuleState(state, SEAFARERS, slot);
  },

  // 卡坦奇觀：完成自己的奇觀，或達到目標分且層數比其他每位玩家都高（取代單純的目標分）。
  winCause(state, playerId, score, ctx) {
    return isWondersOfCatan(ctx) ? wonderCause(state, playerId, score, ctx) : undefined;
  },

  // 建造路之後探索；船在 `ships.ts` 的建造與設置指令裡探索。
  afterBuild(state, build, ctx) {
    if (build.piece === 'road' && !build.setup && build.edge !== undefined) exploreAtEdge(state, build.playerId, build.edge, ctx);
  },

  // 起始資源按第三個村落發；前兩個村落不收資源。
  setupStartingResources(_state, step, ctx) {
    return !isClothForCatan(ctx) || step.third === true;
  },

  // 每 2 枚布匹 1 分（餘數不計），全程計入；海盜巢穴的堡壘收復前不算村落分（-1）。
  score(state, playerId) {
    return clothPoints(state, playerId) - lockedFortresses(state, playerId);
  },

  // 堡壘收復前不產出資源（海盜巢穴）。
  productionAmount(state, _hex, vertex, amount) {
    return fortressLocked(state, vertex) ? 0 : amount;
  },

  // 海盜群島上的路只能從合法取得的建築接出去（未收復的堡壘不行）。
  roadAllowed(state, playerId, edge) {
    return pirateRoadAllowed(state, playerId, edge);
  },

  // 堡壘收復前不能升級成城市。
  allowCity(state, _playerId, vertex) {
    return !fortressLocked(state, vertex);
  },

  // 布匹產地不使用最長道路；海盜巢穴不使用最長道路與最大軍隊。
  awardRules(_state, rules, ctx) {
    if (isPirateIslands(ctx)) return { ...rules, minLongestRoad: Number.POSITIVE_INFINITY, minLargestArmy: Number.POSITIVE_INFINITY };
    return isClothForCatan(ctx) ? { ...rules, minLongestRoad: Number.POSITIVE_INFINITY } : rules;
  },

  // 海盜巢穴：騎士牌在 S7c 才改成只能改裝戰船；在那之前不能打出（否則會把盒子裡的強盜放回棋盤）。
  vetoCommand(_state, _actorId, command, ctx) {
    return isPirateIslands(ctx) && command.type === 'dev.playKnight'
      ? ({ ok: false, error: { code: 'E_INVALID_COMMAND', params: {} } } as CommandOutcome)
      : undefined;
  },

  // 海盜巢穴：強盜放回盒子，7 只有棄牌（偷牌的步驟在 S7b）。
  robberInactive(_state, ctx) {
    return isPirateIslands(ctx);
  },

  // 通往部落的通路中的船不可移動（延伸或分叉出去的船照一般規則）；西島船線上的船不可移動。
  shipMoveBlocked(state, playerId, edge) {
    return closedTribeShip(state, playerId, edge) || lineShipFixed(state, playerId, edge);
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
    [CLOTH_ROBBER_COMMAND]: chooseClothRobber,
    [WORLD_HARBOR_COMMAND]: placeWorldHarbor,
    'wonder.choose': chooseWonder,
    'wonder.build': buildWonder,
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
