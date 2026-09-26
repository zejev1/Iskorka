import type { AgentState, WorldPlace, WorldState } from '../world/types';
import {
  invalidateBrainLogicalByteCacheV1,
  setBrainWorkingStepV1,
  tryStoreBrainDatumV1,
  type BrainStateV1,
} from './BrainStateV1';
import {
  brainForLiveOwnerV1,
  ensureBrainForAgentV1,
} from './BrainStateAdapterV1';
import { isReleasedFoundingSparkV1 } from './ReleasedSparkSurvivalV1';
import type { PerceptBatchV1 } from './PortableHumanCoreV1';

// Reconsider several times per day, not every few minutes across ten adults.
// This keeps decisions responsive to hunger/thirst without turning thought into
// the new performance bottleneck.
const REVIEW_INTERVAL = 180;
const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));

export type NativeSparkIntentKindV1 =
  | 'drink'
  | 'eat'
  | 'gather_food'
  | 'hunt'
  | 'fish'
  | 'rest'
  | 'work'
  | 'explore'
  | 'reflect';

export interface NativeSparkIntentV1 {
  kind: NativeSparkIntentKindV1;
  targetPlaceId?: string;
  targetPopulationId?: string;
  score: number;
  evidence: string[];
}

export interface GuidedPracticeExperienceV1 {
  domain: 'agriculture' | 'construction' | 'household' | 'survival';
  action: 'gather_food' | 'work' | 'fetch_water' | 'explore' | 'hunt' | 'fish';
  placeId: string;
  mentorId: string;
  worldMinute: number;
  succeeded: boolean;
  targetPopulationId?: string;
  targetSpecies?: string;
  harvested?: boolean;
  defensiveEncounter?: boolean;
}


function nextBrainUnit(brain: BrainStateV1): number {
  let x = brain.rngState >>> 0;
  if (x === 0) x = 0x6d2b79f5;
  x ^= x << 13;
  x ^= x >>> 17;
  x ^= x << 5;
  brain.rngState = x >>> 0;
  return brain.rngState / 0xffffffff;
}

function knownPlaces(
  world: Readonly<WorldState>,
  brain: Readonly<BrainStateV1>,
): WorldPlace[] {
  return (brain.perception?.references ?? [])
    .filter((ref) => ref.kind === 'place')
    .map((ref) => world.places[ref.worldObjectId])
    .filter((place): place is WorldPlace => Boolean(place));
}

export function guidedPracticeExperiencesV1(
  brain: Readonly<BrainStateV1>,
): GuidedPracticeExperienceV1[] {
  const result: GuidedPracticeExperienceV1[] = [];
  for (const datum of brain.data) {
    if (datum.kind !== 'mentor_guided_physical_practice') continue;
    try {
      const parsed = JSON.parse(datum.encoded) as GuidedPracticeExperienceV1;
      if (
        parsed &&
        typeof parsed.domain === 'string' &&
        typeof parsed.action === 'string' &&
        typeof parsed.placeId === 'string'
      ) result.push(parsed);
    } catch {
      // BrainState validation owns malformed data handling elsewhere.
    }
  }
  return result;
}

export function brainAcceptsGuidedPracticeV1(
  world: WorldState,
  student: AgentState,
  domain: GuidedPracticeExperienceV1['domain'],
): boolean {
  const brain = ensureBrainForAgentV1(world, student);
  if (!brain || student.life.ageYears < 8) return false;
  const ageConfidence = clamp01((student.life.ageYears - 8) / 6);
  const willingness = clamp01(
    0.34 +
      student.personality.curiosity * 0.2 +
      student.personality.diligence * 0.16 +
      student.mind.values.knowledge * 0.14 +
      student.mind.values.freedom * 0.08 +
      ageConfidence * 0.08,
  );
  const accepted = nextBrainUnit(brain) < willingness;
  setBrainWorkingStepV1(
    brain,
    accepted
      ? {
          stepId: `guided:${domain}:${Math.floor(world.calendar.elapsedWorldMinutes)}`,
          startedWorldMinute: world.calendar.elapsedWorldMinutes,
          phase: 'acting',
          action: `guided:${domain}`,
        }
      : undefined,
  );
  return accepted;
}

export function recordGuidedPracticeExperienceV1(
  world: WorldState,
  student: AgentState,
  experience: GuidedPracticeExperienceV1,
): boolean {
  const brain = ensureBrainForAgentV1(world, student);
  if (!brain) return false;
  const slot = Math.floor(experience.worldMinute / (30 * 24 * 60)) % 12;
  const id = `guided-practice:${experience.domain}:${experience.action}:${slot}`;
  brain.data = brain.data.filter(
    (datum) =>
      datum.kind !== 'mentor_guided_physical_practice' ||
      datum.id !== id,
  );
  invalidateBrainLogicalByteCacheV1(brain);
  const stored = tryStoreBrainDatumV1(brain, {
    id,
    section: 'significant',
    kind: 'mentor_guided_physical_practice',
    source: 'self_observation',
    encoded: JSON.stringify(experience),
  });
  setBrainWorkingStepV1(brain, undefined);
  return stored;
}

export function isNativeSparkChoiceEligibleV1(
  world: Readonly<WorldState>,
  agent: Readonly<AgentState>,
): boolean {
  if (!agent.life.alive || (agent.race ?? 'human') !== 'human') return false;
  if (isReleasedFoundingSparkV1(world, agent)) return true;
  // Ages 15-17 are a transition, not a second childhood. The same acquired
  // choice mechanism used after release is already allowed to operate while
  // mentors are still present as teachers/safety support.
  return Boolean(world.iskorkaMentorsV1?.active && agent.life.ageYears >= 15 && agent.life.ageYears < 18);
}

export function nextNativeSparkReviewBoundaryV1(
  world: Readonly<WorldState>,
  worldMinute: number,
): number {
  if (!Object.values(world.agents).some((agent) => isNativeSparkChoiceEligibleV1(world, agent))) {
    return Number.POSITIVE_INFINITY;
  }
  // One shared scheduler boundary for all eligible Sparks avoids N separate
  // world-time cuts per cycle. Individual choice still remains independent.
  return (Math.floor(Math.max(0, worldMinute) / REVIEW_INTERVAL) + 1) * REVIEW_INTERVAL;
}

export function nativeReviewDueV1(
  world: Readonly<WorldState>,
  agent: Readonly<AgentState>,
  worldMinute: number,
): boolean {
  return isNativeSparkChoiceEligibleV1(world, agent) &&
    Math.abs(worldMinute % REVIEW_INTERVAL) < 1e-7;
}

function weightedPick(
  brain: BrainStateV1,
  candidates: NativeSparkIntentV1[],
): NativeSparkIntentV1 | undefined {
  if (candidates.length === 0) return undefined;
  const best = Math.max(...candidates.map((candidate) => candidate.score));
  const weights = candidates.map((candidate) =>
    Math.exp((candidate.score - best) / 0.2),
  );
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  let roll = nextBrainUnit(brain) * total;
  for (let index = 0; index < candidates.length; index += 1) {
    roll -= weights[index];
    if (roll <= 0) return candidates[index];
  }
  return candidates[candidates.length - 1];
}


export function chooseReleasedSparkNativeIntentV1(
  world: WorldState,
  agent: AgentState,
  percept: Readonly<PerceptBatchV1>,
): NativeSparkIntentV1 | undefined {
  if (!isNativeSparkChoiceEligibleV1(world, agent) || agent.movement) return undefined;
  if (percept.ownerAgentId !== agent.id) return undefined;
  const brain =
    brainForLiveOwnerV1(world, agent.id, agent.life.generation) ??
    ensureBrainForAgentV1(world, agent);
  const body = world.v21?.bodiesByAgentId[agent.id];
  const core = body?.bodyCore;
  if (!brain || !body || !core) return undefined;

  // A choice that required travel remains the person's current intention until
  // they reach the remembered target and actually try it.  Without this,
  // every review could replace "go to the well and drink" with a fresh roll
  // immediately after arrival, producing pointless wandering and eventual
  // death despite correct lived knowledge.
  const pending = brain.workingStep;
  if (pending?.phase === 'waiting_outcome' && pending.action?.startsWith('native:')) {
    const kind = pending.action.slice('native:'.length) as NativeSparkIntentKindV1;
    if (['drink','gather_food','hunt','fish','work','explore'].includes(kind)) {
      const targetObjectId = pending.targetObjectId;
      const population = targetObjectId ? world.wildlife[targetObjectId] : undefined;
      const targetPlaceId = population?.habitatId ??
        (targetObjectId && world.places[targetObjectId] ? targetObjectId : undefined);
      if (targetPlaceId) {
        return {
          kind,
          targetPlaceId,
          ...(population ? { targetPopulationId: population.id } : {}),
          score: 10,
          evidence: ['pending:lived-intent'],
        };
      }
    }
    setBrainWorkingStepV1(brain, undefined);
  }

  const signal = (key: keyof PerceptBatchV1['body']['interoception']): number => {
    const sensed = percept.body.interoception[key];
    return sensed?.availability === 'available' ? sensed.intensity : 0;
  };
  const signals = {
    thirst: signal('thirst'), hunger: signal('hunger'), dryMouth: signal('dryMouth'),
    weakness: signal('weakness'), physicalDiscomfort: signal('physicalDiscomfort'),
  };
  const practice = guidedPracticeExperiencesV1(brain)
    .filter((experience) => experience.succeeded);
  const known = knownPlaces(world, brain);
  const current = world.places[agent.locationId];
  const candidates: NativeSparkIntentV1[] = [];

  const waterPractice = practice.filter((item) => item.action === 'fetch_water');
  const foodPractice = practice.filter((item) => item.action === 'gather_food');
  const workPractice = practice.filter((item) => item.action === 'work');
  const explorePractice = practice.filter((item) => item.action === 'explore');
  const huntPractice = practice.filter((item) => item.action === 'hunt');
  const fishPractice = practice.filter((item) => item.action === 'fish');

  const homeWater =
    current?.kind === 'home' &&
    (current.medievalInfrastructureV1?.waterReserveLitres ?? 0) > 0.2;
  const knownWell = known
    .filter((place) => place.kind === 'well')
    .sort(
      (left, right) =>
        Math.hypot(left.mapX - agent.position.x, left.mapY - agent.position.y) -
          Math.hypot(right.mapX - agent.position.x, right.mapY - agent.position.y),
    )[0];

  if ((current?.kind === 'well' || homeWater) && waterPractice.length > 0) {
    candidates.push({
      kind: 'drink',
      score: 0.22 + signals.thirst * 2.25 + signals.dryMouth * 0.36,
      evidence: ['body:thirst', 'lived:water'],
    });
  } else if (knownWell && waterPractice.length > 0) {
    candidates.push({
      kind: 'drink',
      targetPlaceId: knownWell.id,
      score: 0.14 + signals.thirst * 2.05 + signals.dryMouth * 0.32,
      evidence: ['body:thirst', 'lived:water'],
    });
  }

  const wallet = world.v19?.adventureEconomy.adventurersByAgentId[agent.id];
  const carriedFood =
    (wallet?.carriedGoods?.food ?? 0) +
    (wallet?.carriedGoods?.meat ?? 0);
  if (carriedFood > 0.001) {
    candidates.push({
      kind: 'eat',
      score:
        0.12 +
        signals.hunger * 1.48 +
        (1 - core.homeostasis.energyReserve) * 0.3,
      evidence: ['body:hunger', 'physical:carried-food'],
    });
  }

  const knownFoodPlace = known
    .filter(
      (place) =>
        place.kind === 'resource_field' ||
        place.kind === 'meadow' ||
        place.biome === 'plains',
    )
    .sort(
      (left, right) =>
        Math.hypot(left.mapX - agent.position.x, left.mapY - agent.position.y) -
          Math.hypot(right.mapX - agent.position.x, right.mapY - agent.position.y),
    )[0];
  if (knownFoodPlace && foodPractice.length > 0) {
    candidates.push({
      kind: 'gather_food',
      targetPlaceId: knownFoodPlace.id,
      score:
        0.05 +
        signals.hunger * 1.18 +
        (1 - core.homeostasis.energyReserve) * 0.24 +
        agent.skills.gathering * 0.24,
      evidence: ['body:hunger', 'lived:gather-food'],
    });
  }

  // Hunting and fishing only become candidate actions after the Spark has
  // physically attempted them while growing up.  The animal population is a
  // real target in world state, not a semantic "survival" lesson.
  const knownIds = new Set(known.map((place) => place.id));
  for (const lived of [...huntPractice, ...fishPractice]) {
    if (!knownIds.has(lived.placeId) && lived.placeId !== agent.locationId) continue;
    const population = lived.targetPopulationId
      ? world.wildlife[lived.targetPopulationId]
      : Object.values(world.wildlife).find(
          (candidate) =>
            candidate.habitatId === lived.placeId &&
            (lived.action === 'fish'
              ? candidate.species === 'fish'
              : ['rabbit', 'deer', 'boar', 'bird'].includes(candidate.species)),
        );
    if (!population || population.count <= 0 || population.isMonster) continue;
    const habitat = world.places[population.habitatId];
    if (!habitat) continue;
    const isFishing = lived.action === 'fish' || population.species === 'fish';
    candidates.push({
      kind: isFishing ? 'fish' : 'hunt',
      targetPlaceId: habitat.id,
      targetPopulationId: population.id,
      score:
        0.04 +
        signals.hunger * 1.12 +
        (1 - core.homeostasis.energyReserve) * 0.2 +
        agent.skills.hunting * 0.3 +
        agent.personality.riskTolerance * (isFishing ? 0.03 : 0.1) -
        population.threat * (isFishing ? 0.08 : 0.28) -
        signals.weakness * 0.42,
      evidence: [
        'body:hunger',
        isFishing ? 'lived:fishing' : 'lived:hunting',
        `wildlife:${population.species}`,
      ],
    });
  }

  if (agent.locationId === agent.homeId && (agent.energy < 0.52 || signals.weakness > 0.24)) {
    candidates.push({
      kind: 'rest',
      score:
        0.08 +
        (1 - agent.energy) * 1.08 +
        signals.weakness * 0.48 +
        signals.physicalDiscomfort * 0.18,
      evidence: ['body:fatigue'],
    });
  }

  const knownWorkshop = known.find((place) => place.kind === 'workshop');
  if (knownWorkshop && workPractice.length > 0) {
    candidates.push({
      kind: 'work',
      targetPlaceId: knownWorkshop.id,
      score:
        0.08 +
        agent.mind.values.ambition * 0.3 +
        agent.personality.diligence * 0.24 +
        agent.skills.craft * 0.18 -
        signals.weakness * 0.42,
      evidence: ['lived:work'],
    });
  }

  const exploredPlace = explorePractice.length > 0
    ? known.filter((place) => !['home', 'workshop', 'well'].includes(place.kind))
        .sort((a, b) => a.id.localeCompare(b.id))[0]
    : undefined;
  if (exploredPlace) {
    candidates.push({
      kind: 'explore',
      targetPlaceId: exploredPlace.id,
      score:
        0.04 +
        agent.personality.curiosity * 0.42 +
        agent.mind.values.freedom * 0.2 -
        signals.weakness * 0.5 -
        signals.thirst * 0.32 -
        signals.hunger * 0.24,
      evidence: ['lived:explore'],
    });
  }

  candidates.push({
    kind: 'reflect',
    score:
      0.06 +
      agent.personality.curiosity * 0.08 +
      agent.mind.values.knowledge * 0.08 +
      agent.stress * 0.08,
    evidence: ['self:uncertainty'],
  });

  const chosen = weightedPick(brain, candidates);
  if (!chosen) return undefined;
  setBrainWorkingStepV1(brain, {
    stepId: `native-intent:${Math.floor(world.calendar.elapsedWorldMinutes)}`,
    startedWorldMinute: world.calendar.elapsedWorldMinutes,
    phase: 'considering',
    action: chosen.kind,
    ...(chosen.targetPopulationId
      ? { targetObjectId: chosen.targetPopulationId }
      : chosen.targetPlaceId
        ? { targetObjectId: chosen.targetPlaceId }
        : {}),
  });
  return chosen;
}
