import { useMemo, useState } from 'react';
import { RESOURCES, type Resource } from '@catan/rules';
import { useT } from '../../i18n/context.tsx';
import { nameOf } from '../../state/table.ts';
import { blocksNewCommands } from '../../state/commands.ts';
import { followUpsHeld, shownTradersBarbarians } from '../../state/table.ts';
import type { TableController } from '../../state/useTable.ts';
import { BootEmblem, FishEmblem } from './emblems.tsx';
import { tbHints, tbPart } from './model.ts';

export interface FishingView {
  supplyCount: number;
  discard: [number, number, number];
  tokenCounts: Record<string, number>;
  boot: string | null;
  mine?: number[];
  limit: number;
  costs: Record<FishAction, number>;
}

interface FishingHints {
  canSpend: boolean;
  fish: number;
  canGiveBoot: boolean;
  bootTargets: string[];
}

type FishAction = 'removeRobber' | 'steal' | 'takeResource' | 'road' | 'devCard';
const ACTIONS: readonly FishAction[] = ['removeRobber', 'steal', 'takeResource', 'road', 'devCard'];

/** Smallest set of tokens covering a cost, largest first (a suggestion only). */
export function suggestPayment(hand: readonly number[], cost: number): number[] {
  const sorted = hand.map((value, index) => ({ value, index })).sort((a, b) => b.value - a.value);
  const out: number[] = [];
  let sum = 0;
  for (const token of sorted) {
    if (sum >= cost) break;
    out.push(token.index);
    sum += token.value;
  }
  return sum >= cost ? out : [];
}

/** Fish tokens, the old boot and the fish actions (TB25 p. 10). */
export function FishingSection({ controller }: { controller: TableController }) {
  const t = useT();
  const { state, actions } = controller;
  const view = shownTradersBarbarians(state) ?? state.game?.view;
  const fishing = tbPart<FishingView>(view, 'tb-fishing');
  const hints = tbHints<FishingHints>(view, 'tb-fishing');
  const [action, setAction] = useState<FishAction | null>(null);
  const [picked, setPicked] = useState<number[]>([]);
  const [victim, setVictim] = useState('');
  const [resource, setResource] = useState<Resource>(RESOURCES[0]!);
  const mine = useMemo(() => fishing?.mine ?? [], [fishing?.mine]);
  if (!view || !fishing) return null;
  const name = nameOf(state);
  const busy = blocksNewCommands(state.command) || followUpsHeld(state);
  const selfId = state.session?.id ?? '';
  const cost = action ? fishing.costs[action] : 0;
  const sum = picked.reduce((total, index) => total + (mine[index] ?? 0), 0);
  const tokens = picked.map((index) => mine[index]!).filter((value) => value !== undefined);

  const choose = (next: FishAction) => {
    setAction(next);
    setPicked(suggestPayment(mine, fishing.costs[next]));
  };
  const toggle = (index: number) => setPicked((current) => current.includes(index) ? current.filter((item) => item !== index) : [...current, index]);
  const submit = () => {
    if (!action) return;
    if (action === 'road') {
      actions.selectTarget({ kind: 'edge', index: null, commandType: 'tb.spendFish', labelId: 'tb.fishing.action.road', extra: { action, tokens }, field: 'edge' });
      return;
    }
    const command: Record<string, unknown> = { type: 'tb.spendFish', action, tokens };
    if (action === 'steal') command.victim = victim;
    if (action === 'takeResource') command.resource = resource;
    void actions.submitCommand(command as { type: string }, `tb.fishing.action.${action}`);
    setAction(null);
    setPicked([]);
  };
  const victims = view.players.filter((player) => player.id !== selfId && player.handSize > 0);
  // 銀行沒有所選資源時拿不到（投影的 0 是確切值，#137）。
  const bankEmpty = action === 'takeResource' && (view.bank[resource] ?? 0) <= 0;

  return (
    <section className="tb-section" data-testid="tb-fishing" aria-labelledby="tb-fishing-heading">
      <h3 id="tb-fishing-heading"><FishEmblem size={22} value={2} />{t('tb.fishing.title')}</h3>
      <p className="muted">{t('tb.fishing.mine')}</p>
      {mine.length === 0 ? <p className="muted" data-testid="tb-fish-none">{t('tb.fishing.none')}</p> : (
        <div className="tb-tokens" role="group" aria-label={t('tb.fishing.pickTokens')}>
          {mine.map((value, index) => (
            <button key={index} type="button" className="tb-token" aria-pressed={picked.includes(index)} disabled={!action}
              data-testid={`tb-fish-token-${index}`} onClick={() => toggle(index)}>
              <FishEmblem size={20} value={value} />{t('tb.fishing.token', { value })}
            </button>
          ))}
        </div>
      )}
      {fishing.boot === selfId && <p className="tb-token"><BootEmblem size={20} />{t('tb.fishing.boot', { player: name(selfId) })}</p>}

      {hints?.canSpend && (
        <div className="tb-actions" data-testid="tb-fish-actions">
          {ACTIONS.map((item) => (
            <button key={item} type="button" className={`button${action === item ? ' action-list__button--armed' : ''}`}
              data-testid={`tb-fish-action-${item}`}
              disabled={busy || hints.fish < fishing.costs[item] || (item === 'removeRobber' && view.board.robber < 0) || (item === 'steal' && victims.length === 0)}
              onClick={() => choose(item)}>
              {t(`tb.fishing.action.${item}`)}
            </button>
          ))}
        </div>
      )}
      {action && (
        <div className="tb-actions" data-testid="tb-fish-pay">
          <span>{t('tb.fishing.selected', { sum, cost })}</span>
          {action === 'steal' && (
            <label>{t('tb.fishing.victim')}{' '}
              <select value={victim} onChange={(event) => setVictim(event.target.value)} data-testid="tb-fish-victim">
                <option value="" disabled>—</option>
                {victims.map((player) => <option key={player.id} value={player.id}>{player.nickname}</option>)}
              </select>
            </label>
          )}
          {action === 'takeResource' && (
            <label>{t('tb.fishing.resource')}{' '}
              <select value={resource} onChange={(event) => setResource(event.target.value as Resource)} data-testid="tb-fish-resource">
                {RESOURCES.map((item) => <option key={item} value={item}>{t(`resource.${item}`)}</option>)}
              </select>
            </label>
          )}
          {bankEmpty && <span className="muted" id="tb-fish-bank-empty" data-testid="tb-fish-bank-empty">
            {t('bank.empty', { resource: t(`resource.${resource}`) })}
          </span>}
          <button type="button" className="button" data-testid="tb-fish-submit"
            disabled={busy || sum < cost || (action === 'steal' && !victim) || bankEmpty}
            aria-describedby={bankEmpty ? 'tb-fish-bank-empty' : undefined} onClick={submit}>
            {t(action === 'road' ? 'tb.fishing.pickRoad' : 'tb.fishing.pay')}
          </button>
        </div>
      )}
      {hints?.canGiveBoot && hints.bootTargets.length > 0 && (
        <div className="tb-actions">
          {hints.bootTargets.map((id) => (
            <button key={id} type="button" className="button button--ghost" disabled={busy} data-testid={`tb-boot-${id}`}
              onClick={() => void actions.submitCommand({ type: 'tb.giveBoot', to: id }, 'tb.fishing.giveBoot')}>
              <BootEmblem size={18} />{t('tb.fishing.giveBoot', { player: name(id) })}
            </button>
          ))}
        </div>
      )}
      <ul className="tb-list">
        {view.players.map((player) => <li key={player.id}>{t('tb.fishing.counts', { player: player.nickname, count: fishing.tokenCounts[player.id] ?? 0 })}</li>)}
      </ul>
      <p className="muted" data-testid="tb-fish-supply">
        {t('tb.fishing.supply', { count: fishing.supplyCount, one: fishing.discard[0], two: fishing.discard[1], three: fishing.discard[2] })}
      </p>
      <p className="muted">{fishing.boot ? t('tb.fishing.boot', { player: name(fishing.boot) }) : t('tb.fishing.bootFree')}</p>
    </section>
  );
}

/** The once-per-turn swap at the fish limit (p. 10), shown in the prompt. */
export function FishSwapChoice({ controller }: { controller: TableController }) {
  const t = useT();
  const { state, actions } = controller;
  const fishing = tbPart<FishingView>(state.game?.view, 'tb-fishing');
  const busy = blocksNewCommands(state.command) || followUpsHeld(state);
  const mine = fishing?.mine ?? [];
  return (
    <div className="tb-actions" data-testid="tb-fish-swap">
      {[...new Set(mine)].sort().map((value) => (
        <button key={value} type="button" className="button" disabled={busy} data-testid={`tb-fish-swap-${value}`}
          onClick={() => void actions.submitCommand({ type: 'tb.fishSwap', token: value }, 'tb.fishing.swap')}>
          <FishEmblem size={18} value={value} />{t('tb.fishing.swap', { value })}
        </button>
      ))}
      <button type="button" className="button button--ghost" disabled={busy} data-testid="tb-fish-keep"
        onClick={() => void actions.submitCommand({ type: 'tb.fishSwap', token: null }, 'tb.fishing.keep')}>{t('tb.fishing.keep')}</button>
    </div>
  );
}
