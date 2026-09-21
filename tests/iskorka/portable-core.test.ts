import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { IskorkaRuntime } from '../../src/iskorka/WorldRuntime';
import { InMemoryWorldStore } from '../../src/world/InMemoryWorldStore';
import {
  acceptPerceptBatchV1,
  createPortableBrainCoreShellV1,
} from '../../src/iskorka/PortableHumanCoreV1';
import {
  humanBodyPerceptV1,
  perceptBatchForAgentV1,
} from '../../src/iskorka/PerceptionAdapterV1';
import { bodySignalsV1 } from '../../src/iskorka/BodyCoreV1';

async function world() {
  const runtime = await IskorkaRuntime.openOrCreate(
    new InMemoryWorldStore(),
    'portable-contract-seed',
    'portable-contract-world',
  );
  return runtime.snapshot();
}

test('portable core has no WorldEngine/WorldState dependency', () => {
  const source = readFileSync('src/iskorka/PortableHumanCoreV1.ts', 'utf8');
  assert.doesNotMatch(source, /WorldEngine|WorldState|\.\.\/world/);
});

test('body percept exposes bounded subjective signals and not physical internals', async () => {
  const state = await world();
  const agent = state.agents.agent_1;
  const percept = humanBodyPerceptV1(state, agent);
  assert.equal(percept.ownerAgentId, agent.id);
  assert.equal(percept.worldMinute, state.calendar.elapsedWorldMinutes);
  assert.equal(percept.interoception.thirst.availability, 'available');
  assert.equal('homeostasis' in (percept as unknown as Record<string, unknown>), false);
  assert.equal('reproductive' in (percept as unknown as Record<string, unknown>), false);
  assert.ok(JSON.stringify(percept).length < 5_000);
});

test('interoception is a subjective deterministic reading, not raw BodyCore numbers', async () => {
  const state = await world();
  const agent = state.agents.agent_1;
  const body = state.v21!.bodiesByAgentId[agent.id];
  const core = body.bodyCore!;
  core.phenotype.interoceptionSensitivity = 0.52;
  core.homeostasis.hydration = 0.37;
  core.homeostasis.energyReserve = 0.28;
  const raw = bodySignalsV1(agent, body, core);
  const first = humanBodyPerceptV1(state, agent);
  const second = humanBodyPerceptV1(state, agent);
  assert.deepEqual(first, second);
  assert.equal(first.interoception.thirst.availability, 'available');
  if (first.interoception.thirst.availability !== 'available') throw new Error('expected thirst');
  assert.notEqual(first.interoception.thirst.intensity, raw.thirst);
});

test('missing body signal state is unavailable rather than ideal zero', async () => {
  const state = await world();
  const agent = state.agents.agent_1;
  delete state.v21!.bodiesByAgentId[agent.id].bodyCore;
  const percept = humanBodyPerceptV1(state, agent);
  assert.equal(percept.interoception.thirst.availability, 'unavailable');
  assert.equal(percept.interoception.weakness.availability, 'unavailable');
  assert.equal(percept.interoception.physicalDiscomfort.availability, 'unavailable');
});

test('perception adapter does not leak remote hidden world changes', async () => {
  const state = await world();
  const agent = state.agents.agent_1;
  const before = perceptBatchForAgentV1(state, agent.id);
  const remote = Object.values(state.places).find(
    (place) =>
      place.id !== agent.locationId &&
      !state.places[agent.locationId].connectedPlaceIds.includes(place.id),
  );
  assert.ok(remote);
  remote!.fertility = Math.max(0, 1 - remote!.fertility);
  remote!.danger = Math.max(0, 1 - remote!.danger);
  const after = perceptBatchForAgentV1(state, agent.id);
  assert.deepEqual(after, before);
});

test('co-located person observation contains identity reference but no private mind', async () => {
  const state = await world();
  const a = state.agents.agent_1;
  const b = state.agents.agent_2;
  b.locationId = a.locationId;
  b.position = { ...a.position };
  delete b.movement;
  const percept = perceptBatchForAgentV1(state, a.id);
  const seen = percept.localObservations.find(
    (entry) => entry.kind === 'person' && entry.objectId === b.id,
  );
  assert.ok(seen);
  const text = JSON.stringify(seen);
  assert.doesNotMatch(text, /emotion|belief|goal|stress|skill|memory|resource/);
  assert.equal('observedLabel' in seen!, false);
  assert.equal(text.includes(b.name), false);
  assert.ok(percept.localObservations.length <= 24);
});

test('portable brain shell accepts only its own monotonic percept stream', async () => {
  const state = await world();
  const agent = state.agents.agent_1;
  const batch = perceptBatchForAgentV1(state, agent.id);
  const brain = createPortableBrainCoreShellV1(
    agent.id,
    agent.life.generation,
    state.determinism.rngState,
  );
  const first = {
    ...batch,
    worldMinute: 10,
    body: { ...batch.body, worldMinute: 10 },
  };
  acceptPerceptBatchV1(brain, first);
  assert.equal(brain.lastAcceptedPerceptWorldMinute, 10);

  assert.throws(
    () => acceptPerceptBatchV1(brain, { ...first, ownerAgentId: 'other' }),
    /owner mismatch/,
  );
  assert.throws(
    () => acceptPerceptBatchV1(brain, {
      ...first,
      worldMinute: 9,
      body: { ...first.body, worldMinute: 9 },
    }),
    /backwards/,
  );
});

test('portable percept generation remains cheap and bounded', async () => {
  const state = await world();
  const ids = Object.keys(state.agents);
  const start = performance.now();
  let bytes = 0;
  for (let index = 0; index < 20_000; index += 1) {
    const batch = perceptBatchForAgentV1(state, ids[index % ids.length]);
    bytes += JSON.stringify(batch).length;
  }
  const elapsedMs = performance.now() - start;
  assert.ok(bytes > 0);
  assert.ok(elapsedMs < 2_500, `perception benchmark took ${elapsedMs.toFixed(1)} ms`);
});
