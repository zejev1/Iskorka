import type {
  AgentActionKind,
  AgentState,
  WorldState,
} from '../world/types';
import { allowedActionsForAgeV16 } from '../v16/SocietyFoundationV16';
import { residentDecisionReflection } from '../world/ResidentDecisionReflection';
import { bodySignalsV1 } from './BodyCoreV1';
import { brainDevelopmentProfileV1 } from './BrainLifecycleV1';

const MINUTE = 1;
const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));

export const AGENCY_REVIEW_MIN_WORLD_MINUTES = 30 * MINUTE;
export const AGENCY_REVIEW_MAX_WORLD_MINUTES = 180 * MINUTE;

export interface ResidentAgencyCadenceV1 {
  currentIntent?: AgentActionKind;
  dominantIntent?: AgentActionKind;
  consideredActionCount?: number;
  openness?: number;
  innerThought?: string;
  deliberationWorldMinutes?: number;
  intentSinceWorldMinute?: number;
  decisionWorldMinute?: number;
  lastReviewWorldMinute: number;
  nextReviewWorldMinute: number;
  reviewCount: number;
}

export interface ResidentIntentPreviewV1 {
  action: AgentActionKind;
  dominantAction: AgentActionKind;
  consideredActionCount: number;
  openness: number;
}

function stableUnit(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) / 0xffffffff;
}

/**
 * Stable human-scale cadence. It depends only on durable individual traits,
 * not on browser frame rate or how callers partition the same world time.
 */
export function agencyReviewIntervalV1(
  _world: Readonly<WorldState>,
  agent: Readonly<AgentState>,
): number {
  const temperament =
    agent.personality.diligence * 0.24 +
    agent.personality.resilience * 0.18 -
    agent.personality.curiosity * 0.18 -
    agent.personality.sociability * 0.12;
  const base = 0.5 + temperament * 0.34 +
    (stableUnit(`${agent.id}:agency-cadence`) - 0.5) * 0.34;
  return Math.round(
    AGENCY_REVIEW_MIN_WORLD_MINUTES +
    (AGENCY_REVIEW_MAX_WORLD_MINUTES - AGENCY_REVIEW_MIN_WORLD_MINUTES) *
      clamp01(base),
  );
}

function agencyScheduleV1(
  world: Readonly<WorldState>,
  agent: Readonly<AgentState>,
): {
  interval: number;
  index: number;
  reviewWorldMinute: number;
  nextWorldMinute: number;
} {
  const interval = agencyReviewIntervalV1(world, agent);
  const offset = Math.floor(
    stableUnit(`${world.id}:${agent.id}:agency-offset`) * interval,
  );
  const now = Math.max(0, world.calendar.elapsedWorldMinutes);
  const index = Math.max(0, Math.floor((now + offset) / interval));
  const reviewWorldMinute = Math.max(0, index * interval - offset);
  const nextWorldMinute = Math.max(
    reviewWorldMinute + 1,
    (index + 1) * interval - offset,
  );
  return { interval, index, reviewWorldMinute, nextWorldMinute };
}

/**
 * Side-effect-free current intention. It does not consume world RNG and never
 * writes plans, relationships, resources, knowledge or memories.
 */
export function previewResidentIntentV1(
  world: Readonly<WorldState>,
  agent: Readonly<AgentState>,
  reviewCount: number,
): ResidentIntentPreviewV1 {
  const allowed = allowedActionsForAgeV16(
    agent.race ?? 'human',
    agent.life.ageYears,
  );
  const body = world.v21?.bodiesByAgentId[agent.id];
  const signals = body?.bodyCore
    ? bodySignalsV1(agent, body, body.bodyCore)
    : undefined;

  const recover =
    (1 - agent.energy) * 0.72 +
    agent.stress * 0.28 +
    (signals?.weakness ?? 0) * 0.48 +
    (signals?.breathlessness ?? 0) * 0.34 +
    (signals?.physicalDiscomfort ?? 0) * 0.28;
  const resourceNeed =
    (1 - agent.resources) * 0.42 +
    (signals?.thirst ?? 0) * 0.52 +
    (signals?.hunger ?? 0) * 0.4;
  const socialNeed =
    (1 - agent.needs.belonging) * 0.62 +
    agent.personality.sociability * 0.18 +
    agent.socialDrive * 0.12;
  const purposeNeed = 1 - agent.needs.purpose;

  const scores: Array<{ action: AgentActionKind; score: number }> = [
    { action: 'rest', score: recover * 1.12 + (agent.goal.kind === 'recover' ? 0.22 : 0) },
    { action: 'relax', score: agent.stress * 0.62 + recover * 0.28 + agent.mind.emotions.grief * 0.18 },
    { action: 'walk', score: agent.personality.curiosity * 0.4 + agent.life.physiology.mobility * 0.2 + (1 - agent.stress) * 0.12 },
    { action: 'gather', score: resourceNeed * 0.9 + agent.personality.diligence * 0.22 + agent.skills.gathering * 0.16 },
    { action: 'hunt', score: resourceNeed * 0.68 + agent.skills.hunting * 0.25 + agent.personality.riskTolerance * 0.16 - agent.mind.emotions.fear * 0.22 },
    { action: 'work', score: purposeNeed * 0.52 + agent.personality.diligence * 0.46 + agent.skills.craft * 0.15 },
    { action: 'socialize', score: socialNeed * 0.9 + agent.mind.emotions.grief * 0.08 },
    { action: 'help', score: agent.personality.generosity * 0.58 + agent.mind.values.care * 0.32 + purposeNeed * 0.18 },
    { action: 'explore', score: agent.personality.curiosity * 0.58 + agent.personality.riskTolerance * 0.18 + agent.mind.values.freedom * 0.18 - recover * 0.35 },
    { action: 'reflect', score: agent.stress * 0.48 + purposeNeed * 0.3 + agent.mind.values.knowledge * 0.16 },
    { action: 'bond', score: socialNeed * 0.58 + agent.mind.values.care * 0.26 + agent.mind.emotions.hope * 0.12 },
    { action: 'pray', score: purposeNeed * 0.4 + agent.mind.values.tradition * 0.22 + agent.mind.emotions.awe * 0.2 },
  ];

  for (const item of scores) {
    if (!allowed.has(item.action)) {
      item.score = Number.NEGATIVE_INFINITY;
      continue;
    }
    item.score +=
      stableUnit(
        `${world.id}:${agent.id}:intent:${reviewCount}:${item.action}`,
      ) * 0.1 - 0.05;
  }

  const viable = scores
    .filter((item) => Number.isFinite(item.score))
    .sort((a, b) => b.score - a.score || a.action.localeCompare(b.action));
  const selected = viable[0] ?? { action: 'rest' as const, score: 0 };
  const second = viable[1]?.score ?? selected.score;
  const margin = Math.max(0, selected.score - second);

  return {
    action: selected.action,
    dominantAction: selected.action,
    consideredActionCount: viable.length,
    openness: clamp01(1 - margin / 0.6),
  };
}

/**
 * Pure snapshot projection. Same world state + same world minute always yields
 * the same current intention regardless of x1/x10 speed or advance partition.
 */
export function projectResidentAgencyCadenceV1(
  world: Readonly<WorldState>,
  agent: Readonly<AgentState>,
): ResidentAgencyCadenceV1 {
  const schedule = agencyScheduleV1(world, agent);
  const decision = previewResidentIntentV1(world, agent, schedule.index);
  const development = brainDevelopmentProfileV1(agent.life.ageYears);
  const reflection = development.adultLikeNarrativeReflection
    ? residentDecisionReflection(agent, decision)
    : undefined;
  return {
    currentIntent: decision.action,
    dominantIntent: decision.dominantAction,
    consideredActionCount: decision.consideredActionCount,
    openness: decision.openness,
    ...(reflection?.innerThought === undefined ? {} : { innerThought: reflection.innerThought }),
    ...(reflection?.deliberationWorldMinutes === undefined
      ? {}
      : { deliberationWorldMinutes: reflection.deliberationWorldMinutes }),
    intentSinceWorldMinute: schedule.reviewWorldMinute,
    decisionWorldMinute: schedule.reviewWorldMinute,
    lastReviewWorldMinute: schedule.reviewWorldMinute,
    nextReviewWorldMinute: schedule.nextWorldMinute,
    reviewCount: schedule.index,
  };
}

export function agencyIntentAtWorldTimeV1(
  world: Readonly<WorldState>,
  agent: Readonly<AgentState>,
): AgentActionKind | undefined {
  if (!agent.life.alive) return undefined;
  return projectResidentAgencyCadenceV1(world, agent).currentIntent;
}
