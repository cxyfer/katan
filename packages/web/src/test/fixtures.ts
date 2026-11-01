/**
 * Test fixtures.
 *
 * The board comes from the rules package's own fixed base layout, so a board
 * test exercises the real terrain/numbers/harbours rather than a hand-written
 * approximation. The rest of the `GameView` is a literal projection: the UI is
 * a pure function of that projection, so a literal is exactly what it needs.
 */

import {
  buildBaseLayout,
  getTopology,
  seededRng,
  type ActionHintsView,
  type GameEvent,
  type GameView,
  type Offer,
  type PublicBoardView,
  type PublicPlayerView,
} from '@catan/rules';
import type {
  ChatMessageView,
  GameSnapshot,
  PlayerIdentity,
  ProfileView,
  ResumableGameView,
  RoomMemberView,
  RoomPolicy,
  RoomSummaryView,
  RoomView,
  ServerConfigView,
} from '@catan/protocol';

export const TOPOLOGY_ID = 'hex-r2';

export function fixedBoard(): PublicBoardView {
  const layout = buildBaseLayout({ mode: 'fixed', rng: seededRng(7) });
  const topology = getTopology(layout.topologyId);
  return {
    topologyId: layout.topologyId,
    terrain: layout.terrain.slice(),
    numbers: layout.numbers.slice(),
    harbors: layout.harbors.map((harbor) => ({ edge: harbor.edge, type: harbor.type })),
    islands: layout.islands.slice(),
    robber: layout.robber,
    pirate: null,
    buildings: topology.vertices.map(() => null),
    roads: topology.edges.map(() => null),
  };
}

export function makePlayer(overrides: Partial<PublicPlayerView> = {}): PublicPlayerView {
  return {
    id: 'p1',
    nickname: 'Alex',
    seat: 0,
    color: 'red',
    handSize: 10,
    devCardCount: 1,
    newDevCardCount: 0,
    playedKnights: 0,
    publicScore: 2,
    longestRoadLength: 0,
    bonusPoints: 0,
    cityWalls: 0,
    defenders: 0,
    improvements: {},
    resources: { lumber: 2, brick: 2, wool: 2, grain: 2, ore: 2 },
    devCards: ['knight'],
    newDevCards: [],
    progressCards: [],
    newProgressCards: [],
    ownScore: 2,
    ...overrides,
  };
}

export function makeHints(overrides: Partial<ActionHintsView> = {}): ActionHintsView {
  return {
    canRoll: false,
    canEndTurn: true,
    legalRoads: [],
    legalSettlements: [],
    legalCities: [],
    bankRates: { lumber: 4, brick: 4, wool: 4, grain: 4, ore: 4 },
    pendingKind: null,
    ...overrides,
  };
}

export interface MakeViewOptions {
  selfId?: string;
  hints?: ActionHintsView | null;
  events?: GameEvent[];
  offers?: Offer[];
  pending?: GameView['pending'];
  phase?: GameView['turn']['phase'];
  setup?: GameView['turn']['setup'];
  result?: GameView['result'];
  turnPlayerId?: string;
  board?: PublicBoardView;
  players?: PublicPlayerView[];
}

export function makeView(options: MakeViewOptions = {}): GameView {
  const selfId = options.selfId ?? 'p1';
  const players =
    options.players ??
    [
      makePlayer({ id: 'p1', nickname: 'Alex', seat: 0, color: 'red' }),
      makePlayer({ id: 'p2', nickname: '小美', seat: 1, color: 'blue', resources: undefined, ownScore: undefined, devCards: undefined, newDevCards: undefined, progressCards: undefined, newProgressCards: undefined }),
      makePlayer({ id: 'p3', nickname: 'Bo', seat: 2, color: 'orange', resources: undefined, ownScore: undefined, devCards: undefined, newDevCards: undefined, progressCards: undefined, newProgressCards: undefined }),
    ];
  const view: GameView = {
    engineVersion: 'test',
    profileId: 'base-2025',
    victoryTarget: 10,
    players,
    board: options.board ?? fixedBoard(),
    bank: { lumber: 19, brick: 19, wool: 19, grain: 19, ore: 19 },
    devDeckSize: 20,
    turn: {
      seat: players.find((player) => player.id === (options.turnPlayerId ?? selfId))?.seat ?? 0,
      playerId: options.turnPlayerId ?? selfId,
      phase: options.phase ?? 'action',
      dice: [3, 4],
      devCardPlayed: false,
      setup: options.setup ?? null,
      pairedActor: 1,
    },
    pending: options.pending ?? null,
    offers: options.offers ?? [],
    windowId: 1,
    seq: 12,
    result: options.result ?? null,
    awards: { longestRoad: null, largestArmy: null },
    events: options.events ?? [],
  };
  if (options.hints !== null) view.hints = options.hints ?? makeHints();
  return view;
}

export function makeSnapshot(view: GameView = makeView(), revision = 12): GameSnapshot {
  return { gameId: 'g1', roomId: 'r1', revision, view };
}

export function makeIdentity(overrides: Partial<PlayerIdentity> = {}): PlayerIdentity {
  return {
    id: 'p1',
    nickname: 'Alex',
    locale: 'en',
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

export function makeConfig(overrides: Partial<ServerConfigView> = {}): ServerConfigView {
  return {
    locales: ['zh-Hant', 'en'],
    policyBounds: {
      turnClockSeconds: { min: 0, max: 3600 },
      disconnectGraceSeconds: { min: 30, max: 3600 },
    },
    defaultPolicy: makePolicy(),
    limits: {
      nicknameMaxLength: 24,
      chatMaxLength: 400,
      chatRatePerMinute: 30,
      roomCapacityMax: 6,
    },
    bots: { enabled: true, levels: ['easy', 'standard'] },
    ...overrides,
  };
}

export function makePolicy(overrides: Partial<RoomPolicy> = {}): RoomPolicy {
  return {
    turnClockSeconds: 0,
    disconnectGraceSeconds: 300,
    allowAbandonment: true,
    hostSuccession: 'automatic',
    ...overrides,
  };
}

export function makeProfile(overrides: Partial<ProfileView> = {}): ProfileView {
  return {
    id: 'base-2025',
    labelKey: 'profile.base-2025',
    playerCounts: [3, 4],
    paired: false,
    modules: { seafarers: false, citiesKnights: false },
    scenario: null,
    victoryTarget: 10,
    setupModes: ['fixed', 'variable'],
    enabled: true,
    ...overrides,
  };
}

export function makeMember(overrides: Partial<RoomMemberView> = {}): RoomMemberView {
  return {
    playerId: 'p1',
    nickname: 'Alex',
    seat: 0,
    color: 'red',
    ready: true,
    connected: true,
    host: true,
    joinedAt: '2026-01-01T00:00:00.000Z',
    bot: false,
    ...overrides,
  };
}

/** 電腦座位：永遠已準備、已連線，不是房主。 */
export function makeBotMember(overrides: Partial<RoomMemberView> = {}): RoomMemberView {
  return makeMember({
    playerId: 'bot1',
    nickname: 'Ada',
    seat: 1,
    color: 'blue',
    ready: true,
    connected: true,
    host: false,
    bot: true,
    botLevel: 'standard',
    ...overrides,
  });
}

export function makeRoom(overrides: Partial<RoomView> = {}): RoomView {
  return {
    id: 'r1',
    code: 'ABC123',
    visibility: 'private',
    status: 'lobby',
    hostId: 'p1',
    profileId: 'base-2025',
    setupMode: 'fixed',
    capacity: 4,
    policy: makePolicy(),
    policyRevision: 1,
    members: [
      makeMember(),
      makeMember({ playerId: 'p2', nickname: '小美', seat: 1, color: 'blue', host: false }),
    ],
    gameId: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    startBlockers: [],
    pendingPolicy: null,
    ...overrides,
  };
}

export function makeRoomSummary(overrides: Partial<RoomSummaryView> = {}): RoomSummaryView {
  return {
    id: 'r2',
    code: 'PUB999',
    visibility: 'public',
    status: 'lobby',
    profileId: 'base-2025',
    playerCount: 2,
    botCount: 0,
    capacity: 4,
    openSeats: 2,
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

export function makeResumable(overrides: Partial<ResumableGameView> = {}): ResumableGameView {
  return {
    gameId: 'g1',
    roomId: 'r1',
    roomCode: 'ABC123',
    profileId: 'base-2025',
    status: 'suspended',
    players: [{ playerId: 'p1', nickname: 'Alex', color: 'red' }],
    lastSavedAt: '2026-01-02T03:04:05.000Z',
    revision: 12,
    allSeatsNeeded: false,
    ...overrides,
  };
}

export function makeChatMessage(overrides: Partial<ChatMessageView> = {}): ChatMessageView {
  return {
    id: 'm1',
    seq: 1,
    playerId: 'p2',
    nickname: '小美',
    seat: 1,
    color: 'blue',
    text: 'hi',
    createdAt: '2026-01-01T00:00:01.000Z',
    kind: 'player',
    ...overrides,
  };
}

export function makeEvent(seq: number, type: string, params: Record<string, unknown> = {}): GameEvent {
  return { seq, type, params };
}
