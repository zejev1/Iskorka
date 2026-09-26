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
  type HumanBodySignalKindV1,
  type PerceptBatchV1,
  type SubjectiveSignalV1,
} from '../../src/iskorka/PortableHumanCoreV1';

const SIGNALS: readonly HumanBodySignalKindV1[] = [
  'thirst','hunger','breathlessness','weakness','coldStress','heatStress',
  'sweating','tremor','heartPounding','bladderUrge','bowelUrge',
  'physicalDiscomfort','cryingDrive','tears','blushing','goosebumps',
  'dryMouth','startle','physicalPleasure','sexualArousal',
  'postPleasureRelaxation',
];

function percept(ownerAgentId: string, worldMinute: number, values: Partial<Record<HumanBodySignalKindV1, number>>): PerceptBatchV1 {
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
