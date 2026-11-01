import { useMemo } from 'react';
import type { Material } from 'three';
import type { PublicBoardView } from '@catan/rules';
import type { BoardGeometry } from '../geometry.ts';
import { InstancedPrimitive } from './InstancedPrimitive.tsx';
import { useDioramaGeometry } from './diorama-geometry.ts';
import { createTerrainModel } from './diorama-terrain.ts';
import type { InstanceTransform } from './transforms.ts';

interface TerrainBatch {
  terrain: string;
  variant: number;
  instances: InstanceTransform[];
}

function TerrainBatchMesh({ batch, material, quality }: {
  batch: TerrainBatch;
  material: Material;
  quality: 'standard' | 'low';
}) {
  const geometry = useDioramaGeometry(() => createTerrainModel(batch.terrain, batch.variant), [batch.terrain, batch.variant]);
  return <InstancedPrimitive geometry={geometry} material={material} instances={batch.instances} castShadow={quality === 'standard'} />;
}

export function DioramaTerrain({ geometry, board, material, quality }: {
  geometry: BoardGeometry;
  board: PublicBoardView;
  material: Material;
  quality: 'standard' | 'low';
}) {
  const batches = useMemo(() => {
    const grouped = new Map<string, TerrainBatch>();
    for (const hex of geometry.hexes) {
      // Sea hexes have no tile: the ocean plane is their surface.
      if (geometry.land[hex.index] === false) continue;
      const terrain = board.terrain[hex.index] ?? 'sea';
      const variant = quality === 'low' ? 0 : hex.index % 3;
      const key = `${terrain}:${variant}`;
      let batch = grouped.get(key);
      if (!batch) {
        batch = { terrain, variant, instances: [] };
        grouped.set(key, batch);
      }
      batch.instances.push({
        position: [hex.cx / geometry.scale, 0, hex.cy / geometry.scale],
        rotationY: 0,
        scale: [1, 1, 1],
      });
    }
    return [...grouped.values()];
  }, [geometry, board.terrain, quality]);
  return <>{batches.map(batch => <TerrainBatchMesh key={`${batch.terrain}:${batch.variant}`} batch={batch} material={material} quality={quality} />)}</>;
}
