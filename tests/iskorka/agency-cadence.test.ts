import test from 'node:test';
import assert from 'node:assert/strict';
import { InMemoryWorldStore } from '../../src/world/InMemoryWorldStore';
import { IskorkaRuntime } from '../../src/iskorka/WorldRuntime';
import {
  agencyReviewIntervalV1,
  ensureResidentAgencyCadenceV1,
} from '../../src/iskorka/ResidentAgencyCadenceV1';

test('human-scale agency reviews happen before the legacy six-day world batch', async () => {
  const store = new InMemoryWorldStore();
  const runtime = await IskorkaRuntime.openOrCreate(
    store,
    'agency-human-scale',
    'agency-human-scale-world',
  );
  const before = runtime.snapshot();
  assert.equal(before.v15!.simulationClock.quantumIndex, 0);
  assert.ok(Object.values(before.agents).every(agent => !agent.lastDecision));
  assert.ok(Object.values(before.agents).every(agent => !agent.agencyCadence));

  await runtime.advanceTo(12 * 60);
  const after = runtime.snapshot();

  assert.equal(after.v15!.simulationClock.quantumIndex, 0);
  assert.equal(after.v15!.simulationClock.pendingWorldMinutes, 12 * 60);
  const reviewed = Object.values(after.agents).filter(
    agent => (agent.agencyCadence?.reviewCount ?? 0) > 0,
  );
  assert.equal(reviewed.length, 10);
  assert.ok(reviewed.every(agent => agent.agencyCadence?.currentIntent));
  assert.ok(reviewed.every(agent => agent.agencyCadence?.innerThought));
  // A preview is an intention, not a completed world action.
  assert.ok(reviewed.every(agent => !agent.lastDecision));
  assert.ok(reviewed.every(agent =>
    (agent.agencyCadence?.nextReviewWorldMinute ?? 0) >
    after.calendar.elapsedWorldMinutes,
  ));
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
  const cadence = ensureResidentAgencyCadenceV1(world, agent);
  assert.ok(cadence.nextReviewWorldMinute - world.calendar.elapsedWorldMinutes <= 90);

  const routine = agencyReviewIntervalV1(world, agent, 'relax', 3);
  const major = agencyReviewIntervalV1(world, agent, 'explore', 3);
  assert.ok(routine >= 30 && routine <= 180);
  assert.ok(major >= 120 && major <= 480);
});

test('strong body urgency can interrupt intention within half an hour', async () => {
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
  agent.energy = 0.05;
  agent.stress = 0.95;
  core.homeostasis.hydration = 0.18;
  core.homeostasis.energyReserve = 0.12;
  core.homeostasis.muscleFatigue = 0.9;
  core.homeostasis.oxygenDebt = 0.72;

  const interval = agencyReviewIntervalV1(world, agent, 'explore', 9);
  assert.ok(interval >= 15 && interval <= 30);
});
