import { ISKORKA_PROFILE } from '../src/world/HumanLabProfile';
import { describe, expect, it } from 'vitest';
import { InMemoryAppendOnlyLog } from '../src/persistence/AppendOnlyLog';
import { LiveWorldRuntime } from '../src/runtime/LiveWorldRuntime';
import { WorldSensors } from '../src/sensors/WorldSensors';
import { InMemoryWorldStore } from '../src/world/InMemoryWorldStore';
import { WORLD_RULES_VERSION, WorldEngine } from '../src/world/WorldEngine';

const humanCount = (world: ReturnType<WorldEngine['snapshot']>) =>
  Object.values(world.agents).filter(
    (agent) => agent.life.alive && (agent.race ?? 'human') === 'human',
  ).length;

describe('v0.3.14 Underworld-style substrate audit', () => {
  it('starts the live world with three independent balanced human settlements', async () => {
    const runtime = await LiveWorldRuntime.create({
      mode: 'observer', seed: 'v14-founders', worldId: 'v14-founders',
      store: new InMemoryWorldStore(), controlLog: new InMemoryAppendOnlyLog(),
    });
    const frame = await runtime.tick();
    const humans = Object.values(frame.world.agents).filter(
      (agent) => agent.life.alive && (agent.race ?? 'human') === 'human',
    );
    expect(humans).toHaveLength(10);
    expect(humans.filter((agent) => agent.sex === 'male')).toHaveLength(5);
    expect(humans.filter((agent) => agent.sex === 'female')).toHaveLength(5);
    expect(humans.every((agent) => agent.life.generation === 0)).toBe(true);
    expect(new Set(humans.map((agent) => frame.world.places[agent.homeId]?.settlementId))).toEqual(new Set(['settlement_ainkrad']));
    for (const settlementId of ['settlement_ainkrad']) {
      expect(humans.filter((agent) => frame.world.places[agent.homeId]?.settlementId === settlementId)).toHaveLength(10);
    }

    const c = frame.world.places.commons;
    const workshop = frame.world.places.workshop;
    const field = frame.world.places.resource_field;
    const outskirts = frame.world.places.outskirts;
    const d = (p: typeof c) => Math.hypot(p.mapX - c.mapX, p.mapY - c.mapY);
    expect(d(workshop)).toBeLessThan(4);
    expect(d(field)).toBeGreaterThan(d(workshop));
    expect(d(field)).toBeLessThan(8);
    expect(d(outskirts)).toBeLessThan(d(field));
    expect(d(outskirts)).toBeGreaterThan(frame.world.settlements.settlement_ainkrad.radius);
    expect(d(outskirts)).toBeLessThan(2);
  });

  it('migrates a critically small existing world without a hidden population rescue cohort', async () => {
    const sourceStore = new InMemoryWorldStore();
    const source = await WorldEngine.create({ worldId: 'v14-recovery', seed: 'v14-recovery', store: sourceStore, profile: ISKORKA_PROFILE });
    const damaged = source.snapshot();
    const agents = Object.values(damaged.agents);
    const survivorIds = agents.slice(0, 2).map((agent) => agent.id);
    const survivorMinds = Object.fromEntries(
      survivorIds.map((id) => [id, structuredClone(damaged.agents[id].mind)]),
    );
    agents.slice(2).forEach((agent) => { agent.life.alive = false; agent.life.health = 0; agent.life.diedAt = 1; agent.life.deathCause = 'deprivation'; });
    damaged.population.deaths = agents.length - 2;
    damaged.population.lastDeathAt = 1;
    damaged.rulesVersion = 'ainkrad-world-rules-0.3.13';
    damaged.governance.constitutionVersion = 'ainkrad-constitution-0.3.10';
    delete damaged.governance.laws.settlement_cohesion;
    delete damaged.governance.laws.habitat_integrity;
    delete damaged.governance.laws.civilization_continuity;
    delete damaged.epoch;
    delete damaged.epochStartedAt;

    const store = new InMemoryWorldStore();
    await store.initializeWorld(damaged);
    const controlLog = new InMemoryAppendOnlyLog();
    const first = await LiveWorldRuntime.create({ mode: 'observer', seed: 'v14-recovery', worldId: damaged.id, store, controlLog });
    const migrated = await store.loadWorld(damaged.id);
    expect(migrated?.rulesVersion).toBe(WORLD_RULES_VERSION);
    expect(migrated ? humanCount(migrated) : 0).toBe(2);
    for (const id of survivorIds) {
      expect(migrated?.agents[id].life.alive).toBe(true);
      expect(migrated?.agents[id].mind).toEqual(survivorMinds[id]);
    }
    // Once migration is proven identity-preserving, a normal runtime tick is
    // allowed to evolve emotions/choices as part of ordinary personhood.
    const firstFrame = await first.tick();
    expect(humanCount(firstFrame.world)).toBe(2);
    const reopened = await LiveWorldRuntime.create({ mode: 'observer', seed: 'v14-recovery', worldId: damaged.id, store, controlLog });
    expect(humanCount((await reopened.tick()).world)).toBe(2);
  });

  it('promotes Ainkrad from village to city by local population without requiring frontier stage', async () => {
    const store = new InMemoryWorldStore();
    const world = await WorldEngine.create({
      worldId: 'v14-city', seed: 'v14-city', store, startTime: 0,
      agentNames: Array.from({ length: 18 }, (_, i) => `Resident ${i + 1}`),
    });
    await world.step(24, 0);
    const snapshot = world.snapshot();
    expect(snapshot.growth.stage).toBe(0);
    expect(snapshot.settlements.settlement_ainkrad.kind).toBe('city');
  });

  it('keeps generation-zero founders rooted while allowing travel and later-generation resettlement logic', async () => {
    const store = new InMemoryWorldStore();
    const world = await WorldEngine.create({
      worldId: 'v14-rooted', seed: 'v14-rooted', store,
      agentNames: Array.from({ length: 20 }, (_, i) => `Founder ${i + 1}`),
    });
    const founderIds = Object.values(world.snapshot().agents).map((agent) => agent.id);
    for (let tick = 1; tick <= 360; tick += 1) await world.step(tick);
    const snapshot = world.snapshot();
    for (const id of founderIds) {
      const founder = snapshot.agents[id];
      if (!founder.life.alive) continue;
      expect(founder.life.generation).toBe(0);
      expect(snapshot.places[founder.homeId]?.settlementId).toBe('settlement_ainkrad');
    }
  }, 30_000);

  it('starts a new epoch with ten founders in one settlement without carrying over personal relations', async () => {
    const store = new InMemoryWorldStore();
    const controlLog = new InMemoryAppendOnlyLog();
    const runtime = await LiveWorldRuntime.create({ mode: 'observer', seed: 'v14-reset', worldId: 'v14-reset', store, controlLog });
    let before = await runtime.tick();
    before = await runtime.tick();
    before = await runtime.tick();

    const oldIds = new Set(Object.keys(before.world.agents));

    const reset = await runtime.resetWorld('v14-reset-new');
    expect(reset.epoch).toBe(2);
    expect(reset.calendar.elapsedWorldMinutes).toBe(0);
    expect(humanCount(reset)).toBe(10);
    expect(Object.values(reset.wildlife).every(p => !p.isMonster)).toBe(true);
    expect(Object.keys(reset.wildlife).length).toBeGreaterThan(0);
    expect(Object.keys(reset.relationships)).toHaveLength(0);
    expect(Object.keys(reset.agents).some((id) => oldIds.has(id))).toBe(false);

    await runtime.tick();
  });
});
