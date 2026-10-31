import { useEffect, useMemo, useState } from 'react';
import type { RoomPolicy } from '@catan/protocol';
import { POLICY_BOUNDS } from '@catan/protocol';
import { useT } from '../i18n/context.tsx';
import { LanguageSwitch } from './LanguageSwitch.tsx';
import { SoundSettings } from './SoundSettings.tsx';
import { GameBrand, GameIcon, PregameScene } from './GameArt.tsx';
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
  const [capacityDraft, setCapacityDraft] = useState<number | null>(null);
  const [copied, setCopied] = useState(false);
  const profile = room ? state.profiles.find((item) => item.id === room.profileId) : undefined;
  const capacityLimit = state.config?.limits.roomCapacityMax ?? Infinity;
  // Only counts the ruleset and deployment allow, never below the seated players.
  const capacityOptions = useMemo(
    () =>
      room
        ? Array.from(new Set([...(profile?.playerCounts ?? []), room.capacity]))
            .filter((count) => count >= room.members.length && count <= capacityLimit)
            .sort((a, b) => a - b)
        : [],
    [profile, room?.capacity, room?.members.length, capacityLimit],
  );
  useEffect(() => {
    if (capacityDraft !== null && !capacityOptions.includes(capacityDraft)) {
      setCapacityDraft(null);
    }
  }, [capacityDraft, capacityOptions]);

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
  const desiredCapacity = capacityDraft ?? room.capacity;
  // A join can invalidate a pending value; fall back to the first legal count.
  const selectedCapacity = capacityOptions.includes(desiredCapacity)
    ? desiredCapacity
    : (capacityOptions[0] ?? room.capacity);

  const setPolicyField = <K extends keyof RoomPolicy>(key: K, value: RoomPolicy[K]) => {
    setPolicyDraft({ ...policy, [key]: value });
  };

  return (
    <main className="screen screen--lobby pregame" id="main">
      <PregameScene />
      <header className="pregame__topbar">
        <GameBrand compact />
        <div className="pregame__topbar-end">
          <SoundSettings />
          <LanguageSwitch onChange={actions.setLocale} />
        </div>
      </header>

      <div className="lobby__banner">
        <div className="lobby__heading">
          <h1 className="lobby__title">{t('island.lobby.title')}</h1>
          <p className="lobby__description">{t('island.lobby.description')}</p>
          <ul className="lobby__summary" aria-label={t('lobby.rulesSummary')}>
            <li><GameIcon name="book" size={15} />{t(`profile.${room.profileId}`)}</li>
            <li><GameIcon name="compass" size={15} />{t(`lobby.roomStatus.${room.status}`)}</li>
            <li><GameIcon name="mountain" size={15} />{t('lobby.setupMode.' + room.setupMode)}</li>
            <li><GameIcon name={room.visibility === 'public' ? 'globe' : 'key'} size={15} />{t('lobby.visibility.' + room.visibility)}</li>
          </ul>
        </div>

        <section className="lobby-invite" aria-labelledby="invite-heading">
          <h2 id="invite-heading" className="lobby-invite__label">{t('lobby.inviteCode')}</h2>
          <p className="lobby-invite__code"><code data-testid="room-code">{room.code}</code></p>
          <div className="lobby-invite__actions">
            <button
              type="button"
              className="button button--ghost button--small"
              onClick={() => {
                void navigator.clipboard?.writeText(room.code).then(() => {
                  setCopied(true);
                  window.setTimeout(() => setCopied(false), 2400);
                }, () => setCopied(false));
              }}
            >
              <GameIcon name={copied ? 'check' : 'copy'} size={16} />{t('lobby.copyInvite')}
            </button>
            <span className="lobby-invite__copied" role="status">{copied ? t('lobby.inviteCopied') : ''}</span>
          </div>
          <p className="lobby-invite__hint">{t('island.lobby.inviteDescription')}</p>
          {host && (
            <p className="lobby-invite__host" data-testid="host-name">
              <GameIcon name="crown" size={16} />{t('app.host')}: {host.nickname}
            </p>
          )}
        </section>
      </div>

      <div className="lobby__grid">
        <div className="lobby__main">
          <section className="plaque lobby-players" aria-labelledby="seats-heading">
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

          {profile?.paired && <p className="lobby__paired-note">{t('lobby.pairedNote')}</p>}
          <PolicyProposalPanel controller={controller} />
          <section className="plaque lobby-settings" aria-labelledby="room-settings-heading">
            <div className="section-heading">
              <span className="section-heading__icon"><GameIcon name="users" size={23} /></span>
              <div className="section-heading__copy">
                <h2 id="room-settings-heading">{t('lobby.settingsTitle')}</h2>
                <p className="muted">{t('lobby.settings.help')}</p>
              </div>
            </div>
            <div className="lobby-settings__form">
              <div className="field">
                <label htmlFor="lobby-capacity">{t('lobby.capacity')}</label>
                <select
                  id="lobby-capacity"
                  data-testid="lobby-capacity"
                  value={selectedCapacity}
                  disabled={!isHost}
                  onChange={(event) => setCapacityDraft(Number(event.target.value))}
                >
                  {capacityOptions.map((count) => (
                    <option key={count} value={count}>{count}</option>
                  ))}
                </select>
                <p className="muted">{t('lobby.capacityNote')}</p>
              </div>
              <button
                type="button"
                className="button"
                data-testid="save-settings"
                disabled={!isHost || selectedCapacity === room.capacity}
                onClick={() => {
                  if (selectedCapacity !== room.capacity) {
                    void actions.updateSettings({ capacity: selectedCapacity });
                  }
                }}
              >
                {t('lobby.settings.save')}
              </button>
            </div>
          </section>
          <section className="plaque lobby-policy" aria-labelledby="policy-heading">
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

        <div className="lobby__aside">
          <section className="plaque lobby-start" aria-labelledby="start-heading">
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
              className="button button--primary button--hero"
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
