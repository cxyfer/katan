/**
 * Type and constant exports that `@catan/bots` builds on (bot plan CK-A / P8):
 * the Cities & Knights view and hint shapes, the pending-frame kinds and the
 * constants the bots read. The key lists below are `Record<keyof T, true>` so
 * that a key added to or removed from a type breaks `tsc`, and the tests
 * compare them with what the engine really projects, so a drifting projection
 * breaks the test run.
 */

import { describe, expect, it } from 'vitest';
import {
  CARD_KINDS,
  CITIES_KNIGHTS,
  CK_ABILITY_LEVEL,
  CK_ACTIVATE_COST,
  CK_BARBARIAN_TRACK_LENGTH,
  CK_DEFENDER_FRAME,
  CK_DIPLOMACY_FRAME,
  CK_DISPLACED_FRAME,
  CK_ESPIONAGE_FRAME,
  CK_EVENT_FACES,
  CK_FIXED_DISCS,
  CK_GUILD_DUES_FRAME,
  CK_HARBOR_FRAME,
  CK_KNIGHTS_PER_LEVEL,
  CK_KNIGHT_COST,
  CK_MAX_LEVEL,
  CK_MAX_WALLS,
  CK_MEDICINE_COST,
  CK_METROPOLIS_LEVEL,
  CK_PERMANENT_METROPOLIS_LEVEL,
  CK_PILLAGE_FRAME,
  CK_PROGRESS_DECKS,
  CK_PROGRESS_DISCARD_FRAME,
  CK_PROGRESS_HAND_LIMIT,
  CK_PROMOTE_COST,
  CK_RESOLVE_ROLL_FRAME,
  CK_SABOTAGE_FRAME,
  CK_SCIENCE_FRAME,
  CK_TRACKS,
  CK_TRACK_COMMODITY,
  CK_TREASON_PLACE_FRAME,
  CK_TREASON_REMOVE_FRAME,
  CK_VP_PROGRESS_CARDS,
  CK_WALL_COST,
  CK_WALL_HAND_BONUS,
  CK_WEDDING_FRAME,
  COMMODITIES,
  TERRAIN_COMMODITY,
  actionHints,
  ckDrawThreshold,
  projectGame,
  type CardKind,
  type CitiesKnightsHints,
  type CitiesKnightsView,
  type CkBlockReason,
  type CkEventFace,
  type CkImprovementOption,
  type CkKnightLevel,
  type CkProgressCardHint,
  type CkTrack,
  type ModuleHintsMap,
  type ModuleViewMap,
  type ProgressCardType,
} from '../src/index.ts';
import { requireProfile } from '../src/profiles.ts';
import { citiesKnightsHints, citiesKnightsModule, projectCitiesKnights } from '../src/modules/citiesKnights/index.ts';
import { ckState } from '../src/modules/citiesKnights/state.ts';
import type { GameState } from '../src/types.ts';
import {
  SHIP,
  TRADE,
  actCk,
  addKnight,
  ckGame,
  emptyCkGame,
  giveCommodities,
  moduleFrame,
  player,
  rollRng,
  setBuilding,
  setImprovement,
  spreadVertices,
} from './ck-helpers.ts';
import { give } from './helpers.ts';

type Knight = CitiesKnightsView['knights'][number];
type Wall = CitiesKnightsView['walls'][number];
type Metropolis = NonNullable<CitiesKnightsView['metropolises']['science']>;
type LastRoll = NonNullable<CitiesKnightsView['lastRoll']>;
type LastAttack = NonNullable<CitiesKnightsView['lastAttack']>;
type Merchant = NonNullable<CitiesKnightsView['merchant']>;
type Alchemy = NonNullable<CitiesKnightsView['alchemy']>;
type Fleet = CitiesKnightsView['fleets'][number];
type Harbor = NonNullable<CitiesKnightsView['harbor']>;
type KnightHint = CitiesKnightsHints['knights'][number];

const VIEW_KEYS: Record<keyof CitiesKnightsView, true> = {
  barbarian: true,
  barbarianStrength: true,
  defenderStrength: true,
  robberActive: true,
  knights: true,
  walls: true,
  metropolises: true,
  toppled: true,
  progressVp: true,
  progressCounts: true,
  decks: true,
  commodityBank: true,
  lastRoll: true,
  lastAttack: true,
  handLimit: true,
  merchant: true,
  alchemy: true,
  fleets: true,
  harbor: true,
};

const BARBARIAN_KEYS: Record<keyof CitiesKnightsView['barbarian'], true> = { position: true, length: true, attacks: true };
const KNIGHT_KEYS: Record<keyof Knight, true> = { player: true, vertex: true, level: true, active: true, fresh: true, promoted: true };
const WALL_KEYS: Record<keyof Wall, true> = { vertex: true, player: true };
const METROPOLIS_KEYS: Record<keyof Metropolis, true> = { player: true, vertex: true };
const LAST_ROLL_KEYS: Record<keyof LastRoll, true> = { event: true, red: true, atSeq: true, alchemy: true };
const LAST_ATTACK_KEYS: Record<keyof LastAttack, true> = {
  atSeq: true,
  barbarians: true,
  defenders: true,
  contributions: true,
  outcome: true,
  losers: true,
  defender: true,
  tied: true,
  pillaged: true,
};
const MERCHANT_KEYS: Record<keyof Merchant, true> = { player: true, hex: true };
const ALCHEMY_KEYS: Record<keyof Alchemy, true> = { player: true, dice: true };
const FLEET_KEYS: Record<keyof Fleet, true> = { player: true, kind: true };
const HARBOR_KEYS: Record<keyof Harbor, true> = { player: true, offers: true };

const HINT_KEYS: Record<keyof CitiesKnightsHints, true> = {
  recruitSites: true,
  knightSupply: true,
  knights: true,
  wallSites: true,
  improvements: true,
  commodityRates: true,
  costs: true,
  progressExcess: true,
  retreat: true,
  pillage: true,
  defenderDecks: true,
  scienceBonus: true,
  progress: true,
  harborTargets: true,
  twoForOne: true,
};

const KNIGHT_HINT_KEYS: Record<keyof KnightHint, true> = {
  vertex: true,
  level: true,
  active: true,
  canActivate: true,
  canPromote: true,
  canAct: true,
  moves: true,
  displace: true,
  chase: true,
};
const IMPROVEMENT_KEYS: Record<keyof CkImprovementOption, true> = {
  track: true,
  level: true,
  cost: true,
  commodity: true,
  metropolis: true,
  sites: true,
  blocked: true,
};
const PROGRESS_HINT_KEYS: Record<keyof CkProgressCardHint, true> = {
  card: true,
  track: true,
  count: true,
  playable: true,
  reason: true,
  targets: true,
};
const COSTS_KEYS: Record<keyof CitiesKnightsHints['costs'], true> = { wall: true, knight: true, promote: true, activate: true };
const SUPPLY_KEYS: Record<keyof CitiesKnightsHints['knightSupply'], true> = { 1: true, 2: true, 3: true };

// 聯集型別以 Record 鎖住：新增或移除成員會讓 tsc 失敗。
const BLOCK_REASONS: Record<CkBlockReason, true> = {
  'not-your-turn': true,
  pending: true,
  'before-roll': true,
  'after-roll': true,
  'no-target': true,
  cost: true,
  'robber-inactive': true,
  'alchemy-set': true,
};
const TRACK_NAMES: Record<CkTrack, true> = { science: true, trade: true, politics: true };
const EVENT_FACE_NAMES: Record<CkEventFace, true> = { ship: true, science: true, trade: true, politics: true };
const KNIGHT_LEVELS: Record<CkKnightLevel, true> = { 1: true, 2: true, 3: true };

const keysOf = (record: object): string[] => Object.keys(record).sort();

// Both maps list the same modules, so a module added to one cannot be forgotten in the other.
type SameKeys = [keyof ModuleViewMap] extends [keyof ModuleHintsMap]
  ? [keyof ModuleHintsMap] extends [keyof ModuleViewMap] ? true : never
  : never;
const sameKeys: SameKeys = true;
void sameKeys;

function viewOf(state: GameState, viewerId: string): CitiesKnightsView {
  const modules = projectGame(state, viewerId).modules as Partial<ModuleViewMap> | undefined;
  return modules!.citiesKnights!;
}

function hintsOf(state: GameState, playerId: string): CitiesKnightsHints {
  const modules = actionHints(state, playerId).modules as Partial<ModuleHintsMap> | undefined;
  return modules!.citiesKnights!;
}

/** p1 holds a city with an active knight and a wall; p2 holds a city and a progress card; the module slots are filled. */
function populated(): GameState {
  const state = emptyCkGame(4, 0, 'action');
  const [city, other, wall, k1, k2] = spreadVertices(state, 5);
  setBuilding(state, 'p1', city!, true);
  setBuilding(state, 'p2', other!, true);
  setBuilding(state, 'p1', wall!, true);
  addKnight(state, { player: 'p1', vertex: k1!, level: 2, active: true });
  addKnight(state, { player: 'p2', vertex: k2!, level: 1, active: false, activatedIn: state.windowId, promotedIn: state.windowId });
  const slot = ckState(state);
  slot.walls.push(wall!);
  slot.metropolises.science = { player: 'p1', vertex: city! };
  slot.toppled.push(other!);
  slot.progressVp.p1 = ['printing'];
  slot.lastRoll = { event: 'science', red: 3, atSeq: 1, alchemy: true };
  slot.merchant = { player: 'p2', hex: 4 };
  slot.alchemy = { player: 'p1', windowId: state.windowId, dice: [3, 4] };
  slot.fleets = [{ player: 'p1', windowId: state.windowId, kind: 'ore' }];
  slot.harbor = { player: 'p1', windowId: state.windowId, offers: { p2: 1, p3: 1, p4: 1 } };
  setImprovement(state, 'p1', 'trade', 3);
  give(state, 'p1', { wool: 1, ore: 1 });
  giveCommodities(state, 'p1', { paper: 2 });
  player(state, 'p1').progressCards = ['merchant', 'merchant', 'crane'];
  return state;
}

/** One ship from an attack; p1 holds a city and no knight, p2 a city and a knight, so p1 is pillaged. */
function pillageFrame(): GameState {
  const state = emptyCkGame(4, 0, 'preroll');
  ckState(state).barbarian = 6;
  const [a, b, c, k1] = spreadVertices(state, 4);
  setBuilding(state, 'p1', a!, true);
  setBuilding(state, 'p1', b!, true);
  setBuilding(state, 'p2', c!, true);
  addKnight(state, { player: 'p2', vertex: k1!, level: 1, active: true });
  return actCk(state, 'p1', { type: 'turn.roll' }, rollRng(6, 6, SHIP)).state;
}

describe('cities & knights module exports (bot plan CK-A)', () => {
  it('the module projects and hints through the exported functions', () => {
    const state = populated();
    const ctx = { profile: requireProfile(state.profileId) };
    expect(citiesKnightsModule.project!(state, 'p3', ctx)).toEqual(projectCitiesKnights(state));
    expect(citiesKnightsModule.actionHints!(state, 'p1', ctx)).toEqual(citiesKnightsHints(state, 'p1', ctx));
  });

  it('the projected view has exactly the keys of CitiesKnightsView', () => {
    const state = emptyCkGame(4, 0, 'action');
    for (const viewer of ['p1', 'p3']) expect(keysOf(viewOf(state, viewer))).toEqual(keysOf(VIEW_KEYS));
    expect(keysOf(projectCitiesKnights(state))).toEqual(keysOf(VIEW_KEYS));
    const fresh = viewOf(state, 'p1');
    expect(keysOf(fresh.barbarian)).toEqual(keysOf(BARBARIAN_KEYS));
    expect(fresh.lastRoll).toBeNull();
    expect(fresh.lastAttack).toBeNull();
    expect(fresh.merchant).toBeNull();
    expect(fresh.alchemy).toBeNull();
    expect(fresh.harbor).toBeNull();
    expect(fresh.fleets).toEqual([]);
    expect(keysOf(fresh.metropolises)).toEqual(keysOf(TRACK_NAMES));
    expect(keysOf(fresh.decks)).toEqual(keysOf(TRACK_NAMES));
  });

  it('a populated view keeps the key sets of every nested record', () => {
    const state = populated();
    const view = viewOf(state, 'p3');
    expect(keysOf(view)).toEqual(keysOf(VIEW_KEYS));
    expect(view.knights).toHaveLength(2);
    for (const knight of view.knights) expect(keysOf(knight)).toEqual(keysOf(KNIGHT_KEYS));
    expect(view.knights[1]).toMatchObject({ fresh: true, promoted: true });
    expect(view.walls).toHaveLength(1);
    expect(keysOf(view.walls[0]!)).toEqual(keysOf(WALL_KEYS));
    expect(keysOf(view.metropolises.science!)).toEqual(keysOf(METROPOLIS_KEYS));
    expect(view.metropolises.trade).toBeNull();
    expect(keysOf(view.lastRoll!)).toEqual(keysOf(LAST_ROLL_KEYS));
    expect(keysOf(view.merchant!)).toEqual(keysOf(MERCHANT_KEYS));
    expect(keysOf(view.alchemy!)).toEqual(keysOf(ALCHEMY_KEYS));
    expect(view.fleets).toHaveLength(1);
    expect(keysOf(view.fleets[0]!)).toEqual(keysOf(FLEET_KEYS));
    expect(keysOf(view.harbor!)).toEqual(keysOf(HARBOR_KEYS));
    expect(view.progressVp.p1).toEqual(['printing']);
    // 他人手牌只公開張數。
    expect(view.progressCounts).toEqual({ p1: 3, p2: 0, p3: 0, p4: 0 });
    expect(view.handLimit).toBe(CK_PROGRESS_HAND_LIMIT);
    expect(view.barbarian.length).toBe(CK_BARBARIAN_TRACK_LENGTH);
  });

  it('a barbarian attack leaves a lastAttack with the declared keys', () => {
    const state = emptyCkGame(4, 0, 'preroll');
    ckState(state).barbarian = 6;
    const [a, b, k1] = spreadVertices(state, 3);
    setBuilding(state, 'p1', a!, true);
    setBuilding(state, 'p2', b!, true);
    addKnight(state, { player: 'p2', vertex: k1!, level: 2, active: true });
    const rolled = actCk(state, 'p1', { type: 'turn.roll' }, rollRng(6, 6, SHIP));
    const view = viewOf(rolled.state, 'p3');
    expect(keysOf(view.lastAttack!)).toEqual(keysOf(LAST_ATTACK_KEYS));
    expect(view.lastAttack).toMatchObject({ outcome: 'defenders', defender: 'p2' });
    expect(view.robberActive).toBe(true);
    expect(view.barbarian).toMatchObject({ position: 0, attacks: 1 });
  });

  it('the hints have exactly the keys of CitiesKnightsHints for every viewer and phase', () => {
    const action = emptyCkGame(4, 0, 'action');
    const preroll = emptyCkGame(4, 0, 'preroll');
    const setup = ckGame(4).state;
    expect(setup.turn.setup).not.toBeNull();
    for (const state of [action, preroll, setup, populated(), pillageFrame()]) {
      for (const playerId of ['p1', 'p2', 'p4']) expect(keysOf(hintsOf(state, playerId))).toEqual(keysOf(HINT_KEYS));
    }
    const hints = hintsOf(action, 'p1');
    expect(keysOf(citiesKnightsHints(action, 'p1', { profile: requireProfile(action.profileId) }))).toEqual(keysOf(HINT_KEYS));
    expect(keysOf(hints.costs)).toEqual(keysOf(COSTS_KEYS));
    expect(keysOf(hints.knightSupply)).toEqual(keysOf(SUPPLY_KEYS));
    expect(keysOf(hints.commodityRates)).toEqual([...COMMODITIES].sort());
  });

  it('hints are non-trivial where they should be (the key lists are not satisfied by empty values)', () => {
    const state = populated();
    const mine = hintsOf(state, 'p1');
    expect(mine.knights).toHaveLength(1);
    expect(keysOf(mine.knights[0]!)).toEqual(keysOf(KNIGHT_HINT_KEYS));
    expect(mine.improvements).toHaveLength(CK_TRACKS.length);
    for (const option of mine.improvements) expect(keysOf(option)).toEqual(keysOf(IMPROVEMENT_KEYS));
    expect(mine.progress.map((entry) => entry.card).sort()).toEqual(['crane', 'merchant']);
    for (const entry of mine.progress) expect(keysOf(entry)).toEqual(keysOf(PROGRESS_HINT_KEYS));
    expect(mine.progress.find((entry) => entry.card === 'merchant')!.count).toBe(2);
    expect(mine.wallSites.length).toBeGreaterThan(0);
    expect(mine.progressExcess).toBe(0);
    // 貿易 3 級：商品 2:1；沒有港口與等級的座位是 4:1。
    expect(mine.commodityRates).toEqual({ paper: 2, cloth: 2, coin: 2 });
    expect(hintsOf(state, 'p3').commodityRates).toEqual({ paper: 4, cloth: 4, coin: 4 });
    expect(mine.costs).toEqual({ wall: CK_WALL_COST, knight: CK_KNIGHT_COST, promote: CK_PROMOTE_COST, activate: CK_ACTIVATE_COST });
    // 其他座位沒有騎士也沒有手牌可出。
    expect(hintsOf(state, 'p3').knights).toEqual([]);
    expect(hintsOf(state, 'p3').progress).toEqual([]);
  });

  it('a pillage frame shows up in the responder\'s hints only', () => {
    const state = pillageFrame();
    expect(moduleFrame(state)).toMatchObject({ kind: CK_PILLAGE_FRAME, responders: ['p1'] });
    expect(hintsOf(state, 'p1').pillage.length).toBeGreaterThan(0);
    expect(hintsOf(state, 'p2').pillage).toEqual([]);
  });

  it('exports the constants the bots read', () => {
    expect(CITIES_KNIGHTS).toBe('citiesKnights');
    expect(CITIES_KNIGHTS).toBe(citiesKnightsModule.id);
    expect(CK_TRACKS).toEqual(['science', 'trade', 'politics']);
    expect(CK_TRACK_COMMODITY).toEqual({ science: 'paper', trade: 'cloth', politics: 'coin' });
    expect([CK_MAX_LEVEL, CK_ABILITY_LEVEL, CK_METROPOLIS_LEVEL, CK_PERMANENT_METROPOLIS_LEVEL]).toEqual([5, 3, 4, 5]);
    expect([0, 1, 2, 3, 4, 5].map(ckDrawThreshold)).toEqual([0, 2, 3, 4, 5, 6]);
    expect(CK_WALL_COST).toEqual({ brick: 2 });
    expect(CK_KNIGHT_COST).toEqual({ wool: 1, ore: 1 });
    expect(CK_PROMOTE_COST).toEqual({ wool: 1, ore: 1 });
    expect(CK_ACTIVATE_COST).toEqual({ grain: 1 });
    expect([CK_MAX_WALLS, CK_WALL_HAND_BONUS, CK_KNIGHTS_PER_LEVEL]).toEqual([3, 2, 2]);
    expect([CK_BARBARIAN_TRACK_LENGTH, CK_PROGRESS_HAND_LIMIT]).toEqual([7, 4]);
    expect(CK_EVENT_FACES).toEqual(['ship', 'ship', 'ship', 'science', 'trade', 'politics']);
    expect(CK_VP_PROGRESS_CARDS).toEqual(['printing', 'constitution']);
    expect(CK_MEDICINE_COST).toEqual({ grain: 1, ore: 2 });
    expect(CK_FIXED_DISCS).toEqual([2, 6, 8, 12]);
  });

  it('exports the three progress decks with 18 cards each, VP cards in their own deck', () => {
    expect(keysOf(CK_PROGRESS_DECKS)).toEqual(keysOf(TRACK_NAMES));
    for (const track of CK_TRACKS) expect(CK_PROGRESS_DECKS[track]).toHaveLength(18);
    expect(CK_PROGRESS_DECKS.science).toContain('printing');
    expect(CK_PROGRESS_DECKS.politics).toContain('constitution');
    const cards: ProgressCardType[] = CK_TRACKS.flatMap((track) => CK_PROGRESS_DECKS[track]);
    expect(new Set(cards).size).toBe(25);
    // 新局的牌堆與匯出的牌組同身分。
    const state = emptyCkGame(4);
    for (const track of CK_TRACKS) expect([...state.progressDecks[track]].sort()).toEqual([...CK_PROGRESS_DECKS[track]].sort());
  });

  it('the exported union types list every member', () => {
    expect(keysOf(TRACK_NAMES)).toEqual([...CK_TRACKS].sort());
    expect(keysOf(EVENT_FACE_NAMES)).toEqual([...new Set(CK_EVENT_FACES)].sort());
    expect(keysOf(KNIGHT_LEVELS)).toEqual(['1', '2', '3']);
    // 手牌提示的 reason 只會是 BlockReason 的成員。
    const state = populated();
    const reasons = new Set(hintsOf(state, 'p1').progress.map((entry) => entry.reason));
    for (const reason of reasons) expect(reason === null || reason in BLOCK_REASONS).toBe(true);
  });

  it('the shared base exports sit next to the C&K ones', () => {
    const kinds: readonly CardKind[] = CARD_KINDS;
    expect(kinds).toEqual(['lumber', 'brick', 'wool', 'grain', 'ore', 'paper', 'cloth', 'coin']);
    expect(COMMODITIES).toEqual(['paper', 'cloth', 'coin']);
    expect(TERRAIN_COMMODITY).toMatchObject({ forest: 'paper', pasture: 'cloth', mountains: 'coin' });
  });

  it('the frame kind constants match the strings the rules use', () => {
    const frames = {
      pillage: CK_PILLAGE_FRAME,
      defenderDraw: CK_DEFENDER_FRAME,
      displaced: CK_DISPLACED_FRAME,
      progressDiscard: CK_PROGRESS_DISCARD_FRAME,
      scienceBonus: CK_SCIENCE_FRAME,
      resolveRoll: CK_RESOLVE_ROLL_FRAME,
      harborExchange: CK_HARBOR_FRAME,
      guildDues: CK_GUILD_DUES_FRAME,
      espionage: CK_ESPIONAGE_FRAME,
      sabotage: CK_SABOTAGE_FRAME,
      wedding: CK_WEDDING_FRAME,
      treasonRemove: CK_TREASON_REMOVE_FRAME,
      treasonPlace: CK_TREASON_PLACE_FRAME,
      diplomacyRoad: CK_DIPLOMACY_FRAME,
    };
    expect(Object.keys(frames)).toHaveLength(14);
    for (const [name, kind] of Object.entries(frames)) expect(kind).toBe(`citiesKnights.${name}`);
    expect(new Set(Object.values(frames)).size).toBe(14);
  });

  it('real frames carry the exported kinds', () => {
    // 其餘 frame 由 ck-barbarians／ck-progress-*／ck-knights 的案例以同樣字串斷言。
    expect(moduleFrame(pillageFrame())).toMatchObject({ kind: CK_PILLAGE_FRAME, module: CITIES_KNIGHTS });
    const science = emptyCkGame(4, 0, 'preroll');
    setImprovement(science, 'p2', 'science', 3);
    const rolled = actCk(science, 'p1', { type: 'turn.roll' }, rollRng(5, 6, TRADE));
    expect(moduleFrame(rolled.state)).toMatchObject({ kind: CK_SCIENCE_FRAME, responders: ['p2'] });
    // 其他座位看到的 pending 也是同一個 kind。
    expect((projectGame(rolled.state, 'p4').pending as { kind: string } | null)?.kind).toBe(CK_SCIENCE_FRAME);
  });
});
