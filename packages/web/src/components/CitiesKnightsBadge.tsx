import { useT } from '../i18n/context.tsx';
import type { CitiesKnightsModuleView } from '../board/citiesKnights.ts';
import { BarbarianShip, EventDieFace } from './SvgCitiesKnights.tsx';
import '../styles/cities-knights.css';

/** Compact table status on the board: barbarian distance, strengths and the event die. */
export function CitiesKnightsBadge({ ck }: { ck: CitiesKnightsModuleView | null }) {
  const t = useT();
  if (!ck) return null;
  const left = Math.max(0, ck.barbarian.length - ck.barbarian.position);
  const label = t('ck.badge.label', { left, barbarians: ck.barbarianStrength, defenders: ck.defenderStrength });
  return (
    <div className="ck-badge" data-testid="ck-badge" data-position={ck.barbarian.position} role="status" aria-label={label} title={label}>
      <svg viewBox="-24 -24 48 40" width="34" height="28" aria-hidden="true"><BarbarianShip size={0.8} /></svg>
      <span className="ck-badge__pips" aria-hidden="true">
        {Array.from({ length: ck.barbarian.length }, (_, index) => (
          <span key={index} className="ck-badge__pip" data-passed={index < ck.barbarian.position ? 'true' : undefined} />
        ))}
      </span>
      <span className="ck-badge__strength" aria-hidden="true">{ck.barbarianStrength}<small>⚔</small>{ck.defenderStrength}</span>
      {ck.lastRoll && <EventDieFace face={ck.lastRoll.event} size={26} testId="ck-badge-event" />}
    </div>
  );
}
