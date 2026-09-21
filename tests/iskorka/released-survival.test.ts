import test from 'node:test';
import assert from 'node:assert/strict';
import { IskorkaRuntime } from '../../src/iskorka/WorldRuntime';
import { InMemoryWorldStore } from '../../src/world/InMemoryWorldStore';
import { ensureBodyCoreV1, bodySignalsV1 } from '../../src/iskorka/BodyCoreV1';
import {
  advanceReleasedSparkSurvivalV1,
  nextReleasedSparkBodyBoundaryV1,
} from '../../src/iskorka/ReleasedSparkSurvivalV1';
import { ensureLifeRhythmV18 } from '../../src/v18/LivelihoodAndRhythmV18';

const HOUR = 60;
const DAY = 24 * HOUR;

async function releasedWorld() {
  const store = new InMemoryWorldStore();
  const runtime = await IskorkaRuntime.openOrCreate(
    store,
    'released-body-seed',
    'released-body-world',
  );
  const world = runtime.snapshot();
  const spark = world.agents.agent_1;
  spark.life.ageYears = 18.1;
  spark.life.stage = 'adult';
  world.iskorkaMentorsV1!.active = false;
  for (const mentor of Object.values(world.iskorkaMentorsV1!.mentorsById)) {
    mentor.status = 'inactive';
  }
  const body = world.v21!.bodiesByAgentId[spark.id];
  const core = ensureBodyCoreV1(world, spark, body)!;
  core.homeostasis.hydration = 0.88;
  core.homeostasis.stomachFill = 0.82;
  core.homeostasis.energyReserve = 0.86;
  spark.energy = 1;
  const rhythm = ensureLifeRhythmV18(world, spark);
  rhythm.satiety = 0.88;
  return { world, spark, body, core, rhythm };
}

test('released Spark body deteriorates without choosing or receiving resources', async () => {
  const { world, spark, body, core, rhythm } = await releasedWorld();
  const foodBefore = world.v16!.settlementEconomyById.settlement_ainkrad.stocks.food;
  const storedBefore = world.v15!.renewableResources.storedResources;
  const mealsBefore = rhythm.mealsConsumed;
  const lastActionBefore = spark.lastAction;

  const result = advanceReleasedSparkSurvivalV1(
    world,
    spark,
    0,
    12 * HOUR,
    false,
  );

  assert.equal(result.advancedWorldMinutes, 12 * HOUR);
  assert.ok(core.homeostasis.hydration < 0.88);
  assert.ok(rhythm.satiety < 0.88);
  assert.ok(core.releasedAdultSurvivalV1!.metabolicReserve < 0.86);
  assert.ok(spark.energy < 1);
  assert.equal(rhythm.mealsConsumed, mealsBefore);
  assert.equal(world.v16!.settlementEconomyById.settlement_ainkrad.stocks.food, foodBefore);
  assert.equal(world.v15!.renewableResources.storedResources, storedBefore);
  assert.equal(spark.lastAction, lastActionBefore);
  assert.equal(spark.lastDecision, undefined);
  assert.equal(spark.plan, undefined);

  const signals = bodySignalsV1(spark, body, core);
  assert.ok(signals.thirst > 0.08);
  assert.ok(signals.hunger > 0.08);
});

test('released Spark reaches lethal dehydration in days if nobody actually drinks', async () => {
  const { world, spark, core } = await releasedWorld();
  let minute = 0;
  while (minute < 5 * DAY && !core.releasedAdultSurvivalV1?.fatalCause) {
    const next = Math.min(5 * DAY, nextReleasedSparkBodyBoundaryV1(minute));
    advanceReleasedSparkSurvivalV1(world, spark, minute, next, false);
    minute = next;
  }

  assert.equal(core.releasedAdultSurvivalV1?.fatalCause, 'dehydration');
  assert.ok(minute <= 5 * DAY);
  assert.ok(core.homeostasis.hydration <= 0.12);
  assert.ok(spark.life.health <= 0.01);
});

test('released body clock is partition-independent', async () => {
  const a = await releasedWorld();
  const b = await releasedWorld();

  advanceReleasedSparkSurvivalV1(a.world, a.spark, 0, 3 * DAY, false);

  let minute = 0;
  while (minute < 3 * DAY) {
    const next = Math.min(3 * DAY, minute + 3 * HOUR);
    advanceReleasedSparkSurvivalV1(b.world, b.spark, minute, next, false);
    minute = next;
  }

  assert.deepEqual(
    {
      hydration: a.core.homeostasis.hydration,
      stomach: a.core.homeostasis.stomachFill,
      reserve: a.core.releasedAdultSurvivalV1,
      energy: a.spark.energy,
      health: a.spark.life.health,
      stress: a.spark.stress,
      satiety: a.rhythm.satiety,
    },
    {
      hydration: b.core.homeostasis.hydration,
      stomach: b.core.homeostasis.stomachFill,
      reserve: b.core.releasedAdultSurvivalV1,
      energy: b.spark.energy,
      health: b.spark.life.health,
      stress: b.spark.stress,
      satiety: b.rhythm.satiety,
    },
  );
});
