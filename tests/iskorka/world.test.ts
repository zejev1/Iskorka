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
import { routeIdBetween } from '../../src/world/WorldNavigation';
import { pathCrossesWater } from '../../src/world/WaterNavigation';
import {
  homeHasEssentialLifeSupportV1,
  workshopHasCoreEquipmentV1,
} from '../../src/iskorka/MedievalPlaceInfrastructureV1';
import {
  FOUNDATION_WELL_IDS_V1,
  homeWaterReserveFractionV1,
} from '../../src/iskorka/FoundationWaterV1';
import { perceptBatchForAgentV1 } from '../../src/iskorka/PerceptionAdapterV1';
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


test('fresh world: ten different six-month Sparks, five mentors, no acquired founder profession',async()=>{
 const {world:w}=await create();assertIskorkaProfile(w,true);
 assert.equal(w.simulationProfile,ISKORKA_PROFILE);
 const founders=Object.values(w.agents);
 assert.equal(founders.length,10);
 assert.equal(founders.filter(a=>a.sex==='female').length,5);
 assert.ok(founders.every(a=>a.life.ageYears===0.5&&a.life.stage==='child'&&a.life.generation===0));
 assert.ok(founders.every(a=>Object.values(a.skills).every(value=>value===0)));
 assert.ok(founders.every(a=>Object.values(a.mind.values).every(value=>value===0)));
 assert.ok(founders.every(a=>Object.values(a.mind.beliefs).every(value=>value===0)));
 assert.equal(new Set(founders.map(a=>JSON.stringify(a.personality))).size,10);
 assert.equal(new Set(founders.map(a=>JSON.stringify(a.life.physiology))).size,10);
 assert.deepEqual(w.relationships,{});
 assert.equal(w.v15?.founderSmithAgentId,undefined);
 assert.equal(w.v15?.genesisTeachers.length,0);
 assert.equal(Object.keys(w.iskorkaMentorsV1!.mentorsById).length,5);
 assert.ok(Object.values(w.v18!.livelihoodByAgentId).every(a=>a.primary==='undecided'));
 assert.equal(Object.keys(w.v16!.familyLifecycleByPairId).length,0);
});
test('founding town retains pinned F2 coordinates, buildings, connections and terrain',async()=>{
 const {world:w}=await create();const golden=JSON.parse(readFileSync('tests/iskorka/donor-geometry.json','utf8'));
 for(const [id,p]of Object.entries(golden.places) as [string,Record<string,unknown>][]){
  const actual=w.places[id];assert.ok(actual,id);
  for(const [key,value]of Object.entries(p)){
   if(key==='connectedPlaceIds'){
    for(const expectedId of value as string[])assert.ok(actual.connectedPlaceIds.includes(expectedId),id+'.connectedPlaceIds missing '+expectedId);
    continue;
   }
   assert.deepEqual((actual as any)[key],value,id+'.'+key);
  }
 }
 assert.equal(w.terrain?.version,golden.terrain.version);
 assert.equal(w.terrain?.epoch,golden.terrain.epoch);
 assert.equal(w.terrain?.seed,golden.terrain.seed);
 for(const expectedAnchor of golden.terrain.anchors){
  const actualAnchor=w.terrain!.anchors.find((anchor:any)=>anchor.id===expectedAnchor.id);
  assert.deepEqual(actualAnchor,expectedAnchor,'terrain anchor '+expectedAnchor.id);
 }
 assert.equal(w.terrain!.anchors.filter((anchor:any)=>anchor.id==='foundation_lake').length,1);
 assert.deepEqual(w.v18!.planetaryGeography,golden.planetaryGeography);
 assert.equal(w.settlements.settlement_ainkrad.name,'Основание');
 assert.notEqual(w.places.commons.mapX,0);
});
test('Foundation has one nearby physical lake with a walkable pre-existing footpath',async()=>{
 const {world:w}=await create('foundation-lake','foundation-lake-world');
 const lake=w.places.foundation_lake,outskirts=w.places.outskirts;
 assert.ok(lake);assert.equal(lake.kind,'lake');assert.equal(lake.biome,'lake');assert.equal(lake.surface,'shore');
 assert.ok((lake.waterPolygon?.length??0)>=16);
 assert.ok(Math.hypot(lake.mapX-outskirts.mapX,lake.mapY-outskirts.mapY)<10);
 assert.ok(lake.connectedPlaceIds.includes('outskirts'));
 assert.ok(outskirts.connectedPlaceIds.includes('foundation_lake'));
 const route=w.routes[routeIdBetween('outskirts','foundation_lake')];
 assert.ok(route);assert.equal(route.traversal,'walk');
 assert.ok((route.completedTraversals??0)>=1);
 assert.equal(route.widthMetres,1.5);
 assert.equal(pathCrossesWater(route.waypoints,w.places),false);
});
test('Foundation homes and workshop are physically furnished, not semantic labels',async()=>{
 const {world:w}=await create('physical-interiors','physical-interiors-world');
 const homes=Object.values(w.places).filter(place=>place.kind==='home');
 assert.ok(homes.length>=10);
 assert.ok(homes.every(home=>homeHasEssentialLifeSupportV1(home)));
 assert.ok(homes.every(home=>{
  const kinds=new Set(Object.values(home.medievalInfrastructureV1!.fixtures).map(item=>item.kind));
  return ['bed_frame','mattress','bedding','hearth','cookpot','dining_table','privy','washbasin','pantry'].every(kind=>kinds.has(kind));
 }));
 assert.ok(workshopHasCoreEquipmentV1(w.places.workshop));
 const workshopKinds=new Set(Object.values(w.places.workshop.medievalInfrastructureV1!.fixtures).map(item=>item.kind));
 for(const kind of ['workbench','hand_saw','charcoal_forge','bellows','anvil','smithing_hammer','tongs','quench_trough','grindstone','stone_bench','leather_bench']){
  assert.ok(workshopKinds.has(kind),kind);
 }
 assert.equal(w.places.workshop.medievalInfrastructureV1!.era,'pre_electric_medieval');
});
test('Foundation has two physical potable wells between homes with walkable routes',async()=>{
 const {world:w}=await create('foundation-wells','foundation-wells-world');
 assert.equal(FOUNDATION_WELL_IDS_V1.length,2);
 const homes=Object.values(w.places).filter(p=>p.kind==='home'&&p.settlementId==='settlement_ainkrad');
 for(const id of FOUNDATION_WELL_IDS_V1){
  const well=w.places[id];
  assert.ok(well,id);
  assert.equal(well.kind,'well');
  assert.equal(well.surface,'land');
  assert.equal(well.settlementId,'settlement_ainkrad');
  assert.equal(well.wellWaterV1?.potable,true);
  assert.ok((well.wellWaterV1?.waterLitres??0)>0);
  assert.ok(homes.some(home=>Math.hypot(home.mapX-well.mapX,home.mapY-well.mapY)<1.5));
  const route=w.routes[routeIdBetween(id,'commons')];
  assert.ok(route,id+' route');
  assert.equal(route.traversal,'walk');
 }
 const firstHome=w.places[homes[0].id];
 assert.ok(homeWaterReserveFractionV1(w,firstHome.id)>0);
});

test('Spark perception receives real co-located furniture/tools, not only a place label',async()=>{
 const {world:w}=await create('fixture-perception','fixture-perception-world');
 const spark=w.agents.agent_1;
 spark.life.ageYears=5;
 spark.locationId=spark.homeId;
 spark.position={x:w.places[spark.homeId].mapX,y:w.places[spark.homeId].mapY,layerId:'surface'};
 const percept=perceptBatchForAgentV1(w,spark.id);
 const fixtures=percept.localObservations.filter(o=>o.kind==='fixture');
 assert.ok(fixtures.length>0);
 const physicalIds=new Set(Object.keys(w.places[spark.homeId].medievalInfrastructureV1!.fixtures));
 assert.ok(fixtures.every(o=>physicalIds.has(o.objectId)));

 spark.locationId='workshop';
 spark.position={x:w.places.workshop.mapX,y:w.places.workshop.mapY,layerId:'surface'};
 const workshopPercept=perceptBatchForAgentV1(w,spark.id);
 const workshopFixtures=workshopPercept.localObservations.filter(o=>o.kind==='fixture');
 assert.ok(workshopFixtures.length>0);
 const workshopIds=new Set(Object.keys(w.places.workshop.medievalInfrastructureV1!.fixtures));
 assert.ok(workshopFixtures.every(o=>workshopIds.has(o.objectId)));
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
test('world survives ten mentored years without adult autonomy or artificial births',async()=>{
 const {runtime,store}=await create();const start=performance.now();const yearly=[];
 for(let year=1;year<=10;year++){
  await runtime.advanceTo(year*YEAR);const w=runtime.snapshot();assertIskorkaProfile(w);
  yearly.push({year,alive:Object.values(w.agents).filter(a=>a.life.alive).length,births:w.population.births,deaths:w.population.deaths,lessons:w.iskorkaMentorsV1?.totalLessons??0,care:w.iskorkaMentorsV1?.totalCareActions??0});
 }
 const w=runtime.snapshot();assert.equal(w.calendar.elapsedWorldMinutes,YEAR*10);
 assert.equal(w.population.births,0);
 assert.equal(Object.values(w.agents).filter(a=>a.life.generation>0).length,0);
 assert.ok(Object.values(w.agents).every(a=>a.life.ageYears<18));
 assert.ok(Object.values(w.agents).every(a=>a.lastDecision===undefined));
 assert.ok((w.iskorkaMentorsV1?.totalLessons??0)>100);
 assert.ok((w.iskorkaMentorsV1?.totalCareActions??0)>100);
 assert.equal(w.iskorkaMentorsV1?.active,true);
 assert.ok(Object.values(w.v15!.knowledgeByAgentId).some(k=>k.agriculture>0||k.construction>0||k.household>0||k.survival>0));
 assert.ok(Object.values(w.v18!.languageByAgentId).some(l=>l.spokenComprehension>0&&l.vocabulary>0));
 const history=await store.history(w.id);assert.ok(history.length>0);
 assert.ok(history.every(e=>['agent','world','player','system'].includes(e.source)));
 writeFileSync('validation/ten-year-world.json',JSON.stringify({seed:w.bootstrapSeed,elapsedMs:performance.now()-start,yearly,eventCount:history.length,mentorActive:w.iskorkaMentorsV1?.active},null,2));
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
