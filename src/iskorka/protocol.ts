import type { WorldState } from '../world/types';

export const MINUTES_PER_SECOND = {
  realtime: 1 / 60,
  slow: 1440 / 60,
  normal: 525600 / 60,
  fast: 525600 * 10 / 60,
} as const;
export type Speed = keyof typeof MINUTES_PER_SECOND;
export type WorldCommand =
  | { type: 'init'; seed: string; paused: boolean; speed: Speed }
  | { type: 'pause'; paused: boolean }
  | { type: 'speed'; speed: Speed }
  | { type: 'snapshot' }
  | { type: 'reset'; seed: string; operationId: string }
  | { type: 'advance'; minutes: number };
export type WorldFrame = {
  type: 'frame'; world: WorldState; paused: boolean; speed: Speed;
  wallMs: number; simulatedMinutes: number; saved: true;
};
export type WorldMessage = WorldFrame | { type: 'error'; message: string } | { type: 'ready' };

/** Commands do not accept world state, resident intent, gifts, interventions, or code. */
export function validateCommand(raw: unknown): WorldCommand {
  if (!raw || typeof raw !== 'object') throw new Error('Команда должна быть объектом.');
  const c = raw as Record<string, unknown>;
  switch (c.type) {
    case 'init':
      if (typeof c.seed !== 'string' || !c.seed.trim() || c.seed.length > 128 || typeof c.paused !== 'boolean' || !(typeof c.speed === 'string' && Object.hasOwn(MINUTES_PER_SECOND,c.speed))) break;
      return { type: 'init', seed: c.seed, paused: c.paused, speed: c.speed as Speed };
    case 'pause': if (typeof c.paused === 'boolean') return { type: 'pause', paused: c.paused }; break;
    case 'speed': if (typeof c.speed === 'string' && Object.hasOwn(MINUTES_PER_SECOND,c.speed)) return { type: 'speed', speed: c.speed as Speed }; break;
    case 'snapshot': return { type: 'snapshot' };
    case 'reset':
      if (typeof c.seed === 'string' && c.seed.trim() && c.seed.length <= 128 && typeof c.operationId === 'string' && c.operationId.length > 0 && c.operationId.length <= 128) return { type: 'reset', seed: c.seed, operationId: c.operationId };
      break;
    case 'advance':
      // Bounded deterministic stepping for inspection; no state edits.
      if (typeof c.minutes === 'number' && Number.isFinite(c.minutes) && c.minutes > 0 && c.minutes <= 525600) return { type: 'advance', minutes: c.minutes };
  }
  throw new Error('Неизвестная или некорректная команда мира.');
}
