import type {
  AgentActionKind,
  AgentState,
  WorldState,
} from '../world/types';
import { allowedActionsForAgeV16 } from '../v16/SocietyFoundationV16';
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
  /**
   * True when acceleration skipped many private reviews and only the latest
   * intention was reconstructed. Compressed intentions are informational and
   * do not bias the next heavyweight world action.
   */
  compressedCatchUp?: boolean;
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
  if (urgency >= 0.38) {
    return 15 + Math.round(stableUnit(`${agent.id}:urgent:${reviewCount}`) * 15);
  }
  if (urgency >= 0.26) {
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
  compressedCatchUp = false,
): ResidentAgencyCadenceV1 {
  const cadence = ensureResidentAgencyCadenceV1(world, agent);
  const now = world.calendar.elapsedWorldMinutes;
  if (cadence.currentIntent !== action) {
    cadence.currentIntent = action;
    cadence.intentSinceWorldMinute = now;
  }
  cadence.compressedCatchUp = compressedCatchUp;
  if (compressedCatchUp) {
    // High acceleration reconstructs only the latest private intention. Keep
    // this projection absolute-time based so 1×120 days and 120×1 day produce
    // byte-equivalent persisted state.
    const interval = 12 * HOUR;
    const index = Math.max(1, Math.floor(now / interval));
    cadence.reviewCount = index;
    cadence.lastReviewWorldMinute = index * interval;
    cadence.nextReviewWorldMinute = (index + 1) * interval;
    return cadence;
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
  return agent.agencyCadence?.compressedCatchUp
    ? undefined
    : agent.agencyCadence?.currentIntent;
}


export interface ResidentIntentPreviewV1 {
  action: AgentActionKind;
  dominantAction: AgentActionKind;
  consideredActionCount: number;
  openness: number;
}

/**
 * Cheap, side-effect-free human-scale intention preview. It deliberately does
 * not consume the world's RNG and does not mutate plans, relationships,
 * resources or knowledge. Heavy world execution later remains authoritative.
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
    const noise =
      stableUnit(`${world.id}:${agent.id}:intent:${reviewCount}:${item.action}`) *
        0.1 -
      0.05;
    item.score += noise;
    if (agent.agencyCadence?.currentIntent === item.action) item.score += 0.08;
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
