/** Display parameters for the Cities & Knights rule events (see `../events.ts`). */

import type { Locale } from '@catan/protocol';
import type { GameEvent } from '@catan/rules';
import { t } from '../index.ts';
import { formatGrantMap, formatNumber } from '../format.ts';

type NameResolver = (playerId: string) => string;

const num = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) ? value : 0);
const str = (value: unknown): string => (typeof value === 'string' ? value : '');

function names(values: unknown, nameOf: NameResolver): string {
  return Array.isArray(values) && values.length > 0 ? values.map((id) => nameOf(String(id))).join('、') : '—';
}

function perPlayer(locale: Locale, values: unknown, nameOf: NameResolver): string {
  const map = (values ?? {}) as Record<string, number>;
  const parts = Object.keys(map).map((id) => `${nameOf(id)} ${formatNumber(locale, map[id] ?? 0)}`);
  return parts.length > 0 ? parts.join('、') : '—';
}

export function citiesKnightsEventParams(locale: Locale, event: GameEvent, nameOf: NameResolver): Record<string, unknown> | undefined {
  if (!event.type.startsWith('ck.')) return undefined;
  const p = event.params ?? {};
  const player = nameOf(str(p.playerId));
  const track = () => t(locale, `ck.track.${str(p.track) || 'science'}`);
  const level = (value: unknown) => t(locale, `ck.knight.${num(value) || 1}`);
  const card = (value: unknown) => (typeof value === 'string' ? t(locale, `ck.progress.${value}`) : '');
  switch (event.type) {
    case 'ck.eventRolled':
      return { event: t(locale, `ck.event.${str(p.event) || 'ship'}`), red: num(p.red) };
    case 'ck.barbariansAdvanced':
      return { position: num(p.position), length: num(p.length) };
    case 'ck.barbariansAttack':
      return { barbarians: num(p.barbarians), defenders: num(p.defenders), outcome: t(locale, str(p.outcome) === 'barbarians' ? 'ck.attack.barbarians' : 'ck.attack.defenders') };
    case 'ck.defenderOfCatan':
    case 'ck.robberIdle':
      return { player };
    case 'ck.defendersTied':
      return { players: names(p.players, nameOf) };
    case 'ck.cityPillaged':
      return {
        player,
        vertex: num(p.vertex),
        wallSuffix: p.wallLost ? t(locale, 'ck.wallSuffix') : '',
        toppledSuffix: p.toppled ? t(locale, 'ck.toppledSuffix') : '',
      };
    case 'ck.robberEntered':
      return { hex: num(p.hex) };
    case 'ck.commoditiesProduced':
      return { total: num(p.total), grants: formatGrantMap(locale, p.grants as Record<string, Record<string, number>>, nameOf) };
    case 'ck.scienceBonusOffered':
      return { players: names(p.players, nameOf) };
    case 'ck.scienceBonusTaken':
      return { player, resource: p.resource ? t(locale, `resource.${str(p.resource)}`) : '—' };
    case 'ck.progressDrawn':
      // The card face is only present in the drawer's own copy.
      return { player, track: track(), cardSuffix: p.card ? t(locale, 'ck.cardSuffix', { card: card(p.card) }) : '' };
    case 'ck.progressVictoryPoint':
      return { player, card: card(p.card) };
    case 'ck.progressDeckEmpty':
      return { player, track: p.track ? track() : '—' };
    case 'ck.progressDiscardRequired':
      return { required: perPlayer(locale, p.required, nameOf) };
    case 'ck.progressDiscarded': {
      const cards = Array.isArray(p.cards) ? (p.cards as string[]) : null;
      return {
        player,
        count: Array.isArray(p.tracks) ? p.tracks.length : 0,
        cardSuffix: cards ? t(locale, 'ck.cardSuffix', { card: cards.map(card).join('、') }) : '',
      };
    }
    case 'ck.knightRecruited':
    case 'ck.wallBuilt':
      return { player, vertex: num(p.vertex) };
    case 'ck.knightActivated':
    case 'ck.knightPromoted':
      return { player, vertex: num(p.vertex), level: level(p.level) };
    case 'ck.knightMoved':
    case 'ck.knightRetreated':
      return { player, from: num(p.from), to: num(p.to), level: level(p.level) };
    case 'ck.knightDisplaced':
      return { player, victim: nameOf(str(p.victim)), from: num(p.from), to: num(p.to), level: level(p.level), victimLevel: level(p.victimLevel) };
    case 'ck.knightRemoved':
      return { player, level: level(p.level) };
    case 'ck.knightChasedRobber':
      return { player, vertex: num(p.vertex), hex: num(p.hex) };
    case 'ck.cityImproved':
      return { player, track: track(), level: num(p.level), cost: num(p.cost), commodity: t(locale, `resource.${str(p.commodity) || 'paper'}`) };
    case 'ck.metropolisAwarded':
      return {
        player,
        track: track(),
        vertex: num(p.vertex),
        fromSuffix: p.from ? t(locale, 'ck.fromSuffix', { player: nameOf(str(p.from)) }) : '',
        permanentSuffix: p.permanent ? t(locale, 'ck.permanentSuffix') : '',
      };
    default:
      return undefined;
  }
}
