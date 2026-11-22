/** survey 分片的解析與觀測欄位。 */

import { describe, expect, it } from 'vitest';
import { checkpointVp, openingMetrics } from './survey-observations.ts';
import { parseRoles, parseShard, rolesFor } from './survey-records.ts';
import { mergeShards, ShardMergeError } from './survey-merge.ts';

const PROFILE = 'sf-new-shores-2025';

type Json = Record<string, unknown>;

function seat(index: number, role: string, winner: number | null): Json {
  return {
    seat: index,
    role,
    won: winner === index,
    score: 10,
    opening: [1, 2],
    openPips: [8, 9],
    openCoast: [true, false],
    openHarbor: [false, false],
    openKinds: 4,
    paidShips: 1,
    freeShips: 0,
    setupShips: 0,
    shipsMoved: 0,
    islandBonuses: 0,
    settlements: 2,
    cities: 1,
    roads: 4,
    devBought: 1,
    knights: 0,
    playerTrades: 0,
    bankTrades: 1,
    produced: 20,
    turns: 30,
    improvements: 0,
    robbed: 0,
    blocked: 0,
    longestRoad: false,
    largestArmy: false,
    scriptMiss: 0,
    vp10: null,
    vp20: 5,
  };
}

function game(id: number, extra: Json = {}): Json {
  const winner = 0;
  return { game: id, seed: 10_000 + id, finished: true, problem: null, winner, rounds: 20.5, seats: [0, 1, 2].map((index) => seat(index, 'standard', winner)), ...extra };
}

function text(meta: Json, games: Json[]): string {
  return [JSON.stringify({ meta }), ...games.map((entry) => JSON.stringify(entry))].join('\n') + '\n';
}

const META: Json = { profile: PROFILE, players: 3, roles: 'standard', from: 0, games: 2, openings: '35/78,76/63,37/57', shift: 1 };

function omit(record: Json, key: string): Json {
  const { [key]: _omitted, ...rest } = record;
  return rest;
}

describe('parseShard', () => {
  it('accepts a complete shard', () => {
    const shard = parseShard('a.jsonl', text(META, [game(0), game(1)]));
    expect(shard.meta.players).toBe(3);
    expect(shard.games).toHaveLength(2);
    expect(shard.file).toBe('a.jsonl');
  });

  it('rejects a game with a missing, non-integer or wrongly typed seed', () => {
    const bad = (extra: Json | null): string => text(META, [game(0), extra === null ? omit(game(1), 'seed') : game(1, extra)]);
    expect(() => parseShard('s.jsonl', bad(null))).toThrow('s.jsonl line 3 needs seed (int), got undefined');
    expect(() => parseShard('s.jsonl', bad({ seed: 10_001.5 }))).toThrow('needs seed (int)');
    expect(() => parseShard('s.jsonl', bad({ seed: '10001' }))).toThrow('needs seed (int)');
    expect(() => parseShard('s.jsonl', bad({ seed: null }))).toThrow('needs seed (int)');
    // 整數但不是 10000 + 局號：由 checkShards 拒絕（survey-merge.test.ts），解析本身接受。
    expect(parseShard('s.jsonl', bad({ seed: 10_005 })).games).toHaveLength(2);
  });

  it('rejects every missing or wrongly typed game and seat field', () => {
    for (const key of ['game', 'seed', 'finished', 'problem', 'winner', 'rounds', 'seats']) {
      expect(() => parseShard('g.jsonl', text(META, [game(0), omit(game(1), key)])), `missing ${key}`).toThrow(ShardMergeError);
    }
    const sample = seat(0, 'standard', 0);
    for (const key of Object.keys(sample)) {
      const broken = game(1, { seats: [omit(sample, key), seat(1, 'standard', 0), seat(2, 'standard', 0)] });
      expect(() => parseShard('g.jsonl', text(META, [game(0), broken])), `seat missing ${key}`).toThrow(`needs ${key}`);
    }
    const wrongType = (key: string, value: unknown): string =>
      text(META, [game(0), game(1, { seats: [{ ...sample, [key]: value }, seat(1, 'standard', 0), seat(2, 'standard', 0)] })]);
    expect(() => parseShard('g.jsonl', wrongType('score', '10'))).toThrow('needs score (num)');
    expect(() => parseShard('g.jsonl', wrongType('opening', [1, 'x']))).toThrow('needs opening (int[])');
    expect(() => parseShard('g.jsonl', wrongType('openCoast', [1]))).toThrow('needs openCoast (bool[])');
    expect(() => parseShard('g.jsonl', wrongType('vp10', undefined))).toThrow('needs vp10');
    expect(() => parseShard('g.jsonl', wrongType('role', 'expert'))).toThrow('needs role (role)');
  });

  it('rejects inconsistent records', () => {
    const roleMismatch = game(1, { seats: [seat(0, 'easy', 0), seat(1, 'standard', 0), seat(2, 'standard', 0)] });
    expect(() => parseShard('c.jsonl', text(META, [game(0), roleMismatch]))).toThrow('has role easy, expected standard');
    const wonMismatch = game(1, { winner: 2 });
    expect(() => parseShard('c.jsonl', text(META, [game(0), wonMismatch]))).toThrow('disagrees with winner 2');
    const finishedWithProblem = game(1, { problem: 'watchdog' });
    expect(() => parseShard('c.jsonl', text(META, [game(0), finishedWithProblem]))).toThrow('disagrees with problem');
    const seatsTooFew = game(1, { seats: [seat(0, 'standard', 0), seat(1, 'standard', 0)] });
    expect(() => parseShard('c.jsonl', text(META, [game(0), seatsTooFew]))).toThrow('needs 3 seat records, got 2');
    const unfinishedWithWinner = game(1, { finished: false, problem: 'watchdog' });
    expect(() => parseShard('c.jsonl', text(META, [game(0), unfinishedWithWinner]))).toThrow('is unfinished but has a winner');
    const unfinished = game(1, { finished: false, problem: 'watchdog', winner: null, seats: [0, 1, 2].map((index) => seat(index, 'standard', null)) });
    expect(parseShard('c.jsonl', text(META, [game(0), unfinished])).games[1]!.finished).toBe(false);
  });

  it('checks the focus rotation against --roles', () => {
    const meta = { ...META, roles: 'standard:naive' };
    const ok = game(1, { seats: [seat(0, 'naive', 0), seat(1, 'standard', 0), seat(2, 'naive', 0)] });
    expect(parseShard('r.jsonl', text(meta, [game(0, { seats: [seat(0, 'standard', 0), seat(1, 'naive', 0), seat(2, 'naive', 0)] }), ok])).games).toHaveLength(2);
    const wrong = game(1, { seats: [seat(0, 'standard', 0), seat(1, 'naive', 0), seat(2, 'naive', 0)] });
    expect(() => parseShard('r.jsonl', text(meta, [game(0, { seats: [seat(0, 'standard', 0), seat(1, 'naive', 0), seat(2, 'naive', 0)] }), wrong]))).toThrow('expected');
  });

  it('accepts hard and hard0 as single roles, focus/rest roles and script roles', () => {
    expect(rolesFor(parseRoles('hard'), 3, 1)).toEqual(['hard', 'hard', 'hard']);
    expect(rolesFor(parseRoles('hard0'), 3, 1)).toEqual(['hard0', 'hard0', 'hard0']);
    expect(rolesFor(parseRoles('hard0:standard'), 3, 2)).toEqual(['standard', 'standard', 'hard0']);
    expect(rolesFor(parseRoles('hard:hard0'), 3, 1)).toEqual(['hard0', 'hard', 'hard0']);
    const seats = [seat(0, 'standard', 0), seat(1, 'hard0', 0), seat(2, 'standard', 0)];
    const meta = { ...META, roles: 'hard0:standard', scriptRoles: 'hard0', from: 1, games: 1 };
    expect(parseShard('hard0.jsonl', text(meta, [game(1, { seats })])).games[0]!.seats.map(({ role }) => role)).toEqual(['standard', 'hard0', 'standard']);
  });

  it('validates optional observations and merges new shards with legacy shards unchanged', () => {
    const observations = { openExpected: 17 / 36, openRank: 1, vp5: 2, vp15: null, vpCards: 0 };
    const seatsWith = (extra: Json): Json[] => [0, 1, 2].map((index) => ({ ...seat(index, 'standard', 0), ...extra }));
    const old = parseShard('old.jsonl', text({ ...META, games: 1 }, [game(0)]));
    const parseNew = (extra: Json) => parseShard('new.jsonl', text({ ...META, from: 1, games: 1 }, [game(1, { seats: seatsWith(extra) })]));
    const merged = mergeShards([old, parseNew(observations)]);
    expect(merged.games[0]!.seats[0]).toEqual(seat(0, 'standard', 0));
    expect(merged.games[1]!.seats[0]).toMatchObject(observations);
    for (const [key, value] of Object.entries({ openExpected: '0.47', openRank: 1.5, vp5: false, vp15: [], vpCards: null })) {
      expect(() => parseNew({ ...observations, [key]: value })).toThrow(`needs ${key}`);
    }
  });

  it('requires and types the meta fields', () => {
    const body = [game(0), game(1)];
    for (const key of ['profile', 'players', 'roles', 'from', 'games']) {
      expect(() => parseShard('m.jsonl', text(omit(META, key), body)), `meta missing ${key}`).toThrow(ShardMergeError);
    }
    expect(() => parseShard('m.jsonl', text({ ...META, from: 0.5 }, body))).toThrow('meta.from');
    expect(() => parseShard('m.jsonl', text({ ...META, games: '2' }, body))).toThrow('meta.games');
    expect(() => parseShard('m.jsonl', text({ ...META, players: 0 }, body))).toThrow('players');
    expect(() => parseShard('m.jsonl', text({ ...META, profile: 'nope' }, body))).toThrow('not a known ruleset profile');
    expect(() => parseShard('m.jsonl', text({ ...META, roles: 'expert' }, body))).toThrow('meta.roles is invalid');
    expect(() => parseShard('m.jsonl', text({ ...META, shift: -1 }, body))).toThrow('meta.shift');
    expect(() => parseShard('m.jsonl', text({ ...META, shift: 3 }, body))).toThrow('below the player count');
    expect(() => parseShard('m.jsonl', text({ ...META, openings: '35/78,76/63' }, body))).toThrow('meta.openings must list 3');
    expect(() => parseShard('m.jsonl', text({ ...META, setupFrom: 'naive' }, body))).toThrow('exclusive');
    expect(() => parseShard('m.jsonl', text({ ...omit(omit(META, 'openings'), 'shift'), scriptRoles: 'standard' }, body))).toThrow('no scripted openings');
    expect(() => parseShard('m.jsonl', text({ ...META, scriptRoles: 'naive' }, body))).toThrow('matches no seat');
  });

  it('rejects an empty file, invalid JSON and a missing meta line', () => {
    expect(() => parseShard('e.jsonl', '')).toThrow('e.jsonl is empty');
    expect(() => parseShard('e.jsonl', '{not json}\n')).toThrow('line 1 is not valid JSON');
    expect(() => parseShard('e.jsonl', JSON.stringify(game(0)) + '\n')).toThrow('line 1 is not a shard meta');
    expect(() => parseShard('e.jsonl', JSON.stringify({ meta: META }) + '\n{oops\n')).toThrow('line 2 is not valid JSON');
    expect(() => parseShard('e.jsonl', JSON.stringify({ meta: META }) + '\n[1]\n')).toThrow('is not a game record');
  });
});

describe('survey observations', () => {
  it('uses both settlements for production and gives tied seats the same rank', () => {
    expect(openingMetrics([[7, 8], [10, 5], [7, 6]])).toEqual([
      { openExpected: 15 / 36, openRank: 1 },
      { openExpected: 15 / 36, openRank: 1 },
      { openExpected: 13 / 36, openRank: 3 },
    ]);
    expect(openingMetrics([[7, 8], [10]])).toEqual([
      { openExpected: 15 / 36, openRank: null },
      { openExpected: null, openRank: null },
    ]);
  });

  it('samples the start of the next round and never treats the final score as a checkpoint', () => {
    const throughRound5 = [[2, 2], [2, 2], [2, 2], [3, 2], [3, 3]];
    const nextRound = [...throughRound5, [4, 3]];
    expect(checkpointVp([...throughRound5, [10, 3]], 5, 0, true)).toBeNull();
    expect(checkpointVp([...nextRound, [10, 4]], 5, 1, true)).toBe(3);
    expect(checkpointVp(nextRound, 5, 0, false)).toBe(4);
  });
});
