/**
 * 離開、退出與結束對局（SPEC §4.6、§4.8）的前端判斷。
 *
 * 全部只讀房間成員與提案，不推算任何遊戲資訊；真正的資格仍由伺服器在提交時再驗證。
 * 電腦座位不缺席、不投票，所以每個判斷都先排除。
 */

import type { AbandonProposalView, RoomMemberView, RoomView } from '@catan/protocol';

export function humanMembers(room: RoomView | null | undefined): RoomMemberView[] {
  return (room?.members ?? []).filter((member) => !member.bot);
}

/** 房間內是否只有自己一個真人（其餘皆為電腦）。房間尚未載入時回傳 false。 */
export function isSoloTable(room: RoomView | null | undefined, selfId: string | null): boolean {
  if (!room || !selfId) return false;
  const humans = humanMembers(room);
  return humans.length === 1 && humans[0]!.playerId === selfId;
}

export function selfMemberOf(room: RoomView | null | undefined, selfId: string | null): RoomMemberView | null {
  if (!room || !selfId) return null;
  return room.members.find((member) => member.playerId === selfId && !member.bot) ?? null;
}

export function isSelfWithdrawn(room: RoomView | null | undefined, selfId: string | null): boolean {
  return selfMemberOf(room, selfId)?.withdrawn === true;
}

/** 其他已明確退出的真人。 */
export function withdrawnOthers(room: RoomView | null | undefined, selfId: string | null): RoomMemberView[] {
  return humanMembers(room).filter((member) => member.playerId !== selfId && member.withdrawn === true);
}

/** 其他缺席（離線或已退出）的真人；多人桌提議結束對局的資格條件（SPEC §4.6）。 */
export function absentOthers(room: RoomView | null | undefined, selfId: string | null): RoomMemberView[] {
  return humanMembers(room).filter(
    (member) => member.playerId !== selfId && (member.withdrawn === true || !member.connected),
  );
}

/** 房間政策是否允許無勝者結束；舊版伺服器沒有這個欄位時視為允許，最終仍由伺服器驗證。 */
export function abandonmentAllowed(room: RoomView | null | undefined): boolean {
  return room?.policy.allowAbandonment !== false;
}

/** 投票者：在線且未退出的真人（退出者視同同意，電腦不投票）。 */
export function abandonVoters(room: RoomView | null | undefined): RoomMemberView[] {
  return humanMembers(room).filter((member) => member.connected && member.withdrawn !== true);
}

/** 自己是否為這個提案的投票者，且尚未同意。 */
export function mustVote(
  room: RoomView | null | undefined,
  proposal: AbandonProposalView,
  selfId: string | null,
): boolean {
  if (!selfId) return false;
  const voting = abandonVoters(room).some((member) => member.playerId === selfId);
  return voting && !proposal.consents.includes(selfId);
}

/** 還沒同意的投票者（供「等待…」點名）。 */
export function awaitingConsent(room: RoomView | null | undefined, proposal: AbandonProposalView): RoomMemberView[] {
  return abandonVoters(room).filter((member) => !proposal.consents.includes(member.playerId));
}

/** playerId → 暱稱；找不到時退回 id，確認畫面不會顯示空白。 */
export function nicknameOf(room: RoomView | null | undefined, playerId: string): string {
  return room?.members.find((member) => member.playerId === playerId)?.nickname ?? playerId;
}

/** 暱稱清單依語系連接：中文用頓號，其餘用逗號。 */
export function joinNames(locale: string, names: readonly string[]): string {
  return names.join(locale === 'zh-Hant' ? '、' : ', ');
}
