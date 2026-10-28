import {
  BufferGeometry,
  CylinderGeometry,
  MeshStandardMaterial,
  PlaneGeometry,
  SphereGeometry,
} from 'three';
import { playerColorHex, terrainFill } from '../terrain.ts';
import { createAtlasPlaneGeometry, HARBOR_ATLAS_CELLS, NUMBER_ATLAS_CELLS, type AtlasCell } from './atlas.ts';
import {
  createFieldGeometry,
  createGabledRoofGeometry,
  createHexTileSurfaces,
  createMountainGeometry,
  createMoundGeometry,
  createRobberCloakGeometry,
  createRobberHeadGeometry,
  createRobberHoodGeometry,
  createTokenBodyGeometry,
  createTreeCanopyGeometry,
  createTreeTrunkGeometry,
  createUnitBoxGeometry,
} from './model-geometry.ts';

export interface BoardSceneResources {
  acquire(): void;
  release(): void;
  readonly geometries: {
    readonly tileCap: BufferGeometry;
    readonly tileWall: BufferGeometry;
    readonly box: BufferGeometry;
    readonly roof: BufferGeometry;
    readonly token: BufferGeometry;
    readonly treeTrunk: BufferGeometry;
    readonly treeCanopy: BufferGeometry;
    readonly mountain: BufferGeometry;
    readonly mound: BufferGeometry;
    readonly field: BufferGeometry;
    readonly sheep: BufferGeometry;
    readonly wave: BufferGeometry;
    readonly robberCloak: BufferGeometry;
    readonly robberHead: BufferGeometry;
    readonly robberHood: BufferGeometry;
    readonly atlas: Readonly<Record<string, PlaneGeometry>>;
  };
  readonly materials: {
    readonly tileTop: Readonly<Record<string, MeshStandardMaterial>>;
    readonly tileSide: MeshStandardMaterial;
    readonly player: Readonly<Record<string, MeshStandardMaterial>>;
    readonly ghost: Readonly<Record<string, MeshStandardMaterial>>;
    readonly ghostRoof: MeshStandardMaterial;
    readonly roof: MeshStandardMaterial;
    readonly trim: MeshStandardMaterial;
    readonly token: MeshStandardMaterial;
    readonly forestTrunk: MeshStandardMaterial;
    readonly forestCanopy: MeshStandardMaterial;
    readonly mountain: MeshStandardMaterial;
    readonly dirt: MeshStandardMaterial;
    readonly field: MeshStandardMaterial;
    readonly sheep: MeshStandardMaterial;
    readonly wave: MeshStandardMaterial;
    readonly gold: MeshStandardMaterial;
    readonly robber: MeshStandardMaterial;
    readonly robberFace: MeshStandardMaterial;
    readonly harbor: MeshStandardMaterial;
  };
  readonly disposed: () => boolean;
}

const PLAYER_COLORS = ['red', 'blue', 'orange', 'white', 'green', 'brown', 'gray'] as const;
const TERRAINS = ['forest', 'hills', 'pasture', 'fields', 'mountains', 'desert', 'gold', 'sea'] as const;

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
  const tileTop = Object.fromEntries(TERRAINS.map((terrain) => [terrain, material(terrainFill(terrain), 0.9)]));
  const player = Object.fromEntries(PLAYER_COLORS.map((color) => [color, material(playerColorHex(color), 0.72)]));
  const ghost = Object.fromEntries(PLAYER_COLORS.map((color) => [color, ghostMaterial(playerColorHex(color))]));
  return {
    geometries: {
      tileCap: tile.cap,
      tileWall: tile.wall,
      box: createUnitBoxGeometry(),
      roof: createGabledRoofGeometry(),
      token: createTokenBodyGeometry(),
      treeTrunk: createTreeTrunkGeometry(),
      treeCanopy: createTreeCanopyGeometry(),
      mountain: createMountainGeometry(),
      mound: createMoundGeometry(),
      field: createFieldGeometry(),
      sheep: new SphereGeometry(0.065, 6, 4),
      wave: new CylinderGeometry(0.16, 0.16, 0.022, 12, 1, false, 0, Math.PI),
      robberCloak: createRobberCloakGeometry(),
      robberHead: createRobberHeadGeometry(),
      robberHood: createRobberHoodGeometry(),
      atlas: atlasGeometries,
    },
    materials: {
      tileTop,
      tileSide: material('#d4b778', 0.94),
      player,
      ghost,
      ghostRoof: ghostMaterial('#e4c88f'),
      roof: material('#4f3024', 0.94),
      trim: material('#f0dfba', 0.86),
      token: material('#e8d5ad', 0.88),
      forestTrunk: material('#6b4529', 0.96),
      forestCanopy: material('#315f3a', 0.95),
      mountain: material('#758184', 0.97),
      dirt: material('#b97953', 0.98),
      field: material('#c39a2d', 0.98),
      sheep: material('#f2ead6', 0.92),
      wave: material('#72a9c4', 0.68),
      gold: material('#b78b24', 0.52, 0.18),
      robber: material('#17191b', 0.9),
      robberFace: material('#050505', 1),
      harbor: material('#e9dcbf', 0.9),
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
