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
  foundingMentorHomeIdV1,
  foundingMentorStudentsV1,
  mentorActorsVisibleV1,
  mentorTeachingPlaceV1,
  updateMentorTeachingPositionsV1,
} from '../../src/iskorka/FoundingMentorsV1';
import { perceptBatchForAgentV1 } from '../../src/iskorka/PerceptionAdapterV1';
import { FOUNDATION_WELL_IDS_V1 } from '../../src/iskorka/FoundationWaterV1';

const YEAR = 525_600;
const DAY = 24 * 60;
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
    const guardian = assignedFoundingMentorV1(world, spark.id)!;
    assert.equal(spark.locationId, foundingMentorHomeIdV1(world, guardian.id));
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

test('founding infants live with their guardian and are taken outside before age two', async () => {
  const { store, runtime, world: initial } = await create(
    'mentor-fresh-air',
    'mentor-fresh-air-world',
  );

  for (const mentor of Object.values(initial.iskorkaMentorsV1!.mentorsById)) {
    const pair = foundingMentorStudentsV1(initial, mentor.id);
    assert.equal(pair.length, 2);
    const homeId = foundingMentorHomeIdV1(initial, mentor.id)!;
    assert.equal(mentor.locationId, homeId);
    assert.ok(pair.every((child) => child.locationId === homeId));
  }

  await runtime.advanceTo(YEAR * 0.4);
  const events = await store.history(initial.id);
  const outings = events.filter(
    (event) => event.kind === 'mentor.guardian.outing.started',
  );
  assert.ok(outings.length > 0);
  assert.ok(
    outings.some((event) =>
      ['quiet_space', 'commons', ...FOUNDATION_WELL_IDS_V1].includes(String(event.payload.destinationId)),
    ),
  );
  const state = runtime.snapshot();
  assert.ok(Object.values(state.agents).every((child) => child.life.ageYears < 2));
  // The snapshot may legitimately catch the family back at home. Event
  // evidence proves that an actual physical outing started while the children
  // were still non-walking infants, and that they were carried by a guardian.
  assert.ok(
    outings.some(
      (event) => String(event.payload.carriedStudentIds ?? '').length > 0,
    ),
  );
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
  const homeWaterBefore =
    world.places[spark.homeId].medievalInfrastructureV1!.waterReserveLitres!;
  const result = applyFoundingMentorCareV1(world, spark);
  assert.equal(result.cared, true);
  assert.ok(core.homeostasis.hydration > 0.42);
  assert.ok(core.homeostasis.stomachFill > 0.2);
  assert.ok(world.v15!.renewableResources.storedResources < foodBefore);
  assert.ok(
    world.places[spark.homeId].medievalInfrastructureV1!.waterReserveLitres! <
      homeWaterBefore,
  );
  assert.ok(body.wounds[0].bleeding < 0.3);
  assert.ok(body.wounds[0].contamination < 0.5);
  assert.equal(body.wounds[0].lastTreatedWorldMinute, 0);
  assert.equal(world.iskorkaMentorsV1!.totalCareActions, 1);
  assert.equal(world.iskorkaMentorsV1!.totalMeals, 1);
  assert.equal(world.iskorkaMentorsV1!.totalDrinks, 1);
});

test('mentor water care uses household reserves and real wells, never magic hydration', async () => {
  const { world } = await create('mentor-water', 'mentor-water-world');
  const spark = world.agents.agent_1;
  const mentor = assignedFoundingMentorV1(world, spark.id)!;
  const body = world.v21!.bodiesByAgentId[spark.id];
  const core = body.bodyCore!;
  const home = world.places[spark.homeId];
  const infrastructure = home.medievalInfrastructureV1!;
  infrastructure.waterReserveLitres = 0;
  core.homeostasis.hydration = 0.31;

  const drinksBefore = world.iskorkaMentorsV1!.totalDrinks;
  const dryCare = applyFoundingMentorCareV1(world, spark);
  assert.equal(dryCare.cared, true);
  assert.equal(core.homeostasis.hydration, 0.31);
  assert.equal(world.iskorkaMentorsV1!.totalDrinks, drinksBefore);

  const well = world.places[FOUNDATION_WELL_IDS_V1[0]];
  const wellBefore = well.wellWaterV1!.waterLitres;
  spark.locationId = well.id;
  spark.position = { x: well.mapX, y: well.mapY, layerId: 'surface' };
  mentor.locationId = well.id;
  mentor.position = { x: well.mapX + 0.2, y: well.mapY, };
  const wetCare = applyFoundingMentorCareV1(world, spark);
  assert.equal(wetCare.cared, true);
  assert.ok(core.homeostasis.hydration > 0.31);
  assert.ok(well.wellWaterV1!.waterLitres < wellBefore);
  assert.ok((infrastructure.waterReserveLitres ?? 0) > 0);
  assert.equal(world.iskorkaMentorsV1!.totalDrinks, drinksBefore + 1);
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

test('five-year-old Sparks are guardian-raised and never receive resident work/task scripts', async () => {
  const { runtime } = await create('mentor-five-year-old', 'mentor-five-year-old-world');
  await runtime.advanceTo(YEAR * 4.6);
  const world = runtime.snapshot();

  const mentors = Object.values(world.iskorkaMentorsV1!.mentorsById);
  for (const mentor of mentors) {
    assert.equal(foundingMentorStudentsV1(world, mentor.id).length, 2);
  }

  for (const spark of Object.values(world.agents)) {
    assert.ok(spark.life.ageYears >= 5 && spark.life.ageYears < 6);
    assert.equal(spark.lastDecision, undefined);
    assert.equal(spark.lastAction, undefined);
    assert.equal(spark.plan, undefined);

    const livelihood = world.v18!.livelihoodByAgentId[spark.id];
    assert.equal(livelihood.primary, 'undecided');
    assert.equal(livelihood.totalPractice, 0);

    const mentor = assignedFoundingMentorV1(world, spark.id)!;
    assert.equal(mentor.locationId, spark.locationId);
    assert.ok(Math.hypot(
      mentor.position.x - spark.position.x,
      mentor.position.y - spark.position.y,
    ) <= 2);
  }
});

test('older founding children travel only in permanent mentor pairs and still have no child task script', async () => {
  const { runtime } = await create('mentor-supervised-outing', 'mentor-supervised-outing-world');
  await runtime.advanceTo(YEAR * 9);
  const world = runtime.snapshot();

  for (const spark of Object.values(world.agents)) {
    assert.ok(spark.life.ageYears >= 9);
    assert.equal(spark.lastDecision, undefined);
    assert.equal(spark.lastAction, undefined);
    assert.equal(spark.plan, undefined);
    const mentor = assignedFoundingMentorV1(world, spark.id)!;
    const pair = foundingMentorStudentsV1(world, mentor.id);
    assert.equal(pair.length, 2);
    assert.equal(pair[0].locationId, pair[1].locationId);
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
    assert.equal(spark.lastDecision, undefined);
    assert.equal(spark.plan, undefined);
    const k = world.v15!.knowledgeByAgentId[spark.id];
    assert.ok(k.agriculture + k.construction + k.household + k.survival > 0);
    const language = world.v18!.languageByAgentId[spark.id];
    assert.ok(language.spokenComprehension > 0);
    assert.ok(language.vocabulary > 0);
    assert.ok((spark.knownPlaceIds?.length ?? 0) < 20);
  }
});

test('guardians teach complete reproduction basics before adulthood without creating desire or consent', async () => {
  const { runtime } = await create('mentor-reproduction-education', 'mentor-reproduction-education-world');
  await runtime.advanceTo(YEAR * 17);
  const world = runtime.snapshot();

  const expectedStages = [
    'body_boundaries',
    'puberty',
    'conception',
    'pregnancy_birth',
    'adult_relationships_parenthood',
  ];

  for (const spark of Object.values(world.agents)) {
    assert.ok(spark.life.ageYears >= 17 && spark.life.ageYears < 18);
    const brain = world.iskorkaBrainV1!.brainsByAgentId[spark.id];
    assert.ok(brain);

    for (const stage of expectedStages) {
      const datum = brain.data.find(
        (item) => item.id === `mentor-reproduction:${stage}`,
      );
      assert.ok(datum, `${spark.id} missing reproduction education stage ${stage}`);
      assert.equal(datum!.kind, 'human_reproduction_education');
      assert.equal(datum!.source, 'message');
      const payload = JSON.parse(datum!.encoded);
      assert.equal(payload.stage, stage);
      assert.equal(typeof payload.mentorId, 'string');
      assert.equal(payload.constraints.createsDesire, false);
      assert.equal(payload.constraints.createsConsent, false);
      assert.equal(payload.constraints.createsRelationship, false);
      assert.equal(payload.constraints.createsPregnancy, false);
      assert.equal(payload.constraints.createsParenthoodDecision, false);
    }

    const family = world.v15!.familyAgencyByAgentId[spark.id];
    assert.equal(family.physicalIntimacyInclination, 0);
    assert.equal(family.childDesire, 0);
    assert.ok(family.autonomy >= 0 && family.autonomy <= 1);
    assert.equal(spark.lastDecision, undefined);
    assert.equal(spark.plan, undefined);
  }
});

test('mentor state survives save/reopen and continuation deterministically', async () => {
  // Separate stores, same logical world identity. Terrain intentionally depends
  // on world id, so using different ids would compare two different physical
  // worlds rather than testing save/reopen determinism.
  const a = await create('mentor-save', 'mentor-save-world');
  const b = await create('mentor-save', 'mentor-save-world');
  await a.runtime.advanceTo(YEAR * 6);
  await b.runtime.advanceTo(YEAR * 6);

  const reopened = await IskorkaRuntime.openOrCreate(
    b.store,
    'ignored',
    'mentor-save-world',
  );
  assert.deepEqual(
    b.runtime.snapshot().iskorkaMentorsV1,
    reopened.snapshot().iskorkaMentorsV1,
  );

  await a.runtime.advanceTo(YEAR * 7);
  await reopened.advanceTo(YEAR * 7);
  const left = a.runtime.snapshot();
  const right = reopened.snapshot();
  // The same saved world must continue identically after reopen.
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
    const farewells = messages.filter((message) => message.kind === 'farewell');
    assert.equal(farewells.length, 1);
    const mentor = assignedFoundingMentorV1(world, studentId)!;
    assert.equal(farewells[0].mentorId, mentor.id);
    const brain = world.iskorkaBrainV1!.brainsByAgentId[studentId];
    const orientation = brain.data.find(
      (datum) => datum.id === `mentor-farewell-orientation:${mentor.id}`,
    );
    assert.ok(orientation);
    const payload = JSON.parse(orientation!.encoded);
    assert.equal(payload.constraints.createsTask, false);
    assert.equal(payload.constraints.forcesLibraryVisit, false);
    assert.equal(payload.constraints.forcesWork, false);
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

  // Critical experiment boundary: adulthood must NOT switch the founding
  // cohort back onto the inherited Ainkrad resident task script.
  for (const spark of Object.values(world.agents)) {
    assert.equal(spark.lastDecision, undefined);
    assert.equal(spark.lastAction, undefined);
    assert.equal(spark.plan, undefined);
    assert.equal(spark.agencyCadence, undefined);
  }

  const birthsAtRelease = world.population.births;
  const knowledgeAtRelease = Object.fromEntries(
    Object.values(world.agents).map((spark) => [
      spark.id,
      structuredClone(world.v15!.knowledgeByAgentId[spark.id]),
    ]),
  );

  const releasedAt = world.calendar.elapsedWorldMinutes;
  const probe = Object.values(world.agents).find((spark) => spark.life.alive)!;
  const probeBody = world.v21!.bodiesByAgentId[probe.id].bodyCore!;
  const hydrationAtRelease = probeBody.homeostasis.hydration;
  const mentorMealsAtRelease = world.iskorkaMentorsV1!.totalMeals;
  const mentorDrinksAtRelease = world.iskorkaMentorsV1!.totalDrinks;

  await runtime.advanceTo(releasedAt + 2 * DAY);
  world = runtime.snapshot();
  const probeAfter = world.agents[probe.id];
  const probeBodyAfter = world.v21!.bodiesByAgentId[probe.id].bodyCore!;
  assert.ok(probeBodyAfter.releasedAdultSurvivalV1);
  // The adult body is now autonomous: hydration may fall or recover because
  // the Spark can remember water and act on that memory.  What matters here
  // is that the mentors stopped supplying it.
  assert.ok(Number.isFinite(probeBodyAfter.homeostasis.hydration));
  assert.ok(
    probeBodyAfter.homeostasis.hydration !== hydrationAtRelease ||
      probeAfter.life.alive,
  );
  assert.equal(world.iskorkaMentorsV1!.totalMeals, mentorMealsAtRelease);
  assert.equal(world.iskorkaMentorsV1!.totalDrinks, mentorDrinksAtRelease);
  assert.equal(probeAfter.lastDecision, undefined);
  assert.equal(probeAfter.plan, undefined);

  // Before fatal deprivation, acquired mentor knowledge remains intact and
  // no hidden adult task engine appears.
  world = runtime.snapshot();
  assert.equal(world.population.births, birthsAtRelease);
  for (const spark of Object.values(world.agents).filter((candidate) => candidate.life.alive)) {
    assert.equal(spark.lastDecision, undefined);
    assert.equal(spark.lastAction, undefined);
    assert.equal(spark.plan, undefined);
    assert.equal(spark.agencyCadence, undefined);
    assert.deepEqual(
      world.v15!.knowledgeByAgentId[spark.id],
      knowledgeAtRelease[spark.id],
    );
  }

  // Native adult agency is tested separately.  This farewell test only guards
  // the boundary: mentors are gone and the inherited resident task script has
  // not silently returned.
  assert.equal(world.population.births, birthsAtRelease);
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
