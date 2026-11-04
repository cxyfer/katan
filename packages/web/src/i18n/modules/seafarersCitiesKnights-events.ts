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
        // A chase needs the pirate on a sea hex; fall back to neutral text
        // rather than inventing hex 0 if the parameter is ever missing.
        from: typeof p.hex === 'number' && Number.isInteger(p.hex)
          ? t(locale, 'sfck.pirate.atHex', { hex: p.hex })
          : t(locale, 'sfck.pirate.fromUnknown'),
      };
    default:
      return undefined;
  }
}
