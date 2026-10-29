import {
  BufferGeometry,
  MeshStandardMaterial,
  PlaneGeometry,
} from 'three';
import { playerColorHex } from '../terrain.ts';
import { createAtlasPlaneGeometry, HARBOR_ATLAS_CELLS, NUMBER_ATLAS_CELLS, type AtlasCell } from './atlas.ts';
import {
  createHexTileSurfaces,
  createTokenBodyGeometry,
} from './model-geometry.ts';

export interface BoardSceneResources {
  acquire(): void;
  release(): void;
  readonly geometries: {
    readonly tileCap: BufferGeometry;
    readonly tileWall: BufferGeometry;
    readonly token: BufferGeometry;
    readonly atlas: Readonly<Record<string, PlaneGeometry>>;
  };
  readonly materials: {
    readonly diorama: MeshStandardMaterial;
    readonly tileSide: MeshStandardMaterial;
    readonly ghost: Readonly<Record<string, MeshStandardMaterial>>;
    readonly token: MeshStandardMaterial;
  };
  readonly disposed: () => boolean;
}

const PLAYER_COLORS = ['red', 'blue', 'orange', 'white', 'green', 'brown', 'gray'] as const;

function material(color: string, roughness = 0.82, metalness = 0): MeshStandardMaterial {
  return new MeshStandardMaterial({ color, roughness, metalness });
}

function ghostMaterial(color: string): MeshStandardMaterial {
  return new MeshStandardMaterial({
    color,
    roughness: 0.7,
    metalness: 0,
    transparent: true,
    opacity: 0.52,
    depthWrite: false,
  });
}

function atlasKey(cell: AtlasCell): string {
  return `${cell.column}:${cell.row}`;
}

class ResourceLease {
  private references = 0;
  private disposeScheduled = false;
  private disposed = false;
  private readonly values: Omit<BoardSceneResources, 'acquire' | 'release' | 'disposed'>;
  private readonly view: BoardSceneResources;

  constructor(factory: () => Omit<BoardSceneResources, 'acquire' | 'release' | 'disposed'>) {
    this.values = factory();
    this.view = {
      ...this.values,
      acquire: () => this.acquire(),
      release: () => this.release(),
      disposed: () => this.disposed,
    };
  }

  acquire(): void {
    if (this.disposed) throw new Error('Cannot acquire disposed board resources');
    this.references += 1;
    this.disposeScheduled = false;
  }

  release(): void {
    if (this.references === 0) return;
    this.references -= 1;
    if (this.references !== 0 || this.disposeScheduled) return;
    this.disposeScheduled = true;
    queueMicrotask(() => {
      if (this.references !== 0 || this.disposed) return;
      this.disposed = true;
      const all = new Set<{ dispose(): void }>();
      for (const geometry of Object.values(this.values.geometries)) {
        if (geometry && typeof geometry === 'object' && 'dispose' in geometry) all.add(geometry as { dispose(): void });
        else if (geometry && typeof geometry === 'object') {
          for (const nested of Object.values(geometry)) {
            if (nested && typeof nested === 'object' && 'dispose' in nested) all.add(nested as { dispose(): void });
          }
        }
      }
      for (const value of Object.values(this.values.materials)) {
        if (value && typeof value === 'object') {
          if ('dispose' in value) all.add(value as { dispose(): void });
          else for (const nested of Object.values(value)) all.add(nested as { dispose(): void });
        }
      }
      for (const resource of all) resource.dispose();
    });
  }

  asView(): BoardSceneResources {
    return this.view;
  }
}

function createResources(): Omit<BoardSceneResources, 'acquire' | 'release' | 'disposed'> {
  const tile = createHexTileSurfaces();
  const atlasGeometries: Record<string, PlaneGeometry> = {};
  for (const cell of Object.values(NUMBER_ATLAS_CELLS)) atlasGeometries[atlasKey(cell)] = createAtlasPlaneGeometry(cell);
  for (const cell of Object.values(HARBOR_ATLAS_CELLS)) atlasGeometries[atlasKey(cell)] = createAtlasPlaneGeometry(cell);
  const ghost = Object.fromEntries(PLAYER_COLORS.map((color) => [color, ghostMaterial(playerColorHex(color))]));
  return {
    geometries: {
      tileCap: tile.cap,
      tileWall: tile.wall,
      token: createTokenBodyGeometry(),
      atlas: atlasGeometries,
    },
    materials: {
      diorama: new MeshStandardMaterial({ color: '#ffffff', vertexColors: true, roughness: 0.87, metalness: 0, flatShading: true }),
      tileSide: material('#a58c60', 0.94),
      ghost,
      token: material('#e8d5ad', 0.88),
    },
  };
}

let shared: ResourceLease | null = null;

export function boardSceneResources(): BoardSceneResources {
  if (!shared || shared.asView().disposed()) shared = new ResourceLease(createResources);
  return shared.asView();
}

export function atlasGeometryKey(cell: AtlasCell): string {
  return atlasKey(cell);
}
