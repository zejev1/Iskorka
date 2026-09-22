import test from 'node:test';
import assert from 'node:assert/strict';
import { IskorkaRuntime } from '../../src/iskorka/WorldRuntime';
import { InMemoryWorldStore } from '../../src/world/InMemoryWorldStore';
import {
  FOUNDING_MENTOR_RELEASE_AGE_YEARS_V1,
  FOUNDING_SPARK_START_AGE_YEARS_V1,
} from '../../src/iskorka/FoundingMentorsV1';

const YEAR = 525_600;
const DAY = 24 * 60;

async function create(seed: string, id: string) {
  const store = new InMemoryWorldStore();
  const runtime = await IskorkaRuntime.openOrCreate(store, seed, id);
  return { store, runtime };
}

test('mentor childhood forms values and lived practice instead of a data-only folder', async () => {
  const { runtime } = await create(
    'native-development-childhood',
    'native-development-childhood-world',
  );
  await runtime.advanceTo(YEAR * 12.5);
  const world = runtime.snapshot();

  let successfulPracticeOwners = 0;
  for (const spark of Object.values(world.agents)) {
    assert.ok(spark.life.ageYears >= 13);
    assert.ok(spark.mind.values.care > 0.02, spark.id + ' care');
    assert.ok(spark.mind.values.knowledge > 0.02, spark.id + ' knowledge');
    assert.ok(spark.mind.beliefs.worldTrust > 0.02, spark.id + ' worldTrust');
    assert.ok(spark.mind.emotions.fear < 0.9, spark.id + ' fear saturated');

    const brain = world.iskorkaBrainV1!.brainsByAgentId[spark.id];
    const lived = brain.data.filter(
      (datum) => datum.kind === 'mentor_guided_physical_practice',
    );
    if (lived.some((datum) => {
      try {
        return (JSON.parse(datum.encoded) as { succeeded?: boolean }).succeeded === true;
      } catch {
        return false;
      }
    })) {
      successfulPracticeOwners += 1;
      assert.ok(spark.mind.values.freedom > 0, spark.id + ' freedom');
      assert.ok(
        Object.values(spark.skills).some((value) => value > 0),
        spark.id + ' no practiced skill',
      );
    }
  }
  assert.ok(successfulPracticeOwners >= 8, String(successfulPracticeOwners));
});

test('after guardian departure Sparks can act from lived learning without legacy decisions', async () => {
  const { store, runtime } = await create(
    'native-development-release',
    'native-development-release-world',
  );
  const adulthoodFromStart =
    (FOUNDING_MENTOR_RELEASE_AGE_YEARS_V1 -
      FOUNDING_SPARK_START_AGE_YEARS_V1) *
    YEAR;

  // Allow farewell, physical departure and several weeks of independent life.
  await runtime.advanceTo(adulthoodFromStart + 55 * DAY);
  const world = runtime.snapshot();
  const history = await store.history(world.id);
  const native = history.filter(
    (event) =>
      event.kind === 'agent.native_intent.resolved' ||
      event.kind === 'agent.native_intent.travel_started',
  );
  const resolved = native.filter(
    (event) =>
      event.kind === 'agent.native_intent.resolved' &&
      event.payload.succeeded === true,
  );
  const survivalActions = resolved.filter((event) =>
    ['drink', 'eat', 'gather_food', 'rest'].includes(
      String(event.payload.intent),
    ),
  );

  assert.ok(native.length > 0, 'no native intents');
  assert.ok(survivalActions.length > 0, 'no successful native survival action');
  assert.ok(world.population.deaths < 10, 'all Sparks died');

  for (const spark of Object.values(world.agents).filter((agent) => agent.life.alive)) {
    assert.equal(spark.lastDecision, undefined);
    assert.equal(spark.plan, undefined);
  }
});
