import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { LiveWorldRuntime } from '../src/runtime/LiveWorldRuntime';
import { WorldEngine } from '../src/world/WorldEngine';
import { InMemoryWorldStore } from '../src/world/InMemoryWorldStore';
import { ISKORKA_PROFILE, assertHumanLab } from '../src/world/HumanLabProfile';
import { createIndexedDbWorldStore } from '../src/persistence/IndexedDbPersistence';
import { CANONICAL_WORLD_QUANTUM_MINUTES as Q, WORLD_MINUTES_PER_YEAR as YEAR } from '../src/v15/WorldTimeContract';
import type { WorldState } from '../src/world/types';

const seed = 'ainkrad-browser-world';
const fresh = (worldId = 'ainkrad_live_world', store = new InMemoryWorldStore()) =>
  LiveWorldRuntime.create({ seed, worldId, store });
const assertProfile = (w: WorldState) => {
  assertHumanLab(w);
  expect(w.profile).toBe(ISKORKA_PROFILE);
  expect(w.centuryHumpback).toBeUndefined();
  expect(w.terrain?.offshore).toBeUndefined();
  expect(Object.values(w.agents).every(a => a.race === 'human')).toBe(true);
  expect(Object.values(w.wildlife).every(p => !p.isMonster)).toBe(true);
  expect(Object.keys(w.v19!.adventureEconomy.dungeonsById)).toHaveLength(0);
  expect(Object.keys(w.v19!.adventureEconomy.artifactsById)).toHaveLength(0);
  expect(w.places.elf_library_v20).toBeUndefined();
  expect(w.places.secret_library_v18).toBeDefined();
  expect(w.settlements.settlement_ainkrad.name).toBe('Основание');
};

describe('Iskorka actual physical bootstrap', () => {
  it('starts ten different adults, five women and five men, without preassigned couples or hidden teachers', async () => {
    const w = (await fresh()).worldSnapshot(), people = Object.values(w.agents);
    assertProfile(w);
    expect(people).toHaveLength(10);
    expect(people.filter(a => a.sex === 'male')).toHaveLength(5);
    expect(people.filter(a => a.sex === 'female')).toHaveLength(5);
    expect(people.every(a => a.life.alive && a.life.stage === 'adult' && a.life.ageYears >= 18)).toBe(true);
    expect(new Set(people.map(a => JSON.stringify(a.personality))).size).toBe(10);
    expect(new Set(people.map(a => JSON.stringify(a.life.physiology))).size).toBe(10);
    expect(w.relationships).toEqual({});
    expect(w.v15!.genesisTeachers).toEqual([]);
    expect(Object.keys(w.settlements)).toEqual(['settlement_ainkrad']);
    expect(Object.keys(w.places).filter(p => p.includes('library'))).toEqual(['secret_library_v18']);
  });

  it.each([seed, 'isolation-map-2', 'isolation-map-3'])('keeps donor town coordinates and the terrain seed for %s rather than recentering', async testSeed => {
    const opts = { worldId: 'ainkrad_live_world', seed: testSeed, startTime: 0 };
    const donor = (await WorldEngine.create({ ...opts, store: new InMemoryWorldStore() })).snapshot();
    const lab = (await WorldEngine.create({ ...opts, profile: ISKORKA_PROFILE, store: new InMemoryWorldStore() })).snapshot();
    for (const id of ['commons', 'resource_field', 'workshop', 'quiet_space', 'outskirts', 'home_agent_1', 'home_agent_10', 'ocean_ainkrad']) {
      expect({ x: lab.places[id].mapX, y: lab.places[id].mapY }, id)
        .toEqual({ x: donor.places[id].mapX, y: donor.places[id].mapY });
    }
    expect(lab.terrain!.seed).toEqual(donor.terrain!.seed);
    // Removed towns no longer contribute empty settlement anchors; recipe keys differ.
    expect(lab.places.ocean_ainkrad.waterPolygon).toEqual(donor.places.ocean_ainkrad.waterPolygon);
  });

  it('has ordinary wildlife and physical resources, with no controller or divine console in its API/frame', async () => {
    const r = await fresh(), frame = await r.tick(0), w = frame.world;
    expect(Object.values(w.wildlife).map(p => p.species).sort()).toEqual(['bird', 'fish', 'rabbit']);
    expect(Object.values(w.wildlife).every(p => p.count > 0 && Boolean(w.places[p.habitatId]))).toBe(true);
    expect(w.v15!.renewableResources.storedResources).toBeGreaterThan(0);
    for (const key of ['cardinal', 'core', 'journal', 'evaluation', 'evaluationCount', 'cardinalActivity', 'interventions', 'mode', 'controlLog']) {
      expect(r).not.toHaveProperty(key); expect(frame).not.toHaveProperty(key);
    }
    expect(r).not.toHaveProperty('cardinalConsole');
    expect(r).not.toHaveProperty('divineAudience');
    expect(frame.clock).toBeDefined();
  });

  it('does not silently import or overwrite another project save', async () => {
    const store = new InMemoryWorldStore(), donor = await WorldEngine.create({ seed, worldId: 'foreign', store });
    const before = donor.snapshot();
    await expect(fresh('foreign', store)).rejects.toThrow('не принадлежит Искорке');
    expect(await store.loadWorld('foreign')).toEqual(before);
  });

  it('fails closed on forbidden generators in an Iskorka save, without erasing evidence', async () => {
    const r = await fresh('corrupt');
    const w = r.worldSnapshot();
    Object.values(w.wildlife)[0].isMonster = true;
    const store = new InMemoryWorldStore(); await store.initializeWorld(w);
    await expect(fresh(w.id, store)).rejects.toThrow('monsters');
    expect(await store.loadWorld(w.id)).toEqual(w);
  });

  it('reset keeps the human profile and starts a new epoch without previous relationships or accumulated time', async () => {
    const r = await fresh('reset-lab');
    await r.tick(Q * 6); r.enqueueLiveElapsed(60_000);
    const w = await r.resetWorld(seed);
    assertProfile(w);
    expect(w.epoch).toBe(2); expect(w.calendar.elapsedWorldMinutes).toBe(0);
    expect(Object.values(w.agents)).toHaveLength(10);
    expect(w.relationships).toEqual({});
    expect(r.liveTiming().pendingWorldMinutes).toBe(0);
    expect(Object.values(w.agents).every(a => a.life.parentIds.length === 0)).toBe(true);
  });

  it('reload neither refills depleted food nor resurrects ordinary animals', async () => {
    const w = (await fresh('depleted-lab')).worldSnapshot();
    const fish = Object.values(w.wildlife).find(p => p.species === 'fish')!;
    fish.count = 0;
    const store = new InMemoryWorldStore(); await store.initializeWorld(w);
    const reopened = await fresh(w.id, store);
    expect(reopened.worldSnapshot().wildlife[fish.id].count).toBe(0);
    expect(reopened.worldSnapshot()).toEqual(w);
  });

  it('keeps exact people, RNG and clock through IndexedDB reload in its own database', async () => {
    const store = createIndexedDbWorldStore('iskorka-test-physical-persistence');
    const options = { seed, worldId: 'save-lab', store, durable: true };
    const r = await LiveWorldRuntime.create(options); await r.tick(Q * 4 + 123);
    const before = r.worldSnapshot(), reopened = await LiveWorldRuntime.create(options);
    expect(reopened.worldSnapshot()).toEqual(before);
    expect((await reopened.tick(0)).continuity.resumed).toBe(true);
    const independent = createIndexedDbWorldStore('ainkrad-test-untouched');
    expect(await independent.loadWorld('save-lab')).toBeUndefined();
  });

  it('executes the same canonical world with or without presentation frames and after a mid-run reload', async () => {
    const store = new InMemoryWorldStore();
    const hidden = await fresh('equivalent-lab', store), shown = await fresh('equivalent-lab');
    for (let i = 0; i < 30; i++) {
      await hidden.advanceResponsive(1_000, false);
      await shown.advanceResponsive(1_000, true);
    }
    expect(hidden.worldSnapshot()).toEqual(shown.worldSnapshot());
    const reopened = await fresh('equivalent-lab', store);
    await reopened.tick(Q); await shown.tick(Q);
    expect(reopened.worldSnapshot()).toEqual(shown.worldSnapshot());
  });

  it('keeps all sixty semantic quanta per year while batching storage commits', async () => {
    const r = await fresh('batch-lab');
    let batches = 0;
    while (!(await r.catchUpBatchTo(YEAR * 2, 24)).completed) { expect(++batches).toBeLessThan(10); }
    expect(r.worldSnapshot().v15!.simulationClock.quantumIndex).toBe(120);
    expect(r.worldSnapshot().calendar.elapsedWorldMinutes).toBe(YEAR * 2);
  });

  it('keeps the physical human-only profile through forty years, births, learning, expansion and exact reload', async () => {
    const store = new InMemoryWorldStore(), r = await fresh('ainkrad_live_world', store);
    const initial = r.worldSnapshot();
    for (const years of [1, 5, 10, 20, 40]) {
      while (!(await r.catchUpBatchTo(years * YEAR, 60)).completed) { /* full semantic execution */ }
      const w = r.worldSnapshot(); assertProfile(w);
      expect((await fresh('ainkrad_live_world', store)).worldSnapshot()).toEqual(w);
      expect(w.v15!.simulationClock.quantumIndex).toBe(years * 60);
      expect(w.calendar.elapsedWorldMinutes).toBe(years * YEAR);
    }
    const w = r.worldSnapshot(), history = await store.history(w.id);
    expect(w.population.births).toBeGreaterThan(0);
    expect(Object.keys(w.places).length).toBeGreaterThan(Object.keys(initial.places).length);
    expect(w.v15!.knowledgeByAgentId).not.toEqual(initial.v15!.knowledgeByAgentId);
    expect(history.some(e => /resource|gather|work|harvest|build/.test(e.kind))).toBe(true);
    expect(history.some(e => e.kind.startsWith('cardinal.'))).toBe(false);
    expect(Object.values(w.agents).some(a => a.life.parentIds.length > 0)).toBe(true);
  }, 60_000);

  it('has no controller files or imports reachable from browser, worker or public package entry', () => {
    const visited = new Set<string>();
    function visit(file: string) {
      file = resolve(file); if (visited.has(file)) return; visited.add(file);
      const source = readFileSync(file, 'utf8');
      const dependencies = [...source.matchAll(/(?:from\s*|import\s*)(['"])(\.[^'"]+)\1/g)];
      for (const [, , specifier] of dependencies) {
        expect(specifier).not.toMatch(/(?:^|\/)cardinal\/|Cardinal(?:Core|Runtime|Observer|Journal|OceanArchitect)|InterventionGateway/);
        const path = resolve(dirname(file), specifier), target = [path, `${path}.ts`, `${path}/index.ts`].find(p => existsSync(p) && p.endsWith('.ts'));
        if (target) visit(target);
      }
    }
    for (const p of ['src/browser.ts', 'src/runtime/liveWorld.worker.ts', 'src/index.ts']) visit(p);
    expect(visited.size).toBeGreaterThan(20);
    expect(existsSync('src/cardinal')).toBe(false);
    expect(readFileSync('src/runtime/liveWorld.worker.ts', 'utf8')).toContain('createIndexedDbWorldStore');
    expect(readFileSync('src/runtime/liveWorld.worker.ts', 'utf8')).not.toContain('controlLog');
    expect(readFileSync('src/browser.ts', 'utf8')).not.toContain('cardinalConsole');
  });
});
