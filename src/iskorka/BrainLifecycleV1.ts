export const BRAIN_LIFECYCLE_VERSION_V1 = 1 as const;

export type HumanBrainLifePhaseV1 =
  | 'newborn'
  | 'infant'
  | 'toddler'
  | 'child'
  | 'adolescent'
  | 'adult'
  | 'older_adult'
  | 'late_life';

export interface BrainLifecycleOptionsV1 {
  /** Processing/network integrity. Age alone does not imply dementia. */
  neurologicalIntegrity?: number;
  /** Stored long-term information integrity. Separate from retrieval speed. */
  memoryIntegrity?: number;
}

export interface BrainDevelopmentProfileV1 {
  version: typeof BRAIN_LIFECYCLE_VERSION_V1;
  phase: HumanBrainLifePhaseV1;
  workingMemory: number;
  attentionControl: number;
  episodicEncoding: number;
  semanticLearning: number;
  proceduralLearning: number;
  receptiveLanguage: number;
  expressiveLanguage: number;
  symbolicReasoning: number;
  planning: number;
  retrievalReliability: number;
  retrievalSpeed: number;
  learningPlasticity: number;
  /** Existing consolidated experience is not erased merely because age rose. */
  consolidatedExperienceIntegrity: number;
  /** Prevents adult canned prose from being shown as an infant/child's thought. */
  adultLikeNarrativeReflection: boolean;
}

export interface NewbornBrainSeedV1 {
  version: typeof BRAIN_LIFECYCLE_VERSION_V1;
  ownerAgentId: string;
  createdWorldMinute: number;
  innate: {
    reflexes: true;
    interoception: true;
    sensoryLearning: true;
    associativeLearning: true;
  };
  acquired: {
    episodes: [];
    concepts: [];
    skills: [];
    lexicon: [];
    personModels: [];
    promises: [];
  };
}

type Anchor = Omit<
  BrainDevelopmentProfileV1,
  'version' | 'phase' | 'consolidatedExperienceIntegrity' | 'adultLikeNarrativeReflection'
> & { ageYears: number };

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));

/*
 * Functional calibration, not a medical diagnostic scale. Development is
 * deliberately gradual: a 9-month infant can recognize patterns and some
 * familiar words, but has essentially no adult symbolic speech/planning.
 * Normal aging slows learning/retrieval modestly; severe decline requires a
 * separate loss of neurological or memory integrity rather than age alone.
 */
const ANCHORS: readonly Anchor[] = [
  { ageYears: 0, workingMemory: 0.02, attentionControl: 0.02, episodicEncoding: 0.03, semanticLearning: 0.02, proceduralLearning: 0.10, receptiveLanguage: 0.00, expressiveLanguage: 0.00, symbolicReasoning: 0.00, planning: 0.00, retrievalReliability: 0.03, retrievalSpeed: 0.10, learningPlasticity: 1.00 },
  { ageYears: 0.5, workingMemory: 0.08, attentionControl: 0.08, episodicEncoding: 0.12, semanticLearning: 0.10, proceduralLearning: 0.42, receptiveLanguage: 0.08, expressiveLanguage: 0.00, symbolicReasoning: 0.01, planning: 0.01, retrievalReliability: 0.12, retrievalSpeed: 0.28, learningPlasticity: 1.00 },
  { ageYears: 0.75, workingMemory: 0.12, attentionControl: 0.13, episodicEncoding: 0.18, semanticLearning: 0.16, proceduralLearning: 0.55, receptiveLanguage: 0.18, expressiveLanguage: 0.02, symbolicReasoning: 0.03, planning: 0.02, retrievalReliability: 0.18, retrievalSpeed: 0.35, learningPlasticity: 1.00 },
  { ageYears: 1, workingMemory: 0.17, attentionControl: 0.18, episodicEncoding: 0.24, semanticLearning: 0.24, proceduralLearning: 0.64, receptiveLanguage: 0.30, expressiveLanguage: 0.08, symbolicReasoning: 0.06, planning: 0.04, retrievalReliability: 0.24, retrievalSpeed: 0.42, learningPlasticity: 1.00 },
  { ageYears: 2, workingMemory: 0.31, attentionControl: 0.34, episodicEncoding: 0.42, semanticLearning: 0.47, proceduralLearning: 0.75, receptiveLanguage: 0.58, expressiveLanguage: 0.46, symbolicReasoning: 0.20, planning: 0.12, retrievalReliability: 0.42, retrievalSpeed: 0.56, learningPlasticity: 1.00 },
  { ageYears: 3, workingMemory: 0.42, attentionControl: 0.46, episodicEncoding: 0.54, semanticLearning: 0.60, proceduralLearning: 0.82, receptiveLanguage: 0.74, expressiveLanguage: 0.68, symbolicReasoning: 0.34, planning: 0.22, retrievalReliability: 0.54, retrievalSpeed: 0.66, learningPlasticity: 0.99 },
  { ageYears: 5, workingMemory: 0.56, attentionControl: 0.62, episodicEncoding: 0.68, semanticLearning: 0.74, proceduralLearning: 0.88, receptiveLanguage: 0.88, expressiveLanguage: 0.84, symbolicReasoning: 0.55, planning: 0.38, retrievalReliability: 0.68, retrievalSpeed: 0.76, learningPlasticity: 0.96 },
  { ageYears: 8, workingMemory: 0.70, attentionControl: 0.76, episodicEncoding: 0.80, semanticLearning: 0.84, proceduralLearning: 0.92, receptiveLanguage: 0.95, expressiveLanguage: 0.93, symbolicReasoning: 0.70, planning: 0.56, retrievalReliability: 0.80, retrievalSpeed: 0.84, learningPlasticity: 0.91 },
  { ageYears: 12, workingMemory: 0.82, attentionControl: 0.86, episodicEncoding: 0.88, semanticLearning: 0.90, proceduralLearning: 0.95, receptiveLanguage: 0.98, expressiveLanguage: 0.97, symbolicReasoning: 0.82, planning: 0.72, retrievalReliability: 0.88, retrievalSpeed: 0.90, learningPlasticity: 0.86 },
  { ageYears: 16, workingMemory: 0.93, attentionControl: 0.94, episodicEncoding: 0.95, semanticLearning: 0.96, proceduralLearning: 0.98, receptiveLanguage: 1.00, expressiveLanguage: 1.00, symbolicReasoning: 0.95, planning: 0.90, retrievalReliability: 0.95, retrievalSpeed: 0.97, learningPlasticity: 0.80 },
  { ageYears: 18, workingMemory: 0.98, attentionControl: 0.98, episodicEncoding: 0.98, semanticLearning: 0.98, proceduralLearning: 1.00, receptiveLanguage: 1.00, expressiveLanguage: 1.00, symbolicReasoning: 0.98, planning: 0.96, retrievalReliability: 0.98, retrievalSpeed: 0.99, learningPlasticity: 0.76 },
  { ageYears: 30, workingMemory: 1.00, attentionControl: 1.00, episodicEncoding: 1.00, semanticLearning: 1.00, proceduralLearning: 1.00, receptiveLanguage: 1.00, expressiveLanguage: 1.00, symbolicReasoning: 1.00, planning: 1.00, retrievalReliability: 1.00, retrievalSpeed: 1.00, learningPlasticity: 0.70 },
  { ageYears: 55, workingMemory: 0.96, attentionControl: 0.97, episodicEncoding: 0.95, semanticLearning: 0.96, proceduralLearning: 0.98, receptiveLanguage: 1.00, expressiveLanguage: 1.00, symbolicReasoning: 0.99, planning: 0.98, retrievalReliability: 0.96, retrievalSpeed: 0.91, learningPlasticity: 0.62 },
  { ageYears: 70, workingMemory: 0.91, attentionControl: 0.93, episodicEncoding: 0.89, semanticLearning: 0.92, proceduralLearning: 0.95, receptiveLanguage: 0.99, expressiveLanguage: 0.99, symbolicReasoning: 0.97, planning: 0.95, retrievalReliability: 0.91, retrievalSpeed: 0.82, learningPlasticity: 0.54 },
  { ageYears: 85, workingMemory: 0.82, attentionControl: 0.86, episodicEncoding: 0.80, semanticLearning: 0.86, proceduralLearning: 0.91, receptiveLanguage: 0.98, expressiveLanguage: 0.97, symbolicReasoning: 0.93, planning: 0.88, retrievalReliability: 0.84, retrievalSpeed: 0.70, learningPlasticity: 0.44 },
  { ageYears: 100, workingMemory: 0.70, attentionControl: 0.76, episodicEncoding: 0.67, semanticLearning: 0.77, proceduralLearning: 0.84, receptiveLanguage: 0.94, expressiveLanguage: 0.91, symbolicReasoning: 0.86, planning: 0.78, retrievalReliability: 0.74, retrievalSpeed: 0.57, learningPlasticity: 0.34 },
] as const;

function phaseForAge(ageYears: number): HumanBrainLifePhaseV1 {
  if (ageYears < 0.08) return 'newborn';
  if (ageYears < 1.5) return 'infant';
  if (ageYears < 3) return 'toddler';
  if (ageYears < 12) return 'child';
  if (ageYears < 18) return 'adolescent';
  if (ageYears < 65) return 'adult';
  if (ageYears < 85) return 'older_adult';
  return 'late_life';
}

function interpolate(ageYears: number): Anchor {
  if (ageYears <= ANCHORS[0].ageYears) return ANCHORS[0];
  const last = ANCHORS[ANCHORS.length - 1];
  if (ageYears >= last.ageYears) return last;
  for (let index = 1; index < ANCHORS.length; index += 1) {
    const right = ANCHORS[index];
    if (ageYears > right.ageYears) continue;
    const left = ANCHORS[index - 1];
    const t = (ageYears - left.ageYears) / (right.ageYears - left.ageYears);
    const mix = (key: Exclude<keyof Anchor, 'ageYears'>): number =>
      left[key] + (right[key] - left[key]) * t;
    return {
      ageYears,
      workingMemory: mix('workingMemory'),
      attentionControl: mix('attentionControl'),
      episodicEncoding: mix('episodicEncoding'),
      semanticLearning: mix('semanticLearning'),
      proceduralLearning: mix('proceduralLearning'),
      receptiveLanguage: mix('receptiveLanguage'),
      expressiveLanguage: mix('expressiveLanguage'),
      symbolicReasoning: mix('symbolicReasoning'),
      planning: mix('planning'),
      retrievalReliability: mix('retrievalReliability'),
      retrievalSpeed: mix('retrievalSpeed'),
      learningPlasticity: mix('learningPlasticity'),
    };
  }
  return last;
}

export function brainDevelopmentProfileV1(
  ageYears: number,
  options: BrainLifecycleOptionsV1 = {},
): BrainDevelopmentProfileV1 {
  if (!Number.isFinite(ageYears) || ageYears < 0) {
    throw new Error('ageYears must be finite and non-negative.');
  }
  const neurologicalIntegrity = options.neurologicalIntegrity ?? 1;
  const memoryIntegrity = options.memoryIntegrity ?? 1;
  if (!Number.isFinite(neurologicalIntegrity) || neurologicalIntegrity < 0 || neurologicalIntegrity > 1) {
    throw new Error('neurologicalIntegrity must be finite in 0..1.');
  }
  if (!Number.isFinite(memoryIntegrity) || memoryIntegrity < 0 || memoryIntegrity > 1) {
    throw new Error('memoryIntegrity must be finite in 0..1.');
  }
  const base = interpolate(ageYears);
  const processing = 0.18 + neurologicalIntegrity * 0.82;
  const learning = 0.30 + neurologicalIntegrity * 0.70;
  const profile: BrainDevelopmentProfileV1 = {
    version: BRAIN_LIFECYCLE_VERSION_V1,
    phase: phaseForAge(ageYears),
    workingMemory: clamp01(base.workingMemory * processing),
    attentionControl: clamp01(base.attentionControl * processing),
    episodicEncoding: clamp01(base.episodicEncoding * learning * memoryIntegrity),
    semanticLearning: clamp01(base.semanticLearning * learning * memoryIntegrity),
    proceduralLearning: clamp01(base.proceduralLearning * (0.45 + neurologicalIntegrity * 0.55)),
    receptiveLanguage: clamp01(base.receptiveLanguage * processing),
    expressiveLanguage: clamp01(base.expressiveLanguage * processing),
    symbolicReasoning: clamp01(base.symbolicReasoning * processing),
    planning: clamp01(base.planning * processing),
    retrievalReliability: clamp01(base.retrievalReliability * (0.25 + neurologicalIntegrity * 0.75) * memoryIntegrity),
    retrievalSpeed: clamp01(base.retrievalSpeed * processing),
    learningPlasticity: clamp01(base.learningPlasticity * learning),
    consolidatedExperienceIntegrity: clamp01(memoryIntegrity),
    adultLikeNarrativeReflection: false,
  };
  profile.adultLikeNarrativeReflection =
    ageYears >= 12 &&
    profile.expressiveLanguage >= 0.90 &&
    profile.symbolicReasoning >= 0.78 &&
    profile.planning >= 0.65;
  return profile;
}

export function createBlankNewbornBrainSeedV1(
  ownerAgentId: string,
  createdWorldMinute: number,
): NewbornBrainSeedV1 {
  if (!ownerAgentId.trim()) throw new Error('ownerAgentId must not be empty.');
  if (!Number.isFinite(createdWorldMinute) || createdWorldMinute < 0) {
    throw new Error('createdWorldMinute must be finite and non-negative.');
  }
  return {
    version: BRAIN_LIFECYCLE_VERSION_V1,
    ownerAgentId,
    createdWorldMinute,
    innate: {
      reflexes: true,
      interoception: true,
      sensoryLearning: true,
      associativeLearning: true,
    },
    acquired: {
      episodes: [],
      concepts: [],
      skills: [],
      lexicon: [],
      personModels: [],
      promises: [],
    },
  };
}
