import test from 'node:test';
import assert from 'node:assert/strict';
import { InMemoryWorldStore } from '../../src/world/InMemoryWorldStore';
import { IskorkaRuntime } from '../../src/iskorka/WorldRuntime';
import {
  agencyReviewIntervalV1,
  projectResidentAgencyCadenceV1,
} from '../../src/iskorka/ResidentAgencyCadenceV1';

test('human-scale agency projection changes before the legacy six-day world batch', async () => {
  const store = new InMemoryWorldStore();
  const runtime = await IskorkaRuntime.openOrCreate(
    store,
    'agency-human-scale',
    'agency-human-scale-world',
  );
  const before = runtime.snapshot();
  assert.equal(before.v15!.simulationClock.quantumIndex, 0);
  assert.ok(Object.values(before.agents).every(agent => !agent.lastDecision));
  assert.ok(Object.values(before.agents).every(agent => agent.agencyCadence?.currentIntent));

  const beforeCounts = Object.fromEntries(
    Object.values(before.agents).map(agent => [
      agent.id,
      agent.agencyCadence!.reviewCount,
    ]),
  );

  await runtime.advanceTo(12 * 60);
  const after = runtime.snapshot();

  assert.equal(after.v15!.simulationClock.quantumIndex, 0);
  assert.equal(after.v15!.simulationClock.pendingWorldMinutes, 12 * 60);
  for (const agent of Object.values(after.agents)) {
    assert.ok(agent.agencyCadence?.currentIntent);
    assert.ok(agent.agencyCadence?.innerThought);
    assert.ok(agent.agencyCadence!.reviewCount > beforeCounts[agent.id]);
    assert.ok(agent.agencyCadence!.nextReviewWorldMinute > after.calendar.elapsedWorldMinutes);
    // Human-scale intention is not falsely recorded as a completed world action.
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
  const world = runtime.snapshot();
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
  const world = runtime.snapshot();
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
