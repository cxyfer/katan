import { COSTS, RESOURCES, getProfile } from '@katan/rules';
import { useLocale, useT } from '../i18n/context.tsx';
import { formatResourceMap } from '../i18n/format.ts';
import { Legend } from './Legend.tsx';
import { TbHelp } from './tb/TbPanel.tsx';
import type { TableController } from '../state/useTable.ts';
import { seafarersView, SHIP_COST } from '../board/seafarers.ts';
import { EP_CREW_COST, EP_HARBOR_COST, EP_SETTLER_COST, EP_SHIP_COST, epView } from '../board/explorersPirates.ts';
import { ACTIVATE_COST, citiesKnightsView, KNIGHT_COST, PROMOTE_COST, WALL_COST } from '../board/citiesKnights.ts';

/** In-game help: costs, legend and the profile summary (docs/SPEC.md §8.4). */
export function HelpPanel({ controller }: { controller: TableController }) {
  const t = useT();
  const locale = useLocale();
  const profileId = controller.state.game?.view.profileId ?? '';
  const paired = profileId.includes('paired');
  const ep = epView(controller.state.game?.view);
  // 四島群島沒有主島也沒有金礦；穿越荒漠有沙漠與未探索區域，設置與島嶼獎勵的說明與 New Shores 不同。
  const scenario = getProfile(profileId)?.scenario;
  const fourIslands = scenario === 'four-islands';
  const desert = scenario === 'through-the-desert';
  // 未知海域沒有主島也沒有島嶼獎勵，多了迷霧探索。
  const fogIslands = scenario === 'fog-islands';
  // 世外部落沒有島嶼獎勵與金礦產出（小島全無圓片），有自己的禮物與港口規則。
  const tribe = scenario === 'forgotten-tribe';

  return (
    <section className="panel" aria-labelledby="help-heading" data-testid="help-panel">
      <h2 id="help-heading">{t('play.help')}</h2>
      <h3>{t('play.helpCosts')}</h3>
      <ul className="cost-list">
        {(['road', 'settlement', 'city', 'devCard'] as const).filter((piece) => (!ep || (piece !== 'city' && piece !== 'devCard')) && (piece !== 'devCard' || !citiesKnightsView(controller.state.game?.view))).map((piece) => (
          <li key={piece}>
            {t(`play.build.${piece}`)}: {formatResourceMap(locale, COSTS[piece])}
          </li>
        ))}
      </ul>
      <h3>{t('lobby.rulesSummary')}</h3>
      <p>
        {t(`profile.${profileId}`)} · {t('play.resultTarget', { target: controller.state.game?.view.victoryTarget ?? 10 })}
      </p>
      {paired && <p className="muted">{t('lobby.pairedNote')}</p>}
      <TbHelp controller={controller} />
      {seafarersView(controller.state.game?.view) && (
        <section data-testid="help-seafarers">
          <h3>{fourIslands ? t('sf.help.four.title') : desert ? t('sf.help.desert.title') : fogIslands ? t('sf.help.fog.title') : tribe ? t('sf.help.tribe.title') : t('sf.help.title')}</h3>
          <ul className="help-rules">
            <li>{t('sf.build.ship')}: {formatResourceMap(locale, SHIP_COST)}</li>
            {fourIslands && <li data-testid="help-four-islands-setup">{t('sf.help.four.setup')}</li>}
            {desert && <li data-testid="help-desert-setup">{t('sf.help.desert.setup')}</li>}
            {fogIslands && <li data-testid="help-fog-islands-setup">{t('sf.help.fog.setup')}</li>}
            {fogIslands && <li data-testid="help-fog-islands-explore">{t('sf.help.fog.explore')}</li>}
            {(['setup', 'ships', 'move', 'pirate', 'gold', 'route', 'islands'] as const)
              .filter((key) => !(fourIslands && (key === 'setup' || key === 'islands' || key === 'gold')) && !(desert && (key === 'setup' || key === 'islands')) && !(tribe && (key === 'setup' || key === 'islands' || key === 'gold')))
              .filter((key) => !(fogIslands && (key === 'setup' || key === 'islands' || key === 'pirate')))
              .map((key) => <li key={key}>{t(`sf.help.${key}`)}</li>)}
            {fourIslands && <li data-testid="help-four-islands-bonus">{t('sf.help.four.islands', { target: controller.state.game?.view.victoryTarget ?? 13 })}</li>}
            {desert && <li data-testid="help-desert-bonus">{t('sf.help.desert.islands', { target: controller.state.game?.view.victoryTarget ?? 14 })}</li>}
            {fogIslands && <li data-testid="help-fog-islands-bandits">{t('sf.help.fog.bandits')}</li>}
            {fogIslands && <li data-testid="help-fog-islands-win">{t('sf.help.fog.win', { target: controller.state.game?.view.victoryTarget ?? 12 })}</li>}
              .filter((key) => !(fourIslands && (key === 'setup' || key === 'islands' || key === 'gold')) && !(desert && (key === 'setup' || key === 'islands')) && !(tribe && (key === 'setup' || key === 'islands' || key === 'gold')))
            {tribe && <>
              <li data-testid="help-tribe-setup">{t('sf.help.tribe.setup')}</li>
              <li data-testid="help-tribe-discs">{t('sf.help.tribe.discs')}</li>
              <li data-testid="help-tribe-gifts">{t('sf.help.tribe.gifts')}</li>
              <li data-testid="help-tribe-ports">{t('sf.help.tribe.ports')}</li>
              <li data-testid="help-tribe-win">{t('sf.help.tribe.win', { target: controller.state.game?.view.victoryTarget ?? 13 })}</li>
            </>}
            {paired && <li>{t('sf.help.paired')}</li>}
          </ul>
        </section>
      )}
      {ep && (
        <section data-testid="help-explorers-pirates">
          <h3>{t('ep.help.title')}</h3>
          <ul className="help-rules">
            <li>{t('ep.build.harbor')}: {formatResourceMap(locale, EP_HARBOR_COST)}</li>
            <li>{t('ep.build.ship')}: {formatResourceMap(locale, EP_SHIP_COST)}</li>
            <li>{t('ep.build.settler')}: {formatResourceMap(locale, EP_SETTLER_COST)}</li>
            {ep.pirates && <li>{t('ep.build.crew')}: {formatResourceMap(locale, EP_CREW_COST)}</li>}
            {(['turn', 'explore', 'found', 'gold', 'pieces', 'harbors', 'seven'] as const).map((key) => <li key={key}>{t(`ep.help.${key}`)}</li>)}
            {ep.missions.includes('lairs') && <li>{t('ep.help.lairs')}</li>}
            {ep.missions.includes('fish') && <li>{t('ep.help.fish')}</li>}
            {ep.missions.includes('spices') && <li>{t('ep.help.spices')}</li>}
            {ep.pirates && <li>{t('ep.help.chase')}</li>}
          </ul>
        </section>
      )}
      {citiesKnightsView(controller.state.game?.view) && (
        <section data-testid="help-cities-knights">
          <h3>{t('ck.help.title')}</h3>
          <ul className="help-rules">
            <li>{t('ck.action.wall')}: {formatResourceMap(locale, WALL_COST)}</li>
            <li>{t('ck.action.recruit')}: {formatResourceMap(locale, KNIGHT_COST)}</li>
            <li>{t('ck.action.promote')}: {formatResourceMap(locale, PROMOTE_COST)}</li>
            <li>{t('ck.action.activate')}: {formatResourceMap(locale, ACTIVATE_COST)}</li>
            {(['dice', 'commodities', 'barbarians', 'knights', 'improvements', 'metropolis', 'progress', 'cards', 'science', 'trade', 'politics', 'merchant', 'victory'] as const).map((key) => <li key={key}>{t(`ck.help.${key}`)}</li>)}
            {paired && <li>{t('ck.help.paired')}</li>}
          </ul>
        </section>
      )}
      <h3>{t('play.helpLegend')}</h3>
      <Legend />
      <h3>{t('play.awards')}</h3>
      <p className="muted">{RESOURCES.map((resource) => t(`resource.${resource}`)).join('、')}</p>
      {controller.state.game?.view.turn.setup && (
        <p className="muted">
          {t('play.phase.setup')} · {t('play.pending.remaining', { remaining: controller.state.game.view.turn.setup.remaining })}
        </p>
      )}
    </section>
  );
}
