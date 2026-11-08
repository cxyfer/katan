import { useT, useLocale } from '../i18n/context.tsx';
import { formatNumber } from '../i18n/format.ts';
import {
  citiesKnightsHints, citiesKnightsView, MAX_LEVEL, MAX_WALLS, TRACK_COMMODITY, TRACKS, VP_PROGRESS,
  type CitiesKnightsModuleView, type ImprovementOption,
} from '../board/citiesKnights.ts';
import { pirateActive } from '../board/seafarersCitiesKnights.ts';
import { blocksNewCommands } from '../state/commands.ts';
import { shownCitiesKnights, tableSuspended } from '../state/table.ts';
import type { TableController } from '../state/useTable.ts';
import { ProgressHand } from './CitiesKnightsProgress.tsx';
import { BarbarianTrack, CommodityEmblem, EventDieFace, PipDieFace, TRACK_COLOR, TrackEmblem } from './SvgCitiesKnights.tsx';
import '../styles/cities-knights.css';

/**
 * The Cities & Knights tool panel: barbarian track and strengths, the last
 * event roll, the improvement chart with each level's ability and the buy
 * buttons, the viewer's progress hand (played from `ProgressHand`), the commodity supply and the last barbarian attack.
 */
export function CitiesKnightsPanel({ controller }: { controller: TableController }) {
  const t = useT();
  const locale = useLocale();
  const { state, actions } = controller;
  const view = shownCitiesKnights(state);
  const ck = citiesKnightsView(view);
  if (!view || !ck) return null;
  const hints = citiesKnightsHints(view);
  const selfId = state.session?.id ?? null;
  const self = view.players.find((player) => player.id === selfId);
  // 全桌暫停（§4.8）時伺服器拒絕城市升級。
  const suspended = tableSuspended(state);
  const blocked = blocksNewCommands(state.command) || suspended;
  const n = (value: number) => formatNumber(locale, value);
  const nameOf = (id: string) => view.players.find((player) => player.id === id)?.nickname ?? id;

  const improve = (option: ImprovementOption) => {
    if (option.metropolis && option.sites.length > 1) {
      actions.selectTarget({ kind: 'vertex', index: null, commandType: 'city.improve', labelId: 'ck.panel.metropolisSite', params: { track: option.track }, field: 'vertex' });
      return;
    }
    void actions.submitCommand({ type: 'city.improve', track: option.track }, 'ck.panel.improve');
  };

  return (
    <section className="panel ck-panel" aria-labelledby="ck-panel-heading" data-testid="ck-panel">
      <h2 id="ck-panel-heading" className="visually-hidden">{t('ck.panel.title')}</h2>

      <section className="ck-panel__section" aria-labelledby="ck-barbarians-heading" data-testid="ck-barbarians">
        <h3 id="ck-barbarians-heading">{t('ck.panel.barbarians')}</h3>
        <BarbarianTrack position={ck.barbarian.position} length={ck.barbarian.length} testId="ck-barbarian-track" />
        <p className="ck-panel__strengths">
          <span data-testid="ck-barbarian-strength">{t('ck.panel.barbarianStrength', { strength: n(ck.barbarianStrength) })}</span>
          <span data-testid="ck-defender-strength">{t('ck.panel.defenderStrength', { strength: n(ck.defenderStrength) })}</span>
        </p>
        <p className="muted">
          {t('ck.panel.trackPosition', { position: n(ck.barbarian.position), length: n(ck.barbarian.length) })}
          {' · '}{t(ck.robberActive ? 'ck.panel.robberActive' : 'ck.panel.robberWaiting')}
          {pirateActive(view) !== null && <>{' · '}<span data-testid="sfck-pirate-status">{t(pirateActive(view) ? 'sfck.panel.pirateActive' : 'sfck.panel.pirateWaiting')}</span></>}
        </p>
        {ck.lastRoll && (
          <p className="ck-panel__roll" data-testid="ck-last-roll">
            <span>{t('ck.panel.lastRoll')}</span>
            <EventDieFace face={ck.lastRoll.event} size={30} testId="ck-event-die" />
            <PipDieFace value={ck.lastRoll.red} tone="red" size={30} testId="ck-red-die" />
            <span className="visually-hidden">{t('event.ck.eventRolled', { event: t(`ck.event.${ck.lastRoll.event}`), red: ck.lastRoll.red })}</span>
          </p>
        )}
      </section>

      {ck.lastAttack && <AttackResult ck={ck} nameOf={nameOf} />}

      <section className="ck-panel__section" aria-labelledby="ck-improvements-heading" data-testid="ck-improvements">
        <h3 id="ck-improvements-heading">{t('ck.panel.improvements')}</h3>
        {suspended && <p className="muted" data-testid="ck-improvements-suspended">{t('play.disabled.suspended')}</p>}
        <ul className="ck-chart">
          {TRACKS.map((track) => {
            const level = self?.improvements[track] ?? 0;
            const option = hints?.improvements.find((candidate) => candidate.track === track);
            const holder = ck.metropolises[track];
            const commodity = TRACK_COMMODITY[track];
            return <li key={track} className={`ck-chart__track ck-chart__track--${track}`} data-testid={`ck-track-${track}`} data-level={level}>
              <div className="ck-chart__head" style={{ ['--ck-track' as string]: TRACK_COLOR[track] }}>
                <svg viewBox="-9 -9 18 18" width="20" height="20" aria-hidden="true"><TrackEmblem track={track} size={12} /></svg>
                <strong>{t(`ck.track.${track}`)}</strong>
                <span className="ck-chart__level">{t('ck.panel.level', { level: n(level), max: n(MAX_LEVEL) })}</span>
              </div>
              <ol className="ck-chart__steps" aria-label={t('ck.panel.levels', { track: t(`ck.track.${track}`) })}>
                {Array.from({ length: MAX_LEVEL }, (_, index) => index + 1).map((step) => (
                  <li key={step} data-reached={step <= level ? 'true' : undefined} className="ck-chart__step"
                    title={t('ck.panel.stepDraw', { level: n(step), up: n(step + 1) })}>
                    <span>{n(step)}</span>
                    {step >= 3 && <small>{t(step === 3 ? 'ck.panel.ability' : 'ck.panel.metropolisStep')}</small>}
                  </li>
                ))}
              </ol>
              <p className="ck-chart__ability" data-unlocked={level >= 3 ? 'true' : undefined}>
                {t(`ck.ability.${track}`)}
              </p>
              <p className="muted ck-chart__draw">{level > 0 ? t('ck.panel.drawsOn', { up: n(level + 1) }) : t('ck.panel.drawsNever')}</p>
              <p className="muted" data-testid={`ck-metropolis-${track}`}>
                {holder ? t('ck.panel.metropolisHeld', { player: nameOf(holder.player) }) : t('ck.panel.metropolisOpen')}
              </p>
              {option && (
                <button type="button" className="button ck-chart__buy" data-testid={`ck-improve-${track}`}
                  disabled={blocked || option.blocked !== null}
                  onClick={() => improve(option)}>
                  <CommodityEmblem commodity={commodity} size={16} />
                  {t('ck.panel.buy', { level: n(option.level), cost: n(option.cost), commodity: t(`resource.${commodity}`) })}
                </button>
              )}
              {option?.blocked && <p className="muted" data-testid={`ck-improve-blocked-${track}`}>{t(`ck.blocked.${option.blocked}`)}</p>}
            </li>;
          })}
        </ul>
      </section>

      <section className="ck-panel__section" aria-labelledby="ck-progress-heading" data-testid="ck-progress">
        <h3 id="ck-progress-heading">{t('ck.panel.progress', { count: n(self?.progressCards?.length ?? 0), limit: n(ck.handLimit) })}</h3>
        <ProgressHand controller={controller} />
        {(ck.progressVp[selfId ?? '']?.length ?? 0) > 0 && (
          <p className="muted" data-testid="ck-progress-vp">
            {t('ck.panel.progressVp', { cards: ck.progressVp[selfId!]!.filter((card) => VP_PROGRESS.has(card)).map((card) => t(`ck.progress.${card}`)) })}
          </p>
        )}
        <p className="muted" data-testid="ck-decks">
          {t('ck.panel.decks', { science: n(ck.decks.science), trade: n(ck.decks.trade), politics: n(ck.decks.politics) })}
        </p>
      </section>

      <section className="ck-panel__section" aria-labelledby="ck-supply-heading" data-testid="ck-supply">
        <h3 id="ck-supply-heading">{t('ck.panel.supply')}</h3>
        <ul className="ck-supply">
          {(['paper', 'cloth', 'coin'] as const).map((commodity) => <li key={commodity} data-testid={`ck-supply-${commodity}`}>
            <CommodityEmblem commodity={commodity} size={20} />
            <span>{t(`resource.${commodity}`)}</span>
            <strong>{n(ck.commodityBank[commodity])}</strong>
            {hints && <small>{t('ck.panel.rate', { rate: n(hints.commodityRates[commodity]) })}</small>}
          </li>)}
        </ul>
        {self && <p className="muted">{t('ck.panel.walls', { walls: n(self.cityWalls), limit: n(MAX_WALLS) })}</p>}
        {hints && <p className="muted" data-testid="ck-knight-supply">
          {t('ck.panel.knightSupply', { basic: n(hints.knightSupply[1]), strong: n(hints.knightSupply[2]), mighty: n(hints.knightSupply[3]) })}
        </p>}
      </section>
    </section>
  );
}

function AttackResult({ ck, nameOf }: { ck: CitiesKnightsModuleView; nameOf: (id: string) => string }) {
  const t = useT();
  const attack = ck.lastAttack!;
  const contributions = Object.entries(attack.contributions).sort((a, b) => b[1] - a[1]);
  return (
    <section className="ck-panel__section ck-attack" aria-labelledby="ck-attack-heading" data-testid="ck-attack" data-outcome={attack.outcome}>
      <h3 id="ck-attack-heading">{t('ck.panel.lastAttack')}</h3>
      <p className="ck-attack__score">
        <strong>{t('ck.panel.attackScore', { barbarians: attack.barbarians, defenders: attack.defenders })}</strong>
        {' — '}{t(`ck.attack.${attack.outcome}`)}
      </p>
      <ul className="ck-attack__list">
        {contributions.map(([player, value]) => <li key={player}>{t('ck.panel.contribution', { player: nameOf(player), strength: value })}</li>)}
      </ul>
      {attack.defender && <p data-testid="ck-attack-defender">{t('event.ck.defenderOfCatan', { player: nameOf(attack.defender) })}</p>}
      {attack.tied.length > 0 && <p>{t('event.ck.defendersTied', { players: attack.tied.map(nameOf) })}</p>}
      {attack.pillaged.length > 0 && <p data-testid="ck-attack-pillaged">
        {t('ck.panel.pillaged', { cities: attack.pillaged.map((entry) => t('ck.panel.pillagedEntry', { player: nameOf(entry.player), vertex: entry.vertex })) })}
      </p>}
      {attack.outcome === 'barbarians' && attack.pillaged.length === 0 && <p className="muted">{t('ck.panel.noCityLost')}</p>}
    </section>
  );
}
