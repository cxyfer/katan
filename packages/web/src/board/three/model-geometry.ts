import {
  BufferGeometry,
  ConeGeometry,
  CylinderGeometry,
  ExtrudeGeometry,
  Float32BufferAttribute,
  Shape,
  SphereGeometry,
} from 'three';

const TILE_OUTER_RADIUS = 0.982;
const TILE_DEPTH = 0.18;
const TILE_BEVEL = 0.008;
const CORNER_ANGLES = [30, 90, 150, 210, 270, 330].map((degrees) => (degrees * Math.PI) / 180);

/** Extruded pointy-top hex. Material group 0 is the cap, group 1 is the wall. */
export function createHexTileGeometry(): ExtrudeGeometry {
  const shape = new Shape();
  CORNER_ANGLES.forEach((angle, index) => {
    const x = Math.cos(angle) * TILE_OUTER_RADIUS;
    const y = Math.sin(angle) * TILE_OUTER_RADIUS;
    if (index === 0) shape.moveTo(x, y);
    else shape.lineTo(x, y);
  });
  shape.closePath();
  const geometry = new ExtrudeGeometry(shape, {
    depth: TILE_DEPTH,
    steps: 1,
    curveSegments: 1,
    bevelEnabled: true,
    bevelThickness: TILE_BEVEL,
    bevelSize: TILE_BEVEL,
    bevelSegments: 1,
  });
  // Extrusion starts toward +Z; rotating +90 degrees makes that direction -Y.
  // The shared tile origin is therefore the top surface at Y=0.
  geometry.rotateX(Math.PI / 2);
  geometry.translate(0, -TILE_BEVEL, 0);
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

function extractDrawRange(source: BufferGeometry, start: number, count: number): BufferGeometry {
  const geometry = new BufferGeometry();
  for (const name of ['position', 'normal', 'uv'] as const) {
    const attribute = source.getAttribute(name);
    const begin = start * attribute.itemSize;
    const end = (start + count) * attribute.itemSize;
    geometry.setAttribute(name, new Float32BufferAttribute(
      Array.from(attribute.array as ArrayLike<number>).slice(begin, end),
      attribute.itemSize,
    ));
  }
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

/**
 * Split the two material groups into independent geometries. Chromium omitted
 * instances when a single InstancedMesh received this geometry's material
 * array, so the scene owns one draw path per surface instead.
 */
export function createHexTileSurfaces(): { cap: BufferGeometry; wall: BufferGeometry } {
  const source = createHexTileGeometry();
  const capGroup = source.groups.find((group) => group.materialIndex === 0);
  const wallGroup = source.groups.find((group) => group.materialIndex === 1);
  if (!capGroup || !wallGroup) throw new Error('Hex tile material groups are incomplete');
  const cap = extractDrawRange(source, capGroup.start, capGroup.count);
  const wall = extractDrawRange(source, wallGroup.start, wallGroup.count);
  source.dispose();
  return { cap, wall };
}

/** Closed gable roof with a ridge along local Z, base at Y=0. */
export function createGabledRoofGeometry(): BufferGeometry {
  const vertices = [
    -0.5, 0, -0.5,  0.5, 0, -0.5,  0, 1, -0.5,
    -0.5, 0, 0.5,   0.5, 0, 0.5,   0, 1, 0.5,
  ];
  const indices = [
    0, 2, 1, 3, 4, 5,
    0, 3, 5, 0, 5, 2,
    1, 2, 5, 1, 5, 4,
    0, 1, 4, 0, 4, 3,
  ];
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(vertices, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

function groundedBox(width: number, height: number, depth: number): BufferGeometry {
  const geometry = new CylinderGeometry(1, 1, 1, 4, 1, false);
  // A four-sided cylinder is a closed tapered volume. Rotating it 45 degrees
  // aligns its flat faces with the building footprint.
  geometry.rotateY(Math.PI / 4);
  geometry.scale(width, height, depth);
  geometry.translate(0, height / 2, 0);
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  return geometry;
}

export function createUnitBoxGeometry(): BufferGeometry {
  const geometry = groundedBox(1, 1, 1);
  // Non-uniform instance scaling need not compound an already grounded scale.
  geometry.translate(0, -0.5, 0);
  geometry.computeBoundingBox();
  return geometry;
}

export function createTreeTrunkGeometry(): ConeGeometry {
  return new ConeGeometry(0.035, 0.22, 5).translate(0, 0.11, 0);
}

export function createTreeCanopyGeometry(): ConeGeometry {
  return new ConeGeometry(0.13, 0.28, 6).translate(0, 0.23, 0);
}

export function createMountainGeometry(): ConeGeometry {
  return new ConeGeometry(0.2, 0.32, 6).translate(0, 0.16, 0);
}

export function createMoundGeometry(): SphereGeometry {
  return new SphereGeometry(1, 7, 3, 0, Math.PI * 2, 0, Math.PI / 2);
}

export function createFieldGeometry(): BufferGeometry {
  const geometry = new CylinderGeometry(1, 1, 1, 4, 1, false);
  geometry.rotateY(Math.PI / 4);
  geometry.scale(0.28, 0.025, 0.055);
  geometry.translate(0, 0.0125, 0);
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  return geometry;
}

export function createTokenBodyGeometry(): CylinderGeometry {
  return new CylinderGeometry(0.205, 0.225, 0.035, 12, 1, false).translate(0, 0.0175, 0);
}

export function createRobberCloakGeometry(): ConeGeometry {
  return new ConeGeometry(0.19, 0.39, 7).translate(0, 0.195, 0);
}

export function createRobberHeadGeometry(): SphereGeometry {
  return new SphereGeometry(0.095, 7, 5).translate(0, 0.39, 0);
}

export function createRobberHoodGeometry(): ConeGeometry {
  return new ConeGeometry(0.14, 0.22, 7).translate(0, 0.455, 0);
}
