import test from 'node:test';
import assert from 'node:assert/strict';
import { IskorkaRuntime } from '../../src/iskorka/WorldRuntime';
import { InMemoryWorldStore } from '../../src/world/InMemoryWorldStore';
import {
  assertBodyCoreV1,
  bodySignalsV1,
} from '../../src/iskorka/BodyCoreV1';
import { assertEmbodiedWorldV21 } from '../../src/v21/EmbodiedWorldV21';

async function create(seed='body-core-seed', id='body-core-world') {
  const store = new InMemoryWorldStore();
  const runtime = await IskorkaRuntime.openOrCreate(store, seed, id);
  return { store, runtime, world: runtime.snapshot() };
}

test('BodyCore creates exactly sex-linked founder bodies: 5 male and 5 female', async () => {
  const { world } = await create();
  const founders = Object.values(world.agents);
  const bodies = world.v21!.bodiesByAgentId;
  assert.equal(founders.length, 10);
  assert.equal(founders.filter(agent => agent.sex === 'male').length, 5);
  assert.equal(founders.filter(agent => agent.sex === 'female').length, 5);

  for (const agent of founders) {
    const core = bodies[agent.id].bodyCore;
    assert.ok(core, agent.id);
    assert.equal(core.sex, agent.sex);
    assert.equal(core.phenotype.biologicalSex, agent.sex);
    assert.equal(core.reproductive.type, agent.sex);
    assertBodyCoreV1(agent, core);
    assert.equal(typeof core.homeostasis.sexualArousal, 'number');
    if (agent.sex === 'male') {
      assert.equal(core.reproductive.type, 'male');
      assert.equal(typeof core.reproductive.refractoryLoad, 'number');
      assert.ok(!('cyclePhase' in core.reproductive));
      assert.ok(!('pregnancy' in core.reproductive));
    } else {
      assert.equal(core.reproductive.type, 'female');
      assert.equal(typeof core.reproductive.cyclePhase, 'number');
      assert.ok(!('refractoryLoad' in core.reproductive));
    }
  }
});

test('BodyCore phenotype is deterministic per seed and varied per person', async () => {
  const a = await create('same-body-seed', 'body-a');
  const b = await create('same-body-seed', 'body-b');
  const phenotypeA = Object.fromEntries(Object.entries(a.world.v21!.bodiesByAgentId)
    .map(([id, body]) => [id, body.bodyCore!.phenotype]));
  const phenotypeB = Object.fromEntries(Object.entries(b.world.v21!.bodiesByAgentId)
    .map(([id, body]) => [id, body.bodyCore!.phenotype]));
  assert.deepEqual(phenotypeA, phenotypeB);
  assert.ok(new Set(Object.values(phenotypeA).map(value => JSON.stringify(value))).size >= 9);

  const different = await create('different-body-seed', 'body-c');
  assert.notDeepEqual(
    a.world.v21!.bodiesByAgentId.agent_1.bodyCore!.phenotype,
    different.world.v21!.bodiesByAgentId.agent_1.bodyCore!.phenotype,
  );
});

test('BodyCore rejects a reproductive body that disagrees with agent.sex', async () => {
  const { world } = await create('mismatch-seed', 'mismatch-world');
  const copy = structuredClone(world);
  const male = Object.values(copy.agents).find(agent => agent.sex === 'male')!;
  copy.v21!.bodiesByAgentId[male.id].bodyCore!.sex = 'female';
  assert.throws(() => assertEmbodiedWorldV21(copy), /BodyCore sex\/version mismatch/);
});

test('stage-1 save without BodyCore is repaired additively on reopen', async () => {
  const { world } = await create('migration-seed', 'legacy-body-world');
  const legacy = structuredClone(world);
  for (const body of Object.values(legacy.v21!.bodiesByAgentId)) delete body.bodyCore;

  const store = new InMemoryWorldStore();
  await store.initializeWorld(legacy);
  const reopened = await IskorkaRuntime.openOrCreate(store, 'ignored', legacy.id);
  const repaired = reopened.snapshot();
  for (const agent of Object.values(repaired.agents)) {
    const core = repaired.v21!.bodiesByAgentId[agent.id].bodyCore;
    assert.ok(core, agent.id);
    assert.equal(core.sex, agent.sex);
    assertBodyCoreV1(agent, core);
  }
});

test('derived body signals are bounded and do not mutate persisted physiology', async () => {
  const { world } = await create('signal-seed', 'signal-world');
  const agent = world.agents.agent_1;
  const body = world.v21!.bodiesByAgentId[agent.id];
  const core = body.bodyCore!;
  const before = structuredClone(core);
  const signals = bodySignalsV1(agent, body, core);
  for (const value of Object.values(signals)) {
    assert.ok(Number.isFinite(value));
    assert.ok(value >= 0 && value <= 1);
  }
  assert.deepEqual(core, before);
});
