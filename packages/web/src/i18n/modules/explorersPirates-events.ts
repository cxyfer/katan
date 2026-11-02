/** Display parameters for the Explorers & Pirates rule events (see `../events.ts`). */

import type { Locale } from '@catan/protocol';
import type { GameEvent } from '@catan/rules';
import { t } from '../index.ts';
import { formatNumber, formatResourceMap } from '../format.ts';

type NameResolver = (playerId: string) => string;

const num = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) ? value : 0);
const str = (value: unknown): string => (typeof value === 'string' ? value : '');
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

function count(values: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  for (const value of list(values)) out[String(value)] = (out[String(value)] ?? 0) + 1;
  return out;
}

function pieces(locale: Locale, values: unknown): string {
  const parts = Object.entries(count(values)).map(([piece, n]) => `${formatNumber(locale, n)}×${t(locale, `ep.piece.${piece}`)}`);
  return parts.length > 0 ? parts.join('、') : '—';
}

function names(values: unknown, nameOf: NameResolver): string {
  const parts = list(values).map((id) => nameOf(String(id)));
  return parts.length > 0 ? parts.join('、') : '—';
}

export function explorersPiratesEventParams(locale: Locale, event: GameEvent, nameOf: NameResolver): Record<string, unknown> | undefined {
  if (!event.type.startsWith('ep.')) return undefined;
  const p = event.params ?? {};
  const player = nameOf(str(p.playerId));
  const base = { player, hex: num(p.hex), edge: num(p.edge), vertex: num(p.vertex) };
  switch (event.type) {
    case 'ep.startingResources':
      return { ...base, resources: formatResourceMap(locale, p.resources as Record<string, number>) };
    case 'ep.goldProduced': {
      const grants = (p.grants ?? {}) as Record<string, number>;
      const parts = Object.keys(grants).map((id) => `${nameOf(id)} +${formatNumber(locale, grants[id] ?? 0)}`);
      return {
        total: num(p.total),
        grants: parts.length > 0 ? parts.join('、') : '—',
        compensated: names(p.compensated, nameOf),
      };
    }
    case 'ep.soldForGold':
    case 'ep.fastGold':
      return { ...base, resource: t(locale, `resource.${str(p.give)}`), count: num(p.count) };
    case 'ep.boughtResource':
      return { ...base, resource: t(locale, `resource.${str(p.receive)}`), gold: num(p.gold) };
    case 'ep.shipReturned':
      return { ...base, cargo: pieces(locale, p.cargo) };
    case 'ep.settlerBuilt':
    case 'ep.crewBuilt':
      return {
        ...base,
        place: t(locale, p.ship ? 'ep.place.ship' : 'ep.place.harbor'),
        removedSuffix: p.removed ? t(locale, 'ep.removedSuffix', { piece: t(locale, `ep.piece.${str(p.removed)}`) }) : '',
      };
    case 'ep.shipMoved':
      return { ...base, from: num(p.from), to: num(p.to) };
    case 'ep.tributePaid':
      return { ...base, owner: nameOf(str(p.owner)) };
    case 'ep.explored': {
      const reward = (p.reward ?? null) as { resource?: string; gold?: number } | null;
      const rewardText = reward?.resource
        ? t(locale, 'ep.reward.resource', { resource: t(locale, `resource.${reward.resource}`) })
        : reward?.gold
          ? t(locale, 'ep.reward.gold', { gold: reward.gold })
          : t(locale, 'ep.reward.none');
      return {
        ...base,
        region: t(locale, `ep.region.${str(p.region)}`),
        tile: t(locale, `ep.tile.${str(p.tile)}`),
        reward: rewardText,
      };
    }
    case 'ep.loaded':
    case 'ep.unloaded':
      return { ...base, piece: t(locale, `ep.piece.${str(p.piece)}`) };
    case 'ep.crewLanded':
      return { ...base, site: t(locale, `ep.site.${str(p.site)}`), crews: num(p.crews) };
    case 'ep.delivered':
      return { ...base, goods: pieces(locale, p.goods) };
    case 'ep.fishRolled':
      return {
        ...base,
        die: num(p.die),
        outcome: list(p.hexes).length > 0
          ? t(locale, 'ep.fish.placed', { hexes: list(p.hexes).join('、') })
          : t(locale, 'ep.fish.none'),
      };
    case 'ep.pirateRequired':
    case 'ep.pirateMoved':
      return { ...base, cause: t(locale, `ep.cause.${str(p.cause) || 'seven'}`) };
    case 'ep.pirateReturned':
      return { ...base };
    case 'ep.pirateStole': {
      const priv = p.resource ? t(locale, 'ep.stole.resource', { resource: t(locale, `resource.${str(p.resource)}`) }) : '';
      return {
        ...base,
        victim: nameOf(str(p.victim)),
        loot: p.card ? (priv || t(locale, 'ep.stole.card')) : t(locale, 'ep.stole.gold', { gold: num(p.gold) }),
      };
    }
    case 'ep.chaseRolled':
      return {
        ...base,
        die: num(p.die),
        owner: nameOf(str(p.owner)),
        outcome: t(locale, p.success ? 'ep.chase.success' : 'ep.chase.miss'),
      };
    case 'ep.lairReward':
      return { ...base, gold: num(p.gold) };
    case 'ep.lairCaptured':
      return {
        ...base,
        hero: nameOf(str(p.hero)),
        number: p.number === null || p.number === undefined ? '—' : num(p.number),
        involved: names(p.involved, nameOf),
      };
    case 'ep.trackAdvanced':
    case 'ep.trackFull':
      return { ...base, mission: t(locale, `ep.mission.${str(p.mission)}`), space: num(p.space) };
    default:
      return base;
  }
}
