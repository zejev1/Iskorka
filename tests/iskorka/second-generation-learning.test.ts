import test from 'node:test';
import assert from 'node:assert/strict';
import { IskorkaRuntime } from '../../src/iskorka/WorldRuntime';
import { InMemoryWorldStore } from '../../src/world/InMemoryWorldStore';
import { perceptBatchForAgentV1 } from '../../src/iskorka/PerceptionAdapterV1';
import type { ActionIntentV1, PerceptBatchV1 } from '../../src/iskorka/PortableHumanCoreV1';
import type { AgentState, WorldState } from '../../src/world/types';

type BirthFixtureEngine = {
  state: WorldState;
  mutate(id: string, fingerprint: string, apply: () => Promise<void>): Promise<boolean>;
  createChild(a: AgentState, b: AgentState, now: number, placeId: string): string;
  childExploratoryPossibilitiesV1(agent: AgentState, percept: PerceptBatchV1): ActionIntentV1[];
};

test('a teenager can consider a physically known food source from another place', async () => {
  const runtime = await IskorkaRuntime.openOrCreate(
    new InMemoryWorldStore(), 'teen-food-affordance', 'teen-food-affordance-world',
  );
  const engine = (runtime as unknown as {world: BirthFixtureEngine}).world;
  let childId = '';
  await engine.mutate('teen-food-birth', 'teen-food-birth', async () => {
    const world = engine.state;
    childId = engine.createChild(world.agents.agent_1, world.agents.agent_2,
      world.now, world.agents.agent_1.homeId);
    const child = world.agents[childId];
    child.life.ageYears = 13.5;
    child.life.stage = 'adolescent';
    child.locationId = 'commons';
    child.position = {x: world.places.commons.mapX, y: world.places.commons.mapY, layerId:'surface'};
    child.knownPlaceIds = [child.homeId, 'commons', 'resource_field'];
    delete child.carriedByParentId;
  });
  let options: ActionIntentV1[] = [];
  await engine.mutate('teen-food-observation', 'teen-food-observation', async () => {
    const world = engine.state;
    const percept = perceptBatchForAgentV1(world, childId);
    options = engine.childExploratoryPossibilitiesV1(world.agents[childId], percept);
  });
  const world = runtime.snapshot();
  assert.ok(options.some(option => option.action === 'gather' &&
    option.target?.kind === 'place' && option.target.objectId === 'resource_field'));
  assert.equal(world.v19?.adventureEconomy.adventurersByAgentId[childId]?.carriedGoods?.food ?? 0, 0,
    'perceiving food did not physically produce it');
});

test('a born Spark owns blank acquired knowledge, then learns only from physical trials and keeps it on reopen', async () => {
  const store = new InMemoryWorldStore();
  const runtime = await IskorkaRuntime.openOrCreate(
    store, 'second-generation-methods', 'second-generation-methods-world',
  );
  // Exercise the real birth transaction without waiting years for a random
  // pairing. Advancing the child's age is a fixture for the self-care stage,
  // never a runtime shortcut or a claim that its first two years were tested.
  const engine = (runtime as unknown as { world: BirthFixtureEngine }).world;
  let childId = '';
  await engine.mutate('test-second-gen-birth','test-second-gen-birth', async () => {
    const world = engine.state;
    childId = engine.createChild(
      world.agents.agent_1, world.agents.agent_2, world.now,
      world.agents.agent_1.homeId,
    );
  });
  const newborn = runtime.snapshot();
  const blank = newborn.iskorkaBrainV1!.brainsByAgentId[childId];
  assert.ok(blank);
  assert.equal(blank.learning?.methods.length ?? 0, 0);
  assert.deepEqual(newborn.agents[childId].life.parentIds, ['agent_1','agent_2']);
  const reopenedNewborn = await IskorkaRuntime.openOrCreate(
    store, 'second-generation-methods', 'second-generation-methods-world',
  );
  assert.deepEqual(reopenedNewborn.snapshot(), newborn,
    'reopen imported legacy acquired state into a newborn brain');

  await engine.mutate('test-second-gen-toddler','test-second-gen-toddler', async () => {
    const world = engine.state;
    world.agents[childId].life.ageYears = 2.1;
    const home = world.places[world.agents[childId].homeId];
    home.medievalInfrastructureV1!.waterReserveLitres = 25;
    const economy = world.v16!.settlementEconomyById[home.settlementId!];
    economy.stocks.food = Math.min(economy.storageCapacity.food,
      Math.max(economy.stocks.food, 1));
  });
  await runtime.advanceTo(runtime.elapsedMinutes + 35 * 1440);
  const lived = runtime.snapshot();
  const child = lived.agents[childId];
  const methods = lived.iskorkaBrainV1!.brainsByAgentId[childId].learning?.methods ?? [];
  assert.equal(child.lastDecision, undefined, 'descendant ran the legacy resident choice loop');
  assert.equal(child.plan, undefined);
  assert.ok(methods.some((method) => method.action === 'eat' && method.successes > 0),
    'a physical meal did not become the child’s own learned method');
  assert.ok(methods.some((method) => method.action === 'drink' && method.successes > 0),
    'a physical drink did not become the child’s own learned method');
  assert.ok(methods.every((method) => method.trials === method.successes + method.failures));
  assert.ok(methods.length <= 12, 'personal methods exceeded the finite brain cap');

  const reopened = await IskorkaRuntime.openOrCreate(
    store, 'second-generation-methods', 'second-generation-methods-world',
  );
  assert.equal(reopened.snapshot().revision, lived.revision,
    'reopen fabricated a migration for an existing descendant brain');
  assert.deepEqual(reopened.snapshot().iskorkaBrainV1!.brainsByAgentId[childId],
    lived.iskorkaBrainV1!.brainsByAgentId[childId],
    'reopen rewrote the descendant’s personal brain');
  assert.deepEqual(reopened.snapshot().iskorkaBrainV1!.brainsByAgentId[childId].learning?.methods,
    methods, 'reopen replaced or fabricated the child’s lived methods');
});

test('a newborn remains physically with its mother through world movement and reopen', async () => {
  const store = new InMemoryWorldStore();
  const runtime = await IskorkaRuntime.openOrCreate(
    store, 'infant-carriage', 'infant-carriage-world',
  );
  const engine = (runtime as unknown as { world: BirthFixtureEngine }).world;
  let childId = '';
  await engine.mutate('infant-carriage-birth', 'infant-carriage-birth', async () => {
    const world = engine.state;
    const mother = world.agents.agent_2;
    assert.equal(mother.sex, 'female');
    childId = engine.createChild(world.agents.agent_1, mother, world.now, mother.locationId);
  });
  const born = runtime.snapshot();
  const motherId = born.agents[childId].carriedByParentId;
  assert.equal(motherId, 'agent_2');
  assert.deepEqual(born.agents[childId].position, born.agents[motherId!].position);
  await runtime.advanceTo(runtime.elapsedMinutes + 36 * 1440);
  const lived = runtime.snapshot();
  const child = lived.agents[childId];
  const mother = lived.agents[motherId!];
  assert.notDeepEqual(mother.position, born.agents[motherId!].position,
    'the carrier never moved, so route synchronisation was not exercised');
  assert.equal(child.carriedByParentId, mother.id);
  assert.equal(child.locationId, mother.locationId);
  assert.deepEqual(child.position, mother.position);
  const reopened = await IskorkaRuntime.openOrCreate(
    store, 'infant-carriage', 'infant-carriage-world',
  );
  assert.equal(reopened.snapshot().agents[childId].locationId, mother.locationId);
  assert.deepEqual(reopened.snapshot().agents[childId].position, mother.position);
});
