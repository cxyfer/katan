import { useState } from 'react';
import type { RoomPolicy } from '@catan/protocol';
import { POLICY_BOUNDS } from '@catan/protocol';
import { useT } from '../i18n/context.tsx';
import { LanguageSwitch } from './LanguageSwitch.tsx';
import { PolicyProposalPanel } from './PolicyProposalPanel.tsx';
import type { ScreenProps } from './props.ts';

const COLORS = ['red', 'blue', 'orange', 'white', 'green', 'brown'] as const;

/**
 * Lobby (docs/SPEC.md §4.2, §5.8).
 *
 * - only the host can change settings or start, and start is disabled with the
 *   server's own blockers rather than a client guess;
 * - before start a policy change applies, after start it becomes a proposal
 *   that needs every seat's consent;
 * - host transfer is displayed from `RoomView.hostId`.
 */
export function LobbyScreen({ controller }: ScreenProps) {
  const t = useT();
  const { state, actions } = controller;
  const room = state.room;
  const [policyDraft, setPolicyDraft] = useState<RoomPolicy | null>(null);

  if (!room) {
    return (
      <main className="screen" id="main">
        <p className="muted">{t('app.loading')}</p>
      </main>
    );
  }

  const selfId = state.session?.id ?? null;
  const isHost = room.hostId === selfId;
  const selfMember = room.members.find((member) => member.playerId === selfId) ?? null;
  const takenColors = new Set(room.members.map((member) => member.color));
  const policy = policyDraft ?? room.policy;
  const startBlockers = room.startBlockers;
  const canStart = isHost && startBlockers.length === 0;
  const host = room.members.find((member) => member.playerId === room.hostId) ?? null;

  const setPolicyField = <K extends keyof RoomPolicy>(key: K, value: RoomPolicy[K]) => {
    setPolicyDraft({ ...policy, [key]: value });
  };

  return (
    <main className="screen screen--lobby" id="main">
      <header className="screen__header">
        <h1>{t('lobby.members')}</h1>
        <p className="muted">
          {t(`profile.${room.profileId}`)} · {t(`lobby.roomStatus.${room.status}`)} ·{' '}
          {t('lobby.capacity')}: {room.members.length}/{room.capacity}
        </p>
        <LanguageSwitch onChange={actions.setLocale} />
      </header>

      <section className="card" aria-labelledby="invite-heading">
        <h2 id="invite-heading">{t('lobby.inviteCode')}</h2>
        <p>
          <code data-testid="room-code">{room.code}</code>
        </p>
        <p className="muted">
          {t('lobby.visibility.' + room.visibility)} ·{' '}
          {t('lobby.setupMode.' + room.setupMode)}
        </p>
        {host && (
          <p className="muted" data-testid="host-name">
            {t('app.host')}: {host.nickname}
          </p>
        )}
      </section>

      <section className="card" aria-labelledby="seats-heading">
        <h2 id="seats-heading">{t('lobby.members')}</h2>
        <ul className="seat-list" data-testid="lobby-seats">
          {room.members.map((member) => (
            <li key={member.playerId} className="seat" data-testid={`member-${member.seat}`}>
              <span className="seat__name">
                {member.nickname}
                {member.self ? ` (${t('app.you')})` : ''}
                {member.host ? ` · ${t('app.host')}` : ''}
              </span>
              <span className="muted">
                {t('lobby.color.' + member.color)} ·{' '}
                {member.ready ? t('lobby.ready') : t('lobby.notReady')} ·{' '}
                {member.connected ? t('lobby.connected') : t('lobby.disconnected')}
              </span>
            </li>
          ))}
        </ul>

        {!selfMember && (
          <fieldset>
            <legend>{t('lobby.selectSeat')}</legend>
            <ul className="color-list">
              {COLORS.map((color) => (
                <li key={color}>
                  <button
                    type="button"
                    className="button button--chip"
                    data-testid={`seat-color-${color}`}
                    disabled={takenColors.has(color)}
                    onClick={() => void actions.takeSeat(color)}
                  >
                    {t('lobby.color.' + color)}
                  </button>
                </li>
              ))}
            </ul>
          </fieldset>
        )}

        {selfMember && (
          <button
            type="button"
            className="button"
            data-testid="toggle-ready"
            aria-pressed={selfMember.ready}
            onClick={() => void actions.setReady(!selfMember.ready)}
          >
            {selfMember.ready ? t('lobby.markNotReady') : t('lobby.markReady')}
          </button>
        )}
      </section>

      <section className="card" aria-labelledby="start-heading">
        <h2 id="start-heading">{t('lobby.start')}</h2>
        {startBlockers.length > 0 && (
          <div data-testid="start-blockers" role="status">
            <p>{t('lobby.startBlocked')}</p>
            <ul>
              {startBlockers.map((blocker, index) => (
                <li key={`${blocker.messageId}-${index}`}>
                  {t(blocker.messageId, blocker.params)}
                </li>
              ))}
            </ul>
          </div>
        )}
        {!isHost && <p className="muted">{t('lobby.notHost')}</p>}
        <button
          type="button"
          className="button button--primary"
          data-testid="start-game"
          disabled={!canStart}
          aria-describedby={startBlockers.length > 0 ? 'start-blockers' : undefined}
          onClick={() => void actions.startGame()}
        >
          {t('lobby.start')}
        </button>
        <button type="button" className="button" data-testid="leave-room" onClick={() => void actions.leaveRoom()}>
          {t('lobby.leave')}
        </button>
        {isHost && (
          <button type="button" className="button" data-testid="close-room" onClick={() => void actions.closeRoom()}>
            {t('lobby.closeRoom')}
          </button>
        )}
      </section>

      <section className="card" aria-labelledby="policy-heading">
        <h2 id="policy-heading">{t('lobby.policyTitle')}</h2>
        <div className="field">
          <label htmlFor="policy-clock">{t('lobby.policy.turnClockSeconds')}</label>
          <input
            id="policy-clock"
            data-testid="policy-clock"
            type="number"
            min={POLICY_BOUNDS.turnClockSeconds.min}
            max={POLICY_BOUNDS.turnClockSeconds.max}
            value={policy.turnClockSeconds}
            disabled={!isHost}
            onChange={(event) => setPolicyField('turnClockSeconds', Number(event.target.value))}
          />
        </div>
        <div className="field">
          <label htmlFor="policy-grace">{t('lobby.policy.disconnectGraceSeconds')}</label>
          <input
            id="policy-grace"
            data-testid="policy-grace"
            type="number"
            min={POLICY_BOUNDS.disconnectGraceSeconds.min}
            max={POLICY_BOUNDS.disconnectGraceSeconds.max}
            value={policy.disconnectGraceSeconds}
            disabled={!isHost}
            onChange={(event) => setPolicyField('disconnectGraceSeconds', Number(event.target.value))}
          />
        </div>
        <div className="field field--inline">
          <label htmlFor="policy-abandon">{t('lobby.policy.allowAbandonment')}</label>
          <input
            id="policy-abandon"
            data-testid="policy-abandon"
            type="checkbox"
            checked={policy.allowAbandonment}
            disabled={!isHost}
            onChange={(event) => setPolicyField('allowAbandonment', event.target.checked)}
          />
        </div>
        <p className="muted">
          {t('lobby.policy.hostSuccession')}: {t('lobby.policy.hostSuccession.automatic')}
        </p>
        <button
          type="button"
          className="button"
          data-testid="save-policy"
          disabled={!isHost || policyDraft === null}
          onClick={() => {
            void actions.proposePolicy(policy);
            setPolicyDraft(null);
          }}
        >
          {room.status === 'lobby' ? t('lobby.policy.save') : t('lobby.policyPropose')}
        </button>
      </section>

      <PolicyProposalPanel controller={controller} />

      {state.roomError && (
        <p className="error" role="alert">
          {t(state.roomError.messageId, state.roomError.params)}
        </p>
      )}
    </main>
  );
}
