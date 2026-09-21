import type { AgentState, WorldState } from '../world/types';
import {
  BRAIN_LOGICAL_BUDGET_BYTES_V1,
  BRAIN_SECTION_TARGET_BYTES_V1,
  invalidateBrainPerceptionByteCacheV1,
  logicalBrainBytesV1,
  type BrainCurrentObservationV1,
  type BrainPerceivedMessageV1,
  type BrainPerceivedObjectKindV1,
  type BrainPerceptionReferenceV1,
  type BrainPerceptionStateV1,
  type BrainStateV1,
} from './BrainStateV1';
import {
  brainForLiveOwnerV1,
  ensureBrainForAgentV1,
} from './BrainStateAdapterV1';
import type {
  LocalObservationV1,
  PerceptBatchV1,
  ReceivedMessageV1,
} from './PortableHumanCoreV1';

const MAX_RECENT_MESSAGES_V1 = 8;
const MAX_MESSAGE_SYMBOLS_V1 = 4;
const MAX_MESSAGE_SYMBOL_CODE_UNITS_V1 = 128;
const utf8EncoderV1 = new TextEncoder();
/**
 * Stage-2 reserved 8 KiB for working memory/attention. Stage 3 spends that
 * reserve on the current sensory frame instead of persisting the frame in the
 * world snapshot. Acquired references/messages remain persistent and are
 * charged separately.
 */
const PERSONAL_PERCEPT_WORKING_BYTES_V1 = BRAIN_SECTION_TARGET_BYTES_V1.working;

export interface PersonalPerceptViewV1 {
  worldMinute: number;
  body: PerceptBatchV1['body'];
  observations: readonly BrainCurrentObservationV1[];
  messages: readonly BrainPerceivedMessageV1[];
}

const currentPerceptByBrainV1 = new WeakMap<object, PersonalPerceptViewV1>();
const referenceIndexByPerceptionV1 = new WeakMap<
  object,
  Map<string, BrainPerceptionReferenceV1>
>();
const knownDeathSubjectsByPerceptionV1 = new WeakMap<object, string[]>();

function emptyPerceptionStateV1(): BrainPerceptionStateV1 {
  return {
    nextRefSequence: 1,
    references: [],
    recentMessages: [],
  };
}

function referenceIndexV1(
  perception: BrainPerceptionStateV1,
): Map<string, BrainPerceptionReferenceV1> {
  let index = referenceIndexByPerceptionV1.get(perception as object);
  if (!index) {
    index = new Map(
      perception.references.map((reference) => [
        reference.worldObjectId,
        reference,
      ]),
    );
    referenceIndexByPerceptionV1.set(perception as object, index);
  }
  return index;
}

function sourceKindV1(
  observation: Pick<LocalObservationV1, 'kind'>,
): BrainPerceivedObjectKindV1 {
  return observation.kind;
}

interface PendingReferenceUpdateV1 {
  reference: BrainPerceptionReferenceV1;
  kind: BrainPerceivedObjectKindV1;
  worldMinute: number;
  recognitionConfidence: number;
  subjectWorldObjectId?: string;
}

interface PerceptionMutationContextV1 {
  byWorldObjectId: Map<string, BrainPerceptionReferenceV1>;
  newReferences: BrainPerceptionReferenceV1[];
  pendingByRefId: Map<string, PendingReferenceUpdateV1>;
}

function ensureReferenceV1(
  perception: BrainPerceptionStateV1,
  context: PerceptionMutationContextV1,
  worldObjectId: string,
  kind: BrainPerceivedObjectKindV1,
  worldMinute: number,
  recognitionConfidence: number,
  subjectWorldObjectId?: string,
): BrainPerceptionReferenceV1 {
  let reference = context.byWorldObjectId.get(worldObjectId);
  if (!reference) {
    reference = {
      refId: `ref:${perception.nextRefSequence.toString(36)}`,
      worldObjectId,
      kind,
      firstAcquiredWorldMinute: worldMinute,
      lastAcquiredWorldMinute: worldMinute,
      recognitionConfidence,
      ...(subjectWorldObjectId ? { subjectWorldObjectId } : {}),
    };
    perception.nextRefSequence += 1;
    perception.references.push(reference);
    context.byWorldObjectId.set(worldObjectId, reference);
    context.newReferences.push(reference);
    return reference;
  }

  const pending = context.pendingByRefId.get(reference.refId);
  if (pending) {
    pending.worldMinute = Math.max(pending.worldMinute, worldMinute);
    pending.recognitionConfidence = Math.max(
      pending.recognitionConfidence,
      recognitionConfidence,
    );
    pending.kind = kind;
    if (subjectWorldObjectId) pending.subjectWorldObjectId = subjectWorldObjectId;
  } else {
    context.pendingByRefId.set(reference.refId, {
      reference,
      kind,
      worldMinute,
      recognitionConfidence,
      ...(subjectWorldObjectId ? { subjectWorldObjectId } : {}),
    });
  }
  return reference;
}

function pendingReferenceStructuralDeltaV1(
  context: PerceptionMutationContextV1,
): number {
  let delta = 0;
  for (const pending of context.pendingByRefId.values()) {
    const reference = pending.reference;
    if (reference.kind !== pending.kind) {
      delta +=
        utf8EncoderV1.encode(pending.kind).byteLength -
        utf8EncoderV1.encode(reference.kind).byteLength;
    }
    if (
      pending.subjectWorldObjectId &&
      pending.subjectWorldObjectId !== reference.subjectWorldObjectId
    ) {
      delta +=
        utf8EncoderV1.encode(pending.subjectWorldObjectId).byteLength -
        utf8EncoderV1.encode(reference.subjectWorldObjectId ?? '').byteLength;
    }
  }
  return Math.max(0, delta);
}

function applyPendingReferenceUpdatesV1(
  context: PerceptionMutationContextV1,
): void {
  for (const pending of context.pendingByRefId.values()) {
    const reference = pending.reference;
    reference.kind = pending.kind;
    reference.lastAcquiredWorldMinute = Math.max(
      reference.lastAcquiredWorldMinute,
      pending.worldMinute,
    );
    reference.recognitionConfidence = Math.max(
      reference.recognitionConfidence,
      pending.recognitionConfidence,
    );
    if (pending.subjectWorldObjectId) {
      reference.subjectWorldObjectId = pending.subjectWorldObjectId;
    }
  }
}

function rollbackNewReferencesV1(
  perception: BrainPerceptionStateV1,
  context: PerceptionMutationContextV1,
  priorNextRefSequence: number,
): void {
  if (context.newReferences.length === 0) return;
  const remove = new Set(context.newReferences.map((reference) => reference.refId));
  perception.references = perception.references.filter(
    (reference) => !remove.has(reference.refId),
  );
  for (const reference of context.newReferences) {
    context.byWorldObjectId.delete(reference.worldObjectId);
  }
  perception.nextRefSequence = priorNextRefSequence;
  referenceIndexByPerceptionV1.set(perception as object, context.byWorldObjectId);
  knownDeathSubjectsByPerceptionV1.delete(perception as object);
}

function observationForBrainV1(
  perception: BrainPerceptionStateV1,
  context: PerceptionMutationContextV1,
  observation: Readonly<LocalObservationV1>,
  worldMinute: number,
): BrainCurrentObservationV1 {
  const kind = sourceKindV1(observation);
  const reference = ensureReferenceV1(
    perception,
    context,
    observation.objectId,
    kind,
    worldMinute,
    observation.confidence,
    observation.subjectObjectId,
  );
  let subjectRefId: string | undefined;
  if (observation.subjectObjectId) {
    subjectRefId = ensureReferenceV1(
      perception,
      context,
      observation.subjectObjectId,
      'person',
      worldMinute,
      observation.confidence,
    ).refId;
  }
  return {
    refId: reference.refId,
    kind,
    relation: observation.relation,
    channel: 'vision',
    confidence: observation.confidence,
    ...(observation.observedAction
      ? { observedAction: observation.observedAction }
      : {}),
    ...(observation.eventKind ? { eventKind: observation.eventKind } : {}),
    ...(subjectRefId ? { subjectRefId } : {}),
  };
}

function boundedSymbolsV1(symbols: readonly string[]): string[] {
  return symbols
    .slice(0, MAX_MESSAGE_SYMBOLS_V1)
    .map((symbol) => symbol.slice(0, MAX_MESSAGE_SYMBOL_CODE_UNITS_V1));
}

function messageForBrainV1(
  perception: BrainPerceptionStateV1,
  context: PerceptionMutationContextV1,
  message: Readonly<ReceivedMessageV1>,
  worldMinute: number,
): BrainPerceivedMessageV1 {
  let senderRefId: string | undefined;
  if (message.senderObjectId) {
    senderRefId = ensureReferenceV1(
      perception,
      context,
      message.senderObjectId,
      'person',
      worldMinute,
      message.confidence,
    ).refId;
  }
  let subjectRefId: string | undefined;
  if (message.subjectObjectId) {
    subjectRefId = ensureReferenceV1(
      perception,
      context,
      message.subjectObjectId,
      'person',
      worldMinute,
      message.confidence,
    ).refId;
  }
  return {
    messageId: message.messageId,
    receivedWorldMinute: worldMinute,
    channel: message.channel,
    confidence: message.confidence,
    symbols: boundedSymbolsV1(message.symbols),
    ...(senderRefId ? { senderRefId } : {}),
    ...(subjectRefId ? { subjectRefId } : {}),
    ...(message.eventKind ? { eventKind: message.eventKind } : {}),
  };
}

function sameMessageShapeV1(
  left: Readonly<BrainPerceivedMessageV1>,
  right: Readonly<BrainPerceivedMessageV1>,
): boolean {
  return (
    left.messageId === right.messageId &&
    left.channel === right.channel &&
    left.senderRefId === right.senderRefId &&
    left.subjectRefId === right.subjectRefId &&
    left.eventKind === right.eventKind &&
    left.symbols.length === right.symbols.length &&
    left.symbols.every((symbol, index) => symbol === right.symbols[index])
  );
}

function mergedMessagesV1(
  current: readonly BrainPerceivedMessageV1[],
  messages: readonly BrainPerceivedMessageV1[],
): { messages: BrainPerceivedMessageV1[]; structureChanged: boolean } {
  if (messages.length === 0) {
    return { messages: current as BrainPerceivedMessageV1[], structureChanged: false };
  }
  let next: BrainPerceivedMessageV1[] | undefined;
  let structureChanged = false;

  for (const message of messages) {
    const source = next ?? current;
    const prior = source.findIndex(
      (candidate) => candidate.messageId === message.messageId,
    );
    if (prior >= 0 && sameMessageShapeV1(source[prior], message)) {
      continue;
    }
    next ??= [...current];
    const inNext = next.findIndex(
      (candidate) => candidate.messageId === message.messageId,
    );
    if (inNext >= 0) next.splice(inNext, 1);
    next.push(message);
    structureChanged = true;
  }

  if (!next) {
    return { messages: current as BrainPerceivedMessageV1[], structureChanged: false };
  }
  if (next.length > MAX_RECENT_MESSAGES_V1) {
    next.splice(0, next.length - MAX_RECENT_MESSAGES_V1);
  }
  return { messages: next, structureChanged };
}

/**
 * Stage-3 perception owns acquired object references and bounded received
 * messages. The current body/vision frame stays in runtime working memory:
 * closing/reopening recomputes it from the same physical world instead of
 * bloating every persistent world snapshot.
 */
export function acceptPersonalPerceptBatchV1(
  brain: BrainStateV1,
  batch: Readonly<PerceptBatchV1>,
): {
  accepted: boolean;
  budgetBlocked: boolean;
  view?: PersonalPerceptViewV1;
} {
  if (brain.ownerAgentId !== batch.ownerAgentId) {
    throw new Error('Personal percept owner mismatch.');
  }
  if (!Number.isFinite(batch.worldMinute) || batch.worldMinute < 0) {
    throw new Error('Personal percept worldMinute is invalid.');
  }

  const createdPerception = brain.perception === undefined;
  const perception = brain.perception ??= emptyPerceptionStateV1();
  if (
    perception.lastPerceptWorldMinute !== undefined &&
    batch.worldMinute < perception.lastPerceptWorldMinute
  ) {
    throw new Error('Personal perception cannot move backwards in world time.');
  }

  const priorMessages = perception.recentMessages;
  const priorNextRefSequence = perception.nextRefSequence;
  const context: PerceptionMutationContextV1 = {
    byWorldObjectId: referenceIndexV1(perception),
    newReferences: [],
    pendingByRefId: new Map(),
  };

  const observations = batch.localObservations
    .slice(0, 24)
    .map((observation) =>
      observationForBrainV1(
        perception,
        context,
        observation,
        batch.worldMinute,
      ),
    );
  const receivedMessages = batch.receivedMessages.map((message) =>
    messageForBrainV1(
      perception,
      context,
      message,
      batch.worldMinute,
    ),
  );
  const merged = mergedMessagesV1(priorMessages, receivedMessages);
  if (merged.structureChanged) perception.recentMessages = merged.messages;

  const pendingStructuralDelta = pendingReferenceStructuralDeltaV1(context);
  const structureChanged =
    context.newReferences.length > 0 ||
    merged.structureChanged ||
    pendingStructuralDelta > 0;

  if (structureChanged) invalidateBrainPerceptionByteCacheV1(brain);
  if (
    logicalBrainBytesV1(brain) +
      pendingStructuralDelta +
      PERSONAL_PERCEPT_WORKING_BYTES_V1 >
    BRAIN_LOGICAL_BUDGET_BYTES_V1
  ) {
    rollbackNewReferencesV1(perception, context, priorNextRefSequence);
    if (merged.structureChanged) perception.recentMessages = priorMessages;
    if (createdPerception) {
      delete brain.perception;
      referenceIndexByPerceptionV1.delete(perception as object);
    }
    if (structureChanged) invalidateBrainPerceptionByteCacheV1(brain);
    currentPerceptByBrainV1.delete(brain as object);
    return { accepted: false, budgetBlocked: true };
  }

  applyPendingReferenceUpdatesV1(context);
  if (pendingStructuralDelta > 0) {
    invalidateBrainPerceptionByteCacheV1(brain);
    knownDeathSubjectsByPerceptionV1.delete(perception as object);
  } else if (context.newReferences.some((reference) => reference.kind === 'remains')) {
    knownDeathSubjectsByPerceptionV1.delete(perception as object);
  }
  perception.lastPerceptWorldMinute = batch.worldMinute;
  const view: PersonalPerceptViewV1 = {
    worldMinute: batch.worldMinute,
    body: batch.body,
    observations,
    messages: receivedMessages,
  };
  currentPerceptByBrainV1.set(brain as object, view);
  return { accepted: true, budgetBlocked: false, view };
}

export function currentPersonalPerceptViewV1(
  brain: Readonly<BrainStateV1>,
): Readonly<PersonalPerceptViewV1> | undefined {
  return currentPerceptByBrainV1.get(brain as object);
}

export function perceptionReferenceForWorldObjectV1(
  brain: Readonly<BrainStateV1>,
  worldObjectId: string,
): Readonly<BrainPerceptionReferenceV1> | undefined {
  const perception = brain.perception;
  if (!perception) return undefined;
  return referenceIndexV1(perception).get(worldObjectId);
}

export function knownDeathSubjectWorldIdsV1(
  brain: Readonly<BrainStateV1>,
): string[] {
  const perception = brain.perception;
  if (!perception) return [];
  const cached = knownDeathSubjectsByPerceptionV1.get(perception as object);
  if (cached) return cached;
  const unique = new Set<string>();
  for (const reference of perception.references) {
    if (reference.kind === 'remains' && reference.subjectWorldObjectId) {
      unique.add(reference.subjectWorldObjectId);
    }
  }
  const result = [...unique];
  knownDeathSubjectsByPerceptionV1.set(perception as object, result);
  return result;
}

function queueMessageV1(
  brain: BrainStateV1,
  message: Readonly<ReceivedMessageV1>,
  worldMinute: number,
): boolean {
  const createdPerception = brain.perception === undefined;
  const perception = brain.perception ??= emptyPerceptionStateV1();
  const priorMessages = perception.recentMessages;
  const priorNextRefSequence = perception.nextRefSequence;
  const context: PerceptionMutationContextV1 = {
    byWorldObjectId: referenceIndexV1(perception),
    newReferences: [],
    pendingByRefId: new Map(),
  };
  const translated = messageForBrainV1(
    perception,
    context,
    message,
    worldMinute,
  );
  const merged = mergedMessagesV1(priorMessages, [translated]);
  if (merged.structureChanged) perception.recentMessages = merged.messages;

  const pendingStructuralDelta = pendingReferenceStructuralDeltaV1(context);
  const structureChanged =
    context.newReferences.length > 0 ||
    merged.structureChanged ||
    pendingStructuralDelta > 0;
  if (structureChanged) invalidateBrainPerceptionByteCacheV1(brain);

  if (
    logicalBrainBytesV1(brain) +
      pendingStructuralDelta +
      PERSONAL_PERCEPT_WORKING_BYTES_V1 >
    BRAIN_LOGICAL_BUDGET_BYTES_V1
  ) {
    rollbackNewReferencesV1(perception, context, priorNextRefSequence);
    if (merged.structureChanged) perception.recentMessages = priorMessages;
    if (createdPerception) {
      delete brain.perception;
      referenceIndexByPerceptionV1.delete(perception as object);
    }
    if (structureChanged) invalidateBrainPerceptionByteCacheV1(brain);
    return false;
  }

  applyPendingReferenceUpdatesV1(context);
  if (pendingStructuralDelta > 0) {
    invalidateBrainPerceptionByteCacheV1(brain);
    knownDeathSubjectsByPerceptionV1.delete(perception as object);
  }
  perception.lastPerceptWorldMinute = Math.max(
    perception.lastPerceptWorldMinute ?? 0,
    worldMinute,
  );
  return true;
}

/**
 * Existing Russian is only a legacy transport scaffold until SymbolLanguage.
 * A death report can be delivered only by a living co-located speaker whose
 * own finite brain previously acquired the death through perception.
 */
export function shareKnownDeathReportV1(
  world: WorldState,
  sender: AgentState,
  listener: AgentState,
  messageId: string,
): boolean {
  if (
    !sender.life.alive ||
    !listener.life.alive ||
    sender.locationId !== listener.locationId ||
    sender.movement ||
    listener.movement ||
    (sender.race ?? 'human') !== 'human' ||
    (listener.race ?? 'human') !== 'human'
  ) return false;

  const senderBrain =
    brainForLiveOwnerV1(world, sender.id, sender.life.generation) ??
    ensureBrainForAgentV1(world, sender);
  const listenerBrain =
    brainForLiveOwnerV1(world, listener.id, listener.life.generation) ??
    ensureBrainForAgentV1(world, listener);
  if (!senderBrain || !listenerBrain) return false;

  const knownDeaths = knownDeathSubjectWorldIdsV1(senderBrain);
  if (knownDeaths.length === 0) return false;
  const subjectId = knownDeaths[knownDeaths.length - 1];
  const subject = world.agents[subjectId];
  if (!subject || subject.life.alive) return false;

  const speakerLanguage = world.v18?.languageByAgentId[sender.id];
  const listenerLanguage = world.v18?.languageByAgentId[listener.id];
  const canExpress = (speakerLanguage?.spokenExpression ?? 0) >= 0.18;
  const canUnderstand = (listenerLanguage?.spokenComprehension ?? 0) >= 0.18;
  if (!canExpress) return false;

  return queueMessageV1(
    listenerBrain,
    {
      messageId,
      senderObjectId: sender.id,
      ...(canUnderstand ? { subjectObjectId: subject.id } : {}),
      symbols: [`${subject.name} умер.`],
      channel: 'hearing',
      confidence: canUnderstand ? 0.96 : 0.42,
      ...(canUnderstand ? { eventKind: 'death_report' as const } : {}),
    },
    world.calendar.elapsedWorldMinutes,
  );
}
