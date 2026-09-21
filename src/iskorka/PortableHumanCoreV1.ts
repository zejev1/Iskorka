import type { HumanBrainLifePhaseV1 } from './BrainLifecycleV1';

export const PORTABLE_HUMAN_CONTRACT_VERSION_V1 = 1 as const;

export type PortableHumanActionKindV1 =
  | 'rest'
  | 'relax'
  | 'walk'
  | 'gather'
  | 'hunt'
  | 'work'
  | 'socialize'
  | 'help'
  | 'explore'
  | 'reflect'
  | 'bond'
  | 'pray';

export type HumanBodySignalKindV1 =
  | 'thirst'
  | 'hunger'
  | 'breathlessness'
  | 'weakness'
  | 'coldStress'
  | 'heatStress'
  | 'sweating'
  | 'tremor'
  | 'heartPounding'
  | 'bladderUrge'
  | 'bowelUrge'
  | 'physicalDiscomfort'
  | 'cryingDrive'
  | 'tears'
  | 'blushing'
  | 'goosebumps'
  | 'dryMouth'
  | 'startle'
  | 'physicalPleasure'
  | 'sexualArousal'
  | 'postPleasureRelaxation';

export type SubjectiveSignalV1 =
  | { availability: 'available'; intensity: number }
  | { availability: 'unavailable' };

export interface HumanBodyPerceptV1 {
  version: typeof PORTABLE_HUMAN_CONTRACT_VERSION_V1;
  ownerAgentId: string;
  worldMinute: number;
  ageYears: number;
  brainLifePhase: HumanBrainLifePhaseV1;
  interoception: Record<HumanBodySignalKindV1, SubjectiveSignalV1>;
}

export type LocalObservationKindV1 = 'place' | 'person';

export interface LocalObservationV1 {
  objectId: string;
  kind: LocalObservationKindV1;
  relation: 'here' | 'connected_visible' | 'co_located';
  /** Human-readable labels are observations, not handles to hidden object data. */
  observedLabel?: string;
}

export interface ReceivedMessageV1 {
  messageId: string;
  senderObjectId?: string;
  symbols: readonly string[];
}

export interface PerceptBatchV1 {
  version: typeof PORTABLE_HUMAN_CONTRACT_VERSION_V1;
  ownerAgentId: string;
  worldMinute: number;
  body: HumanBodyPerceptV1;
  localObservations: readonly LocalObservationV1[];
  receivedMessages: readonly ReceivedMessageV1[];
  priorOutcome?: ActionOutcomeV1;
}

export interface ActionTargetV1 {
  kind: 'place' | 'person';
  objectId: string;
}

export interface ActionIntentV1 {
  version: typeof PORTABLE_HUMAN_CONTRACT_VERSION_V1;
  ownerAgentId: string;
  action: PortableHumanActionKindV1;
  target?: ActionTargetV1;
  maxWorldMinutes?: number;
  stopConditions: readonly (
    | 'body_limit'
    | 'target_missing'
    | 'new_danger'
    | 'material_change'
    | 'reconsider'
  )[];
}

export interface ActionOutcomeV1 {
  version: typeof PORTABLE_HUMAN_CONTRACT_VERSION_V1;
  ownerAgentId: string;
  action: PortableHumanActionKindV1;
  startedWorldMinute: number;
  finishedWorldMinute: number;
  status: 'completed' | 'blocked' | 'interrupted' | 'failed';
  perceivedEffects: readonly {
    channel: string;
    direction: 'better' | 'same' | 'worse' | 'unknown';
  }[];
}

/**
 * Stage-1 shell only. Acquired memory is deliberately absent until BrainBudget
 * owns it in the next stage.
 */
export interface PortableBrainCoreShellV1 {
  version: typeof PORTABLE_HUMAN_CONTRACT_VERSION_V1;
  ownerAgentId: string;
  generation: number;
  rngState: number;
  lastAcceptedPerceptWorldMinute?: number;
}

const assertUnit = (value: number, label: string): void => {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(`${label} must be finite in 0..1.`);
  }
};

export function availableSignalV1(intensity: number): SubjectiveSignalV1 {
  assertUnit(intensity, 'signal intensity');
  return { availability: 'available', intensity };
}

export function unavailableSignalV1(): SubjectiveSignalV1 {
  return { availability: 'unavailable' };
}

export function createPortableBrainCoreShellV1(
  ownerAgentId: string,
  generation: number,
  rngState: number,
): PortableBrainCoreShellV1 {
  if (!ownerAgentId.trim()) throw new Error('ownerAgentId must not be empty.');
  if (!Number.isInteger(generation) || generation < 0) {
    throw new Error('generation must be a non-negative integer.');
  }
  if (!Number.isSafeInteger(rngState)) {
    throw new Error('rngState must be a safe integer.');
  }
  return {
    version: PORTABLE_HUMAN_CONTRACT_VERSION_V1,
    ownerAgentId,
    generation,
    rngState,
  };
}

/**
 * Pure stage-1 boundary check. It advances only scheduler/ownership metadata;
 * no memory, belief, skill or action is fabricated here.
 */
export function acceptPerceptBatchV1(
  brain: PortableBrainCoreShellV1,
  batch: Readonly<PerceptBatchV1>,
): void {
  if (batch.version !== PORTABLE_HUMAN_CONTRACT_VERSION_V1) {
    throw new Error('Unsupported percept contract version.');
  }
  if (brain.ownerAgentId !== batch.ownerAgentId || batch.body.ownerAgentId !== batch.ownerAgentId) {
    throw new Error('Percept owner mismatch.');
  }
  if (!Number.isFinite(batch.worldMinute) || batch.worldMinute < 0) {
    throw new Error('Percept worldMinute is invalid.');
  }
  if (
    brain.lastAcceptedPerceptWorldMinute !== undefined &&
    batch.worldMinute < brain.lastAcceptedPerceptWorldMinute
  ) {
    throw new Error('Percepts must not move brain time backwards.');
  }
  brain.lastAcceptedPerceptWorldMinute = batch.worldMinute;
}
