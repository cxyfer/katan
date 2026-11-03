/** Display parameters for the Seafarers rule events (see `../events.ts`). */

import type { Locale } from '@catan/protocol';
import type { GameEvent } from '@catan/rules';
import { t } from '../index.ts';
import { formatNumber, formatResourceMap } from '../format.ts';

type NameResolver = (playerId: string) => string;

function count(values: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (Array.isArray(values)) for (const value of values) out[String(value)] = (out[String(value)] ?? 0) + 1;
  return out;
}

const num = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) ? value : 0);
const str = (value: unknown): string => (typeof value === 'string' ? value : '');

export function seafarersEventParams(locale: Locale, event: GameEvent, nameOf: NameResolver): Record<string, unknown> | undefined {
  const p = event.params ?? {};
  const player = nameOf(str(p.playerId));
  const cause = () => t(locale, str(p.cause) === 'knight' ? 'sf.cause.knight' : 'sf.cause.seven');
  switch (event.type) {
    case 'ship.built':
      return { player, edge: num(p.edge), freeSuffix: p.free ? t(locale, 'sf.freeSuffix') : '' };
    case 'ship.moved':
      return { player, from: num(p.from), to: num(p.to) };
    case 'setup.ship':
      return { player, edge: num(p.edge) };
    case 'pirate.moved':
      return {
        player,
        target: p.hex === null || p.hex === undefined ? t(locale, 'sf.pirate.toFrame') : t(locale, 'sf.pirate.toHex', { hex: num(p.hex) }),
        cause: cause(),
      };
    case 'gold.required': {
      const picks = (p.picks ?? {}) as Record<string, number>;
      const parts = Object.keys(picks).map((id) => `${nameOf(id)} ${formatNumber(locale, picks[id] ?? 0)}`);
      return { picks: parts.length > 0 ? parts.join('、') : '—' };
    }
    case 'gold.chosen':
      return {
        player,
        resources: formatResourceMap(locale, count(p.resources)),
        shortSuffix: num(p.shortBy) > 0 ? t(locale, 'sf.gold.short', { count: num(p.shortBy) }) : '',
      };
    case 'island.bonus':
      return { player, points: num(p.points) };
    default:
      return undefined;
  }
}
