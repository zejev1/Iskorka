import test from 'node:test';
import assert from 'node:assert/strict';
import {WorldEngine} from '../../src/world/WorldEngine';
import {InMemoryWorldStore} from '../../src/world/InMemoryWorldStore';
import {SECRET_LIBRARY_PLACE_ID_V18} from '../../src/v18/SecretLibraryV18';

// Physical F2 regressions adapted only to the ten-human, one-library fixture.
test('human library: at most five volunteers; no learning before physical arrival',async()=>{
 const source=await WorldEngine.create({worldId:'library-study',seed:'secret-library-physical-study',store:new InMemoryWorldStore()});
 const prepared=source.snapshot();
 for(const agent of Object.values(prepared.agents)){
  agent.life.ageYears=24;agent.life.stage='adult';
  agent.personality.curiosity=1;agent.personality.diligence=1;agent.mind.values.knowledge=1;agent.mind.autonomy=1;agent.stress=0;
  prepared.v18!.languageByAgentId[agent.id].cyrillicLiteracy=1;
 }
 const store=new InMemoryWorldStore();await store.initializeWorld(prepared);
 const world=await WorldEngine.open({worldId:prepared.id,store});
 await world.step(1);const w=world.snapshot(),selected=w.v18!.secretLibrary.visitors;
 assert.ok(selected.length>0&&selected.length<=5);assert.equal(w.v18!.secretLibrary.totalKnowledgeRecords,0);
 assert.ok(selected.every(v=>v.acceptedVoluntarily));
 assert.ok(selected.every(v=>w.agents[v.agentId].movement?.targetPlaceId===SECRET_LIBRARY_PLACE_ID_V18));
 for(let tick=2;tick<=7;tick++)await world.step(tick);
 const complete=world.snapshot().v18!.secretLibrary;
 assert.ok(complete.totalKnowledgeRecords>0);
 assert.ok(complete.visitors.some(v=>v.studyQuanta>0&&v.arrivedWorldMinute!==undefined));
});

test('housing: real material reservation, construction time, occupancy, learning and save during building',async()=>{
 const source=await WorldEngine.create({worldId:'v16-material-home',seed:'v16-material-home',store:new InMemoryWorldStore()});
 const raw=source.snapshot(),town=raw.settlements.settlement_ainkrad;
 const beforeHomes=town.memberPlaceIds.filter(id=>raw.places[id]?.kind==='home');
 for(const id of beforeHomes)raw.places[id].capacity=1;
 const economy=raw.v16!.settlementEconomyById.settlement_ainkrad;
 economy.stocks.wood=0;economy.stocks.stone=0;economy.constructionTools=1;
 const outskirts=raw.places.outskirts,id='test_local_wood_lot';
 raw.places[id]={...structuredClone(outskirts),id,name:'Известная местная роща',kind:'forest',biome:'forest',mapX:outskirts.mapX+.4,mapY:outskirts.mapY+.4,connectedPlaceIds:[outskirts.id],boundaryPolygon:undefined,waterPolygon:undefined};
 outskirts.connectedPlaceIds.push(id);
 for(const agent of Object.values(raw.agents)){
  agent.life.stage='adult';agent.life.ageYears=Math.max(24,agent.life.ageYears);agent.life.health=1;agent.energy=1;agent.movement=undefined;agent.plan=undefined;
  agent.skills.craft=1;agent.personality.diligence=1;agent.personality.curiosity=1;agent.mind.values.care=1;agent.needs.purpose=1;
  agent.knownPlaceIds=[...new Set([...(agent.knownPlaceIds??[]),id])];
 }
 const knowledge=Object.fromEntries(Object.entries(raw.v15!.knowledgeByAgentId).map(([id,k])=>[id,k.construction]));
 const store=new InMemoryWorldStore();await store.initializeWorld(raw);const world=await WorldEngine.open({worldId:raw.id,store});
 let started=world.snapshot().v16!.settlementEconomyById.settlement_ainkrad.activeHumanHomeProject;
 for(let i=1;i<=300&&!started;i++){await world.advanceCanonicalTimeTo(8760*i);started=world.snapshot().v16!.settlementEconomyById.settlement_ainkrad.activeHumanHomeProject;}
 assert.ok(started);assert.equal(started.recipe,'timber_wattle_thatch');assert.equal(started.reservedMaterials.stone,0);
 assert.equal(world.snapshot().places[started.homeId].kind,'construction_site');
 assert.equal(world.snapshot().settlements.settlement_ainkrad.memberPlaceIds.filter(id=>world.snapshot().places[id]?.kind==='home').length,beforeHomes.length);
 const initiator=structuredClone(world.snapshot().agents[started.initiatedByAgentId]);
 const resumed=await WorldEngine.open({worldId:raw.id,store});
 assert.deepEqual(resumed.snapshot().v16!.settlementEconomyById.settlement_ainkrad.activeHumanHomeProject,started);
 await resumed.advanceCanonicalTimeTo(started.startedWorldMinute+525600*5);
 const state=resumed.snapshot(),events=(await store.history(raw.id)).filter(e=>e.kind==='world.building.home_built');
 assert.ok(state.settlements.settlement_ainkrad.memberPlaceIds.filter(id=>state.places[id]?.kind==='home').length>beforeHomes.length);
 const completed=events.find(e=>e.payload.projectId===started!.id);assert.ok(completed);
 assert.ok(Number(completed.payload.completedWorldMinute)>Number(completed.payload.startedWorldMinute));
 const builders=completed.payload.builderIds as string[];assert.ok(builders.length>0);
 assert.ok((completed.payload.movedResidentIds as unknown[]).length>0);
 assert.ok(builders.some(id=>state.v15!.knowledgeByAgentId[id].construction>knowledge[id]));
 assert.deepEqual(state.agents[initiator.id].personality,initiator.personality);
 assert.equal(state.agents[initiator.id].mind.identityId,initiator.mind.identityId);
});
