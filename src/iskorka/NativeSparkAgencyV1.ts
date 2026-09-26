import type { AgentState, WorldState } from '../world/types';
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


export interface NativeSparkChoiceContextV1 {
  ownerAgentId: string;
  worldMinute: number;
  currentPlaceId?: string;
  atHome: boolean;
  carriedFood: number;
  energy: number;
  stress: number;
  curiosity: number;
  diligence: number;
  riskTolerance: number;
  ambition: number;
  freedom: number;
  knowledge: number;
  gathering: number;
  hunting: number;
  craft: number;
}

export function chooseReleasedSparkNativeIntentV1(
  brain: BrainStateV1,
  percept: Readonly<PerceptBatchV1>,
  context: Readonly<NativeSparkChoiceContextV1>,
): NativeSparkIntentV1 | undefined {
  if (percept.ownerAgentId !== brain.ownerAgentId || context.ownerAgentId !== brain.ownerAgentId) return undefined;

  const practice = guidedPracticeExperiencesV1(brain)
    .filter((experience) => experience.succeeded);

  const pending = brain.workingStep;
  if (pending?.phase === 'waiting_outcome' && pending.action?.startsWith('native:')) {
    const kind = pending.action.slice('native:'.length) as NativeSparkIntentKindV1;
    const targetObjectId = pending.targetObjectId;
    const learned = targetObjectId
      ? practice.find((item) => item.targetPopulationId === targetObjectId || item.placeId === targetObjectId)
      : undefined;
    const targetPlaceId = learned?.placeId ?? targetObjectId;
    if (targetPlaceId && ['drink','gather_food','hunt','fish','work','explore'].includes(kind)) {
      return {
        kind,
        targetPlaceId,
        ...(learned?.targetPopulationId ? { targetPopulationId: learned.targetPopulationId } : {}),
        score: 10,
        evidence: ['pending:lived-intent'],
      };
    }
    setBrainWorkingStepV1(brain, undefined);
  }

  const signal = (key: keyof PerceptBatchV1['body']['interoception']): number => {
    const sensed = percept.body.interoception[key];
    return sensed?.availability === 'available' ? sensed.intensity : 0;
  };
  const thirst = signal('thirst');
  const hunger = signal('hunger');
  const dryMouth = signal('dryMouth');
  const weakness = signal('weakness');
  const discomfort = signal('physicalDiscomfort');
  const candidates: NativeSparkIntentV1[] = [];

  const waterPractice = practice.filter((item) => item.action === 'fetch_water');
  const foodPractice = practice.filter((item) => item.action === 'gather_food');
  const workPractice = practice.filter((item) => item.action === 'work');
  const explorePractice = practice.filter((item) => item.action === 'explore');
  const huntPractice = practice.filter((item) => item.action === 'hunt');
  const fishPractice = practice.filter((item) => item.action === 'fish');

  const waterHere = context.currentPlaceId
    ? waterPractice.find((item) => item.placeId === context.currentPlaceId)
    : undefined;
  const learnedWater = waterHere ?? waterPractice.at(-1);
  if (learnedWater) {
    candidates.push({
      kind: 'drink',
      ...(waterHere ? {} : { targetPlaceId: learnedWater.placeId }),
      score: 0.16 + thirst * 1.8 + dryMouth * 0.3,
      evidence: ['body:thirst', 'lived:water'],
    });
  }

  if (context.carriedFood > 0.001) {
    candidates.push({
      kind: 'eat',
      score: 0.1 + hunger * 1.45 + weakness * 0.22,
      evidence: ['body:hunger', 'perceived:self-carried-food'],
    });
  }

  const learnedFood = foodPractice.at(-1);
  if (learnedFood) {
    candidates.push({
      kind: 'gather_food',
      ...(learnedFood.placeId === context.currentPlaceId ? {} : { targetPlaceId: learnedFood.placeId }),
      score: 0.04 + hunger * 1.05 + context.gathering * 0.22 - weakness * 0.28,
      evidence: ['body:hunger', 'lived:gather-food'],
    });
  }

  for (const lived of [...huntPractice.slice(-2), ...fishPractice.slice(-2)]) {
    const fishing = lived.action === 'fish';
    candidates.push({
      kind: fishing ? 'fish' : 'hunt',
      ...(lived.placeId === context.currentPlaceId ? {} : { targetPlaceId: lived.placeId }),
      ...(lived.targetPopulationId ? { targetPopulationId: lived.targetPopulationId } : {}),
      score: 0.025 + hunger * 0.88 + context.hunting * 0.26 + context.riskTolerance * (fishing ? 0.03 : 0.08) - weakness * 0.38,
      evidence: ['body:hunger', fishing ? 'lived:fishing' : 'lived:hunting'],
    });
  }

  if (context.atHome && (context.energy < 0.52 || weakness > 0.24)) {
    candidates.push({
      kind: 'rest',
      score: 0.08 + (1 - context.energy) * 1.08 + weakness * 0.48 + discomfort * 0.18,
      evidence: ['body:fatigue'],
    });
  }

  const learnedWork = workPractice.at(-1);
  if (learnedWork) {
    candidates.push({
      kind: 'work',
      ...(learnedWork.placeId === context.currentPlaceId ? {} : { targetPlaceId: learnedWork.placeId }),
      score: 0.06 + context.ambition * 0.28 + context.diligence * 0.22 + context.craft * 0.16 - weakness * 0.38,
      evidence: ['lived:work'],
    });
  }

  const learnedExplore = explorePractice.at(-1);
  if (learnedExplore) {
    candidates.push({
      kind: 'explore',
      ...(learnedExplore.placeId === context.currentPlaceId ? {} : { targetPlaceId: learnedExplore.placeId }),
      score: 0.035 + context.curiosity * 0.38 + context.freedom * 0.18 - weakness * 0.46 - thirst * 0.3 - hunger * 0.22,
      evidence: ['lived:explore'],
    });
  }

  candidates.push({
    kind: 'reflect',
    score: 0.05 + context.curiosity * 0.08 + context.knowledge * 0.08 + context.stress * 0.06,
    evidence: ['self:uncertainty'],
  });

  const chosen = weightedPick(brain, candidates);
  if (!chosen) return undefined;
  setBrainWorkingStepV1(brain, {
    stepId: `native-intent:${Math.floor(context.worldMinute)}`,
    startedWorldMinute: context.worldMinute,
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
