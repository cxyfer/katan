import type { GameView } from '@catan/rules';

/**
 * 排程器詢問 Bot 的順序：先依座位詢問非行動者（棄牌、回應報價），最後才
 * 詢問行動者，讓行動者看到其他座位的回應後再結算或撤回報價。
 */
export function botActingOrder(view: GameView, botIds: readonly string[]): string[] {
  const seatOf = new Map(view.players.map((player) => [player.id, player.seat]));
  const seated = botIds
    .filter((id) => seatOf.has(id))
    .sort((a, b) => seatOf.get(a)! - seatOf.get(b)!);
  const actor = view.turn.playerId;
  return [...seated.filter((id) => id !== actor), ...seated.filter((id) => id === actor)];
}
