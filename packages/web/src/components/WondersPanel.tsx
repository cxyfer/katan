import { RESOURCES, WONDERS, WONDER_LEVELS } from '@katan/rules';
import { useT } from '../i18n/context.tsx';
import { formatNumber } from '../i18n/format.ts';
import { playerColorHex } from '../board/terrain.ts';
import { seafarersHints, seafarersView } from '../board/seafarers.ts';
import { blocksNewCommands } from '../state/commands.ts';
import type { TableController } from '../state/useTable.ts';
import { GameIcon, ResourceIcon } from './GameArt.tsx';
import '../styles/seafarers.css';

/**
 * 卡坦奇觀（The Wonders of Catan）的奇觀牌與每位玩家的進度。五張牌各自顯示條件與每層費用；
 * 被拿走的牌標出持有者與層數。符合條件的牌可認領（`wonder.choose`），自己的奇觀付得起就可蓋下一層
 * （`wonder.build`）。這個面板與渲染器無關：SVG 與 3D 兩種棋盤都用它操作。其他劇本不顯示。
 */
export function WondersPanel({ controller }: { controller: TableController }) {
  const t = useT();
  const { state, actions } = controller;
  const view = state.game?.view ?? null;
  const wonders = seafarersView(view)?.wonders ?? null;
  const selfId = state.session?.id ?? null;
  if (!view || !wonders) return null;
  const hints = seafarersHints(view)?.wonders ?? { claimable: [], buildable: false };
  const blocked = blocksNewCommands(state.command);
  const mine = selfId ? wonders.owned[selfId] ?? null : null;
  const myLevel = selfId ? wonders.levels[selfId] ?? 0 : 0;
  const nickname = (id: string) => view.players.find((player) => player.id === id)?.nickname ?? id;

  return (
    <section className="wonders-panel" data-testid="wonders-panel" aria-labelledby="wonders-heading">
      <h3 id="wonders-heading"><GameIcon name="crown" size={16} />{t('sf.wonder.title')}</h3>
      <ul className="wonders-panel__cards">
        {WONDERS.map((def) => {
          const holder = Object.keys(wonders.owned).find((id) => wonders.owned[id] === def.id) ?? null;
          const level = holder ? wonders.levels[holder] ?? 0 : 0;
          const claimable = hints.claimable.includes(def.id);
          const mineCard = holder !== null && holder === selfId;
          return (
            <li key={def.id} className="wonders-panel__card" data-testid={`wonder-card-${def.id}`} data-holder={holder ?? undefined} data-level={level}
              data-claimable={claimable ? 'true' : 'false'}>
              <strong>{t(`sf.wonder.${def.id}`)}</strong>
              <span className="muted">{t(`sf.wonder.${def.id}.condition`)}</span>
              <span className="wonders-panel__cost" role="group" aria-label={t('sf.wonder.cost')}>
                {RESOURCES.filter((resource) => (def.cost[resource] ?? 0) > 0).map((resource) => (
                  <span key={resource} className="action-list__cost-chip">
                    <ResourceIcon resource={resource} size={20} />
                    <span>{formatNumber(state.locale, def.cost[resource] ?? 0)}</span>
                  </span>
                ))}
              </span>
              <span data-testid={`wonder-status-${def.id}`}>
                {holder ? t('sf.wonder.held', { player: nickname(holder), level: formatNumber(state.locale, level), max: WONDER_LEVELS }) : t('sf.wonder.free')}
              </span>
              {!holder && (
                <button type="button" className="button" data-testid={`wonder-claim-${def.id}`} disabled={!claimable || blocked}
                  onClick={() => void actions.submitCommand({ type: 'wonder.choose', wonder: def.id }, 'sf.wonder.claim')}>
                  {t('sf.wonder.claim')}
                </button>
              )}
              {mineCard && myLevel < WONDER_LEVELS && (
                <button type="button" className="button button--primary" data-testid="wonder-build" disabled={!hints.buildable || blocked}
                  onClick={() => void actions.submitCommand({ type: 'wonder.build' }, 'sf.wonder.build')}>
                  {t('sf.wonder.build', { level: formatNumber(state.locale, myLevel + 1) })}
                </button>
              )}
            </li>
          );
        })}
      </ul>
      <ol className="wonders-panel__progress" data-testid="wonder-progress" aria-label={t('sf.wonder.progress')}>
        {view.players.map((player) => {
          const level = wonders.levels[player.id] ?? 0;
          const id = wonders.owned[player.id] ?? null;
          return (
            <li key={player.id} data-testid={`wonder-progress-${player.seat}`} data-level={level}>
              <span className="wonders-panel__dot" style={{ background: playerColorHex(player.color) }} aria-hidden="true" />
              <span>{player.nickname}</span>
              <span>{id ? `${t(`sf.wonder.${id}`)} ${formatNumber(state.locale, level)}/${WONDER_LEVELS}` : t('sf.wonder.none')}</span>
              <span className="wonders-panel__pips" aria-hidden="true">{Array.from({ length: WONDER_LEVELS }, (_, index) => (index < level ? '■' : '□')).join('')}</span>
            </li>
          );
        })}
      </ol>
      {mine === null && <p className="muted">{t('sf.wonder.hint')}</p>}
    </section>
  );
}
