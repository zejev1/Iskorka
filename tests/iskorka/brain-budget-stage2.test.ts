import test from 'node:test';
import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';
import {
  BRAIN_LOGICAL_BUDGET_BYTES_V1,
  brainBudgetRemainingBytesV1,
  createBrainStateV1,
  logicalBrainBytesV1,
  setBrainWorkingStepV1,
  tryStoreBrainDatumV1,
} from '../../src/iskorka/BrainStateV1';
import {
  brainForLiveOwnerV1,
  retireBrainOwnerV1,
} from '../../src/iskorka/BrainStateAdapterV1';
import {
  applyHumanMotorActionEnvelopeV1,
  humanMotorDevelopmentV1,
  humanMotorMobilityScaleV1,
} from '../../src/iskorka/HumanMotorDevelopmentV1';
import { IskorkaRuntime } from '../../src/iskorka/WorldRuntime';
import { ISKORKA_WORLD_ID } from '../../src/iskorka/Profile';
import { createStandaloneWorldStore } from '../../src/persistence/IndexedDbPersistence';
import { InMemoryWorldStore } from '../../src/world/InMemoryWorldStore';
import type { MemoryRecord, WorldState } from '../../src/world/types';

async function fresh(seed = 'brain-stage2-seed') {
  const store = new InMemoryWorldStore();
  const runtime = await IskorkaRuntime.openOrCreate(store, seed, ISKORKA_WORLD_ID);
  return { store, runtime, world: runtime.snapshot() };
}

function ownedMemory(
  worldId: string,
  agentId: string,
  relatedAgentId: string,
  id: string,
): MemoryRecord {
  return {
    memoryId: id,
    worldId,
    agentId,
    createdAt: 123,
    kind: 'interaction',
    summary: `${agentId} remembers a specific meeting with ${relatedAgentId}.`,
    importance: 0.91,
    valence: 0.42,
    relatedAgentIds: [relatedAgentId],
  };
}

test('BrainState enforces one real 256 KiB logical ceiling', () => {
  const brain = createBrainStateV1('person', 0, 7, 0);
  assert.equal(
    tryStoreBrainDatumV1(brain, {
      id: 'large-but-valid',
      section: 'knowledge',
      kind: 'synthetic',
      source: 'self_observation',
      encoded: 'x'.repeat(180 * 1024),
    }),
    true,
  );
  const acceptedBytes = logicalBrainBytesV1(brain);
  assert.ok(acceptedBytes < BRAIN_LOGICAL_BUDGET_BYTES_V1);

  assert.equal(
    tryStoreBrainDatumV1(brain, {
      id: 'must-not-overflow',
      section: 'knowledge',
      kind: 'synthetic',
      source: 'self_observation',
      encoded: 'y'.repeat(100 * 1024),
    }),
    false,
  );
  assert.equal(logicalBrainBytesV1(brain), acceptedBytes);
  assert.ok(brainBudgetRemainingBytesV1(brain) >= 0);
  assert.ok(logicalBrainBytesV1(brain) <= BRAIN_LOGICAL_BUDGET_BYTES_V1);
});

test('fresh world persists exactly one bounded BrainState per living human', async () => {
  const { world } = await fresh();
  const living = Object.values(world.agents).filter(
    (agent) => agent.life.alive && (agent.race ?? 'human') === 'human',
  );
  assert.equal(
    Object.keys(world.iskorkaBrainV1?.brainsByAgentId ?? {}).length,
    living.length,
  );
  for (const agent of living) {
    const brain = world.iskorkaBrainV1!.brainsByAgentId[agent.id];
    assert.equal(brain.ownerAgentId, agent.id);
    assert.equal(brain.ownerGeneration, agent.life.generation);
    assert.ok(logicalBrainBytesV1(brain) <= BRAIN_LOGICAL_BUDGET_BYTES_V1);
  }
});

test('legacy personal memory is migrated once into BrainState and old owner stream is purged', async () => {
  const seed = await fresh('legacy-memory-source');
  const legacy = seed.world;
  delete legacy.iskorkaBrainV1;

  const store = new InMemoryWorldStore();
  await store.initializeWorld(legacy);
  const owner = legacy.agents.agent_1;
  const other = legacy.agents.agent_2;
  const memory = ownedMemory(legacy.id, owner.id, other.id, 'legacy-owned-memory');
  const revisionOne = structuredClone(legacy);
  revisionOne.revision = 1;
  await store.commit({
    operationId: 'seed-legacy-memory',
    operationFingerprint: 'seed-legacy-memory-v1',
    worldId: legacy.id,
    expectedRevision: 0,
    nextState: revisionOne,
    events: [],
    memories: [memory],
  });

  const migrated = await IskorkaRuntime.openOrCreate(store, 'ignored', legacy.id);
  const first = migrated.snapshot();
  const brain = first.iskorkaBrainV1!.brainsByAgentId[owner.id];
  assert.ok(brain.migration.importedLegacy);
  const imported = brain.data.find(
    (datum) => datum.id === 'legacy:persistent-memory-store',
  );
  assert.ok(imported);
  assert.match(imported.encoded, /specific meeting/);
  assert.deepEqual(await store.historyForAgent(legacy.id, owner.id), []);

  const count = brain.data.length;
  const bytes = logicalBrainBytesV1(brain);
  const revision = first.revision;
  const reopened = await IskorkaRuntime.openOrCreate(store, 'ignored-again', legacy.id);
  const again = reopened.snapshot().iskorkaBrainV1!.brainsByAgentId[owner.id];
  assert.equal(reopened.snapshot().revision, revision);
  assert.equal(again.data.length, count);
  assert.equal(logicalBrainBytesV1(again), bytes);
});

test('unfinished BrainState working step survives save and reopen', async () => {
  const seed = await fresh('brain-working-step');
  const world = seed.world;
  const brain = world.iskorkaBrainV1!.brainsByAgentId.agent_1;
  assert.equal(
    setBrainWorkingStepV1(brain, {
      stepId: 'unfinished:walk-home',
      startedWorldMinute: 77,
      phase: 'acting',
      action: 'walk',
      targetObjectId: 'home_agent_1',
    }),
    true,
  );

  const store = new InMemoryWorldStore();
  await store.initializeWorld(world);
  const opened = await IskorkaRuntime.openOrCreate(store, 'ignored', world.id);
  assert.deepEqual(
    opened.snapshot().iskorkaBrainV1!.brainsByAgentId.agent_1.workingStep,
    brain.workingStep,
  );
});

test('old-age death removes own brain and managed recovery without erasing identity links', async () => {
  const seed = await fresh('forced-old-age');
  const world = seed.world;
  const dying = world.agents.agent_1;
  const living = world.agents.agent_2;
  dying.life.ageYears = dying.life.lifespanYears - 0.001;
  dying.life.stage = 'elder';
  dying.life.childIds = [living.id];
  living.life.parentIds = [dying.id];

  const store = new InMemoryWorldStore();
  await store.initializeWorld(world);
  await store.checkpointWorld(world.id, 0, 'before-forced-death');
  const runtime = await IskorkaRuntime.openOrCreate(store, 'ignored', world.id);
  await runtime.advanceTo(8_760);
  const after = runtime.snapshot();
  const dead = after.agents[dying.id];

  assert.equal(dead.life.alive, false);
  assert.equal(after.iskorkaBrainV1!.brainsByAgentId[dying.id], undefined);
  assert.equal(
    after.iskorkaBrainV1!.retiredOwnersByAgentId[dying.id].ownerGeneration,
    dying.life.generation,
  );
  assert.equal(brainForLiveOwnerV1(after, dying.id, dying.life.generation), undefined);
  assert.deepEqual(dead.life.childIds, [living.id]);
  assert.deepEqual(after.agents[living.id].life.parentIds, [dying.id]);
  assert.equal(dead.learning, undefined);
  assert.equal(after.v15!.knowledgeByAgentId[dying.id], undefined);
  assert.equal(after.v18!.languageByAgentId[dying.id], undefined);
  assert.equal(after.v21!.appliedKnowledgeByAgentId[dying.id], undefined);
  assert.equal(after.v21!.bodiesByAgentId[dying.id], undefined);

  const recoveries = store.migrationBackups.filter((entry) => entry.id === world.id);
  assert.equal(recoveries.length, 1);
  assert.equal(
    recoveries[0].iskorkaBrainV1?.brainsByAgentId[dying.id],
    undefined,
  );
  assert.ok(recoveries[0].iskorkaBrainV1?.retiredOwnersByAgentId[dying.id]);
  const leakedDeathMemory = Object.values(after.iskorkaBrainV1!.brainsByAgentId)
    .flatMap((brainState) => brainState.data)
    .some(
      (datum) =>
        datum.kind === 'legacy_memory:death' &&
        datum.encoded.includes(dying.id),
    );
  assert.equal(leakedDeathMemory, false);
});

test('IndexedDB retirement atomically purges dead private memories and old recovery copies', async () => {
  const dbName = 'iskorka-brain-retirement-idb';
  const store = createStandaloneWorldStore(dbName);
  const runtime = await IskorkaRuntime.openOrCreate(store, 'idb-retire', ISKORKA_WORLD_ID);
  const base = runtime.snapshot();
  const dying = base.agents.agent_1;
  const living = base.agents.agent_2;
  const deadOwned = ownedMemory(base.id, dying.id, living.id, 'dead-owned');
  const livingOwned = ownedMemory(base.id, living.id, dying.id, 'living-owned');

  const revisionOne = structuredClone(base);
  revisionOne.revision = 1;
  await store.commit({
    operationId: 'seed-owner-memories',
    operationFingerprint: 'seed-owner-memories-v1',
    worldId: base.id,
    expectedRevision: 0,
    nextState: revisionOne,
    events: [],
    memories: [deadOwned, livingOwned],
  });
  await store.checkpointWorld(base.id, 1, 'pre-retirement');

  const next = structuredClone(revisionOne);
  const dead = next.agents[dying.id];
  dead.life.alive = false;
  dead.life.diedAt = 500;
  dead.life.deathCause = 'old_age';
  dead.life.health = 0;
  retireBrainOwnerV1(next, dead, 500);
  delete next.v21!.bodiesByAgentId[dead.id];
  delete next.v21!.childSupervisionByChildId[dead.id];
  next.revision = 2;

  await store.commit({
    operationId: 'retire-owner',
    operationFingerprint: 'retire-owner-v1',
    worldId: base.id,
    expectedRevision: 1,
    nextState: next,
    events: [],
    memories: [],
    retiredBrainOwnerIds: [dead.id],
  });

  assert.deepEqual(await store.historyForAgent(base.id, dead.id), []);
  assert.equal((await store.historyForAgent(base.id, living.id)).length, 1);
  const loaded = await store.loadWorld(base.id);
  assert.equal(loaded!.iskorkaBrainV1!.brainsByAgentId[dead.id], undefined);

  const database = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(dbName);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  const transaction = database.transaction('world_recovery', 'readonly');
  const recoveries = await new Promise<any[]>((resolve, reject) => {
    const request = transaction.objectStore('world_recovery').getAll();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  const own = recoveries.filter((entry) => entry.worldId === base.id);
  assert.equal(own.length, 1);
  assert.equal(own[0].state.revision, 2);
  assert.equal(
    own[0].state.iskorkaBrainV1.brainsByAgentId[dead.id],
    undefined,
  );
  database.close();
});

test('human motor development blocks infant walking and grows toward adult locomotion', () => {
  const nineMonths = humanMotorDevelopmentV1(0.75);
  const eighteenMonths = humanMotorDevelopmentV1(1.5);
  const adult = humanMotorDevelopmentV1(18);
  assert.ok(nineMonths.walkingCapacity < 0.1);
  assert.equal(humanMotorMobilityScaleV1(0.75), 0);
  assert.ok(humanMotorMobilityScaleV1(1.5) > 0);
  assert.ok(humanMotorMobilityScaleV1(1.5) < humanMotorMobilityScaleV1(18));
  assert.equal(adult.walkingCapacity, 1);

  const infantActions = applyHumanMotorActionEnvelopeV1(
    0.75,
    new Set(['rest', 'walk', 'explore', 'gather']),
  );
  assert.equal(infantActions.has('walk'), false);
  assert.equal(infantActions.has('explore'), false);

  const toddlerActions = applyHumanMotorActionEnvelopeV1(
    1.5,
    new Set(['rest']),
  );
  assert.equal(toddlerActions.has('walk'), true);
});

test('BrainState and motor profile helpers remain cheap under repeated use', () => {
  const brain = createBrainStateV1('perf-person', 0, 1, 0);
  const started = performance.now();
  let checksum = 0;
  for (let index = 0; index < 250_000; index += 1) {
    const motor = humanMotorDevelopmentV1((index % 216) / 12);
    checksum += motor.walkingCapacity;
  }
  for (let index = 0; index < 2_000; index += 1) {
    checksum += logicalBrainBytesV1(brain);
  }
  const elapsedMs = performance.now() - started;
  assert.ok(checksum > 0);
  assert.ok(elapsedMs < 2_500, `stage-2 helper benchmark took ${elapsedMs.toFixed(1)} ms`);
});
