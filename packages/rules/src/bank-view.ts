/**
 * 投影給 client 的銀行存量（§8.3、#137）。
 *
 * 丟棄（7 點、C&K 的 Saboteur）把牌私下放回銀行；投影若帶確切存量，旁觀者比較
 * 前後兩份快照就能還原丟了哪些牌。因此每一堆只投影 `min(存量, BANK_VIEW_CAP)`：
 * 低於上限的值是確切張數，等於上限表示「至少這麼多」。
 *
 * 上限取 2：豐收之年一次決定兩張（可以同種），`min(2, 總和)` 與「能否拿兩張同種」
 * 都只需要到 2；其他從銀行拿牌的選擇（銀行／港口交易、科學獎勵、金幣購買等）一次只拿
 * 一張。金礦一次可能要拿更多同種的牌，所需的存量只以 hints 給當下作答的玩家
 * （`hints.modules.seafarers.goldBank`）。
 *
 * 殘餘洩漏：牌堆低於上限時，丟棄讓它回升，旁觀者知道「至少丟了一張這種牌」，但不知道
 * 張數；牌堆已在上限以上時看不出任何差別。引擎內部的規則檢查仍使用完整存量。
 */

/** 投影中每一堆銀行存量的上限。 */
export const BANK_VIEW_CAP = 2;

/** 把一份存量（資源銀行或 C&K 商品銀行）轉成投影用的上限值。 */
export function bankView<K extends string>(supply: Readonly<Record<K, number>>, cap: number = BANK_VIEW_CAP): Record<K, number> {
  const out = {} as Record<K, number>;
  for (const key of Object.keys(supply) as K[]) out[key] = Math.max(0, Math.min(supply[key], cap));
  return out;
}
