/** Display parameters for the Cities & Knights rule events (see `../events.ts`). */

import type { Locale } from '@catan/protocol';
import type { GameEvent } from '@catan/rules';
import { t } from '../index.ts';
import { formatGrantMap, formatNumber, formatResourceMap } from '../format.ts';

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

/** A list of card kinds as "2×Wool、1×Cloth" (counts per kind). */
function formatCardList(locale: Locale, cards: unknown[]): string {
  const counts: Record<string, number> = {};
  for (const entry of cards) counts[String(entry)] = (counts[String(entry)] ?? 0) + 1;
  return formatResourceMap(locale, counts);
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
    // --- progress cards and the merchant -----------------------------------
    case 'ck.progressPlayed':
      return { player, card: card(p.card), track: track() };
    case 'ck.alchemySet': {
      const dice = Array.isArray(p.dice) ? p.dice : [];
      return { player, yellow: num(dice[0]), red: num(dice[1]), total: num(p.total) };
    }
    case 'ck.numbersSwapped': {
      const hexes = Array.isArray(p.hexes) ? p.hexes : [];
      const numbers = Array.isArray(p.numbers) ? p.numbers : [];
      return { player, a: num(hexes[0]), b: num(hexes[1]), x: num(numbers[0]), y: num(numbers[1]) };
    }
    case 'ck.harvest':
      return { player, card: card(p.card), amount: num(p.amount), hexes: num(p.hexes), resource: t(locale, `resource.${str(p.resource) || 'grain'}`) };
    case 'ck.medicineCity':
    case 'ck.treasonPlaced':
      return { player, vertex: num(p.vertex), level: level(p.level) };
    case 'ck.freeRoads':
      return { player, roads: num(p.roads) };
    case 'ck.harborOpened':
    case 'ck.diplomacyRoadSkipped':
    case 'ck.treasonNoPlace':
      return { player };
    case 'ck.harborOffered':
    case 'ck.harborReturned':
      // The offered resource is only present in the two players' copies.
      return { player, to: nameOf(str(p.to)), resourceSuffix: p.resource ? t(locale, 'ck.cardSuffix', { card: t(locale, `resource.${str(p.resource)}`) }) : '' };
    case 'ck.harborExchanged':
      return {
        player,
        to: nameOf(str(p.to)),
        resource: p.resource ? t(locale, `resource.${str(p.resource)}`) : '—',
        commodity: p.commodity ? t(locale, `resource.${str(p.commodity)}`) : '—',
      };
    case 'ck.guildDuesTaken':
    case 'ck.weddingGift':
      return {
        player,
        other: nameOf(str(p.victim) || str(p.to)),
        count: num(p.count),
        cardSuffix: Array.isArray(p.cards) ? t(locale, 'ck.cardSuffix', { card: formatCardList(locale, p.cards) }) : '',
      };
    case 'ck.sabotageDiscarded':
      return { player, count: num(p.count), cardSuffix: Array.isArray(p.cards) ? t(locale, 'ck.cardSuffix', { card: formatCardList(locale, p.cards) }) : '' };
    case 'ck.merchantPlaced':
      return {
        player,
        hex: num(p.hex),
        fromSuffix: p.from ? t(locale, 'ck.fromSuffix', { player: nameOf(str(p.from)) }) : '',
      };
    case 'ck.fleetNamed':
      return { player, kind: t(locale, `resource.${str(p.kind) || 'lumber'}`) };
    case 'ck.monopolyTaken': {
      const taken = (p.taken ?? {}) as Record<string, number>;
      const total = Object.values(taken).reduce((sum, value) => sum + value, 0);
      return { player, card: card(p.card), kind: t(locale, `resource.${str(p.kind) || 'lumber'}`), total, from: perPlayer(locale, taken, nameOf) };
    }
    case 'ck.roadRemoved':
      return { player, owner: nameOf(str(p.owner)), edge: num(p.edge) };
    case 'ck.diplomacyRoadBuilt':
      return { player, edge: num(p.edge) };
    case 'ck.knightsEncouraged':
      return { player, count: Array.isArray(p.vertices) ? p.vertices.length : 0 };
    case 'ck.espionageLooked':
      return { player, victim: nameOf(str(p.victim)), count: num(p.count) };
    case 'ck.espionageTaken':
      return {
        player,
        victim: nameOf(str(p.victim)),
        outcome: p.took ? t(locale, 'ck.espionage.took', { card: p.card ? card(p.card) : t(locale, 'ck.espionage.aCard') }) : t(locale, 'ck.espionage.none'),
      };
    case 'ck.knightIntrigued':
      return { player, victim: nameOf(str(p.victim)), vertex: num(p.vertex), level: level(p.level) };
    case 'ck.sabotageRequired':
    case 'ck.weddingRequired':
      return { player, required: perPlayer(locale, p.required, nameOf) };
    case 'ck.taxationMoved':
      return { player, hex: num(p.hex) };
    case 'ck.taxationStole':
      return { player, victim: nameOf(str(p.victim)), cardSuffix: p.card ? t(locale, 'ck.cardSuffix', { card: t(locale, `resource.${str(p.card)}`) }) : '' };
    case 'ck.treasonChosen':
      return { player, victim: nameOf(str(p.victim)) };
    case 'ck.treasonRemoved':
      return { player, vertex: num(p.vertex), level: level(p.level) };
    default:
      return undefined;
  }
}
