import type {
  HumanEnvironmentalCueKindV1,
  HumanBodySignalKindV1,
  PortableHumanActionKindV1,
} from './PortableHumanCoreV1';

export const BRAIN_LEARNING_VERSION_V1 = 1 as const;
export const MAX_BRAIN_LEARNED_METHODS_V1 = 12;

export interface BrainLearnedMethodV1 {
  id: string;
  action: PortableHumanActionKindV1;
  targetObjectId?: string;
  trials: number;
  successes: number;
  failures: number;
  expectedSignalRelief: Partial<Record<HumanBodySignalKindV1, number>>;
  /** Body context in which this brain personally tried the method. */
  expectedContextSignals?: Partial<Record<HumanBodySignalKindV1, number>>;
  /** Nearby physical opportunities remembered from the same personal trial. */
  expectedContextCues?: Partial<Record<HumanEnvironmentalCueKindV1, number>>;
  /** Generic value of observed world effects, learned without action rules. */
  expectedExternalReward?: number;
  /** World changes this person observed after this method, kept by channel. */
  expectedWorldEffects?: Partial<Record<'world:food' | 'world:water', number>>;
  confidence: number;
  lastWorldMinute: number;
  /** Bounded public diary: full action trials stay in this method, not the global log. */
  lastJournaledWorldMinute?: number;
}

export interface BrainLearningAttemptV1 {
  action: PortableHumanActionKindV1;
  targetObjectId?: string;
  startedWorldMinute: number;
  beforeSignals: Partial<Record<HumanBodySignalKindV1, number>>;
  beforeCues?: Partial<Record<HumanEnvironmentalCueKindV1, number>>;
}

export interface BrainLearningStateV1 {
  version: typeof BRAIN_LEARNING_VERSION_V1;
  methods: BrainLearnedMethodV1[];
  pending?: BrainLearningAttemptV1;
  /** Per-person review cadence; the world can serve other residents independently. */
  lastReviewWorldMinute?: number;
  /** Persisted next wake for this person's learned-choice scheduler. */
  nextReviewWorldMinute?: number;
}
