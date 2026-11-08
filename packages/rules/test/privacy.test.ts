/** R-VIS: per-player projection and information visibility. */

import { describe, expect, it } from 'vitest';
import { projectEvent, projectGame, projectRoomSummary, type GameView } from '../src/project.ts';
import type { CardKind, GameEvent, Resource } from '../src/types.ts';
import { actionHints } from '../src/engine.ts';
import { actCk, emptyCkGame, giveCommodities } from './ck-helpers.ts';
import { act, playableGame, scriptedRng, setHand } from './helpers.ts';
import { corner, emptySeafarersGame, settle } from './seafarers-helpers.ts';

describe('R-VIS projections', () => {
  it('never sends another player hidden resources or cards', () => {
    const { state } = playableGame({ players: 4 });
    setHand(state, 'p2', { ore: 3, grain: 1 });
    state.players[1]!.devCards = ['knight', 'victoryPoint'];
    state.players[1]!.newDevCards = ['monopoly'];

    const view = projectGame(state, 'p1');
    const p1 = view.players.find((player) => player.id === 'p1')!;
    const p2 = view.players.find((player) => player.id === 'p2')!;

    expect(p1.resources).toBeDefined();
    expect(p2.resources).toBeUndefined();
    expect(p2.devCards).toBeUndefined();
    expect(p2.newDevCards).toBeUndefined();
    expect(p2.handSize).toBe(4);
    expect(p2.devCardCount).toBe(2);
    expect(p2.newDevCardCount).toBe(1);

    const serialised = JSON.stringify(view);
    expect(serialised).not.toContain('"monopoly"');
    expect(serialised).not.toContain('"victoryPoint"');
  });

  it('exposes the own total score only to its owner', () => {
    const { state } = playableGame({ players: 4 });
    state.players[1]!.devCards = ['victoryPoint', 'victoryPoint'];
    const view = projectGame(state, 'p1');
    const p1 = view.players.find((player) => player.id === 'p1')!;
    const p2 = view.players.find((player) => player.id === 'p2')!;
    expect(p1.ownScore).toBeDefined();
    expect(p2.ownScore).toBeUndefined();
    expect(p2.publicScore).toBe(p2.publicScore);
    expect(p2.publicScore).toBeLessThanOrEqual(p2.handSize + 10);
  });

  it('hides deck order and only publishes its size', () => {
    const { state } = playableGame({ players: 4 });
    const view = projectGame(state, 'p1');
    expect(view.devDeckSize).toBe(state.devDeck.length);
    expect(JSON.stringify(view)).not.toContain('"devDeck":');
  });

  it('filters private event parameters by audience', () => {
    const event: GameEvent = {
      seq: 3,
      type: 'robber.stole',
      params: { playerId: 'p1', victim: 'p2' },
      private: { to: ['p1', 'p2'], params: { resource: 'ore' } },
    };
    const thief = projectEvent(event, 'p1');
    const victim = projectEvent(event, 'p2');
    const bystander = projectEvent(event, 'p3');
    expect(thief.params.resource).toBe('ore');
    expect(victim.params.resource).toBe('ore');
    expect(bystander.params.resource).toBeUndefined();
    expect(bystander.params.victim).toBe('p2');
  });

  it('keeps pending discard counts public but not the discarded identities', () => {
    const { state } = playableGame({ players: 4 });
    setHand(state, 'p1', { ore: 4, grain: 4 });
    state.pending = { kind: 'discard', required: { p1: 4 }, submitted: {} };
    const view = projectGame(state, 'p2');
    expect(view.pending).toEqual({ kind: 'discard', required: { p1: 4 }, waitingFor: ['p1'] });
    expect(JSON.stringify(view)).not.toContain('"ore":4');
  });

  it('hides the invite code of a private room in discovery metadata', () => {
    const summary = projectRoomSummary({
      id: 'room-1',
      code: 'SECRET',
      visibility: 'private',
      status: 'lobby',
      hostId: 'p1',
      profileId: 'base-2025',
      playerCount: 2,
      capacity: 4,
      createdAt: '2026-10-26T00:00:00.000Z',
    });
    expect(summary.code).toBeUndefined();
    const publicSummary = projectRoomSummary({
      id: 'room-2',
      code: 'OPEN',
      visibility: 'public',
      status: 'lobby',
      hostId: 'p1',
      profileId: 'base-2025',
      playerCount: 1,
      capacity: 4,
      createdAt: '2026-10-26T00:00:00.000Z',
    });
    expect(publicSummary.code).toBe('OPEN');
    expect(publicSummary.openSeats).toBe(3);
  });

  it('reports the action-window actor separately from the turn owner', () => {
    const { state } = playableGame({ players: 4 });
    state.pending = { kind: 'steal', actor: 'p3', hex: 0, candidates: ['p2'], pirate: false };
    const view = projectGame(state, 'p2');
    expect(view.turn.playerId).toBe('p1');
    expect(view.pending).toEqual({ kind: 'steal', actor: 'p3', hex: 0, candidates: ['p2'] });
  });
});

/**
 * #137：丟棄的牌回到銀行；若投影帶確切存量，第三個座位比較丟棄前後的
 * `view.bank` 就能還原丟了哪些牌。這裡以「只差在丟棄內容」的幾個世界比較
 * 旁觀者（p3）看到的整份投影。
 */
describe('R-VIS bank supply before and after a discard (#137)', () => {
  /** p1 擲出 7 後 p2 要丟 `cards.length` 張；回傳 p3 在丟棄前後看到的投影。 */
  function bystander(bank: Record<Resource, number>, hand: Partial<Record<Resource, number>>, cards: Resource[]) {
    const { state } = playableGame({ players: 4 });
    state.bank = { ...bank };
    setHand(state, 'p2', hand);
    state.pending = { kind: 'discard', required: { p2: cards.length }, submitted: {} };
    const before = projectGame(state, 'p3');
    const after = projectGame(act(state, 'p2', { type: 'pending.discard', resources: cards }).state, 'p3');
    return { before, after };
  }

  it('looks the same to a third seat whichever cards were discarded', () => {
    const bank = { lumber: 9, brick: 9, wool: 9, grain: 9, ore: 9 };
    const hand = { lumber: 4, ore: 4 };
    const lumber = bystander(bank, hand, ['lumber', 'lumber', 'lumber', 'lumber']);
    const ore = bystander(bank, hand, ['ore', 'ore', 'ore', 'ore']);
    const mixed = bystander(bank, hand, ['lumber', 'lumber', 'ore', 'ore']);
    expect(ore.after).toEqual(lumber.after);
    expect(mixed.after).toEqual(lumber.after);
    // 牌堆夠多時，丟棄前後的銀行完全相同。
    expect(lumber.after.bank).toEqual(lumber.before.bank);
  });

  it('on a nearly empty pile shows at most that it refilled, never with how many cards', () => {
    const bank = { lumber: 1, brick: 0, wool: 6, grain: 6, ore: 0 };
    const hand = { lumber: 3, wool: 3, ore: 3 };
    const a = bystander(bank, hand, ['ore', 'ore', 'lumber', 'wool']);
    const b = bystander(bank, hand, ['ore', 'ore', 'ore', 'lumber']);
    const c = bystander(bank, hand, ['ore', 'ore', 'lumber', 'lumber']);
    const d = bystander(bank, hand, ['ore', 'ore', 'lumber', 'lumber', 'lumber', 'wool']);
    expect(b.after).toEqual(a.after);
    expect(c.after).toEqual(a.after);
    expect(d.after.bank).toEqual(a.after.bank);
    // 殘餘洩漏的上限：低於上限的牌堆只看得出「補回來了」。空的礦石堆沒有人丟礦石時仍是 0，
    // 所以旁觀者知道至少丟了一張礦石，但不知道是幾張。
    const none = bystander(bank, hand, ['lumber', 'lumber', 'wool', 'wool']);
    expect(none.after.bank).toEqual({ ...a.after.bank, ore: 0 });
    expect(a.after.bank).toEqual({ lumber: 2, brick: 0, wool: 2, grain: 2, ore: 2 });
  });

  it('hides discarded commodities in the Cities & Knights commodity bank', () => {
    const world = (cards: CardKind[]) => {
      const state = emptyCkGame(4, 0, 'action');
      giveCommodities(state, 'p2', { paper: 4, cloth: 4 });
      state.pending = { kind: 'discard', required: { p2: cards.length }, submitted: {} };
      const before = projectGame(state, 'p3');
      const after = projectGame(actCk(state, 'p2', { type: 'pending.discard', resources: cards }).state, 'p3');
      return { before, after };
    };
    const paper = world(['paper', 'paper', 'paper', 'paper']);
    const cloth = world(['cloth', 'cloth', 'cloth', 'cloth']);
    expect(cloth.after).toEqual(paper.after);
    const ck = (view: GameView) => (view.modules as { citiesKnights: { commodityBank: Record<string, number> } }).citiesKnights;
    expect(ck(paper.after).commodityBank).toEqual(ck(paper.before).commodityBank);
  });

  it('gives only the gold chooser the supply its choice needs, up to what it must take', () => {
    // p1 有城市和聚落在金礦 (3,0) 上，擲出 10 要拿 3 張；p2 沒有欠額。
    const state = emptySeafarersGame(4, 0, 'preroll');
    settle(state, 'p1', corner(state, 3, 0, 0), true);
    settle(state, 'p1', corner(state, 3, 0, 3));
    state.bank = { lumber: 0, brick: 1, wool: 2, grain: 3, ore: 19 };
    const rolled = act(state, 'p1', { type: 'turn.roll' }, scriptedRng([3, 5])).state;
    const gold = (playerId: string) => (actionHints(rolled, playerId).modules as { seafarers: { goldRequired: number; goldBank: Record<Resource, number> } }).seafarers;
    expect(gold('p1').goldRequired).toBe(3);
    expect(gold('p1').goldBank).toEqual({ lumber: 0, brick: 1, wool: 2, grain: 3, ore: 3 });
    expect(projectGame(rolled, 'p1').bank).toEqual({ lumber: 0, brick: 1, wool: 2, grain: 2, ore: 2 });
    for (const other of ['p2', 'p3', 'p4']) {
      expect(gold(other).goldBank).toEqual({ lumber: 0, brick: 0, wool: 0, grain: 0, ore: 0 });
    }
  });

  it('caps the bank and the commodity bank for every seat, the discarder included', () => {
    const state = emptyCkGame(4, 0, 'action');
    state.bank = { lumber: 0, brick: 1, wool: 2, grain: 3, ore: 19 };
    state.commodityBank = { paper: 0, cloth: 1, coin: 12 };
    for (const viewer of ['p1', 'p2', 'p3', 'p4']) {
      const view = projectGame(state, viewer);
      expect(view.bank).toEqual({ lumber: 0, brick: 1, wool: 2, grain: 2, ore: 2 });
      const ck = (view.modules as { citiesKnights: { commodityBank: Record<string, number> } }).citiesKnights;
      expect(ck.commodityBank).toEqual({ paper: 0, cloth: 1, coin: 2 });
    }
  });
});
