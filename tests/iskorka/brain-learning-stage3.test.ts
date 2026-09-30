import { MAX_BRAIN_LEARNED_METHODS_V1 } from '../../src/iskorka/BrainLearningTypesV1';
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createBrainStateV1,
} from '../../src/iskorka/BrainStateV1';
import {
  beginBrainActionAttemptV1,
  chooseLearnedBrainIntentV1,
  finishBrainActionAttemptV1,
} from '../../src/iskorka/BrainLearningV1';
import {
  PORTABLE_HUMAN_CONTRACT_VERSION_V1,
  availableSignalV1,
  unavailableSignalV1,
  type ActionOutcomeV1,
  type HumanEnvironmentalCueKindV1,
  type HumanBodySignalKindV1,
  type PerceptBatchV1,
  type SubjectiveSignalV1,
} from '../../src/iskorka/PortableHumanCoreV1';

const SIGNALS: readonly HumanBodySignalKindV1[] = [
  'thirst','hunger','breathlessness','weakness','coldStress','heatStress',
  'sweating','tremor','heartPounding','bladderUrge','bowelUrge',
  'physicalDiscomfort','cryingDrive','tears','blushing','goosebumps',
  'dryMouth','startle','physicalPleasure','sexualArousal',
  'sexualDesire',
  'postPleasureRelaxation',
];

function percept(
  ownerAgentId: string,
  worldMinute: number,
  values: Partial<Record<HumanBodySignalKindV1, number>>,
  environmentalCues?: Partial<Record<HumanEnvironmentalCueKindV1, number>>,
): PerceptBatchV1 {
  const interoception = Object.fromEntries(
    SIGNALS.map((key) => [key, values[key] === undefined ? unavailableSignalV1() : availableSignalV1(values[key]!)])
  ) as Record<HumanBodySignalKindV1, SubjectiveSignalV1>;
  return {
    version: PORTABLE_HUMAN_CONTRACT_VERSION_V1,
    ownerAgentId,
    worldMinute,
    body: {
      version: PORTABLE_HUMAN_CONTRACT_VERSION_V1,
      ownerAgentId,
      worldMinute,
      ageYears: 3,
      brainLifePhase: 'toddler',
      interoception,
    },
    ...(environmentalCues ? { environmentalCues } : {}),
    localObservations: [{
      objectId: 'well_a',
      kind: 'place',
      relation: 'here',
      channel: 'vision',
      confidence: 1,
    }],
    receivedMessages: [],
  };
}

function outcome(ownerAgentId: string, action: 'drink' | 'eat', startedWorldMinute: number, finishedWorldMinute: number): ActionOutcomeV1 {
  return {
    version: PORTABLE_HUMAN_CONTRACT_VERSION_V1,
    ownerAgentId,
    action,
    startedWorldMinute,
    finishedWorldMinute,
    status: 'completed',
    perceivedEffects: [{ channel: 'body', direction: 'better' }],
  };
}

test('BrainCore learns a useful action from its own before/after perception without BodyCore or WorldState', () => {
  const brain = createBrainStateV1('spark_1', 0, 12345, 0);
  const before = percept('spark_1', 10, { thirst: 0.82, hunger: 0.2 });
  beginBrainActionAttemptV1(brain, before, 'drink', 'well_a');

  const after = percept('spark_1', 12, { thirst: 0.18, hunger: 0.2 });
  const learned = finishBrainActionAttemptV1(brain, after, outcome('spark_1', 'drink', 10, 12));

  assert.ok(learned);
  assert.equal(learned.action, 'drink');
  assert.ok((learned.expectedSignalRelief.thirst ?? 0) > 0.5);

  const later = percept('spark_1', 100, { thirst: 0.75, hunger: 0.15 });
  const intent = chooseLearnedBrainIntentV1(brain, later);
  assert.equal(intent?.action, 'drink');
  assert.equal(intent?.target?.objectId, 'well_a');
});

test('a remembered meal is chosen only when its personally sensed food affordance is present', () => {
  const brain = createBrainStateV1('spark_food_context', 0, 7, 0);
  const before = percept(
    'spark_food_context',
    1,
    { hunger: 0.8 },
    { foodAtHand: 1 },
  );
  beginBrainActionAttemptV1(brain, before, 'eat');
  finishBrainActionAttemptV1(
    brain,
    percept('spark_food_context', 2, { hunger: 0.2 }, { foodAtHand: 0.8 }),
    outcome('spark_food_context', 'eat', 1, 2),
  );

  assert.equal(
    chooseLearnedBrainIntentV1(
      brain,
      percept('spark_food_context', 3, { hunger: 0.9 }, { foodAtHand: 0 }),
    ),
    undefined,
  );
  assert.equal(
    chooseLearnedBrainIntentV1(
      brain,
      percept('spark_food_context', 4, { hunger: 0.9 }, { foodAtHand: 1 }),
    )?.action,
    'eat',
  );
});

test('sexual desire is perceived by BrainCore but does not become an action drive', () => {
  const brain = createBrainStateV1('spark_desire', 0, 9, 0);
  beginBrainActionAttemptV1(
    brain,
    percept('spark_desire', 1, { sexualDesire: 0.8 }),
    'socialize',
  );
  finishBrainActionAttemptV1(
    brain,
    percept('spark_desire', 2, { sexualDesire: 0.2 }),
    outcome('spark_desire', 'eat', 1, 2),
  );
  // Mismatched outcomes are ignored; a valid method still cannot be activated
  // by sexual desire alone because the body owns that drive.
  assert.equal(brain.learning?.pending?.action, 'socialize');
  const matching: ActionOutcomeV1 = {
    version: PORTABLE_HUMAN_CONTRACT_VERSION_V1,
    ownerAgentId: 'spark_desire',
    action: 'socialize',
    startedWorldMinute: 1,
    finishedWorldMinute: 2,
    status: 'completed',
    perceivedEffects: [{ channel: 'sexualDesire', direction: 'better' }],
  };
  finishBrainActionAttemptV1(
    brain,
    percept('spark_desire', 2, { sexualDesire: 0.2 }),
    matching,
  );
  assert.equal(
    chooseLearnedBrainIntentV1(brain, percept('spark_desire', 3, { sexualDesire: 0.9 })),
    undefined,
  );
});

test('same bodily perception does not fabricate a solution in a brain with no lived method', () => {
  const experienced = createBrainStateV1('experienced', 0, 7, 0);
  const naive = createBrainStateV1('naive', 0, 7, 0);

  beginBrainActionAttemptV1(experienced, percept('experienced', 1, { thirst: 0.8 }), 'drink', 'well_a');
  finishBrainActionAttemptV1(
    experienced,
    percept('experienced', 2, { thirst: 0.2 }),
    outcome('experienced', 'drink', 1, 2),
  );

  assert.equal(chooseLearnedBrainIntentV1(naive, percept('naive', 10, { thirst: 0.8 })), undefined);
  assert.equal(chooseLearnedBrainIntentV1(experienced, percept('experienced', 10, { thirst: 0.8 }))?.action, 'drink');
});

test('an action that did not improve perceived state is not treated as a useful learned solution', () => {
  const brain = createBrainStateV1('spark_2', 0, 99, 0);
  beginBrainActionAttemptV1(brain, percept('spark_2', 20, { thirst: 0.7 }), 'drink', 'well_a');
  const learned = finishBrainActionAttemptV1(
    brain,
    percept('spark_2', 21, { thirst: 0.7 }),
    outcome('spark_2', 'drink', 20, 21),
  );
  assert.ok(learned);
  assert.equal(learned.successes, 0);
  assert.equal(chooseLearnedBrainIntentV1(brain, percept('spark_2', 30, { thirst: 0.8 })), undefined);
});

test('bounded brain memory keeps personally useful methods ahead of failed novelty', () => {
  const brain = createBrainStateV1('spark_memory', 0, 77, 0);
  brain.learning = {
    version: 1,
    methods: [
      {
        id: 'eat',
        action: 'eat',
        trials: 8,
        successes: 8,
        failures: 0,
        expectedSignalRelief: { hunger: 0.22 },
        confidence: 0.88,
        lastWorldMinute: 1,
      },
      ...Array.from({ length: MAX_BRAIN_LEARNED_METHODS_V1 - 1 }, (_, index) => ({
        id: `drink@failed_place_${index}`,
        action: 'drink' as const,
        targetObjectId: `failed_place_${index}`,
        trials: 1,
        successes: 0,
        failures: 1,
        expectedSignalRelief: {},
        confidence: 0.5,
        lastWorldMinute: 2 + index,
      })),
    ],
  };

  beginBrainActionAttemptV1(
    brain,
    percept('spark_memory', 100, { thirst: 0.8 }),
    'drink',
    'well_b',
  );
  finishBrainActionAttemptV1(
    brain,
    percept('spark_memory', 101, { thirst: 0.2 }),
    outcome('spark_memory', 'drink', 100, 101),
  );

  assert.equal(brain.learning.methods.length, MAX_BRAIN_LEARNED_METHODS_V1);
  assert.ok(brain.learning.methods.some((method) => method.id === 'eat'));
});

test('a scarce food outcome learned by one person matters during hunger without making conversation food', () => {
  const brain = createBrainStateV1('spark_resources', 0, 218, 0);
  const learnedAt = percept('spark_resources', 1, { hunger: 0.8 }, { foodAtHand: 0, knownFoodSource: 1 });
  beginBrainActionAttemptV1(brain, learnedAt, 'gather', 'field');
  finishBrainActionAttemptV1(brain, percept('spark_resources', 2, { hunger: 0.8 }, { foodAtHand: 1, knownFoodSource: 1 }), {
    version: PORTABLE_HUMAN_CONTRACT_VERSION_V1,
    ownerAgentId: 'spark_resources', action: 'gather', startedWorldMinute: 1, finishedWorldMinute: 2,
    status: 'completed', perceivedEffects: [{ channel: 'world:food', direction: 'better' }],
  });
  beginBrainActionAttemptV1(brain, learnedAt, 'socialize');
  finishBrainActionAttemptV1(brain, learnedAt, {
    version: PORTABLE_HUMAN_CONTRACT_VERSION_V1,
    ownerAgentId: 'spark_resources', action: 'socialize', startedWorldMinute: 1, finishedWorldMinute: 2,
    status: 'completed', perceivedEffects: [{ channel: 'world:conversation', direction: 'better' }],
  });
  const empty = percept('spark_resources', 5, { hunger: 0.95 }, { foodAtHand: 0, knownFoodSource: 1 });
  const supplied = percept('spark_resources', 5, { hunger: 0.95 }, { foodAtHand: 1, knownFoodSource: 1 });
  const choicesWhenEmpty = Array.from({ length: 100 }, () => chooseLearnedBrainIntentV1(brain, empty)?.action);
  const choicesWhenSupplied = Array.from({ length: 100 }, () => chooseLearnedBrainIntentV1(brain, supplied)?.action);
  assert.ok(choicesWhenEmpty.filter((action) => action === 'gather').length >
    choicesWhenSupplied.filter((action) => action === 'gather').length);
});


test('neutral repetitions without thirst preserve learned water relief; thirst without relief still counts as failure', () => {
  const brain = createBrainStateV1('neutral', 0, 21, 0);
  beginBrainActionAttemptV1(brain, percept('neutral', 1, { thirst: 0.8 }), 'drink', 'well_a');
  finishBrainActionAttemptV1(brain, percept('neutral', 2, { thirst: 0.2 }), outcome('neutral', 'drink', 1, 2));
  for (let i=3; i<203; i+=2) {
    beginBrainActionAttemptV1(brain, percept('neutral', i, { thirst: 0 }), 'drink', 'well_a');
    finishBrainActionAttemptV1(brain, percept('neutral', i+1, { thirst: 0 }), outcome('neutral', 'drink', i, i+1));
  }
  const method = brain.learning!.methods[0];
  assert.ok(method.expectedSignalRelief.thirst! > 0.5);
  assert.equal(method.failures, 0);
  beginBrainActionAttemptV1(brain, percept('neutral', 204, { thirst: 0.8 }), 'drink', 'well_a');
  finishBrainActionAttemptV1(brain, percept('neutral', 205, { thirst: 0.8 }), outcome('neutral', 'drink', 204, 205));
  assert.equal(method.failures, 1);
  assert.ok(method.expectedSignalRelief.thirst! < 0.5);
});
