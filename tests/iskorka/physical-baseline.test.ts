import { describe, it, expect } from 'vitest';
import 'fake-indexeddb/auto';
import { WorldEngine } from '../../src/world/WorldEngine';
import { InMemoryWorldStore } from '../../src/world/InMemoryWorldStore';
import { IskorkaRuntime } from '../../src/iskorka/IskorkaRuntime';
import { createIndexedDbWorldStore } from '../../src/persistence/IndexedDbPersistence';
import { ISKORKA_PROFILE, ISKORKA_FOUNDERS, assertIskorkaProfile } from '../../src/world/WorldProfile';
import { WORLD_MINUTES_PER_YEAR } from '../../src/world/WorldClock';
import { worldWeatherV21 } from '../../src/v21/WeatherV21';
import { syncAdventureEconomyV19, isAdventureCandidateV19 } from '../../src/v19/AdventureEconomyV19';
import type { WorldState } from '../../src/world/types';

async function fresh(seed = 'iskorka-baseline') {
  const store = new InMemoryWorldStore();
  const runtime = await IskorkaRuntime.open(store, seed);
  return { store, runtime, world: runtime.engine.snapshot() };
}
function assertExcluded(w: WorldState) {
  expect(w.profile).toBe(ISKORKA_PROFILE);
  expect(w.settlements.settlement_ainkrad.name).toBe('Основание');
  expect(Object.values(w.agents).every(a => a.race === 'human')).toBe(true);
  expect(Object.values(w.wildlife).every(a => !a.isMonster)).toBe(true);
  expect(w.centuryHumpback).toBeUndefined();
  expect(w.v15!.genesisTeachers).toEqual([]);
  expect(w.v19!.adventureEconomy.dungeonsById).toEqual({});
  expect(Object.values(w.places).filter(p => p.kind === 'library')).toHaveLength(1);
  expect(Object.values(w.places).some(p => /^(elf|dwarf|goblin|orc|ogre)_/.test(p.id))).toBe(false);
  assertIskorkaProfile(w);
}

describe('Iskorka physical baseline', () => {
  it('creates ten different adult human bodies, no couples, one town and one library', async () => {
    const {world:w} = await fresh();
    assertExcluded(w);
    const agents=Object.values(w.agents);
    expect(agents).toHaveLength(10);
    expect(agents.filter(a=>a.sex==='male')).toHaveLength(5);
    expect(agents.filter(a=>a.sex==='female')).toHaveLength(5);
    expect(agents.every(a=>a.life.ageYears>=18&&a.life.alive)).toBe(true);
    expect(w.relationships).toEqual({});
    expect(new Set(agents.map(a=>JSON.stringify(a.personality))).size).toBe(10);
    expect(new Set(agents.map(a=>JSON.stringify(a.life.physiology))).size).toBeGreaterThan(5);
    expect(Object.keys(w.settlements)).toHaveLength(1);
    expect(w.v15!.founderSmithAgentId).toBeUndefined();
    expect(Object.values(w.wildlife).some(a=>a.species==='fish'&&a.count>0)).toBe(true);
    expect(Object.values(w.wildlife).some(a=>a.species==='rabbit'&&a.count>0)).toBe(true);
    expect(w.terrain).toBeDefined();
  });

  it('retains exact first-settlement and home positions from the approved F2 layout', async () => {
    for(const seed of ['layout-a','layout-b','layout-c']) {
      const donor=await WorldEngine.create({store:new InMemoryWorldStore(),seed,worldId:'same-world'});
      const lab=await WorldEngine.create({store:new InMemoryWorldStore(),seed,worldId:'same-world',profile:ISKORKA_PROFILE});
      const before=donor.snapshot(), after=lab.snapshot();
      for(const id of ['commons','resource_field','workshop','quiet_space','outskirts',...Array.from({length:10},(_,i)=>`home_agent_${i+1}`)]) {
        expect({x:after.places[id].mapX,y:after.places[id].mapY},`${seed}: ${id}`).toEqual({x:before.places[id].mapX,y:before.places[id].mapY});
      }
    }
  });

  it('advances physical work, harvests, movement, reading and weather with no observer events', async () => {
    const {world:initial,runtime,store}=await fresh('iskorka-physical-actions');
    await runtime.advanceTo(WORLD_MINUTES_PER_YEAR*2);
    const w=runtime.engine.snapshot(),events=await store.history(w.id);
    assertExcluded(w);
    expect(w.calendar.elapsedWorldMinutes).toBe(WORLD_MINUTES_PER_YEAR*2);
    expect(events.some(e=>e.kind==='agent.gathered'&&Number(e.payload.materialYield)>0)).toBe(true);
    expect(events.some(e=>e.kind==='agent.worked')).toBe(true);
    expect(Object.values(w.agents).some(a=>a.position.x!==initial.agents[a.id]?.position.x||a.position.y!==initial.agents[a.id]?.position.y)).toBe(true);
    const knowledge=Object.values(w.v18!.secretLibrary.knowledgeByAgentId).flat();
    expect(knowledge.length).toBeGreaterThan(0);
    expect(events.some(e=>e.source==='cardinal'||e.source==='auditor')).toBe(false);
    expect(new Set(Array.from({length:12},(_,i)=>worldWeatherV21(w,i*43200).kind)).size).toBeGreaterThan(1);
    expect(w.v16!.settlementEconomyById.settlement_ainkrad.harvestEvents).toBeGreaterThan(0);
    expect(Object.values(w.v16!.settlementEconomyById.settlement_ainkrad.stocks).every(n=>n>=0)).toBe(true);
  },60000);

  it('does not re-create other peoples, monster controllers or dungeons after twelve years', async () => {
    const {runtime}=await fresh('iskorka-twelve-years');
    await runtime.advanceTo(WORLD_MINUTES_PER_YEAR*12);
    const w=runtime.engine.snapshot();assertExcluded(w);
    expect(Object.values(w.agents).every(a=>!isAdventureCandidateV19(w,a))).toBe(true);
    expect(w.calendar.elapsedWorldMinutes).toBe(WORLD_MINUTES_PER_YEAR*12);
    // No fixed-population reset/rescue: original founders retain identity even after births/deaths.
    for(let i=1;i<=10;i++) expect(w.agents[`agent_${i}`].id).toBe(`agent_${i}`);
  },60000);

  it('does not invent a dungeon when a resident physically discovers a mountain entrance', async () => {
    const {world:w}=await fresh();const a=w.agents.agent_1;
    w.places.test_mountain={...w.places.outskirts,id:'test_mountain',kind:'mountains',biome:'mountains',settlementId:undefined};
    a.locationId='test_mountain';delete a.movement;
    w.growth.stage=8;syncAdventureEconomyV19(w);
    expect(w.v19!.adventureEconomy.dungeonsById).toEqual({});
    expect(w.v19!.adventureEconomy.settlementMarketsById.settlement_ainkrad).toBeDefined();
  });

  it('reopens IndexedDB without migrating identities or RNG, with exactly the same next trajectory', async () => {
    const database=`iskorka-test-${crypto.randomUUID()}`;
    const store=createIndexedDbWorldStore(database);
    const runtime=await IskorkaRuntime.open(store,'durable-seed');
    const targets=[8760,8760*3+17,8760*9];
    for(const target of targets) await runtime.advanceTo(target);
    await runtime.checkpoint();
    const saved=runtime.engine.snapshot(),memories=await store.historyForAgent(saved.id,'agent_1');
    const secondStore=createIndexedDbWorldStore(database);
    const restored=await IskorkaRuntime.open(secondStore,'ignored-on-reload');
    expect(restored.resumed).toBe(true);
    expect(restored.engine.snapshot()).toEqual(saved);
    expect(await secondStore.historyForAgent(saved.id,'agent_1')).toEqual(memories);
    // An independent store carries the SAME full history, not merely a WorldState clone.
    const controlStore=new InMemoryWorldStore();
    const control=await IskorkaRuntime.open(controlStore,'durable-seed');
    for(const target of targets)await control.advanceTo(target);
    await restored.advanceTo(8760*16);await control.advanceTo(8760*16);
    expect(restored.engine.snapshot()).toEqual(control.engine.snapshot());
    expect(await secondStore.historyForAgent(saved.id,'agent_1')).toEqual(await controlStore.historyForAgent(saved.id,'agent_1'));
    assertExcluded(restored.engine.snapshot());
  },60000);

  it('reset preserves policy, produces only ten adults and cannot restore excluded controllers', async () => {
    const {runtime}=await fresh('reset-first');
    await runtime.advanceTo(8760*4);
    await runtime.reset('reset-second','reset-operation-1');
    const w=runtime.engine.snapshot();assertExcluded(w);
    expect(w.epoch).toBe(2);expect(w.calendar.elapsedWorldMinutes).toBe(0);
    expect(Object.values(w.agents).map(a=>a.name)).toEqual([...ISKORKA_FOUNDERS]);
    expect(Object.keys(w.agents)).toHaveLength(10);expect(w.relationships).toEqual({});
    await runtime.advanceTo(8760*4);assertExcluded(runtime.engine.snapshot());
  });

  it('refuses an Ainkrad save or a corrupted profile rather than silently rewriting people', async () => {
    const store=new InMemoryWorldStore();
    const donor=await WorldEngine.create({store,worldId:'foreign-save',seed:'foreign'});
    await expect(IskorkaRuntime.open(store,'x','foreign-save')).rejects.toThrow('другого мира');
    expect(donor.snapshot().profile).toBeUndefined();
    const {world:w}=await fresh();w.agents.agent_1.race='elf';
    const bad=new InMemoryWorldStore();await bad.initializeWorld(w);
    await expect(IskorkaRuntime.open(bad,'x',w.id)).rejects.toThrow('human-only');
  });
});
