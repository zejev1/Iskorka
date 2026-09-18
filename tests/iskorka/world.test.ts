import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { IskorkaRuntime } from '../../src/iskorka/WorldRuntime';
import { WorldEngine } from '../../src/world/WorldEngine';
import { InMemoryWorldStore } from '../../src/world/InMemoryWorldStore';
import { assertIskorkaProfile, ISKORKA_PROFILE, ISKORKA_FOUNDER_NAMES } from '../../src/iskorka/Profile';
import { validateCommand } from '../../src/iskorka/protocol';
import { worldWeatherV21 } from '../../src/v21/WeatherV21';
import { worldCalendarAtMinutes } from '../../src/world/WorldClock';
import type { WorldState } from '../../src/world/types';

const YEAR=525600;
async function create(seed='iskorka-baseline-20260918',id='iskorka-world') {
 const store=new InMemoryWorldStore();const runtime=await IskorkaRuntime.openOrCreate(store,seed,id);
 return {store,runtime,world:runtime.snapshot()};
}
function causal(w:WorldState) {const c=structuredClone(w);c.revision=0;return c;}
function assertPartitionEquivalent(actual: unknown, expected: unknown, path = ''): void {
 if (Object.is(actual, expected)) return;
 if (typeof actual === 'number' && typeof expected === 'number' && path.endsWith('.arrivedWorldMinute')) {
   // Pinned F2 continuous movement has sub-nanominute floating-point arrival noise.
   // All choices, RNG, coordinates, other times and evidence remain strict comparisons.
   assert.ok(Math.abs(actual-expected) <= 1e-8, path + ': arrival precision exceeded'); return;
 }
 if (actual && expected && typeof actual === 'object' && typeof expected === 'object') {
   assert.deepEqual(Object.keys(actual).sort(), Object.keys(expected).sort(),path);
   for (const k of Object.keys(actual)) assertPartitionEquivalent((actual as any)[k],(expected as any)[k],path+'.'+k);
   return;
 }
 assert.deepEqual(actual, expected, path);
}


test('fresh world: ten different adult humans, no preassigned partners/profession',async()=>{
 const {world:w}=await create();assertIskorkaProfile(w,true);
 assert.equal(w.simulationProfile,ISKORKA_PROFILE);
 assert.equal(Object.values(w.agents).filter(a=>a.sex==='female').length,5);
 assert.equal(new Set(Object.values(w.agents).map(a=>JSON.stringify(a.personality))).size,10);
 assert.equal(new Set(Object.values(w.agents).map(a=>JSON.stringify(a.life.physiology))).size,10);
 assert.deepEqual(w.relationships,{});
 assert.equal(w.v15?.founderSmithAgentId,undefined);
 assert.ok(Object.values(w.v18!.livelihoodByAgentId).every(a=>a.primary==='undecided'));
 assert.equal(Object.keys(w.v16!.familyLifecycleByPairId).length,0);
});
test('founding town retains pinned F2 coordinates, buildings, connections and terrain',async()=>{
 const {world:w}=await create();const golden=JSON.parse(readFileSync('tests/iskorka/donor-geometry.json','utf8'));
 for(const [id,p]of Object.entries(golden.places) as [string,Record<string,unknown>][]){
  const actual=w.places[id];assert.ok(actual,id);
  for(const [key,value]of Object.entries(p))assert.deepEqual((actual as any)[key],value,id+'.'+key);
 }
 assert.deepEqual(w.terrain,golden.terrain);assert.deepEqual(w.v18!.planetaryGeography,golden.planetaryGeography);
 assert.equal(w.settlements.settlement_ainkrad.name,'Основание');
 assert.notEqual(w.places.commons.mapX,0);
});
test('same seed produces byte-equivalent initial worlds',async()=>{
 const a=await create(),b=await create();assert.deepEqual(a.world,b.world);
});
test('different seed produces different physical geography',async()=>{
 const a=await create('seed-a'),b=await create('seed-b');assert.notDeepEqual(a.world.places.commons,b.world.places.commons);
});
test('ordinary animals and fish inhabit compatible existing locations',async()=>{
 const {world:w}=await create();const pop=Object.values(w.wildlife);
 assert.ok(pop.some(p=>p.species==='fish'));assert.ok(pop.some(p=>p.species==='rabbit'));
 for(const p of pop){assert.ok(w.places[p.habitatId]);assert.ok(!p.isMonster);assert.ok(p.count>0);}
});
test('world survives ten years with autonomous decisions, exploration and births',async()=>{
 const {runtime,store,world:initial}=await create();const start=performance.now();const yearly=[];
 for(let year=1;year<=10;year++){
  await runtime.advanceTo(year*YEAR);const w=runtime.snapshot();assertIskorkaProfile(w);
  yearly.push({year,alive:Object.values(w.agents).filter(a=>a.life.alive).length,births:w.population.births,deaths:w.population.deaths,places:Object.keys(w.places).length});
 }
 const w=runtime.snapshot();assert.equal(w.calendar.elapsedWorldMinutes,YEAR*10);
 assert.ok(w.population.births>0);assert.ok(Object.keys(w.places).length>Object.keys(initial.places).length);
 assert.ok(Object.values(w.v16!.residentEvidenceByAgentId).reduce((a,e)=>a+e.recordedDecisionCount,0)>1000);
 assert.ok(Object.values(w.agents).some(a=>a.lastAction));
 const history=await store.history(w.id);assert.ok(history.length>0);
 assert.ok(history.every(e=>e.source!=='cardinal'&&e.source!=='auditor'));
 writeFileSync('validation/ten-year-world.json',JSON.stringify({seed:w.bootstrapSeed,elapsedMs:performance.now()-start,yearly,eventCount:history.length},null,2));
});
test('save/open preserves full state, identity and deterministic continuation',async()=>{
 const a=await create(),b=await create();await a.runtime.advanceTo(YEAR*.5);await b.runtime.advanceTo(YEAR*.5);
 const reopened=await IskorkaRuntime.openOrCreate(b.store,'ignored-seed','iskorka-world');
 assert.deepEqual(a.runtime.snapshot(),reopened.snapshot());
 await a.runtime.advanceTo(YEAR*3);await reopened.advanceTo(YEAR*3);
 assert.deepEqual(a.runtime.snapshot(),reopened.snapshot());
 assert.deepEqual(await a.store.history('iskorka-world'),await b.store.history('iskorka-world'));
});
test('time partitions preserve causal state and RNG (F2 arrival precision 1e-8 minutes)',async()=>{
 const a=await create(),b=await create();await a.runtime.advanceTo(YEAR);
 for(let i=1;i<=120;i++)await b.runtime.advanceTo(i*YEAR/120);
 assertPartitionEquivalent(causal(a.runtime.snapshot()),causal(b.runtime.snapshot()));
 assert.deepEqual(await a.store.history('iskorka-world'),await b.store.history('iskorka-world'));
});
test('cooperative slice stops at a real quantum, then resumes without dropped choices',async()=>{
 const a=await create(),b=await create();await a.runtime.advanceTo(YEAR);
 let n=0;
 await b.runtime.advanceTo(YEAR,{async afterQuantum(){n++},shouldStop(){return n>=3}});
 assert.equal(n,3);assert.equal(b.runtime.elapsedMinutes,3*b.runtime.quantumMinutes);
 await b.runtime.advanceTo(YEAR);assert.deepEqual(causal(a.runtime.snapshot()),causal(b.runtime.snapshot()));
});
test('duplicate target does not add opportunities, backward time is rejected',async()=>{
 const {runtime:r}=await create();await r.advanceTo(YEAR/10);const before=r.snapshot();
 await r.advanceTo(YEAR/10);assert.deepEqual(r.snapshot(),before);
 await assert.rejects(()=>r.advanceTo(0));await assert.rejects(()=>r.advanceTo(NaN));assert.deepEqual(r.snapshot(),before);
});
test('reset creates exactly one fresh human settlement and no other libraries',async()=>{
 const {runtime:r,store}=await create();await r.advanceTo(YEAR);await r.reset('reset-seed','reset-1');
 const w=r.snapshot();assertIskorkaProfile(w,true);assert.equal(w.epoch,2);assert.equal(w.calendar.elapsedWorldMinutes,0);
 assert.equal(w.bootstrapSeed,'reset-seed');assert.equal(w.population.births,0);assert.equal(w.population.deaths,0);
 const open=await IskorkaRuntime.openOrCreate(store,'unused','iskorka-world');assert.deepEqual(open.snapshot(),w);
});
test('existing Ainkrad save is refused without migration or modification',async()=>{
 const {world:w}=await create();delete w.simulationProfile;const store=new InMemoryWorldStore();await store.initializeWorld(w);
 await assert.rejects(()=>IskorkaRuntime.openOrCreate(store,'seed',w.id));
 assert.deepEqual(await store.loadWorld(w.id),w);assert.equal(store.migrationBackups.length,0);
 await assert.rejects(()=>WorldEngine.open({store,worldId:w.id}));assert.deepEqual(await store.loadWorld(w.id),w);
});
test('snapshot observation and camera-independent inspection cannot mutate the world',async()=>{
 const {runtime:r}=await create();const before=r.snapshot();const exposed=r.snapshot();
 exposed.agents.agent_1.energy=0;exposed.places.commons.mapX=100000;exposed.determinism.rngState=1;
 assert.deepEqual(r.snapshot(),before);
});
test('weather, season and day/night remain physical deterministic functions',async()=>{
 const {world:w}=await create();const weather=[];
 for(let day=0;day<365;day+=10)weather.push(worldWeatherV21(w,day*1440));
 assert.ok(new Set(weather.map(v=>v.kind)).size>2);assert.ok(Math.max(...weather.map(v=>v.temperatureC))-Math.min(...weather.map(v=>v.temperatureC))>15);
 assert.deepEqual(worldWeatherV21(w),worldWeatherV21(structuredClone(w)));
 assert.equal(worldCalendarAtMinutes(0).phase,'night');assert.equal(worldCalendarAtMinutes(12*60).phase,'day');
 assert.equal(new Set([0,100,200,300].map(day=>worldCalendarAtMinutes(day*1440).season)).size,4);
});
test('human/monster/library guard rejects foreign content visibly instead of deleting it',async()=>{
 const {world:w}=await create();
 for(const edit of [
  (v:WorldState)=>v.agents.agent_1.race='elf',
  (v:WorldState)=>v.wildlife.wildlife_foundation_rabbit.isMonster=true,
  (v:WorldState)=>(v.v19!.adventureEconomy.dungeonsById.bad={} as any),
  (v:WorldState)=>(v.places.elf_library_v20={...v.places.secret_library_v18,id:'elf_library_v20'}),
 ]){const copy=structuredClone(w);edit(copy);assert.throws(()=>assertIskorkaProfile(copy));}
});
test('external supervisor/deity entry methods are absent from this engine',()=>{
 const methods=Object.getOwnPropertyNames(WorldEngine.prototype);
 assert.ok(!methods.some(s=>s.startsWith('applyAuthorized')));assert.ok(!methods.includes('handleInput'));
});
test('worker accepts only bounded time and lifecycle commands',()=>{
 assert.deepEqual(validateCommand({type:'pause',paused:true}),{type:'pause',paused:true});
 assert.deepEqual(validateCommand({type:'speed',speed:'fast'}),{type:'speed',speed:'fast'});
 for(const bad of [null,{}, {type:'intervene'}, {type:'gift'}, {type:'advance',minutes:Infinity}, {type:'advance',minutes:999999999}, {type:'speed',speed:'toString'}, {type:'reset',seed:'',operationId:'x'}])assert.throws(()=>validateCommand(bad));
});
