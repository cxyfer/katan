import type { CardKind } from '@catan/rules';
import { isCommodityCard as isCommodity } from '../board/citiesKnights.ts';
import { ResourceGlyph } from './GameArt.tsx';
import { ResourceCardArt } from './ResourceCardArt.tsx';
import { CommodityCardArt, CommodityEmblem } from './SvgCitiesKnights.tsx';

/** Card face for any hand card: a resource, or a Cities & Knights commodity. */
export function CardKindArt({ card }: { card: CardKind }) {
  return isCommodity(card) ? <CommodityCardArt commodity={card} /> : <ResourceCardArt resource={card} />;
}

/** Small glyph for any hand card. */
export function CardKindGlyph({ card, size }: { card: CardKind; size: number }) {
  return isCommodity(card) ? <CommodityEmblem commodity={card} size={size} /> : <ResourceGlyph resource={card} size={size} />;
}
