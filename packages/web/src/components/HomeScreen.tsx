import { useMemo, useState } from 'react';
import { LanguageSwitch } from './LanguageSwitch.tsx';
import { GameBrand, GameIcon, IslandIllustration } from './GameArt.tsx';
import { useLocale, useT } from '../i18n/context.tsx';
import { formatDateTime } from '../i18n/format.ts';
import type { ScreenProps } from './props.ts';

/**
 * Home: resume list, create/join, public room browser (docs/SPEC.md §4.2, §4.8).
 *
 * The public room list is built only from `RoomSummaryView`, which carries
 * lobby metadata and never seated-player state (docs/SPEC.md §8.3).
 */
export function HomeScreen({ controller }: ScreenProps) {
  const t = useT();
  const locale = useLocale();
  const { state, actions } = controller;
  const [code, setCode] = useState('');
  const [visibility, setVisibility] = useState<'private' | 'public'>('private');
  const [capacity, setCapacity] = useState(4);
  const [profileId, setProfileId] = useState('');
  const [setupMode, setSetupMode] = useState<'fixed' | 'variable'>('fixed');

  const profiles = state.profiles.filter((profile) => profile.enabled);
  const chosenProfile = useMemo(
    () => profiles.find((profile) => profile.id === profileId) ?? profiles[0] ?? null,
    [profiles, profileId],
  );
  const capacityOptions = chosenProfile?.playerCounts ?? [3, 4];
  const effectiveCapacity = capacityOptions.includes(capacity) ? capacity : (capacityOptions[0] ?? 4);
  const setupOptions = chosenProfile?.setupModes ?? ['fixed', 'variable'];
  const effectiveSetup = setupOptions.includes(setupMode) ? setupMode : (setupOptions[0] ?? 'fixed');

  return (
    <main className="screen screen--home" id="main">
      <header className="screen__header game-header">
        <GameBrand />
        <div className="game-header__identity">
          <span className="identity-badge"><GameIcon name="users" />{state.nickname}</span>
          <LanguageSwitch onChange={actions.setLocale} />
        </div>
      </header>

      <section className="hero hero--home" aria-labelledby="home-heading">
        <div className="hero__copy">
          <p className="hero__eyebrow"><GameIcon name="compass" />{t('island.home.eyebrow')}</p>
          <h1 className="hero__title" id="home-heading">{t('island.home.title')}</h1>
          <p className="hero__description">{t('island.home.description')}</p>
        </div>
        <div className="hero__art"><IslandIllustration /></div>
      </section>

      <div className="home__actions">
        <section aria-labelledby="create-heading" className="card home__create">
          <div className="section-heading">
            <span className="section-heading__icon"><GameIcon name="flag" size={25} /></span>
            <div className="section-heading__copy">
              <h2 id="create-heading">{t('home.createRoom')}</h2>
              <p className="muted">{t('island.home.createDescription')}</p>
            </div>
          </div>
          <div className="form-grid">
            <div className="field">
              <label htmlFor="room-visibility">{t('lobby.visibility')}</label>
              <select
                id="room-visibility"
                value={visibility}
                onChange={(event) => setVisibility(event.target.value as 'private' | 'public')}
              >
                <option value="private">{t('lobby.visibility.private')}</option>
                <option value="public">{t('lobby.visibility.public')}</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor="room-profile">{t('lobby.profile')}</label>
              <select
                id="room-profile"
                data-testid="profile-select"
                value={chosenProfile?.id ?? ''}
                onChange={(event) => setProfileId(event.target.value)}
              >
                {profiles.length === 0 && <option value="">{t('app.none')}</option>}
                {profiles.map((profile) => (
                  <option key={profile.id} value={profile.id}>
                    {t(profile.labelKey)}
                  </option>
                ))}
              </select>
              {chosenProfile && !chosenProfile.enabled && chosenProfile.unavailableReasonKey && (
                <p className="muted">{t(chosenProfile.unavailableReasonKey)}</p>
              )}
            </div>
            <div className="field">
              <label htmlFor="room-capacity">{t('lobby.capacity')}</label>
              <select
                id="room-capacity"
                value={effectiveCapacity}
                onChange={(event) => setCapacity(Number(event.target.value))}
              >
                {capacityOptions.map((count) => (
                  <option key={count} value={count}>{count}</option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="room-setup">{t('lobby.setupMode')}</label>
              <select
                id="room-setup"
                value={effectiveSetup}
                onChange={(event) => setSetupMode(event.target.value as 'fixed' | 'variable')}
              >
                {setupOptions.map((mode) => (
                  <option key={mode} value={mode}>{t(`lobby.setupMode.${mode}`)}</option>
                ))}
              </select>
            </div>
          </div>
          {chosenProfile?.paired && <p className="muted">{t('lobby.pairedNote')}</p>}
          <div className="form-actions">
            <button
              type="button"
              className="button button--primary"
              data-testid="create-room"
              disabled={!chosenProfile}
              onClick={() =>
                void actions.createRoom({
                  visibility,
                  capacity: effectiveCapacity,
                  profileId: chosenProfile?.id ?? '',
                  setupMode: effectiveSetup,
                })
              }
            >
              <GameIcon name="plus" />{t('lobby.create')}
            </button>
          </div>
        </section>

        <section aria-labelledby="join-heading" className="card home__join">
          <div className="section-heading">
            <span className="section-heading__icon"><GameIcon name="key" size={25} /></span>
            <div className="section-heading__copy">
              <h2 id="join-heading">{t('home.joinRoom')}</h2>
              <p className="muted">{t('island.home.joinDescription')}</p>
            </div>
          </div>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (code.trim().length > 0) void actions.joinRoom(code);
            }}
          >
            <div className="field">
              <label htmlFor="join-code">{t('lobby.joinCode')}</label>
              <input
                id="join-code"
                data-testid="join-code"
                placeholder={t('island.home.codePlaceholder')}
                value={code}
                onChange={(event) => setCode(event.target.value)}
              />
            </div>
            <div className="form-actions">
              <button type="submit" className="button" data-testid="join-room">
                {t('lobby.join')}<GameIcon name="arrow-right" />
              </button>
            </div>
          </form>
          {state.roomError && (
            <p className="error" role="alert">
              {t(state.roomError.messageId, state.roomError.params)}
            </p>
          )}
          <p className="home__join-note muted"><GameIcon name="anchor" />{t('island.home.inviteNote')}</p>
        </section>
      </div>

      <section aria-labelledby="resume-heading" className="card home__resume">
        <div className="section-heading">
          <span className="section-heading__icon"><GameIcon name="scroll" size={24} /></span>
          <div className="section-heading__copy"><h2 id="resume-heading">{t('home.resumeGames')}</h2></div>
        </div>
        {state.games.length === 0 ? (
          <div className="empty-state">
            <GameIcon name="ship" size={32} />
            <p className="muted" data-testid="no-games">{t('home.noResumeGames')}</p>
          </div>
        ) : (
          <ul className="list resume-list" data-testid="resume-list">
            {state.games.map((game) => (
              <li key={game.gameId} className="list__row resume-card">
                <span className="resume-card__icon"><GameIcon name="compass" size={28} /></span>
                <div className="resume-card__copy">
                  <strong>{t(`profile.${game.profileId}`)}</strong>
                  <p className="muted">
                    {t(`lobby.roomStatus.${game.status}`)} · {game.players.map((p) => p.nickname).join('、')}
                  </p>
                  <p className="muted">{t('home.lastSavedAt', { time: formatDateTime(locale, game.lastSavedAt) })}</p>
                  {game.allSeatsNeeded && <p className="muted">{t('home.allSeatsNeeded')}</p>}
                </div>
                <button
                  type="button"
                  className="button"
                  data-testid={`resume-${game.gameId}`}
                  onClick={() => void actions.openGame(game.gameId)}
                >
                  {t('home.resume')}<GameIcon name="arrow-right" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="rooms-heading" className="card home__rooms">
        <div className="section-heading">
          <span className="section-heading__icon"><GameIcon name="globe" size={24} /></span>
          <div className="section-heading__copy"><h2 id="rooms-heading">{t('home.publicRooms')}</h2></div>
          <button type="button" className="button button--ghost" onClick={() => void actions.refreshRooms()}>
            <GameIcon name="refresh" />{t('home.refreshRooms')}
          </button>
        </div>
        <div className="room-filters">
          <div className="field field--inline">
            <label htmlFor="filter-players">{t('lobby.filter.playerCount')}</label>
            <select
              id="filter-players"
              value={state.roomQuery.playerCount ?? ''}
              onChange={(event) => {
                const value = event.target.value;
                void actions.refreshRooms({
                  ...state.roomQuery,
                  ...(value === '' ? { playerCount: undefined } : { playerCount: Number(value) }),
                });
              }}
            >
              <option value="">{t('lobby.filter.any')}</option>
              {[3, 4, 5, 6].map((count) => (
                <option key={count} value={count}>{count}</option>
              ))}
            </select>
          </div>
          <div className="field field--checkbox">
            <input
              id="filter-seats"
              type="checkbox"
              checked={state.roomQuery.hasSeats === true}
              onChange={(event) =>
                void actions.refreshRooms({ ...state.roomQuery, hasSeats: event.target.checked })
              }
            />
            <label htmlFor="filter-seats">{t('lobby.filter.hasSeats')}</label>
          </div>
        </div>
        {state.rooms.length === 0 ? (
          <div className="empty-state">
            <GameIcon name="anchor" size={32} />
            <p className="muted" data-testid="no-rooms">{t('home.roomListEmpty')}</p>
          </div>
        ) : (
          <div className="room-list">
            <table className="table" data-testid="room-table">
              <caption className="visually-hidden">{t('home.publicRooms')}</caption>
              <thead>
                <tr>
                  <th scope="col">{t('lobby.profile')}</th>
                  <th scope="col">{t('lobby.roomStatus')}</th>
                  <th scope="col">{t('lobby.capacity')}</th>
                  <th scope="col">{t('lobby.join')}</th>
                </tr>
              </thead>
              <tbody>
                {state.rooms.map((room) => (
                  <tr key={room.id} className="room-row">
                    <td data-label={t('lobby.profile')}><strong>{t(`profile.${room.profileId}`)}</strong></td>
                    <td data-label={t('lobby.roomStatus')}>{t(`lobby.roomStatus.${room.status}`)}</td>
                    <td data-label={t('lobby.capacity')}>
                      {room.playerCount}/{room.capacity} · {t('lobby.openSeats', { count: room.openSeats })}
                    </td>
                    <td data-label={t('lobby.join')}>
                      <button
                        type="button"
                        className="button"
                        disabled={room.openSeats <= 0 || !room.code}
                        onClick={() => room.code && void actions.joinRoom(room.code)}
                      >
                        {t('lobby.join')}<GameIcon name="chevron-right" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section aria-labelledby="identity-heading" className="card home__identity">
        <div className="section-heading">
          <span className="section-heading__icon"><GameIcon name="users" size={23} /></span>
          <div className="section-heading__copy"><h2 id="identity-heading">{t('entry.changeNickname')}</h2></div>
        </div>
        <NicknameEditor controller={controller} />
        <p className="muted">{t('entry.identityNote')}</p>
      </section>
    </main>
  );
}

function NicknameEditor({ controller }: ScreenProps) {
  const t = useT();
  const { state, dispatch, actions } = controller;
  const [saving, setSaving] = useState(false);
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        setSaving(true);
        void actions.submitNickname(state.draftNickname).then(() => setSaving(false));
      }}
    >
      <div className="field">
        <label htmlFor="home-nickname">{t('entry.nicknameLabel')}</label>
        <input
          id="home-nickname"
          data-testid="home-nickname"
          value={state.draftNickname}
          onChange={(event) => dispatch({ type: 'draft-nickname', value: event.target.value })}
        />
      </div>
      <button type="submit" className="button" disabled={saving}>
        {t('app.confirm')}
      </button>
    </form>
  );
}
