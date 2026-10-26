import { useMemo, useState } from 'react';
import { LanguageSwitch } from './LanguageSwitch.tsx';
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
  const { state, dispatch, actions } = controller;
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
      <header className="screen__header">
        <h1>{t('app.title')}</h1>
        <LanguageSwitch onChange={actions.setLocale} />
      </header>

      <section aria-labelledby="resume-heading" className="card">
        <h2 id="resume-heading">{t('home.resumeGames')}</h2>
        {state.games.length === 0 ? (
          <p className="muted" data-testid="no-games">
            {t('home.noResumeGames')}
          </p>
        ) : (
          <ul className="list" data-testid="resume-list">
            {state.games.map((game) => (
              <li key={game.gameId} className="list__row">
                <div>
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
                  {t('home.resume')}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="create-heading" className="card">
        <h2 id="create-heading">{t('home.createRoom')}</h2>
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
              <option key={count} value={count}>
                {count}
              </option>
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
              <option key={mode} value={mode}>
                {t(`lobby.setupMode.${mode}`)}
              </option>
            ))}
          </select>
        </div>
        {chosenProfile?.paired && <p className="muted">{t('lobby.pairedNote')}</p>}
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
          {t('lobby.create')}
        </button>
      </section>

      <section aria-labelledby="join-heading" className="card">
        <h2 id="join-heading">{t('home.joinRoom')}</h2>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (code.trim().length > 0) void actions.joinRoom(code);
          }}
        >
          <label htmlFor="join-code">{t('lobby.joinCode')}</label>
          <input
            id="join-code"
            data-testid="join-code"
            value={code}
            onChange={(event) => setCode(event.target.value)}
          />
          <button type="submit" className="button" data-testid="join-room">
            {t('lobby.join')}
          </button>
        </form>
        {state.roomError && (
          <p className="error" role="alert">
            {t(state.roomError.messageId, state.roomError.params)}
          </p>
        )}
      </section>

      <section aria-labelledby="rooms-heading" className="card">
        <h2 id="rooms-heading">{t('home.publicRooms')}</h2>
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
              <option key={count} value={count}>
                {count}
              </option>
            ))}
          </select>
          <label htmlFor="filter-seats">{t('lobby.filter.hasSeats')}</label>
          <input
            id="filter-seats"
            type="checkbox"
            checked={state.roomQuery.hasSeats === true}
            onChange={(event) =>
              void actions.refreshRooms({ ...state.roomQuery, hasSeats: event.target.checked })
            }
          />
        </div>
        {state.rooms.length === 0 ? (
          <p className="muted" data-testid="no-rooms">
            {t('home.roomListEmpty')}
          </p>
        ) : (
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
                <tr key={room.id}>
                  <td>{t(`profile.${room.profileId}`)}</td>
                  <td>{t(`lobby.roomStatus.${room.status}`)}</td>
                  <td>
                    {room.playerCount}/{room.capacity} · {t('lobby.openSeats', { count: room.openSeats })}
                  </td>
                  <td>
                    <button
                      type="button"
                      className="button"
                      disabled={room.openSeats <= 0 || !room.code}
                      onClick={() => room.code && void actions.joinRoom(room.code)}
                    >
                      {t('lobby.join')}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <button type="button" className="button button--ghost" onClick={() => void actions.refreshRooms()}>
          {t('home.refreshRooms')}
        </button>
      </section>

      <section aria-labelledby="identity-heading" className="card">
        <h2 id="identity-heading">{t('entry.changeNickname')}</h2>
        <NicknameEditor controller={controller} />
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
      <label htmlFor="home-nickname">{t('entry.nicknameLabel')}</label>
      <input
        id="home-nickname"
        data-testid="home-nickname"
        value={state.draftNickname}
        onChange={(event) => dispatch({ type: 'draft-nickname', value: event.target.value })}
      />
      <button type="submit" className="button" disabled={saving}>
        {t('app.confirm')}
      </button>
    </form>
  );
}
