import test from 'node:test';
import assert from 'node:assert/strict';
import { IskorkaRuntime } from '../../src/iskorka/WorldRuntime';
import { InMemoryWorldStore } from '../../src/world/InMemoryWorldStore';
import {
  assertBodyCoreV1,
  bodySignalsV1,
  completeBodyCorePregnancyV1,
  ensureBodyCoreV1,
} from '../../src/iskorka/BodyCoreV1';
import {
  advanceBodyPhysiologyV1,
  applyBodyMindFeedbackV1,
  bodyDecisionPressureV1,
  recordAdultIntimacyBodyResponseV1,
} from '../../src/iskorka/BodyPhysiologyV1';
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


test('female postpartum recovery expires analytically without minute ticks', async () => {
  const { world } = await create('postpartum-seed', 'postpartum-world');
  const mother = Object.values(world.agents).find(agent => agent.sex === 'female')!;
  const body = world.v21!.bodiesByAgentId[mother.id];
  completeBodyCorePregnancyV1(world, mother.id, 2);
  assert.ok(body.bodyCore!.reproductive.type === 'female');
  if (body.bodyCore!.reproductive.type !== 'female') throw new Error('expected female BodyCore');
  assert.ok(body.bodyCore!.reproductive.postpartum);
  assert.equal(body.bodyCore!.reproductive.cyclePhase, undefined);

  world.calendar.elapsedWorldMinutes += 90 * 24 * 60;
  const repaired = ensureBodyCoreV1(world, mother, body)!;
  assert.equal(repaired.reproductive.type, 'female');
  if (repaired.reproductive.type !== 'female') throw new Error('expected female BodyCore');
  assert.equal(repaired.reproductive.postpartum, undefined);
  assert.equal(typeof repaired.reproductive.cyclePhase, 'number');
});


test('mind drives autonomic body reactions and tears without microticks', async () => {
  const { world } = await create('bridge-seed', 'bridge-world');
  const agent = world.agents.agent_1;
  const body = world.v21!.bodiesByAgentId[agent.id];
  const core = body.bodyCore!;
  agent.stress = 0.82;
  agent.mind.emotions.fear = 0.9;
  agent.mind.emotions.grief = 0.88;
  agent.lastAction = 'work';
  body.pain = 0.48;
  core.homeostasis.autonomicArousal = 0;
  core.homeostasis.tearDrive = 0;

  const signals = advanceBodyPhysiologyV1(world, agent, 8_760)!;
  assert.ok(core.homeostasis.autonomicArousal > 0.5);
  assert.ok(core.homeostasis.muscleTension > 0.35);
  assert.ok(core.homeostasis.stressHormoneLoad > 0.45);
  assert.ok(core.homeostasis.tearDrive > 0.55);
  assert.ok(signals.tears > 0.25);
  assert.ok(signals.heartPounding > 0.2);
  assert.ok(signals.dryMouth > 0.2);
});

test('body signals feed back into stress, emotion and goal salience without choosing actions', async () => {
  const { world } = await create('feedback-seed', 'feedback-world');
  const agent = world.agents.agent_1;
  const body = world.v21!.bodiesByAgentId[agent.id];
  const core = body.bodyCore!;
  core.homeostasis.hydration = 0.32;
  core.homeostasis.energyReserve = 0.24;
  core.homeostasis.muscleFatigue = 0.78;
  core.homeostasis.respiratoryLoad = 0.55;
  core.homeostasis.oxygenDebt = 0.48;
  body.pain = 0.42;

  const signals = bodySignalsV1(agent, body, core);
  const beforeStress = agent.stress;
  const beforeFear = agent.mind.emotions.fear;
  applyBodyMindFeedbackV1(agent, body, signals, 8_760);
  assert.ok(agent.stress > beforeStress);
  assert.ok(agent.mind.emotions.fear >= beforeFear);

  const pressure = bodyDecisionPressureV1(world, agent);
  assert.ok(pressure.recover > 0.35);
  assert.ok(pressure.secureResources > 0.3);
  assert.equal(agent.lastAction, undefined);
});

test('voluntary adult intimacy creates sex-linked physical pleasure but not relationship meaning', async () => {
  const { world } = await create('intimacy-body-seed', 'intimacy-body-world');
  const male = Object.values(world.agents).find(agent => agent.sex === 'male')!;
  const female = Object.values(world.agents).find(agent => agent.sex === 'female')!;
  const maleCore = world.v21!.bodiesByAgentId[male.id].bodyCore!;
  const femaleCore = world.v21!.bodiesByAgentId[female.id].bodyCore!;
  const maleJoy = male.mind.emotions.joy;
  const femaleJoy = female.mind.emotions.joy;
  const maleValues = structuredClone(male.mind.values);
  const femaleValues = structuredClone(female.mind.values);

  const responses = recordAdultIntimacyBodyResponseV1(
    world,
    male,
    female,
    0.86,
    0.9,
  );
  assert.equal(responses.length, 2);
  assert.ok(responses.every(response => response.arousal > 0.45));
  assert.ok(responses.every(response => response.pleasure > 0.25));
  assert.ok(maleCore.homeostasis.sexualArousal! > 0.45);
  assert.ok(femaleCore.homeostasis.sexualArousal! > 0.45);
  assert.equal(maleCore.reproductive.type, 'male');
  assert.equal(femaleCore.reproductive.type, 'female');
  if (maleCore.reproductive.type !== 'male' || femaleCore.reproductive.type !== 'female') {
    throw new Error('unexpected reproductive body types');
  }
  assert.ok((maleCore.reproductive.refractoryLoad ?? 0) > 0);
  assert.ok(!('refractoryLoad' in femaleCore.reproductive));
  assert.ok(male.mind.emotions.joy > maleJoy);
  assert.ok(female.mind.emotions.joy > femaleJoy);
  assert.deepEqual(male.mind.values, maleValues);
  assert.deepEqual(female.mind.values, femaleValues);
});
