import { useState } from 'react';
import type { RoomPolicy } from '@catan/protocol';
import { POLICY_BOUNDS } from '@catan/protocol';
import { useT } from '../i18n/context.tsx';
import { LanguageSwitch } from './LanguageSwitch.tsx';
import { GameBrand, GameIcon } from './GameArt.tsx';
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
  const occupiedSeats = new Set(room.members.map((member) => member.seat));
  const emptySeats = Array.from({ length: room.capacity }, (_, seat) => seat)
    .filter((seat) => !occupiedSeats.has(seat));
  const profile = state.profiles.find((item) => item.id === room.profileId);

  const setPolicyField = <K extends keyof RoomPolicy>(key: K, value: RoomPolicy[K]) => {
    setPolicyDraft({ ...policy, [key]: value });
  };

  return (
    <main className="screen screen--lobby" id="main">
      <header className="screen__header game-header">
        <GameBrand compact />
        <LanguageSwitch onChange={actions.setLocale} />
      </header>

      <div className="lobby__heading">
        <p className="hero__eyebrow"><GameIcon name="anchor" />{t('island.lobby.eyebrow')}</p>
        <h1 className="hero__title">{t('island.lobby.title')}</h1>
        <p className="hero__description">{t('island.lobby.description')}</p>
        <p className="lobby__summary muted">
          {t(`profile.${room.profileId}`)} · {t(`lobby.roomStatus.${room.status}`)} ·{' '}
          {t('lobby.capacity')}: {room.members.length}/{room.capacity}
        </p>
      </div>

      <div className="lobby__grid">
        <div className="lobby__main">
          <section className="card lobby-players" aria-labelledby="seats-heading">
            <div className="section-heading">
              <span className="section-heading__icon"><GameIcon name="users" size={25} /></span>
              <div className="section-heading__copy"><h2 id="seats-heading">{t('lobby.members')}</h2></div>
              <span className="lobby__seat-count">{room.members.length}/{room.capacity}</span>
            </div>
            <div className="lobby__seats">
              <ul className="seat-list lobby__occupied" data-testid="lobby-seats">
                {room.members.map((member) => (
                  <li
                    key={member.playerId}
                    className={`seat lobby-seat lobby-seat--${member.color}${member.ready ? ' lobby-seat--ready' : ''}${member.self ? ' lobby-seat--self' : ''}`}
                    data-testid={`member-${member.seat}`}
                  >
                    <span className="lobby-seat__avatar" aria-hidden="true">
                      {Array.from(member.nickname.trim()).slice(0, 2).join('').toUpperCase()}
                    </span>
                    <p className="lobby-seat__number muted">{t('island.lobby.seatNumber', { number: member.seat + 1 })}</p>
                    <h3 className="seat__name lobby-seat__name">
                      {member.nickname}{member.self ? ` (${t('app.you')})` : ''}
                    </h3>
                    <p className="lobby-seat__meta muted">
                      {t('lobby.color.' + member.color)}
                      {member.host && <span className="lobby-seat__host"><GameIcon name="crown" size={16} />{t('app.host')}</span>}
                    </p>
                    <div className="lobby-seat__status">
                      <span className={`status-tag${member.ready ? ' status-tag--ready' : ''}`}>
                        <GameIcon name={member.ready ? 'check' : 'compass'} size={15} />
                        {member.ready ? t('lobby.ready') : t('lobby.notReady')}
                      </span>
                      <span className="lobby-seat__connection muted">
                        {member.connected ? t('lobby.connected') : t('lobby.disconnected')}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
              {emptySeats.length > 0 && (
                <ul className="lobby__empty" aria-label={t('island.lobby.emptySeats')}>
                  {emptySeats.map((seat) => (
                    <li key={seat} className="lobby-seat lobby-seat--empty">
                      <span className="lobby-seat__avatar"><GameIcon name="users" size={30} /></span>
                      <p className="lobby-seat__number muted">{t('island.lobby.seatNumber', { number: seat + 1 })}</p>
                      <h3 className="lobby-seat__name">{t('island.lobby.emptySeat')}</h3>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {!selfMember && (
              <fieldset className="seat-picker">
                <legend>{t('lobby.selectSeat')}</legend>
                <ul className="color-list">
                  {COLORS.map((color) => (
                    <li key={color}>
                      <button
                        type="button"
                        className={`button button--chip color-choice color-choice--${color}`}
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
              <div className="form-actions">
                <button
                  type="button"
                  className={`button${selfMember.ready ? '' : ' button--primary'}`}
                  data-testid="toggle-ready"
                  aria-pressed={selfMember.ready}
                  onClick={() => void actions.setReady(!selfMember.ready)}
                >
                  <GameIcon name="check" />
                  {selfMember.ready ? t('lobby.markNotReady') : t('lobby.markReady')}
                </button>
              </div>
            )}
          </section>

          <section className="card lobby-rules" aria-labelledby="rules-heading">
            <div className="section-heading">
              <span className="section-heading__icon"><GameIcon name="book" size={23} /></span>
              <div className="section-heading__copy"><h2 id="rules-heading">{t('lobby.rulesSummary')}</h2></div>
            </div>
            <p><strong>{t(`profile.${room.profileId}`)}</strong></p>
            <p className="muted">{t('lobby.setupMode.' + room.setupMode)}</p>
            {profile?.paired && <p className="muted">{t('lobby.pairedNote')}</p>}
          </section>
          <PolicyProposalPanel controller={controller} />
        </div>

        <div className="lobby__aside">
          <section className="card lobby-invite" aria-labelledby="invite-heading">
            <div className="section-heading">
              <span className="section-heading__icon"><GameIcon name="key" size={23} /></span>
              <div className="section-heading__copy"><h2 id="invite-heading">{t('lobby.inviteCode')}</h2></div>
            </div>
            <p className="muted">{t('island.lobby.inviteDescription')}</p>
            <p className="lobby-invite__code"><code data-testid="room-code">{room.code}</code></p>
            <p className="muted">
              {t('lobby.visibility.' + room.visibility)} · {t('lobby.setupMode.' + room.setupMode)}
            </p>
            {host && (
              <p className="lobby-invite__host muted" data-testid="host-name">
                <GameIcon name="crown" size={17} />{t('app.host')}: {host.nickname}
              </p>
            )}
          </section>

          <section className="card lobby-start" aria-labelledby="start-heading">
            <h2 id="start-heading">{t('lobby.start')}</h2>
            {startBlockers.length > 0 ? (
              <div className="lobby-start__blockers" id="start-blockers" data-testid="start-blockers" role="status">
                <p><strong>{t('lobby.startBlocked')}</strong></p>
                <ul>
                  {startBlockers.map((blocker, index) => (
                    <li key={`${blocker.messageId}-${index}`}>
                      {t(blocker.messageId, blocker.params)}
                    </li>
                  ))}
                </ul>
              </div>
            ) : <p className="muted">{t('island.lobby.readyToStart')}</p>}
            {!isHost && <p className="muted">{t('lobby.notHost')}</p>}
            <button
              type="button"
              className="button button--primary"
              data-testid="start-game"
              disabled={!canStart}
              aria-describedby={startBlockers.length > 0 ? 'start-blockers' : undefined}
              onClick={() => void actions.startGame()}
            >
              <GameIcon name="ship" />{t('lobby.start')}
            </button>
            <div className="form-actions lobby-start__leave">
              <button type="button" className="button button--ghost" data-testid="leave-room" onClick={() => void actions.leaveRoom()}>
                {t('lobby.leave')}
              </button>
              {isHost && (
                <button type="button" className="button button--ghost" data-testid="close-room" onClick={() => void actions.closeRoom()}>
                  {t('lobby.closeRoom')}
                </button>
              )}
            </div>
          </section>

          <section className="card lobby-policy" aria-labelledby="policy-heading">
            <div className="section-heading">
              <span className="section-heading__icon"><GameIcon name="settings" size={23} /></span>
              <div className="section-heading__copy"><h2 id="policy-heading">{t('lobby.policyTitle')}</h2></div>
            </div>
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
            <div className="field field--checkbox">
              <input
                id="policy-abandon"
                data-testid="policy-abandon"
                type="checkbox"
                checked={policy.allowAbandonment}
                disabled={!isHost}
                onChange={(event) => setPolicyField('allowAbandonment', event.target.checked)}
              />
              <label htmlFor="policy-abandon">{t('lobby.policy.allowAbandonment')}</label>
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
        </div>
      </div>

      {state.roomError && (
        <p className="error" role="alert">
          {t(state.roomError.messageId, state.roomError.params)}
        </p>
      )}
    </main>
  );
}
