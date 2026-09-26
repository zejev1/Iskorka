import {
  BRAIN_LEARNING_VERSION_V1,
  MAX_BRAIN_LEARNED_METHODS_V1,
  type BrainLearnedMethodV1,
  type BrainLearningStateV1,
} from './BrainLearningTypesV1';
import {
  invalidateBrainLogicalByteCacheV1,
  type BrainStateV1,
} from './BrainStateV1';
import {
  PORTABLE_HUMAN_CONTRACT_VERSION_V1,
  type ActionIntentV1,
  type ActionOutcomeV1,
  type HumanBodySignalKindV1,
  type PerceptBatchV1,
  type PortableHumanActionKindV1,
} from './PortableHumanCoreV1';

const SIGNAL_KEYS: readonly HumanBodySignalKindV1[] = [
  'thirst','hunger','breathlessness','weakness','coldStress','heatStress',
  'sweating','tremor','heartPounding','bladderUrge','bowelUrge',
  'physicalDiscomfort','cryingDrive','tears','blushing','goosebumps',
  'dryMouth','startle','physicalPleasure','sexualArousal',
  'postPleasureRelaxation',
];

const clamp = (value: number, min = -1, max = 1): number =>
  Math.max(min, Math.min(max, value));

function nextBrainUnit(brain: BrainStateV1): number {
  let x = brain.rngState >>> 0;
  if (x === 0) x = 0x6d2b79f5;
  x ^= x << 13;
  x ^= x >>> 17;
  x ^= x << 5;
  brain.rngState = x >>> 0;
  return brain.rngState / 0xffffffff;
}

export function ensureBrainLearningV1(brain: BrainStateV1): BrainLearningStateV1 {
  const state = brain.learning ??= {
    version: BRAIN_LEARNING_VERSION_V1,
    methods: [],
  };
  return state;
}

function availableSignals(batch: Readonly<PerceptBatchV1>): Partial<Record<HumanBodySignalKindV1, number>> {
  const result: Partial<Record<HumanBodySignalKindV1, number>> = {};
  for (const key of SIGNAL_KEYS) {
    const signal = batch.body.interoception[key];
    if (signal.availability === 'available') result[key] = signal.intensity;
  }
  return result;
}

export function beginBrainActionAttemptV1(
  brain: BrainStateV1,
  batch: Readonly<PerceptBatchV1>,
  action: PortableHumanActionKindV1,
  targetObjectId?: string,
): void {
  if (brain.ownerAgentId !== batch.ownerAgentId) throw new Error('Brain/percept owner mismatch.');
  const state = ensureBrainLearningV1(brain);
  state.pending = {
    action,
    ...(targetObjectId ? { targetObjectId } : {}),
    startedWorldMinute: batch.worldMinute,
    beforeSignals: availableSignals(batch),
  };
  invalidateBrainLogicalByteCacheV1(brain);
}

function methodId(action: PortableHumanActionKindV1, targetObjectId?: string): string {
  return targetObjectId ? `${action}@${targetObjectId}` : action;
}

export function finishBrainActionAttemptV1(
  brain: BrainStateV1,
  after: Readonly<PerceptBatchV1>,
  outcome: Readonly<ActionOutcomeV1>,
): BrainLearnedMethodV1 | undefined {
  const state = ensureBrainLearningV1(brain);
  const pending = state.pending;
  if (!pending) return undefined;
  if (brain.ownerAgentId !== after.ownerAgentId || outcome.ownerAgentId !== brain.ownerAgentId) {
    throw new Error('Brain/action outcome owner mismatch.');
  }
  if (outcome.action !== pending.action) return undefined;

  const afterSignals = availableSignals(after);
  const observedRelief: Partial<Record<HumanBodySignalKindV1, number>> = {};
  let meaningful = false;
  for (const key of SIGNAL_KEYS) {
    const before = pending.beforeSignals[key];
    const current = afterSignals[key];
    if (before === undefined || current === undefined) continue;
    const relief = clamp(before - current);
    if (Math.abs(relief) >= 0.002) meaningful = true;
    observedRelief[key] = relief;
  }

  const success = outcome.status === 'completed' && meaningful;
  const id = methodId(pending.action, pending.targetObjectId);
  let method = state.methods.find((candidate) => candidate.id === id);
  if (!method) {
    if (state.methods.length >= MAX_BRAIN_LEARNED_METHODS_V1) {
      state.methods.sort((left, right) => left.lastWorldMinute - right.lastWorldMinute);
      state.methods.shift();
    }
    method = {
      id,
      action: pending.action,
      ...(pending.targetObjectId ? { targetObjectId: pending.targetObjectId } : {}),
      trials: 0,
      successes: 0,
      failures: 0,
      expectedSignalRelief: {},
      confidence: 0,
      lastWorldMinute: after.worldMinute,
    };
    state.methods.push(method);
  }

  method.trials += 1;
  if (success) method.successes += 1;
  else method.failures += 1;
  const learningRate = method.trials === 1 ? 1 : 0.28;
  for (const key of SIGNAL_KEYS) {
    const observed = observedRelief[key];
    if (observed === undefined) continue;
    const prior = method.expectedSignalRelief[key] ?? 0;
    method.expectedSignalRelief[key] = clamp(prior * (1 - learningRate) + observed * learningRate);
  }
  method.confidence = clamp(method.trials / (method.trials + 3), 0, 1);
  method.lastWorldMinute = after.worldMinute;
  delete state.pending;
  invalidateBrainLogicalByteCacheV1(brain);
  return method;
}

function targetStillKnown(brain: Readonly<BrainStateV1>, targetObjectId: string | undefined): boolean {
  if (!targetObjectId) return true;
  return brain.perception?.references.some((ref) => ref.worldObjectId === targetObjectId) ?? false;
}

/**
 * Generic learned choice. No action has a built-in survival meaning here:
 * an action becomes attractive only when this brain personally observed that
 * it relieved a currently perceived signal.
 */
export function chooseLearnedBrainIntentV1(
  brain: BrainStateV1,
  batch: Readonly<PerceptBatchV1>,
): ActionIntentV1 | undefined {
  if (brain.ownerAgentId !== batch.ownerAgentId) throw new Error('Brain/percept owner mismatch.');
  const state = ensureBrainLearningV1(brain);
  if (state.pending) {
    return {
      version: PORTABLE_HUMAN_CONTRACT_VERSION_V1,
      ownerAgentId: brain.ownerAgentId,
      action: state.pending.action,
      ...(state.pending.targetObjectId ? { target: { kind: 'place' as const, objectId: state.pending.targetObjectId } } : {}),
      maxWorldMinutes: 360,
      stopConditions: ['body_limit','target_missing','new_danger','material_change','reconsider'],
    };
  }
  const current = availableSignals(batch);
  const scored = state.methods
    .filter((method) => method.trials > 0 && targetStillKnown(brain, method.targetObjectId))
    .map((method) => {
      let score = 0;
      for (const key of SIGNAL_KEYS) {
        const intensity = current[key] ?? 0;
        const expectedRelief = method.expectedSignalRelief[key] ?? 0;
        score += intensity * expectedRelief * method.confidence;
      }
      return { method, score };
    })
    .filter((entry) => entry.score > 0.002);

  if (scored.length === 0) return undefined;
  const best = Math.max(...scored.map((entry) => entry.score));
  const weights = scored.map((entry) => Math.exp((entry.score - best) / 0.08));
  let roll = nextBrainUnit(brain) * weights.reduce((sum, weight) => sum + weight, 0);
  let chosen = scored[scored.length - 1].method;
  for (let index = 0; index < scored.length; index += 1) {
    roll -= weights[index];
    if (roll <= 0) {
      chosen = scored[index].method;
      break;
    }
  }

  return {
    version: PORTABLE_HUMAN_CONTRACT_VERSION_V1,
    ownerAgentId: brain.ownerAgentId,
    action: chosen.action,
    ...(chosen.targetObjectId ? { target: { kind: 'place' as const, objectId: chosen.targetObjectId } } : {}),
    maxWorldMinutes: 360,
    stopConditions: ['body_limit','target_missing','new_danger','material_change','reconsider'],
  };
}


export function buildPerceivedActionOutcomeV1(
  before: Readonly<PerceptBatchV1>,
  after: Readonly<PerceptBatchV1>,
  action: PortableHumanActionKindV1,
  status: ActionOutcomeV1['status'],
): ActionOutcomeV1 {
  if (before.ownerAgentId !== after.ownerAgentId) throw new Error('Action outcome percept owner mismatch.');
  const effects: ActionOutcomeV1['perceivedEffects'][number][] = [];
  for (const key of SIGNAL_KEYS) {
    const a = before.body.interoception[key];
    const b = after.body.interoception[key];
    if (a.availability !== 'available' || b.availability !== 'available') continue;
    const delta = b.intensity - a.intensity;
    if (Math.abs(delta) < 0.002) continue;
    effects.push({
      channel: key,
      direction: delta < 0 ? 'better' : 'worse',
    });
  }
  return {
    version: PORTABLE_HUMAN_CONTRACT_VERSION_V1,
    ownerAgentId: before.ownerAgentId,
    action,
    startedWorldMinute: before.worldMinute,
    finishedWorldMinute: after.worldMinute,
    status,
    perceivedEffects: effects,
  };
}
