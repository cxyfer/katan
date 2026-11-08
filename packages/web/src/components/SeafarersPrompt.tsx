import { useState } from 'react';
import { RESOURCES, type Resource } from '@catan/rules';
import { useLocale, useT } from '../i18n/context.tsx';
import { formatResourceMap } from '../i18n/format.ts';
import { seafarersHints } from '../board/seafarers.ts';
import { banditTargets, seafarersCitiesKnightsHints } from '../board/seafarersCitiesKnights.ts';
import { blocksNewCommands } from '../state/commands.ts';
import { followUpsHeld, shownBank } from '../state/table.ts';
import type { TableController } from '../state/useTable.ts';
import { ResourceIcon } from './GameArt.tsx';
import '../styles/seafarers.css';

/**
 * Seafarers parts of the required-action prompt: the gold picker, the
 * robber-or-pirate explanation with the frame option, and the road-or-ship
 * switch for a starting settlement or Road Building. Renders nothing in base
 * games (no `hints.modules.seafarers`).
 */
export function SeafarersPrompt({ controller }: { controller: TableController }) {
  const t = useT();
  const { state, actions } = controller;
  const view = state.game?.view ?? null;
  const sea = seafarersHints(view);
  const selfId = state.session?.id ?? null;
  if (!view || !sea || !selfId || followUpsHeld(state)) return null;
  const blocked = blocksNewCommands(state.command);
  const pending = view.pending;
  const armed = state.selection.commandType;

  const robberMine = pending?.kind === 'moveRobber' && pending.actor === selfId;
  const knightArmed = armed === 'dev.playKnight';
  const frameOpen = banditTargets(view, sea.robberTargets, sea.pirateTargets).pirate.includes(null);
  // With Cities & Knights a knight chases one bandit only (COMB-6).
  const bandit = seafarersCitiesKnightsHints(view)?.bandit ?? null;
  const banditText = knightArmed ? 'sf.bandit.knight' : bandit === 'robber' ? 'sfck.bandit.robber' : bandit === 'pirate' ? 'sfck.bandit.pirate' : 'sf.bandit.choose';

  const setup = view.turn.setup;
  const setupMine = !!setup && setup.stage === 'road' && view.turn.playerId === selfId;
  const freeMine = pending?.kind === 'freeRoads' && pending.actor === selfId;
  const shipChoice = (setupMine && sea.setupShips.length > 0) || (freeMine && sea.legalShips.length > 0);
  const shipArmed = armed === 'setup.placeShip' || armed === 'build.ship';
  const roadsOpen = (view.hints?.legalRoads.length ?? 0) > 0;

  return <>
    {pending?.kind === 'seafarers.gold' && sea.goldRequired > 0 && (
      <GoldPicker key={`${view.seq}`} count={sea.goldRequired} bank={sea.goldBank ?? shownBank(state) ?? view.bank} disabled={blocked}
        onSubmit={(resources) => void actions.submitCommand({ type: 'gold.choose', resources }, 'play.pending.seafarers.gold')} />
    )}
    {(robberMine || knightArmed) && (
      <div className="prompt__body bandit-choice" data-testid="bandit-choice">
        <p className="muted" data-testid="bandit-choice-text">{t(banditText)}</p>
        {frameOpen && (
          <button type="button" className="button" data-testid="pirate-to-frame" disabled={blocked}
            onClick={() => void actions.submitCommand(knightArmed ? { type: 'dev.playKnight', hex: null } : { type: 'pending.moveRobber', hex: null }, 'sf.pirate.frame')}>
            {t('sf.pirate.frame')}
          </button>
        )}
      </div>
    )}
    {shipChoice && (
      <div className="prompt__body ship-choice" data-testid="ship-choice">
        {setupMine && <p className="muted">{t('sf.setup.choice')}</p>}
        {shipArmed
          ? roadsOpen && <button type="button" className="button" data-testid="choose-road" onClick={() => actions.cancelSelection()}>{t('sf.setup.roadInstead')}</button>
          : <button type="button" className="button" data-testid="choose-ship"
              onClick={() => actions.selectTarget({ kind: 'edge', index: null, commandType: setupMine ? 'setup.placeShip' : 'build.ship', labelId: 'sf.build.ship' })}>
              {t('sf.setup.shipInstead')}
            </button>}
      </div>
    )}
  </>;
}

/**
 * Picks `count` resources of the player's choice, never more than the bank holds.
 * `bank` is the gold supply hint (`min(supply, count)` per resource), not the
 * public bank, which stops at two (#137).
 */
function GoldPicker({ count, bank, disabled, onSubmit }: {
  count: number; bank: Record<Resource, number>; disabled: boolean; onSubmit: (resources: Resource[]) => void;
}) {
  const t = useT();
  const locale = useLocale();
  const [picked, setPicked] = useState<Resource[]>([]);
  const left = (resource: Resource) => bank[resource] - picked.filter((entry) => entry === resource).length;
  const tally: Partial<Record<Resource, number>> = {};
  for (const resource of picked) tally[resource] = (tally[resource] ?? 0) + 1;
  return (
    <div className="prompt__body gold-picker" data-testid="gold-picker">
      <p>{t('sf.gold.pick', { count })}</p>
      <ul className="resource-picker">
        {RESOURCES.map((resource) => (
          <li key={resource}>
            <button type="button" className="button button--chip" data-testid={`gold-${resource}`}
              disabled={disabled || picked.length >= count || left(resource) <= 0}
              aria-label={t('sf.gold.add', { resource: t(`resource.${resource}`), left: left(resource) })}
              onClick={() => setPicked([...picked, resource])}>
              <ResourceIcon resource={resource} size={20} />{t(`resource.${resource}`)}
            </button>
          </li>
        ))}
      </ul>
      <p className="muted" data-testid="gold-selected">
        {picked.length > 0 ? t('sf.gold.chosen', { resources: formatResourceMap(locale, tally) }) : t('sf.gold.none')}
      </p>
      <div className="gold-picker__actions">
        <button type="button" className="button" data-testid="gold-clear" disabled={picked.length === 0} onClick={() => setPicked([])}>
          {t('sf.gold.clear')}
        </button>
        <button type="button" className="button button--primary" data-testid="gold-confirm"
          disabled={disabled || picked.length !== count} onClick={() => onSubmit(picked)}>
          {t('sf.gold.confirm')}
        </button>
      </div>
    </div>
  );
}
