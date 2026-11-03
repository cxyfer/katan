/**
 * Registers the T&B scenario layout builders (and topologies) on import, so
 * the server and the client resolve the same boards.
 */

import { registerLayoutBuilder } from '../../layout-registry.ts';
import { registerTopologyDefinition } from '../../topology-registry.ts';
import { BARBARIANS_LAYOUT_ID, barbariansLayout } from './barbarians/board.ts';
import { FISHING_LAYOUT_ID, fishingLayout } from './fishing/board.ts';
import { TB_FRAME_TOPOLOGY } from './frame.ts';
import { RIVERS_LAYOUT_ID, riversLayout } from './rivers/board.ts';
import { TRADERS_LAYOUT_ID, TRADERS_TOPOLOGY, tradersLayout } from './traders/board.ts';
import { TRAINS_LAYOUT_ID, trainsLayout } from './trains/board.ts';

registerTopologyDefinition(TB_FRAME_TOPOLOGY);
registerTopologyDefinition(TRADERS_TOPOLOGY);
registerLayoutBuilder(FISHING_LAYOUT_ID, fishingLayout);
registerLayoutBuilder(RIVERS_LAYOUT_ID, riversLayout);
registerLayoutBuilder(TRAINS_LAYOUT_ID, trainsLayout);
registerLayoutBuilder(BARBARIANS_LAYOUT_ID, barbariansLayout);
registerLayoutBuilder(TRADERS_LAYOUT_ID, tradersLayout);
