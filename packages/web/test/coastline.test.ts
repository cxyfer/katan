import { describe, expect, it } from 'vitest';
import { getTopology } from '@catan/rules';
import { coastLoops, distanceToLoop, insideLoop, offsetLoop, smoothLoop } from '../src/board/coastline.ts';

describe('island coastline', () => {
  it.each([['hex-r2', 30], ['hex-r56', 44]] as const)('%s walks every shoreline edge into one outward loop', (id, edges) => {
    const topology = getTopology(id);
    const boundary = topology.edges.filter((edge) => edge.hexes.length === 1).length;
    expect(boundary).toBe(edges);
    const loops = coastLoops(topology);
    expect(loops).toHaveLength(1);
    const [loop] = loops;
    expect(loop!.points).toHaveLength(boundary);
    // 每個地塊中心都在海岸線內，向外偏移的環則完全包住原海岸線。
    for (const hex of topology.hexes) expect(insideLoop(loop!.points, hex.x, hex.y)).toBe(true);
    const outer = offsetLoop(loop!, 0.3);
    for (const point of loop!.points) {
      expect(insideLoop(outer, point.x, point.y)).toBe(true);
      expect(distanceToLoop(outer, point.x, point.y)).toBeGreaterThan(0.29);
    }
    const inner = offsetLoop(loop!, -0.05);
    for (const point of inner) expect(insideLoop(loop!.points, point.x, point.y)).toBe(true);
    expect(smoothLoop(outer, 2)).toHaveLength(boundary * 4);
  });
});
