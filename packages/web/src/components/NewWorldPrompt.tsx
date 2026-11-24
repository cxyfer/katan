import { useId, useState } from 'react';
import type { RoomView, RegenerateProposalView } from '@katan/protocol';
import { useLocale, useT } from '../i18n/context.tsx';
import { seafarersHints, seafarersView } from '../board/seafarers.ts';
import { awaitingSuspendConsent, joinNames, nicknameOf, selfMemberOf } from '../state/leave.ts';
import { blocksNewCommands } from '../state/commands.ts';
import { nameOf as resolveName } from '../state/table.ts';
import type { TableController } from '../state/useTable.ts';
import { GameIcon } from './GameArt.tsx';
import '../styles/leave.css';

/** 新世界港口的顯示名稱：3:1 通用港或某資源的 2:1 港。 */
export function worldPortLabel(t: (id: string, params?: Record<string, unknown>) => string, type: string): string {
  return t(type === 'generic' ? 'sf.gift.port.generic' : 'sf.gift.port.resource', { resource: t(`resource.${type}`) });
}

/**
 * 新世界（SF25 p. 20）設置階段 `harbor` 的提示：現在抽到的港口與輪到誰放（第幾個由設置導引顯示），
 * 以及房主提議重新產生版圖的入口（全體真人同意才成立，見 `RegeneratePanel`）。
 * 選邊本身由棋盤的目標提示處理（SVG 與 3D 都可操作，手機可用目標清單）。
 */
export function NewWorldPrompt({ controller }: { controller: TableController }) {
  const t = useT();
  const { state, actions } = controller;
  const view = state.game?.view ?? null;
  const selfId = state.session?.id ?? null;
  const world = seafarersView(view)?.world ?? null;
  const setup = view?.turn.setup ?? null;
  const [busy, setBusy] = useState(false);
  if (!view || !world || !setup || setup.stage !== 'harbor') return null;
  const nameOf = resolveName(state);
  const mine = view.turn.playerId === selfId;
  const edges = seafarersHints(view)?.harborChoices.edges ?? [];
  const room = state.room;
  const isHost = !!selfId && room?.hostId === selfId;
  const proposal = room?.pendingRegenerate ?? null;
  const blocked = blocksNewCommands(state.command);
  const propose = async () => {
    setBusy(true);
    try {
      await actions.proposeRegenerate();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="prompt__body world-harbor" data-testid="world-harbor">
      {world.drawn && (
        <p data-testid="world-harbor-drawn" data-harbor={world.drawn}>
          <GameIcon name="anchor" size={16} /> {t('sf.world.drawn', { player: nameOf(view.turn.playerId), port: worldPortLabel(t, world.drawn) })}
        </p>
      )}
      {mine && <p className="muted" data-testid="world-harbor-choose">{t('sf.world.choose')}</p>}
      {mine && edges.length === 0 && <p className="muted">{t('sf.world.noEdges')}</p>}
      {world.canRegenerate && !proposal && (isHost
        ? <button type="button" className="button" data-testid="world-regenerate" disabled={busy || blocked} onClick={() => void propose()}>{t('sf.world.regenerate')}</button>
        : <p className="muted" data-testid="world-regenerate-note">{t('sf.world.regenerateHost')}</p>)}
      {world.rerolls > 0 && <p className="muted" data-testid="world-rerolls">{t('sf.world.rerolls', { count: world.rerolls })}</p>}
    </div>
  );
}

/** 重新產生版圖的投票橫幅：與全桌暫停同一種全體同意流程，任何人拒絕即取消。 */
export function RegeneratePanel({ controller }: { controller: TableController }) {
  const room = controller.state.room;
  const proposal = room?.status === 'playing' ? room.pendingRegenerate ?? null : null;
  return room && proposal ? <RegenerateVote key={proposal.id} controller={controller} room={room} proposal={proposal} /> : null;
}

function RegenerateVote({ controller, room, proposal }: { controller: TableController; room: RoomView; proposal: RegenerateProposalView }) {
  const t = useT();
  const locale = useLocale();
  const id = useId();
  const { state, actions } = controller;
  const [busy, setBusy] = useState(false);
  const guard = async (action: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await action();
    } finally {
      setBusy(false);
    }
  };
  const selfId = state.session?.id ?? null;
  const seated = selfMemberOf(room, selfId) !== null;
  const youAgreed = selfId !== null && proposal.consents.includes(selfId);
  const voting = seated && !youAgreed;
  const waiting = awaitingSuspendConsent(room, proposal).filter((member) => member.playerId !== selfId);
  const proposer = proposal.proposedBy === selfId;

  return (
    <section className={`prompt abandon-panel suspend-panel${voting ? ' prompt--mine' : ''}`} aria-labelledby={`${id}-vote`} data-testid="regenerate-proposal">
      <h2 id={`${id}-vote`}>{t('sf.world.vote.title')}</h2>
      <p data-testid="regenerate-summary">{t('sf.world.vote.body', { proposer: nicknameOf(room, proposal.proposedBy) })}</p>
      <p className="muted">{t('sf.world.vote.note')}</p>
      {voting ? (
        <div className="abandon-panel__actions">
          <button type="button" className="button button--primary" data-testid="regenerate-approve" disabled={busy}
            onClick={() => void guard(() => actions.respondRegenerate(proposal.id, true))}>{t('sf.world.vote.approve')}</button>
          <button type="button" className="button" data-testid="regenerate-reject" disabled={busy}
            onClick={() => void guard(() => actions.respondRegenerate(proposal.id, false))}>{t('sf.world.vote.reject')}</button>
        </div>
      ) : (
        <>
          <p className="muted" data-testid="regenerate-waiting">
            {youAgreed && <>{t('sf.world.vote.youAgreed')} </>}
            {waiting.length > 0 && t('sf.world.vote.waiting', { players: joinNames(locale, waiting.map((member) => member.nickname)) })}
          </p>
          {proposer && (
            <div className="abandon-panel__actions">
              <button type="button" className="button" data-testid="regenerate-withdraw" disabled={busy}
                onClick={() => void guard(() => actions.respondRegenerate(proposal.id, false))}>{t('sf.world.vote.withdraw')}</button>
            </div>
          )}
        </>
      )}
    </section>
  );
}
