/** Display parameters for the Seafarers rule events (see `../events.ts`). */

import type { Locale } from '@katan/protocol';
import type { GameEvent } from '@katan/rules';
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

/** 括號補充：中文用全形，英文用半形並留一個空格。 */
const paren = (locale: Locale, text: string): string => (locale === 'en' ? ` (${text})` : `（${text}）`);

const worldHarbor = (locale: Locale, harbor: string): string =>
  harbor === 'generic' ? t(locale, 'sf.gift.port.generic') : t(locale, 'sf.gift.port.resource', { resource: t(locale, `resource.${harbor}`) });

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
    case 'pirate.cruised':
      return { steps: num(p.steps), to: num(p.to) };
    case 'pirate.attacked': {
      const result = str(p.result);
      const strength = num(p.strength);
      const warships = num(p.warships);
      let outcome: string;
      if (result === 'lost') {
        // 被棄的牌只有被攻擊的人看得到（私有欄位 `resources`）。
        const listed = p.resources && typeof p.resources === 'object' ? formatResourceMap(locale, p.resources as Record<string, number>) : '';
        // 手上沒牌時 `formatResourceMap` 回「—」：不加括號。
        const lost = listed === '—' ? '' : listed;
        outcome = t(locale, 'sf.pirate.outcome.lost', {
          count: num(p.count),
          resourceSuffix: lost ? paren(locale, lost) : '',
          shortSuffix: num(p.owed) > num(p.count) ? t(locale, 'sf.pirate.outcome.short', { owed: num(p.owed) }) : '',
        });
      } else outcome = t(locale, result === 'won' ? 'sf.pirate.outcome.won' : 'sf.pirate.outcome.tie');
      return { player, strength, warships, outcome };
    }
    case 'pirate.gifted':
      return {
        player,
        taken: typeof p.resource === 'string' ? t(locale, 'sf.pirate.gifted.card', { resource: t(locale, `resource.${p.resource}`) }) : t(locale, 'sf.pirate.gifted.none'),
      };
    case 'seven.stole':
      return { player, victim: nameOf(str(p.victim)), resourceSuffix: typeof p.resource === 'string' ? paren(locale, t(locale, `resource.${p.resource}`)) : '' };
    case 'seven.stealSkipped':
      return { player };
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
      return { player, points: num(p.points), unit: t(locale, num(p.points) === 1 ? 'sf.vp.one' : 'sf.vp.many') };
    case 'tribe.gift': {
      const harbor = str(p.harbor);
      const gift = p.gift === 'vp' ? t(locale, 'sf.gift.vp') : p.gift === 'devcard' ? t(locale, 'sf.gift.devcard')
        : harbor === 'generic' ? t(locale, 'sf.gift.port.generic') : t(locale, 'sf.gift.port.resource', { resource: t(locale, `resource.${harbor}`) });
      return { player, edge: num(p.edge), gift };
    }
    case 'harbor.placed': {
      const harbor = str(p.harbor);
      return {
        player, edge: num(p.edge),
        harbor: harbor === 'generic' ? t(locale, 'sf.gift.port.generic') : t(locale, 'sf.gift.port.resource', { resource: t(locale, `resource.${harbor}`) }),
      };
    }
    case 'world.harborDrawn':
      return { player, harbor: worldHarbor(locale, str(p.harbor)), number: num(p.number), total: 10 };
    case 'world.harborPlaced':
      return { player, edge: num(p.edge), harbor: worldHarbor(locale, str(p.harbor)) };
    case 'world.harborsSkipped':
      return { remaining: num(p.remaining) };
    case 'world.regenerated':
      return { count: num(p.count) };
    case 'fog.revealed': {
      const terrain = t(locale, `terrain.${str(p.tile)}`).replace(/\s*[（(][^)）]*[)）]\s*$/, '');
      return {
        player,
        hex: num(p.hex),
        found: str(p.tile) === 'sea' ? t(locale, 'sf.fog.foundSea') : t(locale, 'sf.fog.foundLand', { terrain, number: num(p.number) }),
        rewardSuffix: typeof p.resource === 'string' ? t(locale, 'sf.fog.rewardResource', { resource: t(locale, `resource.${p.resource}`) }) : '',
      };
    }
    case 'cloth.trade':
      return {
        player, number: num(p.number),
        gainedSuffix: num(p.gained) > 0 ? t(locale, 'sf.cloth.gainedSuffix') : t(locale, 'sf.cloth.noneSuffix'),
      };
    case 'cloth.produced': {
      const gains = (p.gains ?? {}) as Record<string, number>;
      const names = Object.keys(gains).map((id) => nameOf(id));
      return {
        number: num(p.number),
        gains: names.length > 0 ? names : t(locale, 'sf.cloth.producedNone'),
        shortSuffix: num(p.shortBy) > 0 ? t(locale, 'sf.cloth.shortSuffix', { count: num(p.shortBy) }) : '',
      };
    }
    case 'cloth.robberChosen':
      return { player, hex: num(p.hex) };
    case 'cloth.stolen':
      return { player, victim: nameOf(str(p.victim)) };
    case 'wonder.chosen':
      return { player, wonder: t(locale, `sf.wonder.${str(p.wonder)}`) };
    case 'wonder.built':
      return { player, wonder: t(locale, `sf.wonder.${str(p.wonder)}`), level: num(p.level) };
    default:
      return undefined;
  }
}
