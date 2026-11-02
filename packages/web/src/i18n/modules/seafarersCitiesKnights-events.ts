/** Display parameters for the Seafarers + Cities & Knights events (see `../events.ts`). */

import type { Locale } from '@catan/protocol';
import type { GameEvent } from '@catan/rules';
import { t } from '../index.ts';

type NameResolver = (playerId: string) => string;

const num = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) ? value : 0);
const str = (value: unknown): string => (typeof value === 'string' ? value : '');

export function seafarersCitiesKnightsEventParams(locale: Locale, event: GameEvent, nameOf: NameResolver): Record<string, unknown> | undefined {
  const p = event.params ?? {};
  switch (event.type) {
    case 'sfck.knightChasedPirate':
      return {
        player: nameOf(str(p.playerId)),
        vertex: num(p.vertex),
        from: t(locale, 'sfck.pirate.atHex', { hex: num(p.hex) }),
      };
    default:
      return undefined;
  }
}
