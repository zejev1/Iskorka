import { stableJsonStringify } from '../core/stableJson';

export const BRAIN_STATE_VERSION_V1 = 1 as const;
export const BRAIN_LOGICAL_BUDGET_BYTES_V1 = 256 * 1024;

export type BrainBudgetSectionV1 =
  | 'working'
  | 'recent'
  | 'significant'
  | 'knowledge'
  | 'identity'
  | 'metadata';

export const BRAIN_SECTION_TARGET_BYTES_V1: Readonly<Record<BrainBudgetSectionV1, number>> = {
  working: 8 * 1024,
  recent: 24 * 1024,
  significant: 64 * 1024,
  knowledge: 96 * 1024,
  identity: 48 * 1024,
  metadata: 16 * 1024,
};

export type BrainDatumSourceV1 =
  | 'self_observation'
  | 'message'
  | 'reading'
  | 'inference'
  | 'unknown_legacy';

export interface BrainDatumV1 {
  id: string;
  section: BrainBudgetSectionV1;
  kind: string;
  source: BrainDatumSourceV1;
  /**
   * Canonical compact payload owned by this brain. Stage 2 deliberately does
   * not interpret it as an autobiographical episode; later stages replace
   * legacy envelopes with native memory structures.
   */
  encoded: string;
}

export interface BrainWorkingStepV1 {
  stepId: string;
  startedWorldMinute: number;
  phase: 'perceiving' | 'considering' | 'acting' | 'waiting_outcome';
  action?: string;
  targetObjectId?: string;
}

export interface BrainMigrationStateV1 {
  schemaVersion: 1;
  importedLegacy: boolean;
  importedAtWorldMinute?: number;
  sourceWorldRevision?: number;
  importedDatumIds: string[];
}

export interface BrainStateV1 {
  version: typeof BRAIN_STATE_VERSION_V1;
  ownerAgentId: string;
  ownerGeneration: number;
  createdWorldMinute: number;
  rngState: number;
  workingStep?: BrainWorkingStepV1;
  data: BrainDatumV1[];
  migration: BrainMigrationStateV1;
}

const encoder = new TextEncoder();

export function logicalBrainBytesV1(brain: Readonly<BrainStateV1>): number {
  return encoder.encode(stableJsonStringify(brain)).byteLength;
}

export function brainBudgetRemainingBytesV1(brain: Readonly<BrainStateV1>): number {
  return Math.max(0, BRAIN_LOGICAL_BUDGET_BYTES_V1 - logicalBrainBytesV1(brain));
}

export function createBrainStateV1(
  ownerAgentId: string,
  ownerGeneration: number,
  rngState: number,
  worldMinute: number,
): BrainStateV1 {
  if (!ownerAgentId.trim()) throw new Error('Brain ownerAgentId must not be empty.');
  if (!Number.isInteger(ownerGeneration) || ownerGeneration < 0) {
    throw new Error('Brain ownerGeneration must be a non-negative integer.');
  }
  if (!Number.isSafeInteger(rngState)) throw new Error('Brain rngState must be a safe integer.');
  if (!Number.isFinite(worldMinute) || worldMinute < 0) {
    throw new Error('Brain createdWorldMinute must be finite and non-negative.');
  }
  const brain: BrainStateV1 = {
    version: BRAIN_STATE_VERSION_V1,
    ownerAgentId,
    ownerGeneration,
    createdWorldMinute: worldMinute,
    rngState,
    data: [],
    migration: {
      schemaVersion: 1,
      importedLegacy: false,
      importedDatumIds: [],
    },
  };
  assertBrainStateV1(brain);
  return brain;
}

export function assertBrainStateV1(brain: Readonly<BrainStateV1>): void {
  if (brain.version !== BRAIN_STATE_VERSION_V1) throw new Error('Unsupported BrainState version.');
  if (!brain.ownerAgentId.trim()) throw new Error('Brain owner is missing.');
  if (!Number.isInteger(brain.ownerGeneration) || brain.ownerGeneration < 0) {
    throw new Error('Brain owner generation is invalid.');
  }
  if (!Number.isSafeInteger(brain.rngState)) throw new Error('Brain RNG state is invalid.');
  if (!Number.isFinite(brain.createdWorldMinute) || brain.createdWorldMinute < 0) {
    throw new Error('Brain creation time is invalid.');
  }
  const ids = new Set<string>();
  for (const datum of brain.data) {
    if (!datum.id.trim() || ids.has(datum.id)) throw new Error('Brain datum IDs must be unique and non-empty.');
    ids.add(datum.id);
    if (!datum.kind.trim()) throw new Error(`Brain datum ${datum.id} has no kind.`);
    if (!datum.encoded.trim()) throw new Error(`Brain datum ${datum.id} has empty encoded content.`);
  }
  if (brain.workingStep) {
    if (!brain.workingStep.stepId.trim()) throw new Error('Brain working step has no ID.');
    if (!Number.isFinite(brain.workingStep.startedWorldMinute) || brain.workingStep.startedWorldMinute < 0) {
      throw new Error('Brain working step time is invalid.');
    }
  }
  const bytes = logicalBrainBytesV1(brain);
  if (bytes > BRAIN_LOGICAL_BUDGET_BYTES_V1) {
    throw new Error(`BrainState exceeds logical budget: ${bytes} > ${BRAIN_LOGICAL_BUDGET_BYTES_V1} bytes.`);
  }
}

export function tryStoreBrainDatumV1(
  brain: BrainStateV1,
  datum: BrainDatumV1,
): boolean {
  const existing = brain.data.find((item) => item.id === datum.id);
  if (existing) {
    if (stableJsonStringify(existing) !== stableJsonStringify(datum)) {
      throw new Error(`Brain datum ID ${datum.id} was reused with different content.`);
    }
    return true;
  }
  brain.data.push(datum);
  if (logicalBrainBytesV1(brain) > BRAIN_LOGICAL_BUDGET_BYTES_V1) {
    brain.data.pop();
    return false;
  }
  return true;
}

export function setBrainWorkingStepV1(
  brain: BrainStateV1,
  step: BrainWorkingStepV1 | undefined,
): boolean {
  const previous = brain.workingStep;
  if (step === undefined) delete brain.workingStep;
  else brain.workingStep = { ...step };
  if (logicalBrainBytesV1(brain) > BRAIN_LOGICAL_BUDGET_BYTES_V1) {
    if (previous === undefined) delete brain.workingStep;
    else brain.workingStep = previous;
    return false;
  }
  return true;
}

export function brainOwnerTokenV1(brain: Readonly<BrainStateV1>): string {
  return `${brain.ownerAgentId}:${brain.ownerGeneration}:v${brain.version}`;
}
