import test from 'node:test';
import assert from 'node:assert/strict';
import { IskorkaRuntime } from '../../src/iskorka/WorldRuntime';
import { InMemoryWorldStore } from '../../src/world/InMemoryWorldStore';
import { ensureBodyCoreV1 } from '../../src/iskorka/BodyCoreV1';
import { beginBrainActionAttemptV1 } from '../../src/iskorka/BrainLearningV1';
import { perceptBatchForAgentV1 } from '../../src/iskorka/PerceptionAdapterV1';
import { harvestRenewably } from '../../src/v15/RenewableAgriculture';
import { applyIndependentPractice } from '../../src/v15/KnowledgeTransfer';
import { productiveCapacityScaleV16 } from '../../src/v16/SocietyFoundationV16';
import { ensureAdventurerV19 } from '../../src/v19/AdventureEconomyV19';
import type { AgentState, WorldState } from '../../src/world/types';

type FixtureEngine = {
  state: WorldState;
  residentCountByHomeSettlement: Map<string, number> | undefined;
  mutate(id: string, fingerprint: string, apply: () => Promise<void>): Promise<boolean>;
  createChild(a: AgentState, b: AgentState, now: number, placeId: string): string;
};

test('a completed native forage earns its own agriculture practice without changing the physical harvest', async () => {
  const store = new InMemoryWorldStore();
  const runtime = await IskorkaRuntime.openOrCreate(store, 'native-harvest-area', 'native-harvest-area');
  const engine = (runtime as unknown as {world: FixtureEngine}).world;
  let expectedBase = 0;
  let expectedFertility = 0;
  let expectedFood = 0;
  let beforeHarvestEvents = 0;
  let expectedAgriculture = 0;
  let beforePracticeSessions = 0;
  await engine.mutate('prepare-native-harvest', 'prepare-native-harvest', async () => {
    const world = engine.state;
    world.iskorkaMentorsV1!.active = false;
    const agent = world.agents.agent_1;
    // This fixture exercises one already-chosen physical action, without
    // waiting eighteen simulated years for founder release.
    agent.life.ageYears = 24;
    agent.life.stage = 'adult';
    agent.life.health = 1;
    agent.energy = 1;
    delete agent.movement;
    agent.locationId = 'resource_field';
    agent.position = {x: world.places.resource_field.mapX, y: world.places.resource_field.mapY, layerId: 'surface'};
    agent.knownPlaceIds = [agent.homeId, 'commons', 'resource_field'];
    const body = world.v21!.bodiesByAgentId[agent.id];
    delete body.sleep;
    ensureBodyCoreV1(world, agent, body);
    const brain = world.iskorkaBrainV1!.brainsByAgentId[agent.id];
    beginBrainActionAttemptV1(brain, perceptBatchForAgentV1(world, agent.id), 'gather', agent.locationId);
    delete brain.learning!.nextReviewWorldMinute;
    const settlementId = world.places[agent.homeId].settlementId!;
    const land = world.v16!.settlementResourcesById[settlementId];
    const economy = world.v16!.settlementEconomyById[settlementId];
    const profile = world.v15!.knowledgeByAgentId[agent.id];
    profile.agriculture = 0;
    const knowledge = profile.agriculture;
    beforePracticeSessions = profile.verifiedPracticeSessions;
    const practiced = structuredClone(profile);
    applyIndependentPractice({id: agent.id, generation: agent.life.generation,
      ageYears: agent.life.ageYears, aptitude: practiced.aptitude, knowledge: practiced}, {
      practiceId: 'expected-native-practice', personId: agent.id, domain: 'agriculture',
      worldMinutes: 0, durationWorldMinutes: 45, activityVerified: true, challenge: 0.48,
    });
    expectedAgriculture = practiced.agriculture;
    const effort = Math.max(0, Math.min(1, (
      0.46 + agent.skills.gathering * 0.3 + agent.life.physiology.strength * 0.14 +
      agent.personality.diligence * 0.1
    ) * productiveCapacityScaleV16('human', agent.life.ageYears)));
    const harvest = harvestRenewably(land, {
      id: agent.id, agricultureKnowledge: knowledge, diligence: agent.personality.diligence,
    }, {eventId: 'expected-native-harvest', worldMinutes: 0, effort});
    const residents = Object.values(world.agents).filter(a =>
      a.life.alive && world.places[a.homeId]?.settlementId === settlementId).length;
    assert.equal(residents, 10);
    expectedBase = land.renewableBase - harvest.renewableBaseDamage / (residents * 4);
    expectedFertility = land.fertility - harvest.fertilityDamage / residents;
    expectedFood = harvest.harvested * (1.8 + knowledge * 1.2);
    economy.stocks.food = 0;
    ensureAdventurerV19(world, agent.id).carriedGoods.food = 0;
    beforeHarvestEvents = economy.harvestEvents;
  });
  assert.equal(engine.residentCountByHomeSettlement, undefined,
    'fixture accidentally retained the semantic population index');
  await runtime.advanceTo(1);
  const world = runtime.snapshot();
  const land = world.v16!.settlementResourcesById.settlement_ainkrad;
  const economy = world.v16!.settlementEconomyById.settlement_ainkrad;
  assert.ok(Math.abs(land.renewableBase - expectedBase) < 1e-12,
    `native extraction used the wrong land area: ${land.renewableBase} instead of ${expectedBase}`);
  assert.ok(Math.abs(land.fertility - expectedFertility) < 1e-12,
    'native extraction used the wrong soil share');
  assert.equal(economy.harvestEvents, beforeHarvestEvents + 1);
  const carriedFood = world.v19!.adventureEconomy.adventurersByAgentId.agent_1.carriedGoods.food;
  assert.ok(Math.abs(carriedFood + economy.stocks.food - expectedFood) < 1e-12,
    'correcting area accounting fabricated or lost harvested food');
  assert.equal(world.now, 0, 'test crossed a semantic quantum and rebuilt its index');
  const resolved = (await store.history(world.id)).filter(event =>
    event.kind === 'agent.native_intent.resolved' && event.payload.agentId === 'agent_1');
  assert.equal(resolved.length, 1);
  assert.equal(resolved[0].payload.intent, 'gather_food');
  assert.equal(world.v15!.knowledgeByAgentId.agent_1.agriculture, expectedAgriculture,
    'a successful native forage did not teach the knowledge used by its next harvest');
  assert.equal(world.v15!.knowledgeByAgentId.agent_1.verifiedPracticeSessions, beforePracticeSessions + 1);
  assert.equal(world.v15!.knowledgeByAgentId.agent_1.lastLearningWorldMinute, 0,
    'practice must record the action boundary, not the end of catch-up');
  const reopened = await IskorkaRuntime.openOrCreate(store, 'native-harvest-area', 'native-harvest-area');
  assert.deepEqual(reopened.snapshot(), world, 'save/reload changed harvest accounting');
});

test('a native forage that finds no food does not earn agriculture knowledge or practice credit', async () => {
  const store = new InMemoryWorldStore();
  const runtime = await IskorkaRuntime.openOrCreate(store, 'native-harvest-empty', 'native-harvest-empty');
  const engine = (runtime as unknown as {world: FixtureEngine}).world;
  let beforeAgriculture = 0;
  let beforePracticeSessions = 0;
  let beforeSequence = 0;
  await engine.mutate('prepare-empty-forage', 'prepare-empty-forage', async () => {
    const world = engine.state;
    world.iskorkaMentorsV1!.active = false;
    const agent = world.agents.agent_1;
    agent.life.ageYears = 24;
    agent.life.stage = 'adult';
    agent.life.health = 1;
    agent.energy = 1;
    delete agent.movement;
    agent.locationId = 'resource_field';
    agent.position = {x: world.places.resource_field.mapX, y: world.places.resource_field.mapY, layerId: 'surface'};
    agent.knownPlaceIds = [agent.homeId, 'commons', 'resource_field'];
    const body = world.v21!.bodiesByAgentId[agent.id];
    delete body.sleep;
    ensureBodyCoreV1(world, agent, body);
    const brain = world.iskorkaBrainV1!.brainsByAgentId[agent.id];
    beginBrainActionAttemptV1(brain, perceptBatchForAgentV1(world, agent.id), 'gather', agent.locationId);
    delete brain.learning!.nextReviewWorldMinute;
    // The chosen source becomes exhausted before the physical attempt.
    world.v16!.settlementResourcesById.settlement_ainkrad.renewableBase = 0;
    const profile = world.v15!.knowledgeByAgentId[agent.id];
    beforeAgriculture = profile.agriculture;
    beforePracticeSessions = profile.verifiedPracticeSessions;
    beforeSequence = world.v15!.learningSequence;
  });
  await runtime.advanceTo(1);
  const world = runtime.snapshot();
  const resolved = (await store.history(world.id)).filter(event =>
    event.kind === 'agent.native_intent.resolved' && event.payload.agentId === 'agent_1');
  assert.equal(resolved.length, 1);
  assert.equal(resolved[0].payload.intent, 'gather_food');
  assert.equal(resolved[0].payload.succeeded, false);
  assert.equal(world.v15!.knowledgeByAgentId.agent_1.agriculture, beforeAgriculture);
  assert.equal(world.v15!.knowledgeByAgentId.agent_1.verifiedPracticeSessions, beforePracticeSessions);
  assert.equal(world.v15!.learningSequence, beforeSequence);
  assert.equal(world.v19!.adventureEconomy.adventurersByAgentId.agent_1?.carriedGoods.food ?? 0, 0,
    'an unsuccessful trial created personal food');
});

test('a real newborn inherits no agriculture, then retains knowledge earned through its own native harvest', async () => {
  const store = new InMemoryWorldStore();
  const runtime = await IskorkaRuntime.openOrCreate(store, 'native-harvest-child', 'native-harvest-child');
  const engine = (runtime as unknown as {world: FixtureEngine}).world;
  let childId = '';
  await engine.mutate('native-harvest-birth', 'native-harvest-birth', async () => {
    const world = engine.state;
    world.iskorkaMentorsV1!.active = false;
    world.v15!.knowledgeByAgentId.agent_1.agriculture = 0.8;
    world.v15!.knowledgeByAgentId.agent_2.agriculture = 0.9;
    childId = engine.createChild(world.agents.agent_1, world.agents.agent_2,
      world.now, world.agents.agent_1.homeId);
  });
  const born = runtime.snapshot();
  assert.equal(born.v15!.knowledgeByAgentId[childId].agriculture, 0,
    'newborn inherited acquired agriculture from its parents');
  assert.equal(born.v15!.knowledgeByAgentId[childId].verifiedPracticeSessions, 0);
  assert.equal(born.iskorkaBrainV1!.brainsByAgentId[childId].learning?.methods.length ?? 0, 0);
  await engine.mutate('native-child-forage-trial', 'native-child-forage-trial', async () => {
    const world = engine.state;
    const child = world.agents[childId];
    // Age is advanced only in this physical-executor fixture. No parental
    // method or knowledge is supplied to the child's brain.
    child.life.ageYears = 24;
    child.life.stage = 'adult';
    child.life.health = 1;
    child.energy = 1;
    delete child.carriedByParentId;
    delete child.movement;
    child.locationId = 'resource_field';
    child.position = {x: world.places.resource_field.mapX, y: world.places.resource_field.mapY, layerId: 'surface'};
    child.knownPlaceIds = [child.homeId, 'commons', 'resource_field'];
    const body = world.v21!.bodiesByAgentId[child.id];
    delete body.sleep;
    ensureBodyCoreV1(world, child, body);
    const brain = world.iskorkaBrainV1!.brainsByAgentId[child.id];
    beginBrainActionAttemptV1(brain, perceptBatchForAgentV1(world, child.id), 'gather', child.locationId);
    delete brain.learning!.nextReviewWorldMinute;
  });
  await runtime.advanceTo(1);
  const practiced = runtime.snapshot();
  const profile = practiced.v15!.knowledgeByAgentId[childId];
  assert.ok(profile.agriculture > 0, 'the child’s own completed trial taught no agriculture');
  assert.equal(profile.verifiedPracticeSessions, 1);
  assert.equal(practiced.v15!.knowledgeByAgentId.agent_1.agriculture, 0.8);
  assert.equal(practiced.v15!.knowledgeByAgentId.agent_2.agriculture, 0.9);
  const resolved = (await store.history(practiced.id)).filter(event =>
    event.kind === 'agent.native_intent.resolved' && event.payload.agentId === childId);
  assert.equal(resolved.length, 1);
  assert.equal(resolved[0].payload.intent, 'gather_food');
  assert.equal(resolved[0].payload.succeeded, true);
  assert.ok(practiced.iskorkaBrainV1!.brainsByAgentId[childId].learning!.methods.some(method =>
    method.action === 'gather' && method.successes > 0));
  const reopened = await IskorkaRuntime.openOrCreate(store, 'native-harvest-child', 'native-harvest-child');
  assert.deepEqual(reopened.snapshot(), practiced,
    'save/reopen lost or fabricated the child’s acquired harvest knowledge');
});
