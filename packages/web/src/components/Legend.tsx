import { useT } from '../i18n/context.tsx';
import { ALL_TERRAIN, RESOURCE_GLYPH, TERRAIN_FILL, terrainLetter, terrainSymbol } from '../board/terrain.ts';
import { RESOURCES } from '@catan/rules';

/**
 * Legend: terrain letter + glyph + swatch, and resource glyph. Every entry is
 * identifiable from its letter/glyph alone, so colour is never the only cue
 * (docs/SPEC.md §8.1).
 */
export function Legend() {
  const t = useT();
  return (
    <details className="legend" data-testid="legend">
      <summary>{t('board.legend')}</summary>
      <div className="legend__grid">
        <section>
          <h3>{t('board.legendTerrain')}</h3>
          <ul>
            {ALL_TERRAIN.map((terrain) => (
              <li key={terrain}>
                <span
                  className="legend__swatch"
                  style={{ backgroundColor: TERRAIN_FILL[terrain] }}
                  aria-hidden="true"
                >
                  {terrainSymbol(terrain)}
                </span>
                <span>
                  {t(`terrain.${terrain}`)} · {terrainLetter(terrain)}
                </span>
              </li>
            ))}
          </ul>
        </section>
        <section>
          <h3>{t('board.legendResources')}</h3>
          <ul>
            {RESOURCES.map((resource) => (
              <li key={resource}>
                <span className="legend__swatch" aria-hidden="true">
                  {RESOURCE_GLYPH[resource]}
                </span>
                <span>{t(`resource.${resource}`)}</span>
              </li>
            ))}
          </ul>
        </section>
        <section>
          <h3>{t('board.legendPieces')}</h3>
          <ul>
            <li>
              <span aria-hidden="true">▲</span> {t('board.settlement')}
            </li>
            <li>
              <span aria-hidden="true">⬢</span> {t('board.city')}
            </li>
            <li>
              <span aria-hidden="true">▬</span> {t('board.road')}
            </li>
            <li>
              <span aria-hidden="true">◉</span> {t('board.robber')}
            </li>
          </ul>
        </section>
      </div>
    </details>
  );
}
