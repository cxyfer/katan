/** 香料任務的外殼（E3）：先不提供航點與免費動作，由後續切片填入。 */

import type { Mission } from './index.ts';

export const spicesMission: Mission = {
  id: 'spices',
  targets: () => new Map(),
  here: () => false,
  free: () => null,
};
