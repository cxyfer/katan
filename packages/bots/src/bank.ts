/**
 * 投影的銀行存量（§8.3、#137）：`view.bank` 每種只到 `BANK_VIEW_CAP`，低於上限是確切張數，
 * 等於上限表示「至少這麼多」。
 *
 * 實際送出的單一指令（銀行交易、豐收之年逐張領取、科學獎勵等）一次只拿一張，`view.bank > 0`
 * 就足以判斷是否合法。這裡只給「一回合內連續規劃好幾筆」的地方使用：把「至少」當成這種資源的
 * 全部張數（規則常數 `bankPerResource`），因此只有牌堆真的低於上限時才會受限；萬一實際張數
 * 介於上限與規劃所需之間，下一份投影會反映出來，Bot 再重新規劃，不會送出被拒絕的指令。
 */

import {
  BANK_VIEW_CAP,
  COMMODITIES,
  getProfile,
  RESOURCES,
  type CardKind,
  type Commodity,
  type GameView,
  type Resource,
} from '@catan/rules';

export function plannedBank(view: Pick<GameView, 'bank' | 'profileId'>): Record<Resource, number> {
  const full = getProfile(view.profileId)?.bankPerResource ?? BANK_VIEW_CAP;
  const out = {} as Record<Resource, number>;
  for (const resource of RESOURCES) {
    const shown = view.bank[resource] ?? 0;
    out[resource] = shown >= BANK_VIEW_CAP ? Math.max(shown, full) : shown;
  }
  return out;
}

/**
 * 投影的 commodity 銀行（C&K 的 `view.modules.citiesKnights.commodityBank`）：與 `view.bank` 一樣只到
 * `BANK_VIEW_CAP`。引擎的 `trade.bank` 以核心狀態的 commodity 存量判斷，所以這裡不依賴 C&K 的型別，只讀
 * 這個欄位；沒有這個模組（或形狀不對）時是 undefined，呼叫端視為沒有存量。
 *
 * 技術債：這是骨架裡唯一直接讀模組 view 鍵（`'citiesKnights'`）的地方，與 `rates`、`weights` 走鉤子不一致。
 * 目前只有 C&K 提供 commodity，所以先保留；出現第二個 commodity 提供者時，改成 `bankStock?` 鉤子，合成
 * `Economy.bank`（消費者 `bankTradeToward`、`handRelief` 都拿得到 Economy，改動成本低）。
 */
function commodityBankShown(view: Pick<GameView, 'modules'>): Partial<Record<Commodity, number>> | undefined {
  const entry = view.modules?.['citiesKnights'];
  if (typeof entry !== 'object' || entry === null) return undefined;
  const bank = (entry as { commodityBank?: unknown }).commodityBank;
  return typeof bank === 'object' && bank !== null ? (bank as Partial<Record<Commodity, number>>) : undefined;
}

/** `plannedBank` 的 commodity 版：低於上限是確切張數，等於上限表示「至少」，規劃時取 `commodityBankPerType`。 */
export function plannedCommodityBank(view: Pick<GameView, 'modules' | 'profileId'>): Record<Commodity, number> {
  const full = getProfile(view.profileId)?.commodityBankPerType ?? BANK_VIEW_CAP;
  const shown = commodityBankShown(view);
  const out = {} as Record<Commodity, number>;
  for (const commodity of COMMODITIES) {
    const amount = shown?.[commodity];
    const count = typeof amount === 'number' && Number.isFinite(amount) ? Math.max(0, amount) : 0;
    out[commodity] = count >= BANK_VIEW_CAP ? Math.max(count, full) : count;
  }
  return out;
}

/** 規劃用的銀行存量：資源一律有；`kinds` 含 commodity 時再加上 commodity。 */
export function plannedBankOf(view: Pick<GameView, 'bank' | 'profileId' | 'modules'>, kinds: readonly CardKind[]): Partial<Record<CardKind, number>> {
  const out: Partial<Record<CardKind, number>> = plannedBank(view);
  if (kinds.some((kind) => !(RESOURCES as readonly string[]).includes(kind))) Object.assign(out, plannedCommodityBank(view));
  return out;
}

/** 銀行現在有沒有這種卡（單張交易的合法性只需要這個）；投影到上限，所以 > 0 與真實存量 > 0 等價。 */
export function bankHas(view: Pick<GameView, 'bank' | 'modules'>, kind: CardKind): boolean {
  if ((RESOURCES as readonly string[]).includes(kind)) return (view.bank[kind as Resource] ?? 0) > 0;
  return (commodityBankShown(view)?.[kind as Commodity] ?? 0) > 0;
}
