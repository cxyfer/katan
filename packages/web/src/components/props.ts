import type { TableController } from '../state/useTable.ts';

/** Every screen receives the same controller, so screens stay pure views. */
export interface ScreenProps {
  controller: TableController;
}
