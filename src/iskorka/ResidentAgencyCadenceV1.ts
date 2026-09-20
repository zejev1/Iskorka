import type {
  AgentActionKind,
  AgentState,
  WorldState,
} from '../world/types';
import { bodySignalsV1 } from './BodyCoreV1';

const MINUTE = 1;
const HOUR = 60;
const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));

export const ROUTINE_REVIEW_MIN_WORLD_MINUTES = 30 * MINUTE;
export const ROUTINE_REVIEW_MAX_WORLD_MINUTES = 3 * HOUR;
export const MAJOR_REVIEW_MIN_WORLD_MINUTES = 2 * HOUR;
export const MAJOR_REVIEW_MAX_WORLD_MINUTES = 8 * HOUR;

export interface ResidentAgencyCadenceV1 {
  currentIntent?: AgentActionKind;
  intentSinceWorldMinute?: number;
  lastReviewWorldMinute: number;
  nextReviewWorldMinute: number;
  reviewCount: number;
}

function stableUnit(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) / 0xffffffff;
}

function bodyUrgency(
  world: Readonly<WorldState>,
  agent: Readonly<AgentState>,
): number {
  const body = world.v21?.bodiesByAgentId[agent.id];
  const core = body?.bodyCore;
  if (!body || !core) {
    return clamp01(
      (1 - agent.energy) * 0.45 +
      agent.stress * 0.3 +
      (1 - agent.resources) * 0.25,
    );
  }
  const signals = bodySignalsV1(agent, body, core);
  return clamp01(
    signals.weakness * 0.22 +
    signals.breathlessness * 0.14 +
    signals.physicalDiscomfort * 0.18 +
    signals.thirst * 0.18 +
    signals.hunger * 0.12 +
    Math.max(signals.coldStress, signals.heatStress) * 0.08 +
    agent.stress * 0.08,
  );
}

export function agencyReviewIntervalV1(
  world: Readonly<WorldState>,
  agent: Readonly<AgentState>,
  currentIntent?: AgentActionKind,
  reviewCount = 0,
): number {
  const urgency = bodyUrgency(world, agent);
  // Strong body signals can interrupt an intention quickly, but ordinary
  // residents do not invent a new major life decision every simulated minute.
  if (urgency >= 0.78) {
    return 15 + Math.round(stableUnit(`${agent.id}:urgent:${reviewCount}`) * 15);
  }
  if (urgency >= 0.58) {
    return 30 + Math.round(stableUnit(`${agent.id}:body:${reviewCount}`) * 30);
  }

  const routine = currentIntent === 'rest' ||
    currentIntent === 'relax' ||
    currentIntent === 'walk' ||
    currentIntent === 'socialize' ||
    currentIntent === 'reflect' ||
    currentIntent === 'pray';
  const min = routine
    ? ROUTINE_REVIEW_MIN_WORLD_MINUTES
    : MAJOR_REVIEW_MIN_WORLD_MINUTES;
  const max = routine
    ? ROUTINE_REVIEW_MAX_WORLD_MINUTES
    : MAJOR_REVIEW_MAX_WORLD_MINUTES;
  const temperament =
    agent.personality.diligence * 0.22 +
    agent.personality.resilience * 0.18 -
    agent.personality.curiosity * 0.14 -
    agent.personality.sociability * 0.08;
  const roll = stableUnit(`${agent.id}:review:${reviewCount}`);
  const fraction = clamp01(roll * 0.62 + 0.24 + temperament);
  return Math.round(min + (max - min) * fraction);
}

export function ensureResidentAgencyCadenceV1(
  world: Readonly<WorldState>,
  agent: AgentState,
): ResidentAgencyCadenceV1 {
  const existing = agent.agencyCadence;
  if (existing) return existing;
  const now = world.calendar.elapsedWorldMinutes;
  const initialOffset =
    20 + Math.round(stableUnit(`${world.id}:${agent.id}:agency-start`) * 70);
  const created: ResidentAgencyCadenceV1 = {
    currentIntent: agent.lastDecision?.action,
    intentSinceWorldMinute:
      agent.lastDecision ? now : undefined,
    lastReviewWorldMinute: now,
    nextReviewWorldMinute: now + initialOffset,
    reviewCount: 0,
  };
  agent.agencyCadence = created;
  return created;
}

export function scheduleNextResidentAgencyReviewV1(
  world: Readonly<WorldState>,
  agent: AgentState,
  action: AgentActionKind,
): ResidentAgencyCadenceV1 {
  const cadence = ensureResidentAgencyCadenceV1(world, agent);
  const now = world.calendar.elapsedWorldMinutes;
  if (cadence.currentIntent !== action) {
    cadence.currentIntent = action;
    cadence.intentSinceWorldMinute = now;
  }
  cadence.lastReviewWorldMinute = now;
  cadence.reviewCount += 1;
  cadence.nextReviewWorldMinute =
    now + agencyReviewIntervalV1(world, agent, action, cadence.reviewCount);
  return cadence;
}

export function deferResidentAgencyReviewV1(
  world: Readonly<WorldState>,
  agent: AgentState,
  worldMinutes: number,
): ResidentAgencyCadenceV1 {
  const cadence = ensureResidentAgencyCadenceV1(world, agent);
  const now = world.calendar.elapsedWorldMinutes;
  cadence.lastReviewWorldMinute = now;
  cadence.nextReviewWorldMinute = now + Math.max(5, worldMinutes);
  return cadence;
}

export function nextResidentAgencyReviewWorldMinuteV1(
  world: Readonly<WorldState>,
): number | undefined {
  let next = Number.POSITIVE_INFINITY;
  for (const agent of Object.values(world.agents)) {
    if (!agent.life.alive) continue;
    const cadence = agent.agencyCadence;
    if (!cadence) return world.calendar.elapsedWorldMinutes;
    next = Math.min(next, cadence.nextReviewWorldMinute);
  }
  return Number.isFinite(next) ? next : undefined;
}

export function agencyIntentV1(
  agent: Readonly<AgentState>,
): AgentActionKind | undefined {
  return agent.agencyCadence?.currentIntent;
}
