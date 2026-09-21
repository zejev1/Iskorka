import test from 'node:test';
import assert from 'node:assert/strict';
import { IskorkaRuntime } from '../../src/iskorka/WorldRuntime';
import { InMemoryWorldStore } from '../../src/world/InMemoryWorldStore';
import {
  FOUNDING_MENTOR_RELEASE_AGE_YEARS_V1,
  FOUNDING_SPARK_START_AGE_YEARS_V1,
  applyFoundingMentorCareV1,
  applyFoundingMentorLessonV1,
  assignedFoundingMentorV1,
  mentorActorsVisibleV1,
  mentorTeachingPlaceV1,
  updateMentorTeachingPositionsV1,
} from '../../src/iskorka/FoundingMentorsV1';
import { perceptBatchForAgentV1 } from '../../src/iskorka/PerceptionAdapterV1';

const YEAR = 525_600;
const QUANTUM = YEAR / 60;

async function create(seed='mentor-seed', id='mentor-world') {
  const store = new InMemoryWorldStore();
  const runtime = await IskorkaRuntime.openOrCreate(store, seed, id);
  return { store, runtime, world: runtime.snapshot() };
}

test('new world starts ten six-month Sparks with five non-population mentors', async () => {
  const { world } = await create();
  const founders = Object.values(world.agents);
  const mentors = world.iskorkaMentorsV1!;

  assert.equal(founders.length, 10);
  assert.equal(mentors.cohortStudentIds.length, 10);
  assert.equal(Object.keys(mentors.mentorsById).length, 5);
  assert.equal(world.v15!.genesisTeachers.length, 0);
  assert.equal(mentors.active, true);

  for (const spark of founders) {
    assert.equal(spark.life.ageYears, FOUNDING_SPARK_START_AGE_YEARS_V1);
    assert.equal(spark.life.stage, 'child');
    assert.equal(spark.life.generation, 0);
    assert.equal(spark.locationId, 'commons');
    assert.equal(spark.lastDecision, undefined);
    assert.ok(Object.values(spark.skills).every((value) => value === 0));
    assert.ok(Object.values(spark.mind.values).every((value) => value === 0));
    assert.ok(Object.values(spark.mind.beliefs).every((value) => value === 0));
    const k = world.v15!.knowledgeByAgentId[spark.id];
    assert.equal(k.agriculture + k.construction + k.household + k.survival, 0);
    const language = world.v18!.languageByAgentId[spark.id];
    assert.equal(language.spokenComprehension, 0);
    assert.equal(language.spokenExpression, 0);
    assert.equal(language.vocabulary, 0);
  }

  for (const mentor of Object.values(mentors.mentorsById)) {
    assert.equal(world.agents[mentor.id], undefined);
    assert.equal(mentor.status, 'caregiving');
    assert.equal(mentor.fullKnowledge.agriculture, 0.96);
    assert.equal(mentor.fullKnowledge.construction, 0.96);
    assert.equal(mentor.fullKnowledge.household, 0.96);
    assert.equal(mentor.fullKnowledge.survival, 0.96);
  }
});

test('mentor care physically feeds, hydrates and tends a founding infant', async () => {
  const { world } = await create('mentor-care', 'mentor-care-world');
  const spark = world.agents.agent_1;
  const body = world.v21!.bodiesByAgentId[spark.id];
  const core = body.bodyCore!;
  core.homeostasis.hydration = 0.42;
  core.homeostasis.stomachFill = 0.2;
  core.homeostasis.energyReserve = 0.3;
  body.wounds.push({
    id: 'mentor-care-cut',
    kind: 'cut',
    region: 'arm',
    severity: 0.3,
    bleeding: 0.3,
    contamination: 0.5,
    pain: 0.4,
    mobilityPenalty: 0.05,
    causedWorldMinute: 0,
    source: 'accident',
  });

  const foodBefore = world.v15!.renewableResources.storedResources;
  const result = applyFoundingMentorCareV1(world, spark);
  assert.equal(result.cared, true);
  assert.ok(core.homeostasis.hydration > 0.42);
  assert.ok(core.homeostasis.stomachFill > 0.2);
  assert.ok(world.v15!.renewableResources.storedResources < foodBefore);
  assert.ok(body.wounds[0].bleeding < 0.3);
  assert.ok(body.wounds[0].contamination < 0.5);
  assert.equal(body.wounds[0].lastTreatedWorldMinute, 0);
  assert.equal(world.iskorkaMentorsV1!.totalCareActions, 1);
  assert.equal(world.iskorkaMentorsV1!.totalMeals, 1);
  assert.equal(world.iskorkaMentorsV1!.totalDrinks, 1);
});

test('mentor lesson requires physical co-location and does not write a target level', async () => {
  const { world } = await create('mentor-lesson', 'mentor-lesson-world');
  const spark = world.agents.agent_1;
  spark.life.ageYears = 7;
  spark.life.stage = 'child';
  updateMentorTeachingPositionsV1(world);
  const mentor = assignedFoundingMentorV1(world, spark.id)!;
  const before = structuredClone(world.v15!.knowledgeByAgentId[spark.id]);

  spark.locationId = 'commons';
  spark.position = {
    x: world.places.commons.mapX,
    y: world.places.commons.mapY,
    layerId: 'surface',
  };
  if (mentor.locationId === 'commons') {
    mentor.locationId = 'workshop';
    mentor.position = {
      x: world.places.workshop.mapX,
      y: world.places.workshop.mapY,
    };
  }
  assert.equal(applyFoundingMentorLessonV1(world, spark, mentor).taught, false);
  assert.deepEqual(world.v15!.knowledgeByAgentId[spark.id], before);

  spark.locationId = mentor.locationId;
  spark.position = {
    x: mentor.position.x,
    y: mentor.position.y,
    layerId: 'surface',
  };
  const result = applyFoundingMentorLessonV1(world, spark, mentor);
  assert.equal(result.taught, true);
  assert.ok(result.gained >= 0);
  assert.ok(mentor.lessonCount > 0);
});

test('five-year-old Sparks are cared for and taught, never scripted into work', async () => {
  const { runtime } = await create('mentor-five-year-old', 'mentor-five-year-old-world');
  await runtime.advanceTo(YEAR * 4.6);
  const world = runtime.snapshot();

  for (const spark of Object.values(world.agents)) {
    assert.ok(spark.life.ageYears >= 5 && spark.life.ageYears < 6);
    assert.equal(spark.lastDecision, undefined);
    assert.equal(spark.lastAction, undefined);
    assert.equal(spark.plan, undefined);
    assert.equal(spark.locationId, 'commons');

    const livelihood = world.v18!.livelihoodByAgentId[spark.id];
    assert.equal(livelihood.primary, 'undecided');
    assert.equal(livelihood.totalPractice, 0);

    const mentor = assignedFoundingMentorV1(world, spark.id)!;
    assert.equal(mentor.locationId, spark.locationId);
    assert.equal(mentorTeachingPlaceV1(world, mentor, spark.life.ageYears), 'commons');
  }

  const agricultureMentor = world.iskorkaMentorsV1!.mentorsById.mentor_alexey;
  assert.equal(mentorTeachingPlaceV1(world, agricultureMentor, 5.1), 'commons');
  assert.equal(mentorTeachingPlaceV1(world, agricultureMentor, 8), 'resource_field');
});

test('older founding children may visit teaching sites only as mentor-supervised learners', async () => {
  const { runtime } = await create('mentor-supervised-outing', 'mentor-supervised-outing-world');
  await runtime.advanceTo(YEAR * 9);
  const world = runtime.snapshot();

  for (const spark of Object.values(world.agents)) {
    assert.ok(spark.life.ageYears >= 9);
    assert.equal(spark.lastDecision, undefined);
    assert.equal(spark.lastAction, undefined);
    assert.equal(spark.plan, undefined);
    const mentor = assignedFoundingMentorV1(world, spark.id)!;
    assert.equal(mentor.locationId, spark.locationId);
  }
});

test('founding childhood stays mentor-led: no adult decisions, no births, real learning', async () => {
  const { runtime } = await create('mentor-childhood', 'mentor-childhood-world');
  await runtime.advanceTo(YEAR * 12);
  const world = runtime.snapshot();

  assert.equal(world.population.births, 0);
  assert.equal(world.iskorkaMentorsV1!.active, true);
  assert.ok(Object.values(world.agents).every((agent) => agent.life.ageYears < 18));
  assert.ok(Object.values(world.agents).every((agent) => agent.lastDecision === undefined));
  assert.ok(world.iskorkaMentorsV1!.totalCareActions > 500);
  assert.ok(world.iskorkaMentorsV1!.totalLessons > 300);

  for (const spark of Object.values(world.agents)) {
    assert.equal(spark.lastAction, undefined);
    assert.equal(spark.plan, undefined);
    const k = world.v15!.knowledgeByAgentId[spark.id];
    assert.ok(k.agriculture + k.construction + k.household + k.survival > 0);
    const language = world.v18!.languageByAgentId[spark.id];
    assert.ok(language.spokenComprehension > 0);
    assert.ok(language.vocabulary > 0);
    assert.ok((spark.knownPlaceIds?.length ?? 0) < 20);
  }
});

test('mentor state survives save/reopen and continuation deterministically', async () => {
  const a = await create('mentor-save', 'mentor-save-a');
  const b = await create('mentor-save', 'mentor-save-b');
  await a.runtime.advanceTo(YEAR * 6);
  await b.runtime.advanceTo(YEAR * 6);

  const reopened = await IskorkaRuntime.openOrCreate(
    b.store,
    'ignored',
    'mentor-save-b',
  );
  assert.deepEqual(
    b.runtime.snapshot().iskorkaMentorsV1,
    reopened.snapshot().iskorkaMentorsV1,
  );

  await a.runtime.advanceTo(YEAR * 7);
  await reopened.advanceTo(YEAR * 7);
  const left = a.runtime.snapshot();
  const right = reopened.snapshot();
  // World IDs differ, but the mentor causal state and per-person learning
  // counters must evolve identically under the same seed.
  assert.deepEqual(
    Object.values(left.iskorkaMentorsV1!.mentorsById).map((m) => ({
      role: m.role,
      status: m.status,
      lessonCount: m.lessonCount,
      feedingCount: m.feedingCount,
      careCount: m.careCount,
      locationId: m.locationId,
    })),
    Object.values(right.iskorkaMentorsV1!.mentorsById).map((m) => ({
      role: m.role,
      status: m.status,
      lessonCount: m.lessonCount,
      feedingCount: m.feedingCount,
      careCount: m.careCount,
      locationId: m.locationId,
    })),
  );
});

test('at adulthood mentors say goodbye, visibly depart, then fully deactivate', async () => {
  const { runtime } = await create('mentor-farewell', 'mentor-farewell-world');
  const adulthoodFromStart =
    (FOUNDING_MENTOR_RELEASE_AGE_YEARS_V1 - FOUNDING_SPARK_START_AGE_YEARS_V1) * YEAR;
  await runtime.advanceTo(adulthoodFromStart);
  let world = runtime.snapshot();

  assert.ok(Object.values(world.agents).every((agent) => agent.life.ageYears >= 18));
  assert.ok(world.iskorkaMentorsV1!.farewellStartedWorldMinute !== undefined);
  assert.ok(
    Object.values(world.iskorkaMentorsV1!.mentorsById)
      .every((mentor) => mentor.status === 'farewell'),
  );
  for (const studentId of world.iskorkaMentorsV1!.cohortStudentIds) {
    const messages = world.iskorkaMentorsV1!.messagesByStudentId[studentId] ?? [];
    assert.ok(messages.some((message) => message.kind === 'farewell'));
  }

  await runtime.advanceTo(adulthoodFromStart + QUANTUM);
  world = runtime.snapshot();
  assert.ok(
    Object.values(world.iskorkaMentorsV1!.mentorsById)
      .some((mentor) => mentor.status === 'departing' || mentor.status === 'inactive'),
  );

  for (let step = 2; step <= 12 && world.iskorkaMentorsV1!.active; step += 1) {
    await runtime.advanceTo(adulthoodFromStart + QUANTUM * step);
    world = runtime.snapshot();
  }
  assert.equal(world.iskorkaMentorsV1!.active, false);
  assert.ok(
    Object.values(world.iskorkaMentorsV1!.mentorsById)
      .every((mentor) => mentor.status === 'inactive'),
  );
  assert.equal(mentorActorsVisibleV1(world).length, 0);
  assert.ok(Object.values(world.agents).some((agent) => agent.lastDecision !== undefined));
});

test('mentors become visible/hearable through the same perception boundary, not hidden data injection', async () => {
  const { world } = await create('mentor-perception', 'mentor-perception-world');
  const spark = world.agents.agent_1;
  // At six months the visual system is intentionally immature. By toddler age
  // a nearby caregiver is expected to be represented as a distinct person.
  spark.life.ageYears = 2;
  spark.life.stage = 'child';
  updateMentorTeachingPositionsV1(world);
  const mentor = assignedFoundingMentorV1(world, spark.id)!;
  spark.locationId = mentor.locationId;
  spark.position = { x: mentor.position.x, y: mentor.position.y, layerId: 'surface' };

  const actors = mentorActorsVisibleV1(world);
  assert.ok(actors.some((actor) => actor.id === mentor.id));
  const first = perceptBatchForAgentV1(world, spark.id);
  assert.ok(
    first.localObservations.some((observation) => observation.objectId === mentor.id),
    JSON.stringify({
      mentor: { id: mentor.id, locationId: mentor.locationId, position: mentor.position },
      spark: { ageYears: spark.life.ageYears, locationId: spark.locationId, position: spark.position },
      observations: first.localObservations,
    }),
  );

  applyFoundingMentorLessonV1(world, spark, mentor);
  const second = perceptBatchForAgentV1(world, spark.id);
  assert.ok(second.receivedMessages.some((message) => message.senderObjectId === mentor.id));
});

test('existing pre-mentor save remains loadable and does not silently spawn mentors', async () => {
  const source = await create('mentor-legacy', 'mentor-legacy-world');
  const legacy = source.world;
  delete legacy.iskorkaMentorsV1;
  const store = new InMemoryWorldStore();
  await store.initializeWorld(legacy);
  const reopened = await IskorkaRuntime.openOrCreate(store, 'ignored', legacy.id);
  assert.equal(reopened.snapshot().iskorkaMentorsV1, undefined);
});
