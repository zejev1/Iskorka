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

export type BrainPerceivedObjectKindV1 = 'place' | 'person' | 'remains';

export interface BrainPerceptionReferenceV1 {
  refId: string;
  worldObjectId: string;
  kind: BrainPerceivedObjectKindV1;
  firstAcquiredWorldMinute: number;
  lastAcquiredWorldMinute: number;
  recognitionConfidence: number;
  /** For remains only; this is an observed physical link, not access to the dead person's brain. */
  subjectWorldObjectId?: string;
}

export interface BrainCurrentObservationV1 {
  refId: string;
  kind: BrainPerceivedObjectKindV1;
  relation: 'here' | 'connected_visible' | 'co_located';
  channel: 'vision';
  confidence: number;
  observedAction?: string;
  eventKind?: 'apparent_death';
  subjectRefId?: string;
}

export interface BrainPerceivedMessageV1 {
  messageId: string;
  receivedWorldMinute: number;
  channel: 'hearing' | 'reading';
  confidence: number;
  symbols: string[];
  senderRefId?: string;
  subjectRefId?: string;
  eventKind?: 'death_report';
}

export interface BrainPerceptionStateV1 {
  nextRefSequence: number;
  references: BrainPerceptionReferenceV1[];
  lastPerceptWorldMinute?: number;
  /** Bounded acquired messages; current body/vision input stays transient. */
  recentMessages: BrainPerceivedMessageV1[];
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
  perception?: BrainPerceptionStateV1;
  data: BrainDatumV1[];
  migration: BrainMigrationStateV1;
}

const encoder = new TextEncoder();
const logicalByteCache = new WeakMap<object, number>();
const logicalBaseByteCache = new WeakMap<object, number>();

const BRAIN_PACKET_FIXED_LOGICAL_BYTES_V1 = 192;
const BRAIN_DATUM_FIXED_LOGICAL_BYTES_V1 = 24;
const BRAIN_WORKING_STEP_FIXED_LOGICAL_BYTES_V1 = 32;
const BRAIN_PERCEPTION_FIXED_LOGICAL_BYTES_V1 = 48;
const BRAIN_PERCEPTION_REFERENCE_FIXED_LOGICAL_BYTES_V1 = 32;
const BRAIN_MESSAGE_FIXED_LOGICAL_BYTES_V1 = 28;
const BRAIN_IMPORTED_ID_FIXED_LOGICAL_BYTES_V1 = 4;

const utf8BytesV1 = (value: string): number => encoder.encode(value).byteLength;

/**
 * Logical brain bytes are an explicit allocator, not JSON file size or JS heap
 * size. Every acquired payload byte is charged once, together with bounded
 * metadata/index overhead. This keeps the 256 KiB ceiling exact and cheap even
 * when the persistent representation later changes.
 */
export function brainDatumLogicalBytesV1(datum: Readonly<BrainDatumV1>): number {
  return (
    BRAIN_DATUM_FIXED_LOGICAL_BYTES_V1 +
    utf8BytesV1(datum.id) +
    utf8BytesV1(datum.section) +
    utf8BytesV1(datum.kind) +
    utf8BytesV1(datum.source) +
    utf8BytesV1(datum.encoded)
  );
}

function workingStepLogicalBytesV1(
  step: Readonly<BrainWorkingStepV1> | undefined,
): number {
  if (!step) return 0;
  return (
    BRAIN_WORKING_STEP_FIXED_LOGICAL_BYTES_V1 +
    utf8BytesV1(step.stepId) +
    utf8BytesV1(step.phase) +
    utf8BytesV1(step.action ?? '') +
    utf8BytesV1(step.targetObjectId ?? '')
  );
}


function perceptionLogicalBytesV1(
  perception: Readonly<BrainPerceptionStateV1> | undefined,
): number {
  if (!perception) return 0;
  let bytes = BRAIN_PERCEPTION_FIXED_LOGICAL_BYTES_V1;
  for (const ref of perception.references) {
    bytes +=
      BRAIN_PERCEPTION_REFERENCE_FIXED_LOGICAL_BYTES_V1 +
      utf8BytesV1(ref.refId) +
      utf8BytesV1(ref.worldObjectId) +
      utf8BytesV1(ref.kind) +
      utf8BytesV1(ref.subjectWorldObjectId ?? '');
  }
  for (const message of perception.recentMessages) {
    bytes +=
      BRAIN_MESSAGE_FIXED_LOGICAL_BYTES_V1 +
      utf8BytesV1(message.messageId) +
      utf8BytesV1(message.channel) +
      utf8BytesV1(message.senderRefId ?? '') +
      utf8BytesV1(message.subjectRefId ?? '') +
      utf8BytesV1(message.eventKind ?? '');
    for (const symbol of message.symbols) bytes += 2 + utf8BytesV1(symbol);
  }
  return bytes;
}

export function invalidateBrainLogicalByteCacheV1(brain: Readonly<BrainStateV1>): void {
  logicalByteCache.delete(brain as object);
  logicalBaseByteCache.delete(brain as object);
}

export function invalidateBrainPerceptionByteCacheV1(brain: Readonly<BrainStateV1>): void {
  logicalByteCache.delete(brain as object);
}

function logicalBrainBaseBytesV1(brain: Readonly<BrainStateV1>): number {
  const cached = logicalBaseByteCache.get(brain as object);
  if (cached !== undefined) return cached;
  const bytes =
    BRAIN_PACKET_FIXED_LOGICAL_BYTES_V1 +
    utf8BytesV1(brain.ownerAgentId) +
    workingStepLogicalBytesV1(brain.workingStep) +
    brain.data.reduce(
      (sum, datum) => sum + brainDatumLogicalBytesV1(datum),
      0,
    ) +
    brain.migration.importedDatumIds.reduce(
      (sum, id) =>
        sum + BRAIN_IMPORTED_ID_FIXED_LOGICAL_BYTES_V1 + utf8BytesV1(id),
      0,
    );
  logicalBaseByteCache.set(brain as object, bytes);
  return bytes;
}

export function logicalBrainBytesV1(brain: Readonly<BrainStateV1>): number {
  const cached = logicalByteCache.get(brain as object);
  if (cached !== undefined) return cached;
  const bytes =
    logicalBrainBaseBytesV1(brain) +
    perceptionLogicalBytesV1(brain.perception);
  logicalByteCache.set(brain as object, bytes);
  return bytes;
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
  if (brain.perception) {
    if (!Number.isInteger(brain.perception.nextRefSequence) || brain.perception.nextRefSequence < 1) {
      throw new Error('Brain perception nextRefSequence is invalid.');
    }
    const refIds = new Set<string>();
    const objectIds = new Set<string>();
    for (const ref of brain.perception.references) {
      if (!ref.refId.trim() || !ref.worldObjectId.trim()) {
        throw new Error('Brain perception reference is incomplete.');
      }
      if (refIds.has(ref.refId) || objectIds.has(ref.worldObjectId)) {
        throw new Error('Brain perception references must be unique.');
      }
      refIds.add(ref.refId);
      objectIds.add(ref.worldObjectId);
      if (
        !Number.isFinite(ref.firstAcquiredWorldMinute) ||
        !Number.isFinite(ref.lastAcquiredWorldMinute) ||
        ref.firstAcquiredWorldMinute < 0 ||
        ref.lastAcquiredWorldMinute < ref.firstAcquiredWorldMinute
      ) {
        throw new Error(`Brain perception reference ${ref.refId} has invalid time.`);
      }
      if (
        !Number.isFinite(ref.recognitionConfidence) ||
        ref.recognitionConfidence < 0 ||
        ref.recognitionConfidence > 1
      ) {
        throw new Error(`Brain perception reference ${ref.refId} confidence is invalid.`);
      }
    }
    if (brain.perception.recentMessages.length > 8) {
      throw new Error('Brain recent perception exceeds message bound.');
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
    if (
      existing.section !== datum.section ||
      existing.kind !== datum.kind ||
      existing.source !== datum.source ||
      existing.encoded !== datum.encoded
    ) {
      throw new Error(`Brain datum ID ${datum.id} was reused with different content.`);
    }
    return true;
  }
  const beforeBytes = logicalBrainBytesV1(brain);
  const deltaBytes = brainDatumLogicalBytesV1(datum);
  if (beforeBytes + deltaBytes > BRAIN_LOGICAL_BUDGET_BYTES_V1) {
    return false;
  }
  brain.data.push(datum);
  invalidateBrainLogicalByteCacheV1(brain);
  logicalByteCache.set(brain, beforeBytes + deltaBytes);
  return true;
}

export function setBrainWorkingStepV1(
  brain: BrainStateV1,
  step: BrainWorkingStepV1 | undefined,
): boolean {
  const previous = brain.workingStep;
  invalidateBrainLogicalByteCacheV1(brain);
  if (step === undefined) delete brain.workingStep;
  else brain.workingStep = { ...step };
  if (logicalBrainBytesV1(brain) > BRAIN_LOGICAL_BUDGET_BYTES_V1) {
    if (previous === undefined) delete brain.workingStep;
    else brain.workingStep = previous;
    invalidateBrainLogicalByteCacheV1(brain);
    logicalBrainBytesV1(brain);
    return false;
  }
  return true;
}

export function brainOwnerTokenV1(brain: Readonly<BrainStateV1>): string {
  return `${brain.ownerAgentId}:${brain.ownerGeneration}:v${brain.version}`;
}
