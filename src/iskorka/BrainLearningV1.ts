import {
  BRAIN_LEARNING_VERSION_V1,
  MAX_BRAIN_LEARNED_METHODS_V1,
  type BrainLearnedMethodV1,
  type BrainLearningStateV1,
} from './BrainLearningTypesV1';
import {
  invalidateBrainTransientByteCacheV1,
  type BrainStateV1,
} from './BrainStateV1';
import {
  PORTABLE_HUMAN_CONTRACT_VERSION_V1,
  type ActionIntentV1,
  type ActionOutcomeV1,
  type HumanEnvironmentalCueKindV1,
  type HumanBodySignalKindV1,
  type PerceptBatchV1,
  type PortableHumanActionKindV1,
} from './PortableHumanCoreV1';

const SIGNAL_KEYS: readonly HumanBodySignalKindV1[] = [
  'thirst','hunger','breathlessness','weakness','coldStress','heatStress',
  'sweating','tremor','heartPounding','bladderUrge','bowelUrge',
  'physicalDiscomfort','cryingDrive','tears','blushing','goosebumps',
  'dryMouth','startle','physicalPleasure','sexualArousal',
  'sexualDesire',
  'postPleasureRelaxation',
];

const ACTION_DRIVE_KEYS: readonly HumanBodySignalKindV1[] = [
  'thirst','hunger','breathlessness','weakness','coldStress','heatStress',
  'bladderUrge','bowelUrge','physicalDiscomfort',
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

function availableCues(batch: Readonly<PerceptBatchV1>): Partial<Record<HumanEnvironmentalCueKindV1, number>> {
  const result: Partial<Record<HumanEnvironmentalCueKindV1, number>> = {};
  for (const [key, value] of Object.entries(batch.environmentalCues ?? {})) {
    if (typeof value === 'number' && Number.isFinite(value)) {
      result[key as HumanEnvironmentalCueKindV1] = clamp(value, 0, 1);
    }
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
    beforeCues: availableCues(batch),
  };
  invalidateBrainTransientByteCacheV1(brain);
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
    // A changed sensation is not automatically a useful result. Physical work
    // can make fatigue worse; that must lower the value of the action instead
    // of teaching the brain that it helped.
    if (relief >= 0.002) meaningful = true;
    // Absence of a sensation cannot disprove a previously experienced remedy.
    // Still learn harm, and failed relief when the sensation was present.
    if (before >= 0.04 || relief < -0.002 || relief >= 0.002)
      observedRelief[key] = relief;
  }

  // The body can improve through a world change (for example food or water
  // becoming available) before the related sensation changes. Keep this as a
  // generic value learned from the perceived result, not an action rule.
  const externalReward = clamp(outcome.perceivedEffects.reduce((sum, effect) => {
    if (!effect.channel.startsWith('world:')) return sum;
    return sum + (effect.direction === 'better' ? 1 : effect.direction === 'worse' ? -1 : 0);
  }, 0));
  const success = outcome.status === 'completed' && (meaningful || externalReward > 0.002);
  const id = methodId(pending.action, pending.targetObjectId);
  let method = state.methods.find((candidate) => candidate.id === id);
  const relevantSensation = method && ACTION_DRIVE_KEYS.some(key =>
    (method?.expectedSignalRelief[key] ?? 0) > 0.002 &&
    (pending.beforeSignals[key] ?? 0) >= 0.04);
  if (method && outcome.status === 'completed' && !meaningful &&
      externalReward === 0 && !relevantSensation) {
    delete state.pending;
    invalidateBrainTransientByteCacheV1(brain);
    return method;
  }
  if (!method) {
    if (state.methods.length >= MAX_BRAIN_LEARNED_METHODS_V1) {
      const rememberedValue = (candidate: Readonly<BrainLearnedMethodV1>): number => {
        const usefulRelief = ACTION_DRIVE_KEYS.reduce(
          (sum, key) => sum + Math.max(0, candidate.expectedSignalRelief[key] ?? 0),
          0,
        );
        const reliability = candidate.trials > 0
          ? candidate.successes / candidate.trials
          : 0;
        // Retain methods for the useful result they taught this brain. The
        // small evidence floor lets repeated social and exploratory actions
        // persist, while failures and useless novelty are easiest to forget.
        return reliability * (
          0.015 + usefulRelief + Math.max(0, candidate.expectedExternalReward ?? 0) * 0.05
        );
      };
      let leastUsefulIndex = 0;
      for (let index = 1; index < state.methods.length; index += 1) {
        if (rememberedValue(state.methods[index]) < rememberedValue(state.methods[leastUsefulIndex])) {
          leastUsefulIndex = index;
        }
      }
      // A first failed attempt has not earned space at the expense of a
      // personally useful method. The attempt still happened physically;
      // only its long-term trace is lost to this brain's finite capacity.
      const firstValue = success ? 0.015 + ACTION_DRIVE_KEYS.reduce(
        (sum, key) => sum + Math.max(0, observedRelief[key] ?? 0),
        0,
      ) + Math.max(0, externalReward) * 0.05 : 0;
      if (firstValue <= rememberedValue(state.methods[leastUsefulIndex])) {
        delete state.pending;
        invalidateBrainTransientByteCacheV1(brain);
        return undefined;
      }
      state.methods.splice(leastUsefulIndex, 1);
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
  method.expectedContextSignals ??= {};
  for (const key of ACTION_DRIVE_KEYS) {
    const observed = pending.beforeSignals[key];
    if (observed === undefined) continue;
    const prior = method.expectedContextSignals[key] ?? observed;
    method.expectedContextSignals[key] = clamp(
      prior * (1 - learningRate) + observed * learningRate,
      0,
      1,
    );
  }
  method.expectedContextCues ??= {};
  for (const [key, observed] of Object.entries(pending.beforeCues ?? {})) {
    if (observed === undefined) continue;
    const cue = key as HumanEnvironmentalCueKindV1;
    const prior = method.expectedContextCues[cue] ?? observed;
    method.expectedContextCues[cue] = clamp(
      prior * (1 - learningRate) + observed * learningRate,
      0,
      1,
    );
  }
  method.expectedExternalReward = clamp(
    (method.expectedExternalReward ?? 0) * (1 - learningRate) + externalReward * learningRate,
  );
  method.expectedWorldEffects ??= {};
  for (const channel of ['world:food', 'world:water', 'world:shelter', 'world:materials', 'world:clothing'] as const) {
    const observed = outcome.perceivedEffects
      .filter((effect) => effect.channel === channel)
      .reduce((sum, effect) => sum + (effect.direction === 'better' ? 1 : effect.direction === 'worse' ? -1 : 0), 0);
    method.expectedWorldEffects[channel] = clamp(
      (method.expectedWorldEffects[channel] ?? 0) * (1 - learningRate) + observed * learningRate,
    );
  }
  method.confidence = clamp(method.trials / (method.trials + 1), 0, 1);
  method.lastWorldMinute = after.worldMinute;
  delete state.pending;
  invalidateBrainTransientByteCacheV1(brain);
  return method;
}

function actionContextSimilarity(
  method: Readonly<BrainLearnedMethodV1>,
  current: Readonly<Partial<Record<HumanBodySignalKindV1, number>>>,
): number {
  const expected = method.expectedContextSignals;
  if (!expected) return 0;
  let difference = 0;
  let totalSignalMass = 0;
  for (const key of ACTION_DRIVE_KEYS) {
    const observed = expected[key];
    const now = current[key];
    if (observed === undefined || now === undefined) continue;
    difference += Math.abs(observed - now);
    totalSignalMass += Math.max(observed, now);
  }
  if (totalSignalMass < 0.002) return 0;
  return clamp(1 - difference / totalSignalMass, 0, 1);
}

function actionAffordanceSimilarity(
  method: Readonly<BrainLearnedMethodV1>,
  current: Readonly<Partial<Record<HumanEnvironmentalCueKindV1, number>>>,
): number {
  const expected = method.expectedContextCues;
  if (!expected) return 1;
  let difference = 0;
  let comparedCues = 0;
  for (const [key, value] of Object.entries(expected)) {
    const now = current[key as HumanEnvironmentalCueKindV1];
    if (value === undefined || now === undefined) continue;
    difference += Math.abs(value - now);
    comparedCues += 1;
  }
  return comparedCues === 0 ? 1 : clamp(1 - difference / comparedCues, 0, 1);
}

/**
 * Generic learned choice. No action has a built-in survival meaning here:
 * an action becomes attractive only when this brain personally observed that
 * it relieved a currently perceived signal.
 */
export function chooseLearnedBrainIntentV1(
  brain: BrainStateV1,
  batch: Readonly<PerceptBatchV1>,
  allowedActions?: ReadonlySet<PortableHumanActionKindV1>,
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
  const currentCues = availableCues(batch);
  const scored = state.methods
    // The method's remembered place is itself personal experience. Requiring
    // current visibility here prevented a Spark from travelling to it.
    .filter((method) => method.trials > 0)
    .filter((method) => !allowedActions || allowedActions.has(method.action))
    .map((method) => {
      let reliefValue = 0;
      let discomfortValue = 0;
      const strongestRelief = Math.max(0, ...ACTION_DRIVE_KEYS.map(
        (key) => method.expectedSignalRelief[key] ?? 0,
      ));
      for (const key of ACTION_DRIVE_KEYS) {
        const intensity = current[key] ?? 0;
        const urgency = intensity * (1 + 2 * Math.pow(intensity, 6));
        const expectedRelief = method.expectedSignalRelief[key] ?? 0;
        // Small side effects should not masquerade as the main bodily result.
        // For example, water may slightly ease weakness, but that observation
        // does not make drinking a good answer to strong hunger without thirst.
        if (expectedRelief > 0) reliefValue += urgency * expectedRelief *
          Math.pow(expectedRelief / Math.max(strongestRelief, 1e-9), 2);
        else discomfortValue -= intensity * expectedRelief;
      }
      // A secondary discomfort after relief (such as bladder pressure after
      // drinking) remains evidence without erasing the learned relief.
      // Small authentic relief must remain distinguishable after many neutral
      // repetitions. It is still zero when the person has never felt relief.
      let score = (Math.pow(reliefValue, 0.45) * 0.28 -
        Math.min(discomfortValue * 0.15, reliefValue * 0.3)) * method.confidence;
      const reliability = method.trials > 0
        ? method.successes / method.trials
        : 0;
      const currentPressure = Math.max(0, ...ACTION_DRIVE_KEYS.map((key) => current[key] ?? 0));
      const contextSimilarity = actionContextSimilarity(method, current);
      const affordanceSimilarity = actionAffordanceSimilarity(method, currentCues);
      score *= affordanceSimilarity;
      // Positive relief this person actually felt while eating with food in
      // hand is stronger evidence when food is presently in hand. The same
      // rule applies to any learned method with a hunger-relieving outcome.
      score += (current.hunger ?? 0) * (currentCues.foodAtHand ?? 0) *
        // Availability amplifies a learned solution only in proportion to
        // its current need. Otherwise a carried meal overwhelms much stronger
        // thirst indefinitely, even after this person has learned water relief.
        Math.pow((current.hunger ?? 0) / Math.max(0.001, currentPressure), 2) *
        Math.sqrt(Math.max(0, method.expectedSignalRelief.hunger ?? 0)) *
        Math.pow(Math.max(0, method.expectedSignalRelief.hunger ?? 0) /
          Math.max(strongestRelief, 1e-9), 2) *
        method.confidence * reliability * 2.4;
      // Remember which resource physically changed. A conversation is not
      // nourishment, and a new stock of food matters more when food at hand
      // is scarce. This is an association of personally observed outcomes,
      // independent of the name of the action that produced them.
      const foodNeed = (current.hunger ?? 0) * (1 - (currentCues.foodAtHand ?? 0)) *
        (1 - 0.9 * Math.pow(current.thirst ?? 0, 3));
      const waterNeed = (current.thirst ?? 0) * (1 - (currentCues.waterHere ?? 0));
      score += (
        Math.max(0, method.expectedWorldEffects?.['world:food'] ?? 0) * foodNeed +
        Math.max(0, method.expectedWorldEffects?.['world:water'] ?? 0) * waterNeed
      ) * Math.max(0.75, contextSimilarity) * affordanceSimilarity * 0.14;
      // The name of an action has no assigned value: only a personally
      // observed product/progress can acquire value for a perceived need.
      const safety = 1 - Math.pow(Math.max(current.thirst ?? 0, current.hunger ?? 0), 3);
      score += (
        Math.max(0, method.expectedWorldEffects?.['world:shelter'] ?? 0) *
          (0.2 + (currentCues.housingPressure ?? 0)) +
        Math.max(0, method.expectedWorldEffects?.['world:materials'] ?? 0) *
          (0.12 + (currentCues.housingPressure ?? 0)) +
        Math.max(0, method.expectedWorldEffects?.['world:clothing'] ?? 0) *
          (currentCues.clothingNeed ?? 0)
      ) * safety * method.confidence * reliability * 0.12;
      score += Math.max(0, method.expectedExternalReward ?? 0) *
        currentPressure * contextSimilarity * affordanceSimilarity * 0.001;
      // Preserve some chance to revisit a personally useful method in a
      // similar bodily context. A past failure caused by missing materials
      // must not permanently suppress an action that once relieved a signal.
      score += reliability * currentPressure * contextSimilarity * affordanceSimilarity * 0.0008;
      // A remembered action that repeatedly fails at its actual destination
      // should lose priority, so the brain can try another personally learned
      // method such as refilling water at a well.
      score *= reliability;
      return { method, score };
    })
    .filter((entry) => entry.score > 0.0001);

  if (scored.length === 0) return undefined;
  const best = Math.max(...scored.map((entry) => entry.score));
  // Learned values are small normalized relief estimates. Keep uncertainty,
  // while making a clearly better bodily result measurably more likely.
  const weights = scored.map((entry) => Math.exp((entry.score - best) / 0.009));
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

/** Try a currently perceived, physically reachable possibility without
 * assigning an innate benefit to its action name. Only the lived outcome can
 * turn a trial into a useful method. The executor owns the capability list. */
export function chooseExploratoryBrainIntentV1(
  brain: BrainStateV1,
  batch: Readonly<PerceptBatchV1>,
  possibilities: readonly Readonly<ActionIntentV1>[],
  learnedIntent?: Readonly<ActionIntentV1>,
): ActionIntentV1 | undefined {
  if (brain.ownerAgentId !== batch.ownerAgentId) throw new Error('Brain/percept owner mismatch.');
  const pressure = Math.max(...['thirst','hunger','weakness'].map(key => {
    const signal = batch.body.interoception[key as HumanBodySignalKindV1];
    return signal.availability === 'available' ? signal.intensity : 0;
  }));
  const explorationChance = 0.12 * (1 - Math.pow(pressure, 4));
  if (possibilities.length === 0 || (learnedIntent && nextBrainUnit(brain) >= explorationChance)) {
    return learnedIntent ? { ...learnedIntent } : undefined;
  }
  const methods = ensureBrainLearningV1(brain).methods;
  const weights = possibilities.map((possibility) => {
    if (possibility.ownerAgentId !== brain.ownerAgentId) {
      throw new Error('Exploratory intent owner mismatch.');
    }
    const id = methodId(
      possibility.action,
      possibility.target?.kind === 'place' ? possibility.target.objectId : undefined,
    );
    const prior = methods.find((method) => method.id === id);
    // Novel possibilities remain available throughout life. Failed attempts
    // are less tempting, but never permanently forbid trying again.
    return prior ? 1 / (1 + prior.failures * 0.25 + prior.successes * 2) : 1;
  });
  let roll = nextBrainUnit(brain) * weights.reduce((sum, weight) => sum + weight, 0);
  for (let index = 0; index < possibilities.length; index += 1) {
    roll -= weights[index];
    if (roll <= 0) return { ...possibilities[index] };
  }
  return { ...possibilities[possibilities.length - 1] };
}


export function buildPerceivedActionOutcomeV1(
  before: Readonly<PerceptBatchV1>,
  after: Readonly<PerceptBatchV1>,
  action: PortableHumanActionKindV1,
  status: ActionOutcomeV1['status'],
  externalEffects: ActionOutcomeV1['perceivedEffects'] = [],
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
    perceivedEffects: [...effects, ...externalEffects],
  };
}
