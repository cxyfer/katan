import { useEffect, useMemo, useRef, useState } from 'react';
import { GAME_ORDER_MODES, type GameOrderMode } from '@catan/protocol';
import { LanguageSwitch } from './LanguageSwitch.tsx';
import { SoundSettings } from './SoundSettings.tsx';
import { NewsBoard } from './NewsBoard.tsx';
import { LATEST_PLAYER_NOTE, PLAYER_NOTES } from '../news/player-notes.ts';
import { GameBrand, GameIcon, PregameScene } from './GameArt.tsx';
import { useLocale, useT } from '../i18n/context.tsx';
import { formatDateTime } from '../i18n/format.ts';
import type { ScreenProps } from './props.ts';
import { expansionLabelIds, resolveRuleset, scenarioLabelIds } from '../state/rulesets.ts';

/**
 * Home: resume list, create/join, public room browser (docs/SPEC.md §4.2, §4.8).
 *
 * The public room list is built only from `RoomSummaryView`, which carries
 * lobby metadata and never seated-player state (docs/SPEC.md §8.3).
 */
type HomePane = 'table' | 'resume' | 'rooms' | 'news' | 'identity';

export function HomeScreen({ controller }: ScreenProps) {
  const t = useT();
  const locale = useLocale();
  const { state, actions } = controller;
  const [homePane, setHomePane] = useState<HomePane>('table');
  const [code, setCode] = useState('');
  const [visibility, setVisibility] = useState<'private' | 'public'>('private');
  const [capacity, setCapacity] = useState(3);
  const [expansionKey, setExpansionKey] = useState('');
  const [scenarioKey, setScenarioKey] = useState('');
  const [setupMode, setSetupMode] = useState<'fixed' | 'variable'>('fixed');
  const [orderMode, setOrderMode] = useState<GameOrderMode>('join');
  const homePanes = ['table', 'resume', 'rooms', 'news', 'identity'] as const;
  const homeTabRef = useRef<HTMLButtonElement | null>(null);

  const capacityLimit = state.config?.limits.roomCapacityMax ?? Infinity;
  // Expansion set → scenario → player count, all derived from the registry.
  const ruleset = useMemo(
    () => resolveRuleset(state.profiles, { expansionKey, scenarioKey, playerCount: capacity }, capacityLimit),
    [state.profiles, expansionKey, scenarioKey, capacity, capacityLimit],
  );
  const chosenProfile = ruleset.profile;
  const capacityOptions = ruleset.playerCounts;
  const effectiveCapacity = ruleset.playerCount ?? capacityOptions[0] ?? 4;
  const joinLabels = (ids: string[]) => ids.map((id) => t(id)).join(' + ');
  const setupOptions = chosenProfile?.setupModes ?? ['fixed', 'variable'];
  const effectiveSetup = setupOptions.includes(setupMode) ? setupMode : (setupOptions[0] ?? 'fixed');

  const paneIcon: Record<HomePane, string> = { table: 'flag', resume: 'anchor', rooms: 'globe', news: 'sparkles', identity: 'settings' };
  const paneCount: Partial<Record<HomePane, number>> = { resume: state.games.length, rooms: state.rooms.length };
  // 公告牌：最新一則還沒在這個瀏覽器看過時，在分頁上標示「新」。
  const latestNote = LATEST_PLAYER_NOTE;
  const newsUnread = latestNote !== null && state.newsSeen !== latestNote.version;
  const paneHint = (pane: HomePane) =>
    pane === 'news' && latestNote ? `v${latestNote.version} · ${latestNote.title[locale]}` : t(`home.paneHint.${pane}`);

  // 開啟公告牌即視為已讀；離開首頁再回來也不會重複標示。
  useEffect(() => {
    if (homePane === 'news' && newsUnread && latestNote) actions.markNewsSeen(latestNote.version);
  }, [homePane, newsUnread, latestNote, actions.markNewsSeen]);

  // The room browser renders a live `GET /api/rooms` result, so opening the
  // pane must fetch it instead of waiting for the refresh button. Re-running
  // on every visit also picks up rooms created while this page stayed open.
  useEffect(() => {
    if (homePane === 'rooms') void actions.refreshRooms();
  }, [homePane, actions.refreshRooms]);

  return (
    <main className="screen screen--home pregame" id="main">
      <PregameScene withIsland />
      <header className="pregame__topbar">
        <GameBrand compact />
        <div className="pregame__topbar-end">
          <span className="identity-badge">
            <span className="identity-badge__token" aria-hidden="true">{initials(state.nickname ?? '')}</span>
            <span className="identity-badge__name">{state.nickname}</span>
          </span>
          <SoundSettings />
          <LanguageSwitch onChange={actions.setLocale} />
        </div>
      </header>

      <div className="home-stage">
        <div className="home-stage__menu">
          <section className="home-stage__intro" aria-labelledby="home-heading">
            <h1 className="home-stage__title" id="home-heading">{t('island.home.title')}</h1>
            <p className="home-stage__description">{t('island.home.description')}</p>
          </section>
          <nav className="home__nav" aria-label={t('home.navigation')} role="tablist" aria-orientation="vertical">
            {homePanes.map((pane, index) => (
              <button
                ref={homePane === pane ? homeTabRef : undefined}
                id={`home-tab-${pane}`}
                key={pane}
                type="button"
                tabIndex={homePane === pane ? 0 : -1}
                className={`home__nav-tab${homePane === pane ? ' home__nav-tab--active' : ''}`}
                // 手機橫屏只剩圖示時，滑鼠與觸控仍看得到名稱。
                title={t(`home.pane.${pane}`)}
                role="tab"
                aria-selected={homePane === pane}
                aria-controls={`home-pane-${pane}`}
                onClick={() => setHomePane(pane)}
                onKeyDown={(event) => {
                  let next = index;
                  if (event.key === 'ArrowRight' || event.key === 'ArrowDown') next = (index + 1) % homePanes.length;
                  else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') next = (index + homePanes.length - 1) % homePanes.length;
                  else if (event.key === 'Home') next = 0;
                  else if (event.key === 'End') next = homePanes.length - 1;
                  else return;
                  event.preventDefault();
                  const target = homePanes[next]!;
                  setHomePane(target);
                  requestAnimationFrame(() => document.getElementById(`home-tab-${target}`)?.focus());
                }}
              >
                <span className="home__nav-icon"><GameIcon name={paneIcon[pane]} size={20} /></span>
                <span className="home__nav-copy">
                  <span className="home__nav-label">{t(`home.pane.${pane}`)}</span>
                  <span className="home__nav-hint">{paneHint(pane)}</span>
                </span>
                {(paneCount[pane] ?? 0) > 0 && <span className="home__nav-count">{paneCount[pane]}</span>}
                {pane === 'news' && newsUnread && (
                  <span className="home__nav-count home__nav-count--new" data-testid="news-unread">{t('home.news.new')}</span>
                )}
              </button>
            ))}
          </nav>
        </div>

        <div className="plaque home-stage__panel">
      <div className="home-pane home__actions" id="home-pane-table" role="tabpanel" aria-labelledby="home-tab-table" hidden={homePane !== 'table'}>
        <section aria-labelledby="create-heading" className="home__create">
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
              <label htmlFor="room-expansions">{t('lobby.expansions')}</label>
              <select
                id="room-expansions"
                data-testid="expansion-select"
                value={ruleset.expansion?.key ?? ''}
                onChange={(event) => setExpansionKey(event.target.value)}
              >
                {ruleset.expansions.length === 0 && <option value="">{t('app.none')}</option>}
                {ruleset.expansions.map((choice) => (
                  <option key={choice.key} value={choice.key}>{joinLabels(expansionLabelIds(choice))}</option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="room-scenario">{t('lobby.scenario')}</label>
              <select
                id="room-scenario"
                data-testid="scenario-select"
                value={ruleset.scenario?.key ?? ''}
                disabled={ruleset.scenarios.length <= 1}
                onChange={(event) => setScenarioKey(event.target.value)}
              >
                {ruleset.scenarios.length === 0 && <option value="">{t('app.none')}</option>}
                {ruleset.scenarios.map((choice) => (
                  <option key={choice.key} value={choice.key}>{joinLabels(scenarioLabelIds(choice))}</option>
                ))}
              </select>
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
            <div className="field">
              <label htmlFor="room-order">{t('lobby.orderMode')}</label>
              <select
                id="room-order"
                data-testid="room-order"
                value={orderMode}
                onChange={(event) => setOrderMode(event.target.value as GameOrderMode)}
              >
                {GAME_ORDER_MODES.map((mode) => (
                  <option key={mode} value={mode}>{t(`lobby.orderMode.${mode}`)}</option>
                ))}
              </select>
              <p className="muted">{t('lobby.orderModeNote')}</p>
            </div>
          </div>
          {chosenProfile && (
            <p className="muted" data-testid="resolved-profile">
              {t('lobby.resolvedProfile', { profile: t(chosenProfile.labelKey) })}
              {' · '}
              {t('lobby.requiredBoxes', { boxes: chosenProfile.requiredBoxes.map((box) => t(`box.${box}`)) })}
            </p>
          )}
          {chosenProfile?.paired && <p className="muted">{t('lobby.pairedNote')}</p>}
          <div className="form-actions">
            <button
              type="button"
              className="button button--primary button--hero"
              data-testid="create-room"
              disabled={!chosenProfile || capacityOptions.length === 0}
              onClick={() =>
                void actions.createRoom({
                  visibility,
                  capacity: effectiveCapacity,
                  profileId: chosenProfile?.id ?? '',
                  setupMode: effectiveSetup,
                  orderMode,
                })
              }
            >
              <GameIcon name="plus" />{t('lobby.create')}
            </button>
          </div>
        </section>

        <section aria-labelledby="join-heading" className="home__join">
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

      <section id="home-pane-resume" role="tabpanel" aria-labelledby="home-tab-resume" hidden={homePane !== 'resume'} className="home-pane home__resume">
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
                    {t(`lobby.roomStatus.${game.status}`)} ·{' '}
                    {game.players
                      .map((p) => (p.bot ? t('bot.playerName', { name: p.nickname }) : p.nickname))
                      .join('、')}
                  </p>
                  <p className="muted">{t('home.lastSavedAt', { time: formatDateTime(locale, game.lastSavedAt) })}</p>
                  {game.allSeatsNeeded ? (
                    <p className="muted">{t('home.allSeatsNeeded')}</p>
                  ) : game.players.some((player) => player.bot) ? (
                    <p className="muted">{t('home.humanSeatsNeeded')}</p>
                  ) : null}
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

      <section id="home-pane-rooms" role="tabpanel" aria-labelledby="home-tab-rooms" hidden={homePane !== 'rooms'} className="home-pane home__rooms" aria-busy={state.roomsStatus === 'loading'}>
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
        {state.roomsError && (
          <p className="error" role="alert" data-testid="rooms-error">{t('home.roomListFailed')}</p>
        )}
        {state.rooms.length === 0 ? (
          state.roomsStatus === 'loading' ? (
            <div className="empty-state" role="status" data-testid="rooms-loading">
              <GameIcon name="compass" size={32} />
              <p className="muted">{t('app.loading')}</p>
            </div>
          ) : state.roomsStatus === 'error' ? null : (
            <div className="empty-state">
              <GameIcon name="anchor" size={32} />
              <p className="muted" data-testid="no-rooms">{t('home.roomListEmpty')}</p>
            </div>
          )
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
                      {(room.botCount ?? 0) > 0 && (
                        <span className="muted" data-testid={`room-bots-${room.id}`}>
                          {' · '}{t('lobby.botCount', { count: room.botCount })}
                        </span>
                      )}
                    </td>
                    <td data-label={t('lobby.join')}>
                      <button
                        type="button"
                        className="button"
                        disabled={room.status !== 'lobby' || room.openSeats <= 0 || !room.code}
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

      <section id="home-pane-news" role="tabpanel" aria-labelledby="home-tab-news" hidden={homePane !== 'news'} className="home-pane home__news">
        <NewsBoard notes={PLAYER_NOTES} version={__CATAN_VERSION__} />
      </section>

      <section id="home-pane-identity" role="tabpanel" aria-labelledby="home-tab-identity" hidden={homePane !== 'identity'} className="home-pane home__identity">
        <div className="section-heading">
          <span className="section-heading__icon"><GameIcon name="users" size={23} /></span>
          <div className="section-heading__copy"><h2 id="identity-heading">{t('entry.changeNickname')}</h2></div>
        </div>
        <NicknameEditor controller={controller} />
        <p className="muted">{t('entry.identityNote')}</p>
      </section>
        </div>
      </div>
    </main>
  );
}

function initials(nickname: string) {
  return Array.from(nickname.trim()).slice(0, 2).join('').toUpperCase();
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
