import type { AgentState, WorldState } from '../world/types';
import {
  BRAIN_BODY_SIGNAL_ORDER_V1,
  BRAIN_LOGICAL_BUDGET_BYTES_V1,
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

function emptyPerceptionStateV1(): BrainPerceptionStateV1 {
  return {
    nextRefSequence: 1,
    references: [],
    currentBodySignals: [],
    currentObservations: [],
    recentMessages: [],
  };
}

function sourceKindV1(
  observation: Pick<LocalObservationV1, 'kind'>,
): BrainPerceivedObjectKindV1 {
  return observation.kind;
}

interface ReferenceSnapshotV1 {
  reference: BrainPerceptionReferenceV1;
  kind: BrainPerceivedObjectKindV1;
  lastAcquiredWorldMinute: number;
  recognitionConfidence: number;
  subjectWorldObjectId?: string;
}

interface PerceptionMutationContextV1 {
  byWorldObjectId: Map<string, BrainPerceptionReferenceV1>;
  changedReferences: Map<string, ReferenceSnapshotV1>;
}

function rememberReferenceBeforeMutationV1(
  context: PerceptionMutationContextV1,
  reference: BrainPerceptionReferenceV1,
): void {
  if (context.changedReferences.has(reference.refId)) return;
  context.changedReferences.set(reference.refId, {
    reference,
    kind: reference.kind,
    lastAcquiredWorldMinute: reference.lastAcquiredWorldMinute,
    recognitionConfidence: reference.recognitionConfidence,
    ...(reference.subjectWorldObjectId
      ? { subjectWorldObjectId: reference.subjectWorldObjectId }
      : {}),
  });
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
  } else {
    rememberReferenceBeforeMutationV1(context, reference);
    reference.kind = kind;
    reference.lastAcquiredWorldMinute = Math.max(
      reference.lastAcquiredWorldMinute,
      worldMinute,
    );
    reference.recognitionConfidence = Math.max(
      reference.recognitionConfidence,
      recognitionConfidence,
    );
    if (subjectWorldObjectId) reference.subjectWorldObjectId = subjectWorldObjectId;
  }
  return reference;
}

function bodySignalsFromBatchV1(batch: Readonly<PerceptBatchV1>): number[] {
  return BRAIN_BODY_SIGNAL_ORDER_V1.map((kind) => {
    const signal = batch.body.interoception[kind];
    return signal.availability === 'available' ? signal.intensity : -1;
  });
}

function observationForBrainV1(
  perception: BrainPerceptionStateV1,
  context: PerceptionMutationContextV1,
  observation: Readonly<LocalObservationV1>,
  worldMinute: number,
): BrainCurrentObservationV1 {
  const reference = ensureReferenceV1(
    perception,
    context,
    observation.objectId,
    sourceKindV1(observation),
    worldMinute,
    observation.confidence,
    observation.subjectObjectId,
  );
  let subjectRefId: string | undefined;
  if (observation.subjectObjectId) {
    const subject = ensureReferenceV1(
      perception,
      context,
      observation.subjectObjectId,
      'person',
      worldMinute,
      observation.confidence,
    );
    subjectRefId = subject.refId;
  }
  return {
    refId: reference.refId,
    kind: reference.kind,
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
    symbols: [...message.symbols].slice(0, 16),
    ...(senderRefId ? { senderRefId } : {}),
    ...(subjectRefId ? { subjectRefId } : {}),
    ...(message.eventKind ? { eventKind: message.eventKind } : {}),
  };
}

function mergedMessagesV1(
  current: readonly BrainPerceivedMessageV1[],
  messages: readonly BrainPerceivedMessageV1[],
): BrainPerceivedMessageV1[] {
  if (messages.length === 0) return current as BrainPerceivedMessageV1[];
  const next = [...current];
  for (const message of messages) {
    const prior = next.findIndex(
      (candidate) => candidate.messageId === message.messageId,
    );
    if (prior >= 0) next.splice(prior, 1);
    next.push(message);
  }
  return next.slice(-MAX_RECENT_MESSAGES_V1);
}

function rollbackPerceptionMutationV1(
  perception: BrainPerceptionStateV1,
  context: PerceptionMutationContextV1,
  initialReferenceLength: number,
  priorNextRefSequence: number,
): void {
  for (const snapshot of context.changedReferences.values()) {
    snapshot.reference.kind = snapshot.kind;
    snapshot.reference.lastAcquiredWorldMinute = snapshot.lastAcquiredWorldMinute;
    snapshot.reference.recognitionConfidence = snapshot.recognitionConfidence;
    if (snapshot.subjectWorldObjectId) {
      snapshot.reference.subjectWorldObjectId = snapshot.subjectWorldObjectId;
    } else {
      delete snapshot.reference.subjectWorldObjectId;
    }
  }
  perception.references.splice(initialReferenceLength);
  perception.nextRefSequence = priorNextRefSequence;
}

/**
 * Stage-3 perception writes only current subjective input and object/message
 * references. It deliberately does not create episodic memories or beliefs.
 */
export function acceptPersonalPerceptBatchV1(
  brain: BrainStateV1,
  batch: Readonly<PerceptBatchV1>,
): { accepted: boolean; budgetBlocked: boolean } {
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

  const priorLastPerceptWorldMinute = perception.lastPerceptWorldMinute;
  const priorBodySignals = perception.currentBodySignals;
  const priorObservations = perception.currentObservations;
  const priorMessages = perception.recentMessages;
  const priorNextRefSequence = perception.nextRefSequence;
  const initialReferenceLength = perception.references.length;
  const context: PerceptionMutationContextV1 = {
    byWorldObjectId: new Map(
      perception.references.map((reference) => [
        reference.worldObjectId,
        reference,
      ]),
    ),
    changedReferences: new Map(),
  };

  perception.lastPerceptWorldMinute = batch.worldMinute;
  perception.currentBodySignals = bodySignalsFromBatchV1(batch);
  perception.currentObservations = batch.localObservations
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
  perception.recentMessages = mergedMessagesV1(
    priorMessages,
    receivedMessages,
  );

  invalidateBrainPerceptionByteCacheV1(brain);
  if (logicalBrainBytesV1(brain) > BRAIN_LOGICAL_BUDGET_BYTES_V1) {
    rollbackPerceptionMutationV1(
      perception,
      context,
      initialReferenceLength,
      priorNextRefSequence,
    );
    perception.lastPerceptWorldMinute = priorLastPerceptWorldMinute;
    perception.currentBodySignals = priorBodySignals;
    perception.currentObservations = priorObservations;
    perception.recentMessages = priorMessages;
    if (createdPerception) delete brain.perception;
    invalidateBrainPerceptionByteCacheV1(brain);
    return { accepted: false, budgetBlocked: true };
  }
  return { accepted: true, budgetBlocked: false };
}

export function perceptionReferenceForWorldObjectV1(
  brain: Readonly<BrainStateV1>,
  worldObjectId: string,
): Readonly<BrainPerceptionReferenceV1> | undefined {
  return brain.perception?.references.find(
    (reference) => reference.worldObjectId === worldObjectId,
  );
}

export function knownDeathSubjectWorldIdsV1(
  brain: Readonly<BrainStateV1>,
): string[] {
  return [
    ...new Set(
      (brain.perception?.references ?? [])
        .filter(
          (reference) =>
            reference.kind === 'remains' &&
            Boolean(reference.subjectWorldObjectId),
        )
        .map((reference) => reference.subjectWorldObjectId!),
    ),
  ];
}

function queueMessageV1(
  brain: BrainStateV1,
  message: Readonly<ReceivedMessageV1>,
  worldMinute: number,
): boolean {
  const createdPerception = brain.perception === undefined;
  const perception = brain.perception ??= emptyPerceptionStateV1();
  const priorLastPerceptWorldMinute = perception.lastPerceptWorldMinute;
  const priorMessages = perception.recentMessages;
  const priorNextRefSequence = perception.nextRefSequence;
  const initialReferenceLength = perception.references.length;
  const context: PerceptionMutationContextV1 = {
    byWorldObjectId: new Map(
      perception.references.map((reference) => [
        reference.worldObjectId,
        reference,
      ]),
    ),
    changedReferences: new Map(),
  };
  const translated = messageForBrainV1(
    perception,
    context,
    message,
    worldMinute,
  );
  perception.recentMessages = mergedMessagesV1(
    priorMessages,
    [translated],
  );
  perception.lastPerceptWorldMinute = Math.max(
    perception.lastPerceptWorldMinute ?? 0,
    worldMinute,
  );

  invalidateBrainPerceptionByteCacheV1(brain);
  if (logicalBrainBytesV1(brain) > BRAIN_LOGICAL_BUDGET_BYTES_V1) {
    rollbackPerceptionMutationV1(
      perception,
      context,
      initialReferenceLength,
      priorNextRefSequence,
    );
    perception.lastPerceptWorldMinute = priorLastPerceptWorldMinute;
    perception.recentMessages = priorMessages;
    if (createdPerception) delete brain.perception;
    invalidateBrainPerceptionByteCacheV1(brain);
    return false;
  }
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
