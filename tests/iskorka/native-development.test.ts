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
  let huntingPracticeOwners = 0;
  let fishingPracticeOwners = 0;
  let gatheringPracticeOwners = 0;
  let learnedMealOwners = 0;
  let defensiveExperienceOwners = 0;
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
    const decoded = lived.map((datum) => {
      try { return JSON.parse(datum.encoded) as { action?: string; defensiveEncounter?: boolean }; }
      catch { return {}; }
    });
    if (decoded.some((experience) => experience.action === 'hunt')) huntingPracticeOwners += 1;
    if (decoded.some((experience) => experience.action === 'fish')) fishingPracticeOwners += 1;
    if (decoded.some((experience) => experience.action === 'gather_food')) gatheringPracticeOwners += 1;
    if (decoded.some((experience) => experience.defensiveEncounter === true)) defensiveExperienceOwners += 1;
    if (brain.learning?.methods.some((method) => method.action === 'eat' && method.successes > 0)) {
      learnedMealOwners += 1;
    }
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
  assert.ok(huntingPracticeOwners >= 7, JSON.stringify({
    huntingPracticeOwners,
    fishingPracticeOwners,
    gatheringPracticeOwners,
    learnedMealOwners,
    defensiveExperienceOwners,
  }));
  assert.ok(fishingPracticeOwners >= 8, `fishing owners: ${fishingPracticeOwners}`);
  assert.ok(gatheringPracticeOwners >= 7, `gathering owners: ${gatheringPracticeOwners}`);
  assert.ok(learnedMealOwners >= 7, `brains that learned a physically successful meal: ${learnedMealOwners}`);
  assert.ok(defensiveExperienceOwners >= 1, 'no real defensive wildlife experience');
});

test('ages 15-17 use the same acquired-choice path before mentor departure and are not routinely fed', async () => {
  const { store, runtime } = await create(
    'native-development-transition',
    'native-development-transition-world',
  );
  await runtime.advanceTo(YEAR * 15);
  let world = runtime.snapshot();
  assert.ok(Object.values(world.agents).every((agent) => agent.life.ageYears >= 15 && agent.life.ageYears < 18));
  const mealsBefore = world.iskorkaMentorsV1!.totalMeals;
  const historyBefore = (await store.history(world.id)).length;

  await runtime.advanceTo(YEAR * 15 + 14 * DAY);
  world = runtime.snapshot();
  assert.equal(world.iskorkaMentorsV1!.totalMeals, mealsBefore, 'mentor routine feeding continued after 15');
  const newHistory = (await store.history(world.id)).slice(historyBefore);
  const teenNative = newHistory.filter((event) =>
    event.kind === 'agent.native_intent.resolved' || event.kind === 'agent.native_intent.travel_started',
  );
  assert.ok(teenNative.length > 0, 'transition-age Sparks never used acquired native choices');
  for (const spark of Object.values(world.agents)) {
    assert.equal(spark.lastDecision, undefined);
    assert.equal(spark.plan, undefined);
  }
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
  const departureMinute = world.iskorkaMentorsV1?.deactivatedWorldMinute ?? adulthoodFromStart;
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
  const independentNative = native.filter(
    (event) => event.occurredWorldMinutes >= departureMinute,
  );
  const independentResolved = independentNative.filter(
    (event) =>
      event.kind === 'agent.native_intent.resolved' &&
      event.payload.succeeded === true,
  );
  const survivalActions = independentResolved.filter((event) =>
    ['drink', 'eat', 'gather_food', 'hunt', 'fish', 'rest'].includes(
      String(event.payload.intent),
    ),
  );
  const wildlifeChoices = native.filter((event) =>
    ['hunt', 'fish'].includes(String(event.payload.intent)),
  );

  assert.ok(independentNative.length > 0, 'no native intents after the mentors physically left');
  assert.ok(
    independentNative.length < 8_000,
    'native deliberation repeated too often after release: ' + independentNative.length,
  );
  assert.ok(survivalActions.length > 0, 'no successful native survival action');
  assert.ok(
    independentResolved.some((event) => String(event.payload.intent) === 'drink'),
    'no successful drinking from lived water practice',
  );
  assert.ok(wildlifeChoices.length > 0, 'learned hunting/fishing never became a native choice');
  const intentCounts = Object.fromEntries(
    [...new Set(native.map((event) => String(event.payload.intent)))].map((intent) => [
      intent,
      {
        total: native.filter((event) => String(event.payload.intent) === intent).length,
        succeeded: resolved.filter((event) => String(event.payload.intent) === intent).length,
      },
    ]),
  );
  const deathCauses = Object.values(world.agents)
    .filter((agent) => !agent.life.alive)
    .map((agent) => ({ id: agent.id, cause: agent.life.deathCause, ageYears: agent.life.ageYears }));
  const survivalSnapshot = Object.values(world.agents).map((agent) => {
    const body = world.v21?.bodiesByAgentId[agent.id]?.bodyCore;
    const brain = world.iskorkaBrainV1?.brainsByAgentId[agent.id];
    const home = world.places[agent.homeId];
    const settlementId = home?.settlementId;
    return {
      id: agent.id,
      alive: agent.life.alive,
      locationId: agent.locationId,
      health: agent.life.health,
      resources: agent.resources,
      hydration: body?.homeostasis.hydration,
      satiety: world.v18?.lifeRhythmsByAgentId?.[agent.id]?.satiety,
      waterAtHome: home?.medievalInfrastructureV1?.waterReserveLitres,
      foodAtHome: settlementId
        ? world.v16?.settlementEconomyById[settlementId]?.stocks.food
        : undefined,
      survival: body?.releasedAdultSurvivalV1,
      methods: brain?.learning?.methods.map((method) => ({
        action: method.action,
        target: method.targetObjectId,
        successes: method.successes,
        failures: method.failures,
        relief: method.expectedSignalRelief,
        cues: method.expectedContextCues,
      })),
    };
  });
  assert.ok(
    world.population.deaths <= 2,
    'adult survival failed: ' + JSON.stringify({ intentCounts, independentIntents: Object.fromEntries([...new Set(independentNative.map((event) => String(event.payload.intent)))].map((intent) => [intent, independentNative.filter((event) => String(event.payload.intent) === intent).length])), departureMinute, deathCauses, survivalSnapshot }),
  );
  assert.ok(
    Object.values(world.agents).filter((spark) => spark.life.alive).length >= 8,
    'fewer than eight of ten adults survived 55 days independently',
  );

  for (const spark of Object.values(world.agents).filter((agent) => agent.life.alive)) {
    assert.equal(spark.lastDecision, undefined);
    assert.equal(spark.plan, undefined);
  }
});
