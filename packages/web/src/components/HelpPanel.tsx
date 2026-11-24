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
  // 布匹產地：沒有島嶼獎勵、最長道路與金礦產出（小島無圓片），起始設置有第三個村落，另有部落、布匹與兩種終局。
  const cloth = scenario === 'cloth-for-catan';
  // 新世界：隨機版圖、輪流放港口、home islands 與每座非 home 島 1 分。
  const newWorld = scenario === 'new-world';
  const harborWorld = seafarersView(controller.state.game?.view)?.world ?? null;
  // 卡坦奇觀：小島獎勵每座 1 分、沒有海盜與金礦產出的特殊規則，另有奇觀與兩種終局。
  const wonders = scenario === 'wonders-of-catan';

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
          <h3>{fourIslands ? t('sf.help.four.title') : desert ? t('sf.help.desert.title') : fogIslands ? t('sf.help.fog.title') : tribe ? t('sf.help.tribe.title') : cloth ? t('sf.help.cloth.title') : wonders ? t('sf.help.wonders.title') : newWorld ? t('sf.help.world.title') : t('sf.help.title')}</h3>
          <ul className="help-rules">
            <li>{t('sf.build.ship')}: {formatResourceMap(locale, SHIP_COST)}</li>
            {fourIslands && <li data-testid="help-four-islands-setup">{t('sf.help.four.setup')}</li>}
            {desert && <li data-testid="help-desert-setup">{t('sf.help.desert.setup')}</li>}
            {fogIslands && <li data-testid="help-fog-islands-setup">{t('sf.help.fog.setup')}</li>}
            {fogIslands && <li data-testid="help-fog-islands-explore">{t('sf.help.fog.explore')}</li>}
            {(['setup', 'ships', 'move', 'pirate', 'gold', 'route', 'islands'] as const)
              .filter((key) => !(fourIslands && (key === 'setup' || key === 'islands' || key === 'gold')) && !(desert && (key === 'setup' || key === 'islands')) && !(tribe && (key === 'setup' || key === 'islands' || key === 'gold')) && !(newWorld && (key === 'setup' || key === 'islands' || key === 'gold')))
              .filter((key) => !(wonders && (key === 'setup' || key === 'islands' || key === 'pirate')))
              .filter((key) => !(cloth && (key === 'setup' || key === 'islands' || key === 'gold' || key === 'pirate' || key === 'route')))
              .filter((key) => !(fogIslands && (key === 'setup' || key === 'islands' || key === 'pirate')))
              .map((key) => <li key={key}>{t(`sf.help.${key}`)}</li>)}
            {fourIslands && <li data-testid="help-four-islands-bonus">{t('sf.help.four.islands', { target: controller.state.game?.view.victoryTarget ?? 13 })}</li>}
            {desert && <li data-testid="help-desert-bonus">{t('sf.help.desert.islands', { target: controller.state.game?.view.victoryTarget ?? 14 })}</li>}
            {fogIslands && <li data-testid="help-fog-islands-bandits">{t('sf.help.fog.bandits')}</li>}
            {fogIslands && <li data-testid="help-fog-islands-win">{t('sf.help.fog.win', { target: controller.state.game?.view.victoryTarget ?? 12 })}</li>}
            {tribe && <>
              <li data-testid="help-tribe-setup">{t('sf.help.tribe.setup')}</li>
              <li data-testid="help-tribe-discs">{t('sf.help.tribe.discs')}</li>
              <li data-testid="help-tribe-gifts">{t('sf.help.tribe.gifts')}</li>
              <li data-testid="help-tribe-ports">{t('sf.help.tribe.ports')}</li>
              <li data-testid="help-tribe-win">{t('sf.help.tribe.win', { target: controller.state.game?.view.victoryTarget ?? 13 })}</li>
            </>}
            {cloth && <>
              <li data-testid="help-cloth-setup">{t('sf.help.cloth.setup')}</li>
              <li data-testid="help-cloth-trade">{t('sf.help.cloth.trade')}</li>
              <li data-testid="help-cloth-produce">{t('sf.help.cloth.produce')}</li>
              <li data-testid="help-cloth-score">{t('sf.help.cloth.score')}</li>
              <li data-testid="help-cloth-ships">{t('sf.help.cloth.ships')}</li>
              <li data-testid="help-cloth-pirate">{t('sf.help.cloth.pirate')}</li>
              <li data-testid="help-cloth-win">{t('sf.help.cloth.win', { target: controller.state.game?.view.victoryTarget ?? 14 })}</li>
            </>}
            {newWorld && <>
              <li data-testid="help-world-setup">{t('sf.help.world.setup')}</li>
              <li data-testid="help-world-ports">{t('sf.help.world.ports')}</li>
              <li data-testid="help-world-bandits">{t('sf.help.world.bandits')}</li>
              <li data-testid="help-world-bonus">{t('sf.help.world.islands')}</li>
              <li data-testid="help-world-regenerate">{t('sf.help.world.regenerate')}</li>
              <li data-testid="help-world-win">{t('sf.help.world.win', { target: controller.state.game?.view.victoryTarget ?? 12 })}</li>
            </>}
            {wonders && <>
              <li data-testid="help-wonders-setup">{t('sf.help.wonders.setup')}</li>
              <li data-testid="help-wonders-bonus">{t('sf.help.wonders.bonus')}</li>
              <li data-testid="help-wonders-claim">{t('sf.help.wonders.claim')}</li>
              <li data-testid="help-wonders-build">{t('sf.help.wonders.build')}</li>
              <li data-testid="help-wonders-win">{t('sf.help.wonders.win', { target: controller.state.game?.view.victoryTarget ?? 10 })}</li>
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
          {t('play.phase.setup')} · {harborWorld && controller.state.game.view.turn.setup.stage === 'harbor'
            // 新世界的港口階段：剩餘次數固定是起始村落的步數，改顯示港口進度（與設置導引一致）。
            ? t('sf.world.progress', { placed: Math.min(harborWorld.placed + 1, harborWorld.total), total: harborWorld.total })
            : t('play.pending.remaining', { remaining: controller.state.game.view.turn.setup.remaining })}
        </p>
      )}
    </section>
  );
}
