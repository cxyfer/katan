/**
 * R-VIS for progress cards: hands, deck order and every card that peeks at or
 * moves hidden cards (Espionage, Guild Dues, Commercial Harbor, Taxation,
 * Wedding, Sabotage). A bystander's projection and events never carry the
 * hidden card identities; the right viewers see them.
 */

import { describe, expect, it } from 'vitest';
import { projectEvent, projectGame } from '../src/project.ts';
import { ckState } from '../src/modules/citiesKnights/state.ts';
import type { GameEvent, GameState } from '../src/types.ts';
import {
  actCk,
  cornersOf,
  emptyCkGame,
  giveCommodities,
  handCards,
  hexWith,
  playCard,
  scripted,
  setBuilding,
  spreadVertices,
} from './ck-helpers.ts';
import { give } from './helpers.ts';

function seenBy(state: GameState, events: GameEvent[], viewer: string): string {
  return JSON.stringify({ game: projectGame(state, viewer), events: events.map((event) => projectEvent(event, viewer)) });
}

describe('R-VIS progress cards', () => {
  it('VIS-PC1 progress hands and deck order reach their owner only; counts are public', () => {
    const state = emptyCkGame(4);
    handCards(state, 'p2', ['espionage', 'taxation']);
    const bystander = projectGame(state, 'p1');
    expect(bystander.players.find((p) => p.id === 'p2')!.progressCards).toBeUndefined();
    expect((bystander.modules!.citiesKnights as any).progressCounts.p2).toBe(2);
    expect(projectGame(state, 'p2').players.find((p) => p.id === 'p2')!.progressCards).toEqual(['espionage', 'taxation']);
    const json = JSON.stringify(bystander);
    expect(json).not.toContain('"espionage"');
    expect(json).not.toContain('progressDecks');
    expect((bystander.modules!.citiesKnights as any).decks).toEqual({ science: 18, trade: 18, politics: 16 });
  });

  it('VIS-PC2 Espionage: the spy alone sees the hand; the taken card reaches spy and victim only', () => {
    const state = emptyCkGame(4);
    handCards(state, 'p1', ['espionage']);
    handCards(state, 'p2', ['merchantFleet', 'irrigation']);
    const played = playCard(state, 'p1', 'espionage', { target: 'p2' });
    expect(seenBy(played.state, played.events, 'p3')).not.toContain('merchantFleet');
    expect(seenBy(played.state, played.events, 'p1')).toContain('merchantFleet');
    const taken = actCk(played.state, 'p1', { type: 'progress.takeProgress', card: 'merchantFleet' });
    expect(seenBy(taken.state, taken.events, 'p3')).not.toContain('merchantFleet');
    expect(seenBy(taken.state, taken.events, 'p2')).toContain('merchantFleet');
  });

  it('VIS-PC3 Guild Dues: the hand is shown to the taker only; the cards to both players', () => {
    const state = emptyCkGame(4);
    setBuilding(state, 'p2', spreadVertices(state, 1)[0]!, false);
    // 3 張木材：投影的銀行只到 2（#137），所以 `"lumber":3` 只可能來自 p2 的手牌。
    give(state, 'p2', { lumber: 3, brick: 1 });
    handCards(state, 'p1', ['guildDues']);
    const played = playCard(state, 'p1', 'guildDues', { target: 'p2' });
    expect(seenBy(played.state, played.events, 'p3')).not.toContain('"lumber":3');
    expect(JSON.stringify(projectGame(played.state, 'p1').pending)).toContain('"lumber":3');
    const taken = actCk(played.state, 'p1', { type: 'progress.takeCards', cards: ['brick', 'lumber'] });
    const event = taken.events.find((candidate) => candidate.type === 'ck.guildDuesTaken')!;
    expect(projectEvent(event, 'p4').params).not.toHaveProperty('cards');
    expect(projectEvent(event, 'p2').params).toHaveProperty('cards', ['brick', 'lumber']);
  });

  it('VIS-PC4 Commercial Harbor: resource and commodity stay between the two players', () => {
    const state = emptyCkGame(4);
    give(state, 'p1', { wool: 1 });
    giveCommodities(state, 'p2', { paper: 1, cloth: 1 });
    handCards(state, 'p1', ['commercialHarbor']);
    const opened = playCard(state, 'p1', 'commercialHarbor');
    const offered = actCk(opened.state, 'p1', { type: 'progress.harborOffer', to: 'p2', resource: 'wool' });
    expect((projectGame(offered.state, 'p3').pending as any).data).toEqual({ from: 'p1' });
    expect(JSON.stringify(offered.events.map((event) => projectEvent(event, 'p3')))).not.toContain('wool');
    const answered = actCk(offered.state, 'p2', { type: 'progress.harborAnswer', commodity: 'cloth' });
    const bystander = answered.events.map((event) => projectEvent(event, 'p4'));
    expect(JSON.stringify(bystander)).not.toContain('cloth');
  });

  it('VIS-PC5 Taxation, Wedding and Sabotage name the cards only to the players involved', () => {
    const state = emptyCkGame(4);
    ckState(state).attacks = 1;
    const hex = hexWith(state, 'hills');
    setBuilding(state, 'p2', cornersOf(state, hex)[0]!, true);
    give(state, 'p2', { ore: 1, grain: 2 });
    giveCommodities(state, 'p2', { coin: 1 });
    handCards(state, 'p1', ['taxation', 'wedding', 'sabotage']);
    const taxed = playCard(state, 'p1', 'taxation', { hex }, scripted([0]));
    const wedding = playCard(taxed.state, 'p1', 'wedding');
    const gave = actCk(wedding.state, 'p2', { type: 'progress.weddingGive', cards: ['grain', 'coin'] });
    const sabotage = playCard(gave.state, 'p1', 'sabotage');
    const events = [...taxed.events, ...wedding.events, ...gave.events, ...sabotage.events];
    for (const event of events) {
      if (!event.private) continue;
      expect(event.private.to).not.toContain('p3');
      expect(projectEvent(event, 'p3').params).toEqual(event.params);
    }
    expect(events.some((event) => event.type === 'ck.taxationStole')).toBe(true);
    expect(events.some((event) => event.type === 'ck.weddingGift')).toBe(true);
  });
});
