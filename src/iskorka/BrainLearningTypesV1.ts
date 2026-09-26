import type {
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
  confidence: number;
  lastWorldMinute: number;
}

export interface BrainLearningAttemptV1 {
  action: PortableHumanActionKindV1;
  targetObjectId?: string;
  startedWorldMinute: number;
  beforeSignals: Partial<Record<HumanBodySignalKindV1, number>>;
}

export interface BrainLearningStateV1 {
  version: typeof BRAIN_LEARNING_VERSION_V1;
  methods: BrainLearnedMethodV1[];
  pending?: BrainLearningAttemptV1;
}
