/** Seafarers 的行動候選與免費路線候選。SF-1 先接上 stub，SF-2a 實作（造船、移船、Road Building）。 */

import type { BotModule } from '../types.ts';

export const seafarersActions: NonNullable<BotModule['actions']> = () => [];

/** 非空時取代 base 的選路，所以回 [] 才會沿用 base。 */
export const seafarersFreeRouteCandidates: NonNullable<BotModule['freeRouteCandidates']> = () => [];
