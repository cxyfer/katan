import { describe, expect, it } from 'vitest';
import { SHIP_BEAM, SHIP_LANE, shipLaneOffsets, shipSlots, type EpView } from '../src/board/explorersPirates.ts';

const pairs = (items: number[]) => items.flatMap((a, i) => items.slice(i + 1).map((b) => [a, b] as const));

function viewWith(ships: { id: string; edge: number }[]): EpView {
  return { ships: ships.map((ship) => ({ ...ship, player: 'p1', cargo: [] })) } as unknown as EpView;
}

describe('ship lanes on a shared path', () => {
  it('keeps one ship on the path and two ships where they always sat', () => {
    expect(shipLaneOffsets(1)).toEqual([0]);
    expect(shipLaneOffsets(2)).toEqual([-SHIP_LANE / 2, SHIP_LANE / 2]);
    expect(shipLaneOffsets(1, 1)).toEqual([0]);
    expect(shipLaneOffsets(2, -1)).toEqual([-SHIP_LANE / 2, SHIP_LANE / 2]);
  });

  it.each([1, 2, 3, 4])('gives %i ships their own lanes, clear of each other and within half a hex side', (count) => {
    for (const shore of [0, 1, -1] as const) {
      const offsets = shipLaneOffsets(count, shore);
      expect(offsets).toHaveLength(count);
      // 兩兩間距大於船身寬度：平行的船身不會互相重疊。
      for (const [a, b] of pairs(offsets)) expect(Math.abs(a - b)).toBeGreaterThan(SHIP_BEAM);
      // 依 slot 由負向正排列，順序固定。
      expect(offsets.slice().sort((a, b) => a - b)).toEqual(offsets);
      if (shore === 0) {
        // 置中於路徑：整組（含船身寬）不超出路徑兩側各半個邊長。
        for (const offset of offsets) expect(Math.abs(offset) + SHIP_BEAM / 2).toBeLessThanOrEqual(0.5);
        expect(offsets.reduce((sum, offset) => sum + offset, 0)).toBeCloseTo(0);
      }
    }
  });

  it('grows a coastal group out to sea, never more than half a lane towards the land', () => {
    for (const count of [3, 4]) {
      const seaward = shipLaneOffsets(count, 1);
      expect(Math.min(...seaward)).toBeCloseTo(-SHIP_LANE / 2);
      expect(shipLaneOffsets(count, -1)).toEqual(seaward.map((offset) => -offset).reverse());
    }
  });

  it('keeps a crowded path within the four-ship spread', () => {
    const offsets = shipLaneOffsets(6);
    expect(Math.max(...offsets) - Math.min(...offsets)).toBeCloseTo(3 * SHIP_LANE);
    for (const [a, b] of pairs(offsets)) expect(Math.abs(a - b)).toBeGreaterThan(0);
  });

  it('assigns lanes by ship id, whatever order the ships arrive in', () => {
    const ships = [{ id: 's10', edge: 7 }, { id: 's2', edge: 7 }, { id: 's5', edge: 3 }, { id: 's9', edge: 7 }];
    const expected = new Map([['s2', { slot: 0, of: 3 }], ['s9', { slot: 1, of: 3 }], ['s10', { slot: 2, of: 3 }], ['s5', { slot: 0, of: 1 }]]);
    expect(shipSlots(viewWith(ships))).toEqual(expected);
    expect(shipSlots(viewWith(ships.slice().reverse()))).toEqual(expected);
    expect(shipSlots(null).size).toBe(0);
  });
});
