import test from 'node:test';
import assert from 'node:assert/strict';
import { IskorkaRuntime } from '../../src/iskorka/WorldRuntime';
import { InMemoryWorldStore } from '../../src/world/InMemoryWorldStore';
import type { AgentState, WorldState } from '../../src/world/types';

type BirthFixtureEngine = {
  state: WorldState;
  mutate(id: string, fingerprint: string, apply: () => Promise<void>): Promise<boolean>;
  createChild(a: AgentState, b: AgentState, now: number, placeId: string): string;
};

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
