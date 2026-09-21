import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BRAIN_LOGICAL_BUDGET_BYTES_V1,
  createBrainStateV1,
  logicalBrainBytesV1,
  tryStoreBrainDatumV1,
} from '../../src/iskorka/BrainStateV1';
import {
  acceptPersonalPerceptBatchV1,
  knownDeathSubjectWorldIdsV1,
  perceptionReferenceForWorldObjectV1,
  shareKnownDeathReportV1,
} from '../../src/iskorka/PersonalPerceptionV1';
import {
  humanVisionDevelopmentV1,
  humanVisualCapacityV1,
} from '../../src/iskorka/HumanVisionDevelopmentV1';
import { perceptBatchForAgentV1 } from '../../src/iskorka/PerceptionAdapterV1';
import { retireBrainOwnerV1 } from '../../src/iskorka/BrainStateAdapterV1';
import { IskorkaRuntime } from '../../src/iskorka/WorldRuntime';
import { InMemoryWorldStore } from '../../src/world/InMemoryWorldStore';

async function world(seed = 'stage3-perception-seed', id = 'stage3-perception-world') {
  const store = new InMemoryWorldStore();
  const runtime = await IskorkaRuntime.openOrCreate(store, seed, id);
  return { store, runtime, state: runtime.snapshot() };
}

test('human vision matures through childhood and normal ageing is gradual', () => {
  const infant = humanVisionDevelopmentV1(0.75);
  const child = humanVisionDevelopmentV1(5);
  const adult = humanVisionDevelopmentV1(25);
  const old = humanVisionDevelopmentV1(85);

  assert.ok(infant.acuityScale < child.acuityScale);
  assert.ok(child.acuityScale < adult.acuityScale);
  assert.ok(old.acuityScale < adult.acuityScale);
  assert.ok(old.acuityScale > infant.acuityScale);
  assert.ok(
    humanVisualCapacityV1(0.75, 0.9, 1) <
      humanVisualCapacityV1(25, 0.9, 1),
  );
});

test('personal perception acquires only visible references and ignores remote hidden changes', async () => {
  const { state } = await world();
  const agent = state.agents.agent_1;
  const brain = state.iskorkaBrainV1!.brainsByAgentId[agent.id];
  const firstBatch = perceptBatchForAgentV1(state, agent.id);
  const accepted = acceptPersonalPerceptBatchV1(brain, firstBatch);
  assert.equal(accepted.accepted, true);

  const visibleIds = new Set(firstBatch.localObservations.map((item) => item.objectId));
  for (const observation of firstBatch.localObservations) {
    assert.ok(perceptionReferenceForWorldObjectV1(brain, observation.objectId));
  }

  const remote = Object.values(state.places).find(
    (place) =>
      !visibleIds.has(place.id) &&
      place.id !== agent.locationId,
  );
  assert.ok(remote);
  assert.equal(perceptionReferenceForWorldObjectV1(brain, remote!.id), undefined);

  const before = structuredClone(brain.perception);
  remote!.fertility = 1 - remote!.fertility;
  remote!.danger = 1 - remote!.danger;
  const secondBatch = perceptBatchForAgentV1(state, agent.id);
  acceptPersonalPerceptBatchV1(brain, secondBatch);
  assert.deepEqual(brain.perception, before);
  assert.equal(perceptionReferenceForWorldObjectV1(brain, remote!.id), undefined);
});

test('two sparks in the same current place can retain different personal references from different experience', async () => {
  const { state } = await world('stage3-different-history', 'stage3-different-history-world');
  const a = state.agents.agent_1;
  const b = state.agents.agent_2;
  const brainA = state.iskorkaBrainV1!.brainsByAgentId[a.id];
  const brainB = state.iskorkaBrainV1!.brainsByAgentId[b.id];

  const aBatch = perceptBatchForAgentV1(state, a.id);
  const learnedOnlyByA = aBatch.localObservations.find(
    (item) => item.kind === 'place' && item.objectId !== a.locationId,
  );
  assert.ok(learnedOnlyByA);
  acceptPersonalPerceptBatchV1(brainA, aBatch);
  assert.ok(perceptionReferenceForWorldObjectV1(brainA, learnedOnlyByA!.objectId));
  assert.equal(perceptionReferenceForWorldObjectV1(brainB, learnedOnlyByA!.objectId), undefined);

  b.locationId = a.locationId;
  b.position = { ...a.position };
  const currentA = perceptBatchForAgentV1(state, a.id);
  const currentB = perceptBatchForAgentV1(state, b.id);
  acceptPersonalPerceptBatchV1(brainA, currentA);
  acceptPersonalPerceptBatchV1(brainB, currentB);

  assert.equal(a.locationId, b.locationId);
  assert.ok(perceptionReferenceForWorldObjectV1(brainA, learnedOnlyByA!.objectId));
  if (!currentB.localObservations.some((item) => item.objectId === learnedOnlyByA!.objectId)) {
    assert.equal(perceptionReferenceForWorldObjectV1(brainB, learnedOnlyByA!.objectId), undefined);
  }
});

test('local remains create personal death knowledge; a remote relative learns only after accessible speech', async () => {
  const { state } = await world('stage3-death-message', 'stage3-death-message-world');
  const witness = state.agents.agent_1;
  const relative = state.agents.agent_2;
  const subject = state.agents.agent_3;

  subject.life.alive = false;
  subject.life.health = 0;
  subject.life.diedAt = state.now;
  subject.life.deathCause = 'old_age';
  retireBrainOwnerV1(state, subject, state.calendar.elapsedWorldMinutes);
  delete state.v21!.bodiesByAgentId[subject.id];

  state.v16!.remainsById['remains:test-subject'] = {
    id: 'remains:test-subject',
    agentId: subject.id,
    race: 'human',
    deathWorldMinute: state.calendar.elapsedWorldMinutes,
    deathPlaceId: witness.locationId,
    currentPlaceId: witness.locationId,
    homeSettlementId: state.places[subject.homeId]?.settlementId,
    status: 'unburied',
    contaminationRisk: 0,
    buriedByAgentIds: [],
  };

  relative.locationId = relative.homeId;
  relative.position = {
    x: state.places[relative.homeId].mapX,
    y: state.places[relative.homeId].mapY,
    layerId: 'surface',
  };

  const witnessBrain = state.iskorkaBrainV1!.brainsByAgentId[witness.id];
  const relativeBrain = state.iskorkaBrainV1!.brainsByAgentId[relative.id];
  acceptPersonalPerceptBatchV1(
    witnessBrain,
    perceptBatchForAgentV1(state, witness.id),
  );
  acceptPersonalPerceptBatchV1(
    relativeBrain,
    perceptBatchForAgentV1(state, relative.id),
  );

  assert.ok(knownDeathSubjectWorldIdsV1(witnessBrain).includes(subject.id));
  assert.equal(knownDeathSubjectWorldIdsV1(relativeBrain).includes(subject.id), false);
  assert.equal(
    relativeBrain.perception?.recentMessages.some(
      (message) => message.eventKind === 'death_report',
    ) ?? false,
    false,
  );

  relative.locationId = witness.locationId;
  relative.position = { ...witness.position };
  delete relative.movement;
  delete witness.movement;
  state.v18!.languageByAgentId[witness.id].spokenExpression = 0.9;
  state.v18!.languageByAgentId[relative.id].spokenComprehension = 0.9;

  const shared = shareKnownDeathReportV1(
    state,
    witness,
    relative,
    'test:death-report',
  );
  assert.equal(shared, true);
  const report = relativeBrain.perception!.recentMessages.find(
    (message) => message.messageId === 'test:death-report',
  );
  assert.ok(report);
  assert.equal(report!.eventKind, 'death_report');
  assert.ok(report!.subjectRefId);
  assert.ok(
    perceptionReferenceForWorldObjectV1(relativeBrain, subject.id),
  );
});

test('stage-3 perception never pushes a nearly full brain past 256 KiB', async () => {
  const { state } = await world('stage3-budget', 'stage3-budget-world');
  const agent = state.agents.agent_1;
  const brain = createBrainStateV1(
    agent.id,
    agent.life.generation,
    state.determinism.rngState,
    state.calendar.elapsedWorldMinutes,
  );
  assert.equal(
    tryStoreBrainDatumV1(brain, {
      id: 'nearly-full',
      section: 'knowledge',
      kind: 'synthetic-load',
      source: 'self_observation',
      encoded: 'x'.repeat(255 * 1024),
    }),
    true,
  );
  const result = acceptPersonalPerceptBatchV1(
    brain,
    perceptBatchForAgentV1(state, agent.id),
  );
  assert.equal(result.budgetBlocked, true);
  assert.ok(logicalBrainBytesV1(brain) <= BRAIN_LOGICAL_BUDGET_BYTES_V1);
  assert.equal(brain.perception, undefined);
});

test('real world loop writes personal perception into persisted human brains', async () => {
  const { runtime } = await world('stage3-runtime', 'stage3-runtime-world');
  await runtime.advanceTo(8_760);
  const after = runtime.snapshot();
  const living = Object.values(after.agents).filter(
    (agent) => agent.life.alive && (agent.race ?? 'human') === 'human',
  );
  assert.ok(
    living.some(
      (agent) =>
        after.iskorkaBrainV1!.brainsByAgentId[agent.id].perception
          ?.lastPerceptWorldMinute === 8_760,
    ),
  );
});

test('personal perception update stays bounded under repeated current-world sampling', async () => {
  const { state } = await world('stage3-perf', 'stage3-perf-world');
  const agent = state.agents.agent_1;
  const brain = state.iskorkaBrainV1!.brainsByAgentId[agent.id];
  const batch = perceptBatchForAgentV1(state, agent.id);
  const start = performance.now();
  for (let index = 0; index < 20_000; index += 1) {
    acceptPersonalPerceptBatchV1(brain, batch);
  }
  const elapsedMs = performance.now() - start;
  assert.ok(elapsedMs < 2_500, `20k personal percept updates took ${elapsedMs.toFixed(1)} ms`);
  assert.ok(logicalBrainBytesV1(brain) <= BRAIN_LOGICAL_BUDGET_BYTES_V1);
});
