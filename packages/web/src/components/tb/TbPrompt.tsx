import type { ComponentType } from 'react';
import type { TableController } from '../../state/useTable.ts';
import { BaStealChoice, KnightMovesChoice, TreasonChoice } from './BarbariansSection.tsx';
import { FishSwapChoice } from './FishingSection.tsx';
import { WagonBidChoice } from './TrainsSection.tsx';

/** Choice UIs for T&B pending frames, by frame kind. */
const CHOICES: Readonly<Record<string, ComponentType<{ controller: TableController }>>> = {
  'tradersBarbarians.fishSwap': FishSwapChoice,
  'tradersBarbarians.wagonBid': WagonBidChoice,
  'tradersBarbarians.baKnights': KnightMovesChoice,
  'tradersBarbarians.baSteal': BaStealChoice,
  'tradersBarbarians.baTreason': TreasonChoice,
};

/**
 * Rendered inside the mandatory-response prompt for the viewer's own T&B
 * frame, so the choice can never be hidden behind a closed panel.
 */
export function TbPrompt({ controller }: { controller: TableController }) {
  const pending = controller.state.game?.view.pending;
  const selfId = controller.state.session?.id ?? null;
  if (!pending || !('module' in pending) || pending.module !== 'tradersBarbarians') return null;
  if (!selfId || !pending.responders.includes(selfId)) return null;
  const Choice = CHOICES[pending.kind];
  return Choice ? <div className="tb-prompt" data-testid="tb-prompt"><Choice controller={controller} /></div> : null;
}
