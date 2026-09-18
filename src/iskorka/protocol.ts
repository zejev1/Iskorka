import type { WorldState } from '../world/types';
import type { WorldEvent } from '../world/events';
import type { WorldSpeedId } from '../world/WorldClock';
export type IskorkaCommand =
  | { type: 'boot'; seed: string }
  | { type: 'play' | 'pause' | 'save' }
  | { type: 'speed'; speed: WorldSpeedId }
  | { type: 'reset'; seed: string; operationId: string };
export interface IskorkaFrame {
  world: WorldState; recentEvents: WorldEvent[]; resumed: boolean;
  running: boolean; speed: WorldSpeedId; capacityLimited: boolean; workMs: number;
}
export type IskorkaMessage =
  | { type: 'frame'; frame: IskorkaFrame }
  | { type: 'saved'; revision: number }
  | { type: 'error'; message: string };
