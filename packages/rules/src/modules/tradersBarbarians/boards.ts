/**
 * Registers the T&B scenario layout builders (and topologies) on import, so
 * the server and the client resolve the same boards.
 */

import { registerLayoutBuilder } from '../../layout-registry.ts';
import { registerTopologyDefinition } from '../../topology-registry.ts';
import { FISHING_LAYOUT_ID, fishingLayout } from './fishing/board.ts';
import { TB_FRAME_TOPOLOGY } from './frame.ts';

registerTopologyDefinition(TB_FRAME_TOPOLOGY);
registerLayoutBuilder(FISHING_LAYOUT_ID, fishingLayout);
