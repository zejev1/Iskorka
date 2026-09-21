import test from 'node:test';
import assert from 'node:assert/strict';
import {WorldEngine} from '../../src/world/WorldEngine';
import {InMemoryWorldStore} from '../../src/world/InMemoryWorldStore';
import {SECRET_LIBRARY_PLACE_ID_V18} from '../../src/v18/SecretLibraryV18';

// Physical F2 regressions adapted only to the ten-human, one-library fixture.
test('human library: at most five volunteers; no learning before physical arrival',async()=>{
 const source=await WorldEngine.create({worldId:'library-study',seed:'secret-library-physical-study',store:new InMemoryWorldStore()});
 const prepared=source.snapshot();
 delete prepared.iskorkaMentorsV1;
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

test('housing: an explicit adult project preserves materials, save state and physical completion',async()=>{
 const source=await WorldEngine.create({worldId:'v16-material-home',seed:'v16-material-home',store:new InMemoryWorldStore()});
 const raw=source.snapshot(),town=raw.settlements.settlement_ainkrad;
 delete raw.iskorkaMentorsV1;
 const beforeHomes=town.memberPlaceIds.filter(id=>raw.places[id]?.kind==='home');
 for(const id of beforeHomes)raw.places[id].capacity=1;

 const economy=raw.v16!.settlementEconomyById.settlement_ainkrad;
 economy.stocks.wood=0.18;economy.stocks.stone=0;economy.constructionTools=1;
 const initiator=Object.values(raw.agents)[0];
 const siteId='settlement_ainkrad_test_home_project';
 const workshop=raw.places.workshop;
 raw.places[siteId]={
  ...structuredClone(workshop),
  id:siteId,name:'Строящийся тестовый дом',kind:'construction_site',capacity:1,
  mapX:workshop.mapX+.25,mapY:workshop.mapY+.18,connectedPlaceIds:[],
  boundaryPolygon:undefined,waterPolygon:undefined,settlementId:'settlement_ainkrad',
  urbanLot:999,urbanLayoutVersion:3,rotation:workshop.rotation,
 };
 town.memberPlaceIds.push(siteId);

 for(const agent of Object.values(raw.agents)){
  agent.life.stage='adult';agent.life.ageYears=Math.max(24,agent.life.ageYears);agent.life.health=1;
  agent.life.physiology={strength:1,endurance:1,mobility:1,recovery:1};
  agent.energy=1;agent.stress=0;agent.resources=0.8;agent.movement=undefined;agent.plan=undefined;agent.lastDecision=undefined;
  agent.locationId=siteId;agent.position={x:raw.places[siteId].mapX,y:raw.places[siteId].mapY,layerId:'surface'};agent.lastAction='work';
  agent.skills.craft=1;agent.personality.diligence=1;agent.personality.curiosity=0;agent.personality.generosity=1;agent.personality.sociability=0;agent.personality.riskTolerance=0;
  agent.mind.values.care=1;agent.mind.values.ambition=1;agent.needs.purpose=0;agent.goal={kind:'contribute',strength:1,since:0};
  raw.v15!.knowledgeByAgentId[agent.id].construction=0.4;
  agent.knownPlaceIds=[...new Set([...(agent.knownPlaceIds??[]),siteId,'workshop'])];
 }
 const knowledge=Object.fromEntries(Object.entries(raw.v15!.knowledgeByAgentId).map(([id,k])=>[id,k.construction]));
 economy.activeHumanHomeProject={
  id:'test-home-project',
  settlementId:'settlement_ainkrad',
  homeId:siteId,
  recipe:'timber_wattle_thatch',
  initiatedByAgentId:initiator.id,
  intendedResidentIds:Object.keys(raw.agents),
  builderIds:[],
  plotX:raw.places[siteId].mapX,
  plotY:raw.places[siteId].mapY,
  plotRotation:raw.places[siteId].rotation??0,
  urbanLot:999,
  startedWorldMinute:0,
  lastProgressWorldMinute:0,
  stage:'site_selection',
  laborRequiredPersonDays:1,
  laborCompletedPersonDays:0,
  reservedMaterials:{wood:0.72,stone:0},
 };

 const store=new InMemoryWorldStore();await store.initializeWorld(raw);
 const world=await WorldEngine.open({worldId:raw.id,store});
 const started=world.snapshot().v16!.settlementEconomyById.settlement_ainkrad.activeHumanHomeProject!;
 assert.ok(started);assert.equal(started.recipe,'timber_wattle_thatch');assert.equal(started.reservedMaterials.stone,0);
 assert.equal(world.snapshot().places[started.homeId].kind,'construction_site');
 const reopened=await WorldEngine.open({worldId:raw.id,store});
 assert.deepEqual(reopened.snapshot().v16!.settlementEconomyById.settlement_ainkrad.activeHumanHomeProject,started);

 for(let i=1;i<=30&&reopened.snapshot().v16!.settlementEconomyById.settlement_ainkrad.activeHumanHomeProject;i++){
  await reopened.advanceCanonicalTimeTo(8760*i);
 }
 const state=reopened.snapshot(),events=(await store.history(raw.id)).filter(e=>e.kind==='world.building.home_built');
 assert.equal(state.v16!.settlementEconomyById.settlement_ainkrad.activeHumanHomeProject,undefined);
 assert.equal(state.places[siteId].kind,'home');
 assert.ok(state.settlements.settlement_ainkrad.memberPlaceIds.filter(id=>state.places[id]?.kind==='home').length>beforeHomes.length);
 const completed=events.find(e=>e.payload.projectId==='test-home-project');assert.ok(completed);
 const builders=completed!.payload.builderIds as string[];assert.ok(builders.length>0);
 assert.ok((completed!.payload.movedResidentIds as unknown[]).length>0);
 assert.ok(builders.some(id=>state.v15!.knowledgeByAgentId[id].construction>=knowledge[id]));
});
