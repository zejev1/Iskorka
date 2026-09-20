import type {
  AgentState,
  RelationshipState,
  V21BodyRegion,
  V21BodyState,
  WorldState,
} from '../world/types';
import {
  bodySignalsV1,
  ensureBodyCoreV1,
  type BodyActionKindV1,
} from './BodyCoreV1';

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));
const SEMANTIC_QUANTUM = 8_760;

export interface RegionalPainV1 {
  head: number;
  torso: number;
  arm: number;
  leg: number;
  dominantRegion?: V21BodyRegion;
  dominantPain: number;
}

export interface SocialTouchResponseV1 {
  agentId: string;
  kind: 'touch' | 'hug';
  valence: 'pleasant' | 'neutral' | 'unpleasant';
  comfort: number;
  pleasure: number;
  defensiveArousal: number;
}

export interface EliminationResultV1 {
  kinds: Array<'urinate' | 'defecate'>;
  bladderBefore: number;
  bowelBefore: number;
}

function stampBodyAction(
  world: Readonly<WorldState>,
  body: V21BodyState,
  kind: BodyActionKindV1,
  intensity: number,
): void {
  if (!body.bodyCore) return;
  body.bodyCore.lastBodyAction = {
    kind,
    worldMinute: world.calendar.elapsedWorldMinutes,
    intensity: clamp01(intensity),
  };
}

export function bodyRegionalPainV1(
  body: Readonly<V21BodyState>,
): RegionalPainV1 {
  const result: RegionalPainV1 = {
    head: 0,
    torso: 0,
    arm: 0,
    leg: 0,
    dominantPain: 0,
  };
  for (const wound of body.wounds) {
    const contribution = clamp01(
      wound.pain * 0.72 +
      wound.severity * 0.2 +
      (wound.kind === 'fracture' ? 0.12 : 0),
    );
    result[wound.region] = clamp01(
      result[wound.region] + contribution * (1 - result[wound.region] * 0.45),
    );
  }
  const ordered = (['head', 'torso', 'arm', 'leg'] as V21BodyRegion[])
    .map((region) => ({ region, pain: result[region] }))
    .sort((a, b) => b.pain - a.pain);
  if (ordered[0]?.pain > 0) {
    result.dominantRegion = ordered[0].region;
    result.dominantPain = ordered[0].pain;
  }
  return result;
}

export function recordBodyMealV1(
  world: WorldState,
  agent: AgentState,
  portion: number,
): number {
  const body = world.v21?.bodiesByAgentId[agent.id];
  if (!body) return 0;
  const core = ensureBodyCoreV1(world, agent, body);
  if (!core) return 0;
  const amount = clamp01(portion);
  core.homeostasis.stomachFill = clamp01(
    core.homeostasis.stomachFill + amount * 0.72,
  );
  core.homeostasis.energyReserve = clamp01(
    core.homeostasis.energyReserve + amount * 0.16,
  );
  core.homeostasis.bowelLoad = clamp01(
    core.homeostasis.bowelLoad + amount * 0.08,
  );
  core.homeostasis.nausea = clamp01(
    core.homeostasis.nausea - amount * 0.04,
  );
  stampBodyAction(world, body, 'eat', amount);
  return amount;
}

export function recordBodyDrinkV1(
  world: WorldState,
  agent: AgentState,
  amountInput = 0.24,
): number {
  const body = world.v21?.bodiesByAgentId[agent.id];
  if (!body) return 0;
  const core = ensureBodyCoreV1(world, agent, body);
  if (!core) return 0;
  const amount = clamp01(amountInput);
  const before = core.homeostasis.hydration;
  core.homeostasis.hydration = clamp01(
    core.homeostasis.hydration + amount * 0.58,
  );
  core.homeostasis.electrolyteDeviation *= 0.72;
  core.homeostasis.bladderFill = clamp01(
    core.homeostasis.bladderFill + amount * 0.28,
  );
  core.homeostasis.dizziness = clamp01(
    core.homeostasis.dizziness - amount * 0.08,
  );
  stampBodyAction(world, body, 'drink', amount);
  return Math.max(0, core.homeostasis.hydration - before);
}

/**
 * Elimination is not a six-day mind decision. At high urge the body performs
 * the short maintenance act between ordinary decisions. No event history is
 * required; the latest body action and current fill levels are enough.
 */
export function resolveBodyEliminationV1(
  world: WorldState,
  agent: AgentState,
): EliminationResultV1 {
  const body = world.v21?.bodiesByAgentId[agent.id];
  const core = body?.bodyCore;
  if (!body || !core || !agent.life.alive || agent.movement) {
    return { kinds: [], bladderBefore: core?.homeostasis.bladderFill ?? 0, bowelBefore: core?.homeostasis.bowelLoad ?? 0 };
  }
  const bladderBefore = core.homeostasis.bladderFill;
  const bowelBefore = core.homeostasis.bowelLoad;
  const kinds: Array<'urinate' | 'defecate'> = [];

  if (bladderBefore >= 0.84) {
    core.homeostasis.bladderFill = 0.08;
    kinds.push('urinate');
    stampBodyAction(world, body, 'urinate', bladderBefore);
  }
  if (bowelBefore >= 0.9) {
    core.homeostasis.bowelLoad = 0.14;
    kinds.push('defecate');
    stampBodyAction(world, body, 'defecate', bowelBefore);
  }
  return { kinds, bladderBefore, bowelBefore };
}

/**
 * Adds load from movement that actually happened in continuous physical time.
 * It does not simulate footsteps, breaths or heartbeats.
 */
export function recordBodyMovementV1(
  world: WorldState,
  agent: AgentState,
  movedWorldMinutes: number,
  intensityInput = 0.55,
): void {
  if (!(movedWorldMinutes > 0)) return;
  const body = world.v21?.bodiesByAgentId[agent.id];
  if (!body) return;
  const core = ensureBodyCoreV1(world, agent, body);
  if (!core) return;
  const intensity = clamp01(intensityInput);
  const dose = Math.max(0, Math.min(1.5, movedWorldMinutes / SEMANTIC_QUANTUM));
  const regionalPain = bodyRegionalPainV1(body);
  const legPenalty = regionalPain.leg * 0.28;
  const torsoPenalty = regionalPain.torso * 0.18;
  const enduranceRelief = agent.life.physiology.endurance * 0.32;

  core.homeostasis.exertionDebt = clamp01(
    core.homeostasis.exertionDebt +
      dose * intensity * (0.23 + legPenalty + torsoPenalty - enduranceRelief * 0.15),
  );
  core.homeostasis.muscleFatigue = clamp01(
    core.homeostasis.muscleFatigue +
      dose * intensity * (0.2 + legPenalty + (1 - agent.life.physiology.strength) * 0.12),
  );
  core.homeostasis.oxygenDebt = clamp01(
    core.homeostasis.oxygenDebt +
      dose * intensity * (0.16 + torsoPenalty),
  );
  core.homeostasis.cardiovascularLoad = clamp01(
    core.homeostasis.cardiovascularLoad +
      dose * intensity * 0.18,
  );
  core.homeostasis.respiratoryLoad = clamp01(
    core.homeostasis.respiratoryLoad +
      dose * intensity * 0.17,
  );
}

function touchResponseFor(
  world: WorldState,
  actor: AgentState,
  partner: AgentState,
  relationship: Readonly<RelationshipState>,
  kind: 'touch' | 'hug',
  accepted: boolean,
): SocialTouchResponseV1 | undefined {
  const body = world.v21?.bodiesByAgentId[actor.id];
  if (!body) return undefined;
  const core = ensureBodyCoreV1(world, actor, body);
  if (!core) return undefined;
  const signals = bodySignalsV1(actor, body, core);
  const safety = clamp01(
    relationship.trust * 0.38 +
    relationship.affinity * 0.34 +
    relationship.respect * 0.16 -
    relationship.conflict * 0.32 -
    actor.mind.emotions.fear * 0.12,
  );
  const physicalComfort = clamp01(
    1 - signals.physicalDiscomfort * 0.62 - body.pain * 0.28,
  );
  const contactStrength = kind === 'hug' ? 1 : 0.58;

  let comfort = 0;
  let pleasure = 0;
  let defensiveArousal = 0;
  let valence: SocialTouchResponseV1['valence'] = 'neutral';

  if (accepted) {
    comfort = clamp01(
      contactStrength *
      (0.22 + safety * 0.48 + physicalComfort * 0.3),
    );
    pleasure = clamp01(
      comfort * (0.35 + safety * 0.34),
    );
    valence = comfort >= 0.42 ? 'pleasant' : 'neutral';
    core.homeostasis.physicalPleasure = Math.max(
      core.homeostasis.physicalPleasure,
      pleasure,
    );
    core.homeostasis.muscleTension = clamp01(
      core.homeostasis.muscleTension - comfort * 0.08,
    );
  } else {
    defensiveArousal = clamp01(
      contactStrength * (0.38 + (1 - safety) * 0.5),
    );
    valence = 'unpleasant';
    core.homeostasis.autonomicArousal = Math.max(
      core.homeostasis.autonomicArousal,
      defensiveArousal,
    );
    core.homeostasis.muscleTension = Math.max(
      core.homeostasis.muscleTension,
      defensiveArousal * 0.72,
    );
  }

  stampBodyAction(world, body, kind, accepted ? comfort : defensiveArousal);
  return {
    agentId: actor.id,
    kind,
    valence,
    comfort,
    pleasure,
    defensiveArousal,
  };
}

/**
 * Contextual body response to touch that has already been socially accepted
 * or declined. It never changes relationship values or decides consent.
 */
export function recordSocialTouchBodyResponseV1(
  world: WorldState,
  a: AgentState,
  b: AgentState,
  relationship: Readonly<RelationshipState>,
  kind: 'touch' | 'hug',
  accepted: boolean,
): SocialTouchResponseV1[] {
  const responses = [
    touchResponseFor(world, a, b, relationship, kind, accepted),
    touchResponseFor(world, b, a, relationship, kind, accepted),
  ].filter((value): value is SocialTouchResponseV1 => value !== undefined);
  return responses;
}
