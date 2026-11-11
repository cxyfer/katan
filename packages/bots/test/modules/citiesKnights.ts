/**
 * Cities & Knights 的 ModuleTestKit（C&K 計畫 §5 CK-B1、§6.1）。
 *
 * 提供：
 * - conservation：資源與 commodity 守恆、54 張進步卡的身分守恆、每級騎士 ≤ 2 與總數 ≤ `pieces.knights`、
 *   建築與騎士不同點、城牆與改良的上限；
 * - hideDifferently：交換對手的資源與 commodity（手牌張數不變）、把對手的進步卡與同牌組的牌互換、
 *   反轉各牌組（張數是公開的）。guildDues／espionage 的行動者看得到受害者的手牌，那位受害者不動；
 * - perturb：重新分配 commodity 與進步卡、挪動騎士、調整蠻族位置，並在沒有待決效果時偶爾注入 C&K 的
 *   frame（形狀依 rules 的實際投影，見 `stageFrame`）；
 * - responseCommands：宣告 13 個 pending 指令；
 * - mechanics（B2）：Q2 計數器，事件欄位一律讀 `event.params.*`，指令與事件分「策略」與「保底」兩種來源，
 *   並分 standard／easy 兩種難度（鍵的格式見 `CkMechanicsTally`）。
 *
 * 不得 import `rules/test/ck-checks.ts`：它依賴 vitest 的 `expect`，而 bench 會把 kit 打包進去。這裡只用
 * `@catan/rules` 的公開 API，檢查回傳字串清單。
 */

import {
  actionHints,
  CK_BARBARIAN_TRACK_LENGTH,
  CK_DEFENDER_FRAME,
  CK_DIPLOMACY_FRAME,
  CK_DISPLACED_FRAME,
  CK_ESPIONAGE_FRAME,
  CK_GUILD_DUES_FRAME,
  CK_HARBOR_FRAME,
  CK_MAX_LEVEL,
  CK_MAX_WALLS,
  CK_PILLAGE_FRAME,
  CK_PROGRESS_DECKS,
  CK_PROGRESS_DISCARD_FRAME,
  CK_SABOTAGE_FRAME,
  CK_SCIENCE_FRAME,
  CK_TRACKS,
  CK_VP_PROGRESS_CARDS,
  CK_TREASON_PLACE_FRAME,
  CK_TREASON_REMOVE_FRAME,
  CK_WEDDING_FRAME,
  CITIES_KNIGHTS,
  COMMODITIES,
  isLandHex,
  moduleStateOf,
  RESOURCES,
  requireProfile,
  topologyOf,
  type CkTrack,
  type GameState,
  type ModulePending,
  type PlayerState,
  type ProgressCardType,
  type Rng,
} from '@catan/rules';
import type { MechanicsStep, MechanicsTally, ModuleTestKit } from './types.ts';

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
  barbarian: number;
  attacks: number;
  knights: CkKnight[];
  walls: number[];
  progressVp: Record<string, ProgressCardType[]>;
  metropolises?: Record<string, { player: string; vertex: number } | null>;
}

function slotOf(state: GameState): CkSlot | undefined {
  return moduleStateOf<CkSlot>(state, CITIES_KNIGHTS);
}

/** 分數卡（printing、constitution）打出時立刻攤開，不會留在手牌：擾動與換牌都不得把它們放進手牌。 */
function isHeldCard(card: ProgressCardType): boolean {
  return !CK_VP_PROGRESS_CARDS.includes(card);
}

/** 進步卡所屬的牌組（棄牌與換牌都放回自己的牌組）。 */
function trackOf(card: ProgressCardType): CkTrack | undefined {
  return CK_TRACKS.find((track) => CK_PROGRESS_DECKS[track].includes(card));
}

function handTotal(player: PlayerState): number {
  return (
    RESOURCES.reduce((sum, resource) => sum + player.resources[resource], 0) +
    COMMODITIES.reduce((sum, commodity) => sum + player.commodities[commodity], 0)
  );
}

/** 手上持有的牌（進步卡含剛抽到的）。 */
function progressHeld(player: PlayerState, slot: CkSlot | undefined): ProgressCardType[] {
  return [...player.progressCards, ...(player.newProgressCards ?? []), ...(slot?.progressVp[player.id] ?? [])];
}

// ---------------------------------------------------------------------------
// conservation
// ---------------------------------------------------------------------------

function conservation(state: GameState): readonly string[] {
  const problems: string[] = [];
  const profile = requireProfile(state.profileId);
  const slot = slotOf(state);

  for (const resource of RESOURCES) {
    const total = state.bank[resource] + state.players.reduce((sum, player) => sum + player.resources[resource], 0);
    if (total !== profile.bankPerResource) problems.push(`resource ${resource} supply ${total} != ${profile.bankPerResource}`);
    if (state.bank[resource] < 0) problems.push(`bank ${resource} < 0: ${state.bank[resource]}`);
    for (const player of state.players) {
      if (player.resources[resource] < 0) problems.push(`${player.id} ${resource} < 0: ${player.resources[resource]}`);
    }
  }
  for (const commodity of COMMODITIES) {
    const total = state.commodityBank[commodity] + state.players.reduce((sum, player) => sum + player.commodities[commodity], 0);
    if (total !== profile.commodityBankPerType) {
      problems.push(`commodity ${commodity} supply ${total} != ${profile.commodityBankPerType}`);
    }
    if (state.commodityBank[commodity] < 0) problems.push(`commodity bank ${commodity} < 0: ${state.commodityBank[commodity]}`);
    for (const player of state.players) {
      if (player.commodities[commodity] < 0) problems.push(`${player.id} ${commodity} < 0: ${player.commodities[commodity]}`);
    }
  }

  // 每個牌組：牌庫加上持有（手牌、剛抽到、攤開的分數卡）恰好是原本的組成。
  for (const track of CK_TRACKS) {
    const held = state.players.flatMap((player) => progressHeld(player, slot)).filter((card) => trackOf(card) === track);
    const all = [...state.progressDecks[track], ...held].sort();
    const expected = CK_PROGRESS_DECKS[track].slice().sort();
    if (JSON.stringify(all) !== JSON.stringify(expected)) {
      problems.push(`progress deck ${track}: ${all.length} cards, expected ${expected.length} of the same identities`);
    }
  }

  const knights = slot?.knights ?? [];
  const seen = new Set<number>();
  for (const knight of knights) {
    if (seen.has(knight.vertex)) problems.push(`two knights at vertex ${knight.vertex}`);
    seen.add(knight.vertex);
    if (state.board.buildings[knight.vertex]) problems.push(`knight and building share vertex ${knight.vertex}`);
  }
  for (const player of state.players) {
    const own = knights.filter((knight) => knight.player === player.id);
    if (own.length > profile.pieces.knights) problems.push(`${player.id} has ${own.length} knights > ${profile.pieces.knights}`);
    for (const level of [1, 2, 3]) {
      const count = own.filter((knight) => knight.level === level).length;
      if (count > 2) problems.push(`${player.id} has ${count} level-${level} knights > 2`);
    }
    if (player.cityWalls > CK_MAX_WALLS) problems.push(`${player.id} has ${player.cityWalls} walls > ${CK_MAX_WALLS}`);
    for (const track of CK_TRACKS) {
      if (player.improvements[track]! > CK_MAX_LEVEL) problems.push(`${player.id} ${track} level ${player.improvements[track]} > ${CK_MAX_LEVEL}`);
    }
  }
  return problems;
}

// ---------------------------------------------------------------------------
// hideDifferently
// ---------------------------------------------------------------------------

/** 這個 frame 讓 `viewerId` 看得到手牌或進步卡的玩家：行動者看得到 guildDues 與 espionage 的受害者。 */
function revealedTo(state: GameState, viewerId: string): Set<string> {
  const out = new Set<string>();
  const frame = state.pending as ModulePending | null;
  if (!frame || !('module' in frame) || frame.module !== CITIES_KNIGHTS || !frame.responders.includes(viewerId)) return out;
  if (frame.kind === CK_GUILD_DUES_FRAME || frame.kind === CK_ESPIONAGE_FRAME) out.add(frame.data.victim as string);
  return out;
}

function hideDifferently(variant: GameState, viewerId: string): boolean {
  let changed = false;
  const visible = revealedTo(variant, viewerId);
  const opponents = variant.players.filter((player) => player.id !== viewerId && !visible.has(player.id));

  // 兩位對手各交換一張牌：一位的資源換另一位的 commodity，手牌張數不變。
  outer: for (const a of opponents) {
    for (const b of opponents) {
      if (a === b) continue;
      for (const give of RESOURCES) {
        for (const take of COMMODITIES) {
          if (a.resources[give] === 0 || b.commodities[take] === 0) continue;
          a.resources[give] -= 1;
          a.commodities[take] += 1;
          b.commodities[take] -= 1;
          b.resources[give] += 1;
          changed = true;
          break outer;
        }
      }
    }
  }
  // 兩位對手交換不同種類的 commodity。
  swap: for (const a of opponents) {
    for (const b of opponents) {
      if (a === b) continue;
      for (const x of COMMODITIES) {
        for (const y of COMMODITIES) {
          if (x === y || a.commodities[x] === 0 || b.commodities[y] === 0) continue;
          a.commodities[x] -= 1;
          a.commodities[y] += 1;
          b.commodities[y] -= 1;
          b.commodities[x] += 1;
          changed = true;
          break swap;
        }
      }
    }
  }
  // 對手的一張進步卡與同一牌組、不同身分的牌交換（張數與牌組都不變）。
  for (const player of opponents) {
    for (let index = 0; index < player.progressCards.length; index++) {
      const card = player.progressCards[index]!;
      const track = trackOf(card);
      const deck = track ? variant.progressDecks[track] : undefined;
      const deckIndex = deck ? deck.findIndex((other) => other !== card && isHeldCard(other)) : -1;
      if (!deck || deckIndex < 0) continue;
      player.progressCards[index] = deck[deckIndex]!;
      deck[deckIndex] = card;
      changed = true;
      break;
    }
    if (changed) break;
  }
  // 牌組的順序是隱藏的，張數是公開的。
  for (const track of CK_TRACKS) {
    if (variant.progressDecks[track].length > 1) {
      variant.progressDecks[track].reverse();
      changed = true;
    }
  }
  return changed;
}

// ---------------------------------------------------------------------------
// perturb
// ---------------------------------------------------------------------------

function pick<T>(items: readonly T[], rng: Rng): T {
  return items[rng.int(items.length)]!;
}

/** C&K 的 pending frame；其他 frame 與沒有 pending 回 null。 */
function ckFrameOf(state: GameState): ModulePending | null {
  const frame = state.pending as ModulePending | null;
  return frame && 'module' in frame && frame.module === CITIES_KNIGHTS ? frame : null;
}

/** 手牌與進步卡不可改動的玩家：base 棄牌者，以及既有 C&K frame 的資料所引用的玩家。 */
function frozenPlayers(state: GameState): Set<string> {
  const out = new Set<string>();
  if (state.pending?.kind === 'discard') for (const id of Object.keys(state.pending.required)) out.add(id);
  const frame = ckFrameOf(state);
  if (frame) {
    for (const id of frame.responders) out.add(id);
    const data = frame.data;
    for (const key of ['victim', 'actor', 'from']) if (typeof data[key] === 'string') out.add(data[key] as string);
    const required = data.required;
    if (typeof required === 'object' && required !== null) for (const id of Object.keys(required)) out.add(id);
  }
  return out;
}

function perturbCommodities(state: GameState, rng: Rng, frozen: ReadonlySet<string>): void {
  const movable = state.players.filter((player) => !frozen.has(player.id));
  for (const player of movable) {
    for (const commodity of COMMODITIES) {
      state.commodityBank[commodity] += player.commodities[commodity];
      player.commodities[commodity] = 0;
    }
  }
  for (const player of movable) {
    for (const commodity of COMMODITIES) {
      const amount = Math.min(rng.int(5), state.commodityBank[commodity]);
      player.commodities[commodity] = amount;
      state.commodityBank[commodity] -= amount;
    }
  }
}

/** 進步卡先全部放回各自的牌組，再發給玩家；0–5 張，偶爾超過手牌上限（`progressExcess`）。 */
function perturbProgress(state: GameState, rng: Rng, frozen: ReadonlySet<string>): void {
  const movable = state.players.filter((player) => !frozen.has(player.id));
  for (const player of movable) {
    for (const card of [...player.progressCards, ...(player.newProgressCards ?? [])]) {
      const track = trackOf(card);
      if (track) state.progressDecks[track].push(card);
    }
    player.progressCards = [];
    player.newProgressCards = [];
  }
  for (const player of movable) {
    const count = rng.int(6);
    for (let i = 0; i < count; i++) {
      const decks = CK_TRACKS.filter((track) => state.progressDecks[track].length > 0);
      if (decks.length === 0) return;
      const deck = state.progressDecks[pick(decks, rng)];
      const held = deck.flatMap((card, at) => (isHeldCard(card) ? [at] : []));
      if (held.length === 0) continue;
      player.progressCards.push(deck.splice(pick(held, rng), 1)[0]!);
    }
  }
}

function freeVertices(state: GameState, slot: CkSlot): number[] {
  const topo = topologyOf(state);
  const taken = new Set(slot.knights.map((knight) => knight.vertex));
  const out: number[] = [];
  topo.vertices.forEach((info, vertex) => {
    if (state.board.buildings[vertex] || taken.has(vertex)) return;
    if (info.hexes.some((hex) => isLandHex(state, hex))) out.push(vertex);
  });
  return out;
}

/** 挪動騎士（不碰建築與其他騎士的點）、切換啟動狀態，偶爾補一隻 1 級騎士。 */
function perturbKnights(state: GameState, slot: CkSlot, rng: Rng): void {
  const profile = requireProfile(state.profileId);
  for (const knight of slot.knights) {
    const free = freeVertices(state, slot);
    if (free.length > 0 && rng.int(2) === 0) knight.vertex = pick(free, rng);
    if (rng.int(3) === 0) knight.active = !knight.active;
    // 本視窗剛啟動、剛升級的騎士不能行動，其他的可以。
    knight.activatedIn = knight.active && rng.int(3) === 0 ? state.windowId : undefined;
    knight.promotedIn = rng.int(4) === 0 ? state.windowId : undefined;
    if (knight.activatedIn === undefined) delete knight.activatedIn;
    if (knight.promotedIn === undefined) delete knight.promotedIn;
  }
  if (rng.int(2) !== 0) return;
  const owner = pick(state.players, rng);
  const own = slot.knights.filter((knight) => knight.player === owner.id);
  const free = freeVertices(state, slot);
  if (own.length >= profile.pieces.knights || own.filter((knight) => knight.level === 1).length >= 2 || free.length === 0) return;
  slot.knights.push({ player: owner.id, vertex: pick(free, rng), level: 1, active: rng.int(2) === 0 });
}

function clampFrame(state: GameState): void {
  const frame = ckFrameOf(state);
  if (!frame) return;
  const totals = new Map(state.players.map((player) => [player.id, handTotal(player)]));
  if (frame.kind === CK_SABOTAGE_FRAME || frame.kind === CK_WEDDING_FRAME) {
    const required = frame.data.required as Record<string, number>;
    for (const id of Object.keys(required)) required[id] = Math.min(required[id]!, totals.get(id) ?? 0);
    frame.responders = frame.responders.filter((id) => (required[id] ?? 0) > 0);
    if (frame.responders.length === 0) state.pending = null;
  } else if (frame.kind === CK_GUILD_DUES_FRAME) {
    const total = totals.get(frame.data.victim as string) ?? 0;
    frame.data.count = Math.min(frame.data.count as number, total);
    if ((frame.data.count as number) <= 0) state.pending = null;
  } else if (frame.kind === CK_ESPIONAGE_FRAME) {
    const victim = state.players.find((player) => player.id === frame.data.victim);
    if (!victim || victim.progressCards.length === 0) state.pending = null;
  }
}

/** frame 的 kind 清單：`stageFrame` 能佈置的種類（resolveRoll 是續行 frame，不佈置）。 */
export const STAGEABLE_FRAMES: readonly string[] = [
  CK_PILLAGE_FRAME,
  CK_DISPLACED_FRAME,
  CK_PROGRESS_DISCARD_FRAME,
  CK_DEFENDER_FRAME,
  CK_SCIENCE_FRAME,
  CK_HARBOR_FRAME,
  CK_GUILD_DUES_FRAME,
  CK_ESPIONAGE_FRAME,
  CK_SABOTAGE_FRAME,
  CK_WEDDING_FRAME,
  CK_TREASON_REMOVE_FRAME,
  CK_TREASON_PLACE_FRAME,
  CK_DIPLOMACY_FRAME,
];

function frame(kind: string, responders: string[], data: Record<string, unknown>): ModulePending {
  return { kind: kind as ModulePending['kind'], module: CITIES_KNIGHTS, responders, data };
}

/**
 * 在行動者的行動階段、沒有待決效果的狀態上佈置一個 C&K frame，形狀與 rules 的實際投影一致
 * （`progressDiscard.data.required`、`displaced.data.{knight,from}`、`guildDues` 的 `{victim,count}`、
 * `responders` 的順序等）。條件不足時回 false，狀態不變。
 */
export function stageFrame(state: GameState, kind: string, rng: Rng): boolean {
  if (state.pending || state.result || state.turn.phase !== 'action') return false;
  const slot = slotOf(state);
  const actor = state.players[state.turn.seat];
  if (!slot || !actor) return false;
  const others = state.players.filter((player) => player.id !== actor.id);
  const order = state.players.map((player) => player.id);
  const hasCards = (player: PlayerState) => handTotal(player) > 0;
  let staged: ModulePending | null = null;

  switch (kind) {
    case CK_PROGRESS_DISCARD_FRAME: {
      const holders = state.players.filter((player) => player.progressCards.length > 0);
      if (holders.length === 0) return false;
      const required = Object.fromEntries(holders.map((player) => [player.id, 1 + rng.int(Math.min(2, player.progressCards.length))]));
      staged = frame(kind, holders.map((player) => player.id), { required });
      break;
    }
    case CK_DISPLACED_FRAME: {
      if (slot.knights.length === 0) return false;
      const knight = pick(slot.knights, rng);
      staged = frame(kind, [knight.player], { knight: { ...knight }, from: knight.vertex });
      // 被擠走的騎士不在盤面上，資料帶在 frame 裡（撤退後才放回）。
      slot.knights = slot.knights.filter((candidate) => candidate !== knight);
      state.pending = staged;
      // 沒有退路時 rules 直接移除騎士、不出 frame。
      if ((actionHints(state, knight.player).modules?.citiesKnights as { retreat: number[] }).retreat.length === 0) {
        state.pending = null;
        slot.knights.push(knight);
        return false;
      }
      return true;
    }
    case CK_PILLAGE_FRAME: {
      const owners = order.filter((id) => state.board.buildings.some((building) => building?.player === id && building.city));
      staged = frame(kind, owners, {});
      state.pending = staged;
      // 只有真的有可掠奪城市的玩家才是 responder（大都市與已倒下的城市除外）。
      staged.responders = owners.filter(
        (id) => (actionHints(state, id).modules?.citiesKnights as { pillage: number[] }).pillage.length > 0,
      );
      if (staged.responders.length === 0) {
        state.pending = null;
        return false;
      }
      return true;
    }
    case CK_DEFENDER_FRAME: {
      if (CK_TRACKS.every((track) => state.progressDecks[track].length === 0)) return false;
      staged = frame(kind, order.slice(0, 1 + rng.int(order.length)), {});
      break;
    }
    case CK_SCIENCE_FRAME: {
      if (RESOURCES.every((resource) => state.bank[resource] === 0)) return false;
      staged = frame(kind, order.slice(0, 1 + rng.int(order.length)), {});
      break;
    }
    case CK_HARBOR_FRAME: {
      const to = others.filter((player) => COMMODITIES.some((commodity) => player.commodities[commodity] > 0));
      if (to.length === 0) return false;
      const receiver = pick(to, rng);
      const givers = state.players.filter((player) => player.id !== receiver.id && RESOURCES.some((resource) => player.resources[resource] > 0));
      if (givers.length === 0) return false;
      const giver = pick(givers, rng);
      const resource = pick(RESOURCES.filter((candidate) => giver.resources[candidate] > 0), rng);
      staged = frame(kind, [receiver.id], { from: giver.id, resource });
      break;
    }
    case CK_GUILD_DUES_FRAME: {
      const victims = others.filter(hasCards);
      if (victims.length === 0) return false;
      const victim = pick(victims, rng);
      staged = frame(kind, [actor.id], { victim: victim.id, count: Math.min(2, handTotal(victim)) });
      break;
    }
    case CK_ESPIONAGE_FRAME: {
      const victims = others.filter((player) => player.progressCards.length > 0);
      if (victims.length === 0) return false;
      staged = frame(kind, [actor.id], { victim: pick(victims, rng).id });
      break;
    }
    case CK_SABOTAGE_FRAME:
    case CK_WEDDING_FRAME: {
      const givers = others.filter(hasCards);
      if (givers.length === 0) return false;
      const required = Object.fromEntries(givers.map((player) => [player.id, Math.min(2, handTotal(player))]));
      staged = frame(kind, givers.map((player) => player.id), { actor: actor.id, required });
      break;
    }
    case CK_TREASON_REMOVE_FRAME: {
      const victims = others.filter((player) => slot.knights.some((knight) => knight.player === player.id));
      if (victims.length === 0) return false;
      staged = frame(kind, [pick(victims, rng).id], { actor: actor.id });
      break;
    }
    case CK_TREASON_PLACE_FRAME: {
      const free = freeVertices(state, slot);
      if (free.length === 0) return false;
      staged = frame(kind, [actor.id], { level: 1 + rng.int(3), active: rng.int(2) === 0, from: pick(free, rng) });
      break;
    }
    case CK_DIPLOMACY_FRAME: {
      // 比照 rules 的 Diplomacy：先拆掉自己的一條道路，再以拆除後的盤面算出可重建的邊（cards-politics.ts）。
      const taken = state.board.roads.findIndex((road) => road?.player === actor.id && !road.ship);
      if (taken < 0) return false;
      const removed = state.board.roads[taken];
      state.board.roads[taken] = null;
      const edges = actionHints(state, actor.id).legalRoads.slice();
      if (edges.length === 0) {
        state.board.roads[taken] = removed;
        return false;
      }
      staged = frame(kind, [actor.id], { edge: taken, edges });
      break;
    }
    default:
      return false;
  }
  state.pending = staged;
  return true;
}

function perturb(state: GameState, rng: Rng): void {
  const slot = slotOf(state);
  if (!slot) return;
  // C&K 沒有發展卡（騎士、豐收等指令是 `not-in-ruleset`）：harness 的 base 擾動發的發展卡在這裡收回。
  for (const player of state.players) {
    player.devCards = [];
    player.newDevCards = [];
  }
  clampFrame(state);
  const frozen = frozenPlayers(state);
  perturbCommodities(state, rng, frozen);
  perturbProgress(state, rng, frozen);
  // 騎士與蠻族只在沒有待決效果時動：displaced 之類的 frame 的資料依賴騎士。
  if (!state.pending && state.turn.phase !== 'setup') {
    perturbKnights(state, slot, rng);
    if (rng.int(2) === 0) slot.barbarian = rng.int(CK_BARBARIAN_TRACK_LENGTH);
  }
  // 偶爾注入一個 C&K frame，而且第一個答案要合法：先試一種，不行就算了。
  if (!state.pending && state.turn.phase === 'action' && rng.int(3) === 0) {
    stageFrame(state, pick(STAGEABLE_FRAMES, rng), rng);
  }
}

// ---------------------------------------------------------------------------
// mechanics（Q2 計數器）
// ---------------------------------------------------------------------------

/** 終局時持有的大都市數（M6）；從公開狀態讀，不靠事件。 */
export function metropolisCount(state: GameState): number {
  return Object.values(slotOf(state)?.metropolises ?? {}).filter((entry) => entry !== null && entry !== undefined).length;
}

/** 桌上最高的改良等級（M2）。 */
export function maxImprovementLevel(state: GameState): number {
  return Math.max(0, ...state.players.flatMap((player) => CK_TRACKS.map((track) => player.improvements[track] ?? 0)));
}

/** 這個玩家目前有沒有會被掠奪的城（沒有大都市標記的城市）。 */
function pillageable(state: GameState, playerId: string): boolean {
  const slot = slotOf(state);
  const metropolisVertices = new Set(
    Object.values(slot?.metropolises ?? {}).flatMap((entry) => (entry ? [entry.vertex] : [])),
  );
  return state.board.buildings.some(
    (building, vertex) => building?.city === true && building.player === playerId && !metropolisVertices.has(vertex),
  );
}

/** 計數的指令：C&K 的行動與回應指令（建城牆、改良、騎士、進步卡、科學獎勵、蠻族）。 */
const CK_COMMAND = /^(build\.wall|city\.|knight\.|progress\.|science\.|barbarians\.)/;

/**
 * 鍵（全部是整數累計，`harness` 會再加上 `citiesKnights.` 前綴）：
 * - `cmd.<type>`：保底以外的策略送出的 C&K 指令；`cmd.<level>.<type>` 依座位難度細分；
 * - `ev.<type>`：全部來源的 `ck.*` 事件；`ev.policy.<type>`、`ev.<level>.<type>`：由策略指令引起的事件（level 為 standard／easy）；
 * - `card.<card>`：策略打出的進步卡（M3、M7）；
 * - `attack.defenders`、`attack.barbarians`：蠻族攻擊的結果（M4）；
 * - `exposed.<player>`：該玩家在幾次攻擊前有會被掠奪的城；`lost.<player>`：失去幾座城（M5，test 依座位難度合計）；
 * - `maxImprovement`：升級事件的最高等級（取最大值，不累加）。
 */
class CkMechanicsTally implements MechanicsTally {
  private readonly counts: Record<string, number> = {};

  private bump(key: string, by = 1): void {
    this.counts[key] = (this.counts[key] ?? 0) + by;
  }

  observe(step: MechanicsStep): void {
    const { level, command, source, before, events } = step;
    if (source === 'policy' && CK_COMMAND.test(command.type)) {
      this.bump(`cmd.${command.type}`);
      this.bump(`cmd.${level}.${command.type}`);
    }
    for (const event of events) {
      // 只計 C&K 自己的事件：bench 把每個鍵都印成一欄，base 的事件與指令由 base 的計數涵蓋。
      if (event.type.startsWith('ck.')) {
        this.bump(`ev.${event.type}`);
        if (source === 'policy') {
          this.bump(`ev.policy.${event.type}`);
          this.bump(`ev.${level}.${event.type}`);
        }
      }
      const params = event.params as Record<string, unknown>;
      switch (event.type) {
        case 'ck.progressPlayed':
          if (source === 'policy' && typeof params.card === 'string') this.bump(`card.${params.card}`);
          break;
        case 'ck.cityImproved':
          if (typeof params.level === 'number') {
            this.counts.maxImprovement = Math.max(this.counts.maxImprovement ?? 0, params.level);
          }
          break;
        case 'ck.barbariansAttack':
          if (params.outcome === 'defenders') this.bump('attack.defenders');
          if (params.outcome === 'barbarians') this.bump('attack.barbarians');
          for (const player of before.players) if (pillageable(before, player.id)) this.bump(`exposed.${player.id}`);
          break;
        case 'ck.cityPillaged':
          if (typeof params.playerId === 'string') this.bump(`lost.${params.playerId}`);
          break;
        default:
      }
    }
  }

  snapshot(): Readonly<Record<string, number>> {
    return { ...this.counts };
  }
}

export const citiesKnightsKit: ModuleTestKit = {
  id: CITIES_KNIGHTS,
  // 與 rules 的 `pendingCommands` 一致：非行動者也可能在這些 frame 裡作答。
  responseCommands: [
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
  conservation,
  hideDifferently,
  perturb,
  mechanics: () => new CkMechanicsTally(),
};
