/**
 * Seafarers + Cities & Knights 組合層的 ModuleTestKit（SF+CK 計畫 §5 SFCK-3、§12.1）。
 *
 * 只放「兩個擴充同時在場才有」的部分；SF 的守恆與 `gold.choose` 回應、C&K 的守恆、`hideDifferently` 與 13 個回應指令
 * 仍由各自的 kit 提供，本 kit **不呼叫**它們（bench 會把三個 kit 一起用，呼叫了計數會重複）。
 * family 測試明列 `[seafarersKit, citiesKnightsKit, sfckKit]`：`perturb` 依陣列順序套用，所以本 kit 最後執行，
 * 修補前兩者擾動出來、但組合層裡不可能出現的狀態。bench 的 `kitsOf(profile, BENCH_KITS)` 不做 perturb，只計數。
 *
 * 提供：
 * - conservation：首攻前兩個盜賊都在外框（強盜 -1、海盜 null）、沒有 `moveRobber` frame；首攻後強盜在陸地；海盜在海格或外框；
 *   `moveRobber` 的 `pirate` 旗標只出現在追擊（`cause: 'knight'`）之後；商人不站在金礦格（COMB-9）；
 * - perturb：SF kit 無條件把海盜放到海格、也會佈置 `moveRobber cause:'seven'`，這兩種狀態在首攻前都不可能出現，
 *   先修補（海盜設回 null、強盜 -1、拿掉 `moveRobber`）；再擾動首攻前後、海盜位置、船端的騎士（自己的與對手的）、
 *   騎士相鄰海盜（`knight.chasePirate` 的時機）與三種 `bandit` frame；最後再修補一次，維持上述不變量；
 * - mechanics：`sfck.knightChasedPirate` 事件、`either` 時強盜與海盜各移幾次、自己的騎士釘住自己船的窗口數、
 *   騎士站在自己可蓋的小島空點的窗口數（鍵的格式見 `SfckMechanicsTally`，不與 SF／C&K kit 的鍵重複）。
 *
 * 沒有 `hideDifferently`（組合層沒有額外的隱藏資訊）、也沒有 `responseCommands`（`knight.chasePirate` 只有行動者送）。
 *
 * 不得 import `rules/test/*`：bench 會把 kit 打包進去，那些 helper 依賴 vitest。這裡只用 `@catan/rules` 的公開 API。
 */

import {
  actionHints,
  CITIES_KNIGHTS,
  isLandHex,
  moduleStateOf,
  requireProfile,
  SEAFARERS_CITIES_KNIGHTS,
  topologyOf,
  type GameState,
  type MoveRobberPending,
  type Rng,
} from '@catan/rules';
import type { MechanicsStep, MechanicsTally, ModuleTestKit } from './types.ts';

/** `moveRobber` frame 對應的三種 `bandit` hint（與 rules 的 `SfckBandit` 相同）。 */
export type StagedBandit = 'robber' | 'pirate' | 'either';

/** rules 的 `CitiesKnightsState` 沒有匯出；這裡只宣告會讀寫的欄位。 */
interface CkKnight {
  player: string;
  vertex: number;
  level: 1 | 2 | 3;
  active: boolean;
  activatedIn?: number;
  promotedIn?: number;
}

interface CkSlot {
  attacks: number;
  knights: CkKnight[];
  merchant?: { player: string; hex: number } | null;
}

function slotOf(state: GameState): CkSlot | undefined {
  return moduleStateOf<CkSlot>(state, CITIES_KNIGHTS);
}

function pick<T>(items: readonly T[], rng: Rng): T {
  return items[rng.int(items.length)]!;
}

function seaHexesOf(state: GameState): number[] {
  const out: number[] = [];
  state.board.layout.terrain.forEach((terrain, hex) => {
    if (terrain === 'sea') out.push(hex);
  });
  return out;
}

// ---------------------------------------------------------------------------
// conservation
// ---------------------------------------------------------------------------

function conservation(state: GameState): readonly string[] {
  const problems: string[] = [];
  const slot = slotOf(state);
  if (!slot) return [`missing ${CITIES_KNIGHTS} state`];
  const { terrain } = state.board.layout;
  const { robber, pirate } = state.board;
  const attacked = slot.attacks > 0;

  if (!attacked) {
    // 首攻之前兩個盜賊都在外框（CK25 pp. 6、12；COMB-10）。
    if (robber !== -1) problems.push(`robber ${robber} is on the board before the first attack`);
    if (pirate !== null) problems.push(`pirate ${String(pirate)} is on the board before the first attack`);
  } else if (!Number.isInteger(robber) || robber < 0 || robber >= terrain.length || terrain[robber] === 'sea') {
    problems.push(`robber ${robber} is not on a land hex after the first attack`);
  }
  if (pirate !== null && (!Number.isInteger(pirate) || pirate < 0 || pirate >= terrain.length || terrain[pirate] !== 'sea')) {
    problems.push(`pirate ${String(pirate)} is not on a sea hex`);
  }

  const pending = state.pending;
  if (pending?.kind === 'moveRobber') {
    if (!attacked) problems.push('moveRobber frame before the first attack');
    if (pending.pirate === true && pending.cause !== 'knight') {
      problems.push(`pirate moveRobber frame with cause ${pending.cause}: only a knight chases the pirate`);
    }
    // 追擊海盜要鄰接海盜所在的海格，所以海盜一定在場上。
    if (pending.pirate === true && pirate === null) problems.push('pirate moveRobber frame while the pirate is off the board');
  }

  const merchant = slot.merchant;
  if (merchant && terrain[merchant.hex] === 'gold') problems.push(`the merchant stands on the gold field ${merchant.hex}`);
  return problems;
}

// ---------------------------------------------------------------------------
// perturb
// ---------------------------------------------------------------------------

/** 第一次蠻族攻擊之後：強盜進場，位置與 rules 相同（`layout.robber`）。 */
function enterFirstAttack(state: GameState, slot: CkSlot): void {
  if (slot.attacks === 0) slot.attacks = 1;
  if (state.board.robber < 0) state.board.robber = state.board.layout.robber;
}

/**
 * 組合層不可能出現的盜賊狀態：首攻前兩個盜賊都在外框、沒有 `moveRobber` frame；首攻後強盜一定在場。
 * 其他模組的擾動（SF kit 的海盜、`moveRobber cause:'seven'`）與本 kit 自己的翻轉之後都要呼叫一次。
 */
function repairBandits(state: GameState, slot: CkSlot): void {
  if (slot.attacks === 0) {
    state.board.robber = -1;
    state.board.pirate = null;
    if (state.pending?.kind === 'moveRobber') state.pending = null;
  } else if (state.board.robber < 0) {
    state.board.robber = state.board.layout.robber;
  }
}

function isFreeVertex(state: GameState, slot: CkSlot, vertex: number): boolean {
  return !state.board.buildings[vertex] && !slot.knights.some((knight) => knight.vertex === vertex);
}

/** 這個玩家的船的「開放端」：沒有建築、也沒有接這個玩家別條道路或船的船端頂點（沒有騎士站著）。 */
function openShipEnds(state: GameState, slot: CkSlot, playerId: string): number[] {
  const topo = topologyOf(state);
  const { roads, buildings } = state.board;
  const out = new Set<number>();
  roads.forEach((road, edge) => {
    if (!road || !road.ship || road.player !== playerId) return;
    for (const vertex of topo.edges[edge]!.vertices) {
      if (buildings[vertex] || !isFreeVertex(state, slot, vertex)) continue;
      const linked = topo.vertices[vertex]!.edges.some((other) => other !== edge && roads[other]?.player === playerId);
      if (!linked) out.add(vertex);
    }
  });
  return [...out].sort((a, b) => a - b);
}

/** 讓 `owner` 的一隻騎士站在 `vertex`：優先搬動既有的騎士（張數與等級上限不變），其次補一隻 1 級騎士。 */
function placeKnight(state: GameState, slot: CkSlot, owner: string, vertex: number, rng: Rng): CkKnight | null {
  const profile = requireProfile(state.profileId);
  const own = slot.knights.filter((knight) => knight.player === owner);
  const canAdd = own.length < profile.pieces.knights && own.filter((knight) => knight.level === 1).length < 2;
  if (own.length > 0 && (!canAdd || rng.int(3) !== 0)) {
    const knight = pick(own, rng);
    knight.vertex = vertex;
    return knight;
  }
  if (!canAdd) return null;
  const knight: CkKnight = { player: owner, vertex, level: 1, active: rng.int(2) === 0 };
  slot.knights.push(knight);
  return knight;
}

/** 能行動的騎士（`active`、本視窗沒有剛啟動或升級）：清掉那兩個標記。 */
function readyKnight(knight: CkKnight): void {
  knight.active = true;
  delete knight.activatedIn;
  delete knight.promotedIn;
}

/**
 * 在行動者的行動階段（沒有待決效果）佈置「騎士相鄰海盜」：首攻之後，行動者有一隻能行動的騎士站在鄰接海格的路口，
 * 海盜停在那個海格上，所以 `hints.modules.seafarersCitiesKnights.pirateChase` 非空，標準 Bot 可以考慮 `knight.chasePirate`。
 * 既有的騎士鄰接海格就直接用，否則在空的海岸路口（同時鄰接陸地與海）放一隻。條件不足時回 false，狀態不變。
 */
export function stagePirateChase(state: GameState, rng: Rng): boolean {
  if (state.result || state.pending || state.turn.phase !== 'action') return false;
  const slot = slotOf(state);
  const actor = state.players[state.turn.seat];
  if (!slot || !actor) return false;
  const topo = topologyOf(state);
  const seaAround = (vertex: number): number[] => topo.vertices[vertex]!.hexes.filter((hex) => !isLandHex(state, hex));

  const placed = slot.knights.filter((knight) => knight.player === actor.id && seaAround(knight.vertex).length > 0);
  let knight: CkKnight | null = placed.length > 0 ? pick(placed, rng) : null;
  if (!knight) {
    const coast: number[] = [];
    topo.vertices.forEach((info, vertex) => {
      if (!isFreeVertex(state, slot, vertex)) return;
      if (info.hexes.some((hex) => isLandHex(state, hex)) && seaAround(vertex).length > 0) coast.push(vertex);
    });
    if (coast.length === 0) return false;
    knight = placeKnight(state, slot, actor.id, pick(coast, rng), rng);
    if (!knight) return false;
  }
  readyKnight(knight);
  enterFirstAttack(state, slot);
  state.board.pirate = pick(seaAround(knight.vertex), rng);
  return true;
}

/**
 * 佈置一個待行動者移動盜賊的 `moveRobber` frame（行動階段、沒有待決效果；首攻之後才可能出現）：
 * `either` 是首攻後擲出 7（`cause: 'seven'`）；`robber` 是追擊強盜之後；`pirate` 是追擊海盜之後，海盜此時在海格上。
 * 條件不足時回 false，狀態不變。
 */
export function stageBandit(state: GameState, bandit: StagedBandit, rng: Rng): boolean {
  if (state.result || state.pending || state.turn.phase !== 'action') return false;
  const slot = slotOf(state);
  const actor = state.players[state.turn.seat];
  if (!slot || !actor) return false;
  enterFirstAttack(state, slot);
  if (bandit === 'pirate') {
    const sea = seaHexesOf(state);
    if (sea.length === 0) return false;
    state.board.pirate = pick(sea, rng);
  }
  const pending: MoveRobberPending = {
    kind: 'moveRobber',
    actor: actor.id,
    cause: bandit === 'either' ? 'seven' : 'knight',
    pirate: bandit === 'pirate',
  };
  state.pending = pending;
  return true;
}

/** 把一隻騎士（自己的或對手的）放在某艘船的開放端，讓該船不能移（COMB-4、COMB-5）。沒有合適的船端時回 false。 */
function pinShip(state: GameState, slot: CkSlot, actorId: string, rng: Rng): boolean {
  const owners = state.players.map((player) => player.id);
  // 三分之二的機率釘自己的船（那是「自己的騎士壓住自己的船」的情境），其餘釘隨機一位玩家的船。
  const owner = rng.int(3) === 0 ? pick(owners, rng) : actorId;
  const ends = openShipEnds(state, slot, owner);
  if (ends.length === 0) return false;
  // 站的人：自己的騎士（`owner` 自己的船）或對手的騎士。
  const standing = rng.int(3) === 0 ? pick(owners, rng) : owner;
  return placeKnight(state, slot, standing, pick(ends, rng), rng) !== null;
}

function perturb(state: GameState, rng: Rng): void {
  const slot = slotOf(state);
  if (!slot) return;
  // 先修補 SF kit 擾動出來的首攻前狀態（海盜在海上、`moveRobber cause:'seven'`）。
  repairBandits(state, slot);
  if (state.result || state.turn.phase === 'setup') return;

  // 首攻前後：翻轉一次（回到首攻前時，下面的修補會把盜賊收回外框）。
  if (slot.attacks === 0 && rng.int(4) === 0) enterFirstAttack(state, slot);
  else if (slot.attacks > 0 && rng.int(8) === 0) slot.attacks = 0;

  if (slot.attacks > 0) {
    // 海盜位置：任一海格，或回到外框。待行動者移動盜賊時不動它（追擊海盜之後，海盜一定在場上）。
    if (state.pending?.kind !== 'moveRobber' && rng.int(2) === 0) {
      state.board.pirate = rng.int(5) === 0 ? null : pick(seaHexesOf(state), rng);
    }
    // SF kit 佈置的 `moveRobber`（擲出 7）有一半換成別種 bandit frame，三種 frame 才都有機會出現。
    if (state.pending?.kind === 'moveRobber' && state.turn.phase === 'action' && rng.int(2) === 0) state.pending = null;
    if (!state.pending) {
      const actor = state.players[state.turn.seat]!;
      const roll = rng.int(4);
      // 騎士釘船、騎士相鄰海盜各 1/4，三種 bandit frame 合計 1/2。
      if (roll === 0) pinShip(state, slot, actor.id, rng);
      else if (roll === 1) stagePirateChase(state, rng);
      else stageBandit(state, pick(['robber', 'pirate', 'either'] as const, rng), rng);
    }
  } else if (!state.pending && rng.int(3) === 0) {
    // 首攻前也擾動船端的騎士（海盜不在場，但騎士一樣會釘船）。
    pinShip(state, slot, state.players[state.turn.seat]!.id, rng);
  }
  repairBandits(state, slot);
}

// ---------------------------------------------------------------------------
// mechanics（Q3 計數器）
// ---------------------------------------------------------------------------

function cloneState(state: GameState): GameState {
  return JSON.parse(JSON.stringify(state)) as GameState;
}

/** 路口周圍有小島的陸地格（島嶼 id > 1，主島是 1）。 */
function onSmallIsland(state: GameState, vertex: number): boolean {
  return topologyOf(state).vertices[vertex]!.hexes.some(
    (hex) => isLandHex(state, hex) && (state.board.layout.islands[hex] ?? 0) > 1,
  );
}

interface SeaHints {
  movableShips?: { edge: number }[];
}

/**
 * 鍵（全部是整數累計，`harness` 會再加上 `seafarersCitiesKnights.` 前綴；鍵與 SF、C&K kit 的不重複）：
 * - `knightChasedPirate`：`sfck.knightChasedPirate` 事件（全部來源）；`policy.knightChasedPirate`：策略送出的；
 *   `<level>.knightChasedPirate`：策略送出、依座位難度細分（standard／easy）。`knight.chasePirate` 的指令數另見
 *   C&K kit 的 `cmd.knight.chasePirate`（它的 regex 會計入）；
 * - `either.robber`、`either.pirate`：首攻後擲出 7（`either` frame）時移強盜、移海盜各幾次；`either.<level>.robber|pirate`
 *   依座位難度細分。`chased.robber`、`chased.pirate`：追擊（`cause: 'knight'`）之後移動的盜賊；
 * - `window.evaluated`：行動者開啟的行動視窗數（每個 `(windowId, 行動者)` 只算一次，在視窗的第一個行動指令之前取樣）；
 *   `window.movable`：其中 SF 模型認為至少有一艘船可移的視窗（不看自己的騎士）；`window.selfPinned`：其中有船因為
 *   「自己的騎士」站在開放端而不能移的視窗；`window.knightOnIslandSpot`：其中自己的騎士站在「自己能蓋聚落的小島空點」的視窗
 *   （把自己的騎士拿掉就能蓋，別人的騎士不動）。
 */
class SfckMechanicsTally implements MechanicsTally {
  private readonly counts: Record<string, number> = {};
  private readonly seen = new Set<string>();

  private bump(key: string, by = 1): void {
    this.counts[key] = (this.counts[key] ?? 0) + by;
  }

  observe(step: MechanicsStep): void {
    const { level, source } = step;
    for (const event of step.events) {
      const params = event.params as Record<string, unknown>;
      switch (event.type) {
        case 'sfck.knightChasedPirate':
          this.bump('knightChasedPirate');
          if (source === 'policy') {
            this.bump('policy.knightChasedPirate');
            this.bump(`${level}.knightChasedPirate`);
          }
          break;
        case 'robber.moved':
        case 'pirate.moved': {
          const bandit = event.type === 'pirate.moved' ? 'pirate' : 'robber';
          if (params.cause === 'knight') {
            this.bump(`chased.${bandit}`);
          } else {
            this.bump(`either.${bandit}`);
            this.bump(`either.${level}.${bandit}`);
          }
          break;
        }
        default:
      }
    }
    this.observeWindow(step);
  }

  /** 行動視窗的取樣：用套用前的狀態、行動者自己的 hints；移掉自己的騎士後再算一次，差異就是自己的騎士造成的。 */
  private observeWindow(step: MechanicsStep): void {
    const { actor, before } = step;
    if (before.result || before.pending || before.turn.phase !== 'action') return;
    if (before.players[before.turn.seat]?.id !== actor) return;
    const key = `${before.windowId}:${actor}`;
    if (this.seen.has(key)) return;
    this.seen.add(key);
    this.bump('window.evaluated');

    const slot = slotOf(before);
    const ownKnights = slot?.knights.filter((knight) => knight.player === actor) ?? [];
    const hasShips = before.board.roads.some((road) => road?.ship === true && road.player === actor);
    if (!slot || (!hasShips && ownKnights.length === 0)) return;

    const hints = actionHints(before, actor);
    const movableNow = new Set(((hints.modules?.seafarers as SeaHints | undefined)?.movableShips ?? []).map((ship) => ship.edge));
    if (ownKnights.length === 0) {
      if (movableNow.size > 0) this.bump('window.movable');
      return;
    }

    const free = cloneState(before);
    const freeSlot = slotOf(free)!;
    freeSlot.knights = freeSlot.knights.filter((knight) => knight.player !== actor);
    const freeHints = actionHints(free, actor);
    const movableFree = ((freeHints.modules?.seafarers as SeaHints | undefined)?.movableShips ?? []).map((ship) => ship.edge);
    if (movableFree.length > 0) this.bump('window.movable');
    if (movableFree.some((edge) => !movableNow.has(edge))) this.bump('window.selfPinned');

    const spotsNow = new Set(hints.legalSettlements);
    const standing = new Set(ownKnights.map((knight) => knight.vertex));
    if (freeHints.legalSettlements.some((vertex) => !spotsNow.has(vertex) && standing.has(vertex) && onSmallIsland(before, vertex))) {
      this.bump('window.knightOnIslandSpot');
    }
  }

  snapshot(): Readonly<Record<string, number>> {
    return { ...this.counts };
  }
}

export const sfckKit: ModuleTestKit = {
  id: SEAFARERS_CITIES_KNIGHTS,
  conservation,
  perturb,
  mechanics: () => new SfckMechanicsTally(),
};

