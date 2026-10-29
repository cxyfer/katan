import { BoxGeometry, CylinderGeometry, IcosahedronGeometry, SphereGeometry, TorusGeometry, type BufferGeometry } from 'three';
import { ModelBuilder } from './diorama-geometry.ts';

/** A hooded traveller with a face, folded cloak, boots, staff and stolen goods. */
export function createRobberModel(): BufferGeometry {
  const model = new ModelBuilder();
  const cloak = '#354449';
  const fold = '#253439';
  const leather = '#855f3d';
  model.add(new CylinderGeometry(0.18, 0.19, 0.025, 10), '#485052', [0, 0.0125, 0]);
  for (const x of [-0.075, 0.075]) {
    model.add(new BoxGeometry(0.09, 0.065, 0.145), '#40392e', [x, 0.06, 0.018]);
  }
  model.add(new CylinderGeometry(0.098, 0.18, 0.46, 9), cloak, [0, 0.31, 0]);
  for (const [x, z] of [[-0.11, 0.08], [-0.035, 0.135], [0.055, 0.128], [0.13, 0.05]]) {
    model.add(new CylinderGeometry(0.012, 0.027, 0.34, 3), fold, [x!, 0.29, z!], [1, 1, 0.5]);
  }
  model.add(new SphereGeometry(1, 8, 4), cloak, [0, 0.54, 0], [0.145, 0.105, 0.115]);
  model.add(new CylinderGeometry(0.107, 0.113, 0.027, 9), leather, [0, 0.453, 0]);
  model.add(new BoxGeometry(0.041, 0.036, 0.012), '#c4a05d', [0, 0.452, 0.115]);
  model.add(new BoxGeometry(0.02, 0.018, 0.014), fold, [0, 0.452, 0.121]);
  for (const side of [-1, 1]) {
    model.add(new SphereGeometry(1, 6, 4), cloak, [side * 0.143, 0.51, 0.025],
      [0.056, 0.14, 0.065], [0, 0, side * 0.33]);
    model.add(new IcosahedronGeometry(0.041, 0), '#c7a27b', [side * 0.18, 0.41, 0.069]);
  }
  model.add(new SphereGeometry(1, 8, 5), fold, [0, 0.718, -0.025], [0.15, 0.183, 0.145]);
  model.add(new SphereGeometry(1, 7, 4), '#bd9977', [0, 0.717, 0.098], [0.086, 0.112, 0.052]);
  model.add(new BoxGeometry(0.16, 0.033, 0.027), '#1e2e34', [0, 0.755, 0.133]);
  for (const x of [-0.035, 0.035]) {
    model.add(new BoxGeometry(0.022, 0.012, 0.011), '#ece2c6', [x, 0.755, 0.15]);
    model.add(new BoxGeometry(0.008, 0.013, 0.013), '#253439', [x + 0.002, 0.755, 0.155]);
  }
  model.add(new IcosahedronGeometry(1, 0), '#c9a785', [0, 0.724, 0.153], [0.023, 0.03, 0.025]);
  model.add(new SphereGeometry(1, 7, 3), cloak, [0, 0.643, 0.091], [0.1, 0.032, 0.065]);
  model.add(new TorusGeometry(0.097, 0.015, 3, 8, Math.PI), '#596466',
    [0, 0.721, 0.109], [1, 1.22, 1]);
  // The satchel and walking staff make the figure readable at board scale.
  model.add(new IcosahedronGeometry(1, 1), '#a18a5d', [-0.185, 0.41, -0.035], [0.085, 0.115, 0.078]);
  model.add(new CylinderGeometry(0.032, 0.044, 0.054, 5), '#6c6544', [-0.19, 0.514, -0.035]);
  model.add(new TorusGeometry(0.035, 0.007, 3, 6), '#c8b986', [-0.19, 0.522, -0.035],
    [1, 1, 1], [Math.PI / 2, 0, 0]);
  model.add(new CylinderGeometry(0.012, 0.016, 0.73, 5), leather, [0.21, 0.385, 0.085], [1, 1, 1], [0, 0, -0.045]);
  model.add(new IcosahedronGeometry(0.03, 0), '#b39a6d', [0.226, 0.763, 0.085]);
  return model.build();
}
