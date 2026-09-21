import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAgentAnalyticsV1 } from '../../src/iskorka/AgentAnalyticsV1';
import { IskorkaRuntime } from '../../src/iskorka/WorldRuntime';
import { InMemoryWorldStore } from '../../src/world/InMemoryWorldStore';

async function create(seed='analytics-seed', id='analytics-world') {
  const store = new InMemoryWorldStore();
  const runtime = await IskorkaRuntime.openOrCreate(store, seed, id);
  return { store, runtime, world: runtime.snapshot() };
}

test('agent analytics is an exact read-only snapshot of current world minute', async () => {
  const { runtime, world } = await create();
  const agent = world.agents.agent_1;
  const before = structuredClone(world);
  const analytics = buildAgentAnalyticsV1(world, agent.id);

  assert.equal(analytics.agentId, agent.id);
  assert.equal(analytics.worldMinute, world.calendar.elapsedWorldMinutes);
  assert.equal(analytics.worldRevision, world.revision);
  assert.equal(analytics.identity.locationId, agent.locationId);
  assert.equal(analytics.life.health, agent.life.health);
  assert.equal(analytics.life.energy, agent.energy);
  assert.equal(analytics.brain.present, true);
  assert.ok(analytics.brain.usedBytes > 0);
  assert.ok(analytics.brain.remainingBytes >= 0);
  assert.equal(analytics.body.present, true);
  assert.ok(analytics.body.homeostasis);
  assert.ok(analytics.body.signals);
  assert.equal(typeof analytics.body.signals!.thirst, 'number');
  assert.equal(typeof analytics.body.motorDevelopment.walkingCapacity, 'number');
  assert.equal(typeof analytics.body.visionDevelopment.acuityScale, 'number');
  assert.deepEqual(world, before);

  await runtime.advanceTo(8_760);
  const advanced = runtime.snapshot();
  const live = buildAgentAnalyticsV1(advanced, agent.id);
  assert.equal(live.worldMinute, 8_760);
  assert.ok(live.worldRevision > analytics.worldRevision);
});

test('analytics exposes finite brain and current BodyCore without foreign brain data', async () => {
  const { world } = await create('analytics-isolation', 'analytics-isolation-world');
  const a = buildAgentAnalyticsV1(world, 'agent_1');
  const b = buildAgentAnalyticsV1(world, 'agent_2');

  assert.notEqual(a.agentId, b.agentId);
  assert.equal(a.brain.budgetBytes, 256 * 1024);
  assert.ok(a.brain.usedBytes <= a.brain.budgetBytes);
  assert.ok(b.brain.usedBytes <= b.brain.budgetBytes);
  assert.equal(a.body.phenotype, world.v21!.bodiesByAgentId.agent_1.bodyCore!.phenotype);
  assert.equal(a.mind.mind, world.agents.agent_1.mind);
  assert.equal(
    JSON.stringify(a).includes(world.agents.agent_2.mind.identityId),
    false,
  );
});

test('analytics reflects deliberate body changes on the next snapshot', async () => {
  const { world } = await create('analytics-body', 'analytics-body-world');
  const agent = world.agents.agent_1;
  const body = world.v21!.bodiesByAgentId[agent.id];
  const core = body.bodyCore!;
  const before = buildAgentAnalyticsV1(world, agent.id);

  core.homeostasis.hydration = 0.31;
  core.homeostasis.coreTemperatureC = 38.2;
  body.pain = 0.44;
  const after = buildAgentAnalyticsV1(world, agent.id);

  assert.notEqual(after.body.signals!.thirst, before.body.signals!.thirst);
  assert.equal(after.body.homeostasis!.hydration, 0.31);
  assert.equal(after.body.homeostasis!.coreTemperatureC, 38.2);
  assert.equal(after.body.pain, 0.44);
});

test('analytics cost stays small for repeated selected-Spark refreshes', async () => {
  const { world } = await create('analytics-perf', 'analytics-perf-world');
  const start = performance.now();
  let checksum = 0;
  for (let index = 0; index < 10_000; index += 1) {
    const snapshot = buildAgentAnalyticsV1(world, 'agent_1');
    checksum += snapshot.brain.usedBytes + snapshot.worldMinute;
  }
  const elapsedMs = performance.now() - start;
  assert.ok(checksum > 0);
  assert.ok(elapsedMs < 2_500, `10k analytics snapshots took ${elapsedMs.toFixed(1)} ms`);
});
