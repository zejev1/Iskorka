import test from 'node:test';
import assert from 'node:assert/strict';
import { InMemoryWorldStore } from '../../src/world/InMemoryWorldStore';
import { IskorkaRuntime } from '../../src/iskorka/WorldRuntime';
import {
  agencyReviewIntervalV1,
  projectResidentAgencyCadenceV1,
} from '../../src/iskorka/ResidentAgencyCadenceV1';

test('founding infants do not receive the adult agency projection before mentor adulthood', async () => {
  const store = new InMemoryWorldStore();
  const runtime = await IskorkaRuntime.openOrCreate(
    store,
    'agency-human-scale',
    'agency-human-scale-world',
  );
  const before = runtime.presentationSnapshot();
  assert.equal(before.v15!.simulationClock.quantumIndex, 0);
  assert.ok(Object.values(before.agents).every(agent => !agent.lastDecision));
  assert.ok(Object.values(before.agents).every(agent => agent.agencyCadence === undefined));

  await runtime.advanceTo(12 * 60);
  const after = runtime.presentationSnapshot();

  assert.equal(after.v15!.simulationClock.quantumIndex, 0);
  assert.equal(after.v15!.simulationClock.pendingWorldMinutes, 12 * 60);
  for (const agent of Object.values(after.agents)) {
    assert.equal(agent.agencyCadence, undefined);
    assert.equal(agent.lastDecision, undefined);
  }
});
test('ordinary intention cadence uses human hours, not six-day intervals', async () => {
  const store = new InMemoryWorldStore();
  const runtime = await IskorkaRuntime.openOrCreate(
    store,
    'agency-cadence-bounds',
    'agency-cadence-bounds-world',
  );
  const world = runtime.presentationSnapshot();
  const agent = world.agents.agent_1;
  const cadence = projectResidentAgencyCadenceV1(world, agent);
  const interval = agencyReviewIntervalV1(world, agent);
  assert.ok(interval >= 30 && interval <= 180);
  assert.ok(cadence.nextReviewWorldMinute > cadence.lastReviewWorldMinute);
  assert.ok(
    cadence.nextReviewWorldMinute - cadence.lastReviewWorldMinute <= 180,
  );
});

test('strong body urgency changes the current projected intention without mutating history', async () => {
  const store = new InMemoryWorldStore();
  const runtime = await IskorkaRuntime.openOrCreate(
    store,
    'agency-urgent-body',
    'agency-urgent-body-world',
  );
  const world = runtime.presentationSnapshot();
  const agent = world.agents.agent_1;
  const body = world.v21!.bodiesByAgentId[agent.id];
  const core = body.bodyCore!;
  agent.energy = 0.03;
  agent.stress = 0.98;
  agent.resources = 0.6;
  core.homeostasis.hydration = 0.42;
  core.homeostasis.energyReserve = 0.18;
  core.homeostasis.muscleFatigue = 0.92;
  core.homeostasis.oxygenDebt = 0.78;

  const beforeDecision = agent.lastDecision;
  const projected = projectResidentAgencyCadenceV1(world, agent);
  assert.equal(projected.currentIntent, 'rest');
  assert.equal(agent.lastDecision, beforeDecision);
});


test('infant projection never fabricates an adult inner monologue', async () => {
  const store = new InMemoryWorldStore();
  const runtime = await IskorkaRuntime.openOrCreate(
    store,
    'agency-infant-development',
    'agency-infant-development-world',
  );
  const world = runtime.presentationSnapshot();
  const infant = world.agents.agent_1;
  infant.life.ageYears = 0.75;
  infant.life.stage = 'child';

  const projected = projectResidentAgencyCadenceV1(world, infant);
  assert.equal(projected.currentIntent, 'rest');
  assert.equal(projected.innerThought, undefined);
  assert.equal(projected.deliberationWorldMinutes, undefined);
});
