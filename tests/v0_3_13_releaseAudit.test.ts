import { describe, expect, it } from 'vitest';
import { InMemoryAppendOnlyLog } from '../src/persistence/AppendOnlyLog';
import { WorldSensors } from '../src/sensors/WorldSensors';
import { InMemoryWorldStore } from '../src/world/InMemoryWorldStore';
import { WorldEngine } from '../src/world/WorldEngine';

describe('v0.3.13 release audit', () => {
  it('starts three default human lines as 15 male + 15 female with progression', async () => {
    const store = new InMemoryWorldStore();
    const world = await WorldEngine.create({
      worldId: 'audit-founders',
      seed: 'audit-founders-seed',
      store,
      startTime: 0,
    });
    const living = Object.values(world.snapshot().agents).filter((agent) => agent.life.alive);
    expect(living).toHaveLength(30);
    expect(living.filter((agent) => agent.race === 'human')).toHaveLength(30);
    expect(living.filter((agent) => agent.sex === 'male')).toHaveLength(15);
    expect(living.filter((agent) => agent.sex === 'female')).toHaveLength(15);
    expect(living.every((agent) => (agent.progression?.level ?? 0) >= 1)).toBe(true);
  });

  it('migrates a stopped v0.3.12 world with only three survivors without replacing their minds', async () => {
    const sourceStore = new InMemoryWorldStore();
    const source = await WorldEngine.create({
      worldId: 'audit-three-survivors',
      seed: 'audit-three-survivors-seed',
      store: sourceStore,
      startTime: 0,
    });
    const legacy = source.snapshot() as any;
    legacy.rulesVersion = 'ainkrad-world-rules-0.3.12';
    legacy.revision = 0;
    const agents = Object.values(legacy.agents) as any[];
    const survivingIds = agents.slice(0, 3).map((agent) => agent.id);
    const survivingMinds = Object.fromEntries(
      agents.slice(0, 3).map((agent) => [agent.id, structuredClone(agent.mind)]),
    );
    for (const [index, agent] of agents.entries()) {
      delete agent.sex;
      delete agent.race;
      delete agent.progression;
      if (index >= 3) {
        agent.life.alive = false;
        agent.life.health = 0;
        agent.life.diedAt = 1;
        agent.life.deathCause = 'monster';
      }
    }
    legacy.population.deaths = 3;
    legacy.population.lastDeathAt = 1;

    const store = new InMemoryWorldStore();
    await store.initializeWorld(legacy);
    const opened = await WorldEngine.open({ worldId: legacy.id, store });
    const migrated = opened.snapshot();
    const living = Object.values(migrated.agents).filter((agent) => agent.life.alive);
    expect(living.map((agent) => agent.id).sort()).toEqual([...survivingIds].sort());
    expect(living.some((agent) => agent.sex === 'male')).toBe(true);
    expect(living.some((agent) => agent.sex === 'female')).toBe(true);
    for (const id of survivingIds) {
      expect(migrated.agents[id].mind).toEqual(survivingMinds[id]);
      expect(migrated.agents[id].race).toBe('human');
      expect((migrated.agents[id].progression?.level ?? 0)).toBeGreaterThanOrEqual(1);
    }

    for (let tick = 1; tick <= 180; tick += 1) {
      await opened.step(tick);
    }

    const continued = opened.snapshot();
    const continuedHumans = Object.values(continued.agents).filter(
      (agent) =>
        agent.life.alive &&
        (agent.race ?? 'human') === 'human',
    );

    expect(continuedHumans.length).toBeGreaterThanOrEqual(3);

    for (const id of survivingIds) {
      expect(continued.agents[id].life.alive).toBe(true);
    }

    const observation = await new WorldSensors(store).observe(
      continued,
      continued.now,
    );

    expect(
      observation.metrics.livingPopulation,
    ).toBeGreaterThanOrEqual(3);

    expect(
      observation.metrics.reproductivePairPotential,
    ).toBeGreaterThanOrEqual(1);
  });

  it('does not count other intelligent races as humans and allows lived progression', async () => {
    const store = new InMemoryWorldStore();
    const world = await WorldEngine.create({
      worldId: 'audit-races-levels',
      seed: 'audit-races-levels-seed',
      store,
      agentNames: Array.from({ length: 12 }, (_, index) => `Resident ${index + 1}`),
      startTime: 0,
    });
    for (let tick = 1; tick <= 600; tick += 1) {
      await world.step(tick);
    }
    const snapshot = world.snapshot();
    const living = Object.values(snapshot.agents).filter((agent) => agent.life.alive);
    const humans = living.filter((agent) => (agent.race ?? 'human') === 'human');
    const otherSapients = living.filter((agent) => (agent.race ?? 'human') !== 'human');
    const observation = await new WorldSensors(store).observe(snapshot, snapshot.now);
    expect(observation.metrics.livingPopulation).toBe(humans.length);
    expect(observation.metrics.sapientPopulation).toBe(living.length);
    expect(otherSapients.length).toBeGreaterThan(0);
    expect(observation.metrics.raceDiversity).toBeGreaterThan(1);
    expect(
      Object.values(snapshot.agents).some(
        (agent) => (agent.progression?.experience ?? 0) > 0 && (agent.progression?.level ?? 1) > 1,
      ),
    ).toBe(true);
  }, 45_000);
});
