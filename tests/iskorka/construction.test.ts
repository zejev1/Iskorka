import {describe,it,expect} from 'vitest';
import {WorldEngine} from '../../src/world/WorldEngine';
import {InMemoryWorldStore} from '../../src/world/InMemoryWorldStore';
import {ISKORKA_PROFILE} from '../../src/world/WorldProfile';
import {WORLD_MINUTES_PER_YEAR} from '../../src/world/WorldClock';
describe('Iskorka physical home building from local harvested materials',()=>{
  it('reserves local materials and builds a real home when housing is full', async () => {
    const source = await WorldEngine.create({
      profile: ISKORKA_PROFILE,
      worldId: 'v16-material-home',
      seed: 'v16-material-home',
      store: new InMemoryWorldStore(),
      startTime: 0,
    });
    const raw = source.snapshot();
    const settlement = raw.settlements.settlement_ainkrad;
    const startingHomes = settlement.memberPlaceIds.filter(
      (placeId) => raw.places[placeId]?.kind === 'home',
    );
    for (const homeId of startingHomes) raw.places[homeId].capacity = 1;
    const economy = raw.v16!.settlementEconomyById.settlement_ainkrad;
    economy.stocks.wood = 0;
    // A timber, wattle and thatch home must remain possible without a quarry.
    economy.stocks.stone = 0;
    economy.constructionTools = 1;
    // This is a construction test: provide an actually local known wood lot,
    // independent of the seed's far-away forests and exploration decisions.
    const outskirts = raw.places.outskirts;
    const knownWoodSourceId = 'test_local_wood_lot';
    raw.places[knownWoodSourceId] = { ...structuredClone(outskirts), id: knownWoodSourceId,
      name: 'Известная местная роща', kind: 'forest', biome: 'forest',
      mapX: outskirts.mapX + 0.4, mapY: outskirts.mapY + 0.4,
      connectedPlaceIds: [outskirts.id], boundaryPolygon: undefined, waterPolygon: undefined };
    outskirts.connectedPlaceIds.push(knownWoodSourceId);
    for (const agent of Object.values(raw.agents)) {
      agent.life.stage = 'adult';
      agent.life.ageYears = Math.max(24, agent.life.ageYears);
      agent.life.health = 1;
      agent.energy = 1;
      agent.movement = undefined;
      agent.plan = undefined;
      agent.skills.craft = 1;
      agent.personality.diligence = 1;
      agent.personality.curiosity = 1;
      agent.mind.values.care = 1;
      agent.needs.purpose = 1;
      agent.knownPlaceIds = [
        ...new Set([...(agent.knownPlaceIds ?? []), knownWoodSourceId]),
      ];
    }
    const constructionKnowledgeBefore = Object.fromEntries(
      Object.entries(raw.v15!.knowledgeByAgentId).map(([agentId, knowledge]) => [
        agentId,
        knowledge.construction,
      ]),
    );
    const store = new InMemoryWorldStore();
    await store.initializeWorld(raw);
    const world = await WorldEngine.open({ worldId: raw.id, store });
    const decisionQuantum = WORLD_MINUTES_PER_YEAR / 60;
    let started = world.snapshot().v16!.settlementEconomyById.settlement_ainkrad
      .activeHumanHomeProject;
    for (let index = 1; index <= 300 && !started; index += 1) {
      await world.advanceCanonicalTimeTo(decisionQuantum * index);
      started = world.snapshot().v16!.settlementEconomyById.settlement_ainkrad
        .activeHumanHomeProject;
    }

    expect(started).toBeDefined();
    expect(started!.recipe).toBe('timber_wattle_thatch');
    expect(started!.reservedMaterials.stone).toBe(0);
    expect(world.snapshot().places[started!.homeId].kind).toBe(
      'construction_site',
    );
    expect(
      world.snapshot().settlements.settlement_ainkrad.memberPlaceIds.filter(
        (placeId) => world.snapshot().places[placeId]?.kind === 'home',
      ),
    ).toHaveLength(startingHomes.length);

    const initiatorAtStart = structuredClone(
      world.snapshot().agents[started!.initiatedByAgentId],
    );
    const resumed = await WorldEngine.open({ worldId: raw.id, store });
    expect(
      resumed.snapshot().v16!.settlementEconomyById.settlement_ainkrad
        .activeHumanHomeProject,
    ).toEqual(started);
    await resumed.advanceCanonicalTimeTo(
      started!.startedWorldMinute + WORLD_MINUTES_PER_YEAR * 5,
    );
    const state = resumed.snapshot();
    const afterHomes = state.settlements.settlement_ainkrad.memberPlaceIds.filter(
      (placeId) => state.places[placeId]?.kind === 'home',
    );
    const homeEvents = (await store.history(state.id)).filter(
      (event) => event.kind === 'world.building.home_built',
    );

    expect(afterHomes.length).toBeGreaterThan(startingHomes.length);
    expect(
      state.v16!.settlementEconomyById.settlement_ainkrad.constructionEvents,
    ).toBeGreaterThan(0);
    expect(homeEvents.length).toBeGreaterThan(0);
    const completedProjectEvent = homeEvents.find(
      (event) => event.payload.projectId === started!.id,
    );
    expect(completedProjectEvent).toBeDefined();
    expect(completedProjectEvent!.payload.recipe).toBe(
      'timber_wattle_thatch',
    );
    expect(
      Number(completedProjectEvent!.payload.completedWorldMinute),
    ).toBeGreaterThan(Number(completedProjectEvent!.payload.startedWorldMinute));
    const builderIds = completedProjectEvent!.payload.builderIds as string[];
    expect(builderIds.length).toBeGreaterThan(0);
    expect(
      (completedProjectEvent!.payload.movedResidentIds as unknown[]).length,
    ).toBeGreaterThan(0);

    const initiatorAfter = state.agents[started!.initiatedByAgentId];
    expect(initiatorAfter.personality).toEqual(initiatorAtStart.personality);
    expect(initiatorAfter.origin).toEqual(initiatorAtStart.origin);
    expect(initiatorAfter.mind.identityId).toBe(
      initiatorAtStart.mind.identityId,
    );
    expect(initiatorAfter.learning!.sequence).toBeGreaterThanOrEqual(
      initiatorAtStart.learning!.sequence,
    );
    expect(initiatorAfter.learning!.totalEvaluated).toBeGreaterThanOrEqual(
      initiatorAtStart.learning!.totalEvaluated,
    );
    expect(
      builderIds.some(
        (agentId) =>
          state.v15!.knowledgeByAgentId[agentId].construction >
          constructionKnowledgeBefore[agentId],
      ),
    ).toBe(true);
    expect(
      (await store.historyForAgent(raw.id, builderIds[0])).some((memory) =>
        memory.summary.includes('remembers') && memory.summary.includes('build'),
      ),
    ).toBe(true);
  }, 30_000);
});
