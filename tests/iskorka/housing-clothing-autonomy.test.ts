import test from 'node:test';
import { ensureBodyCoreV1 } from '../../src/iskorka/BodyCoreV1';
import assert from 'node:assert/strict';
import { IskorkaRuntime } from '../../src/iskorka/WorldRuntime';
import { InMemoryWorldStore } from '../../src/world/InMemoryWorldStore';
import { ensureClothingV1, gatherClothingFibreV1, makeClothingV1, wearClothingV1, garmentConditionV1, clothingProtectionV1 } from '../../src/iskorka/ClothingV1';
import { perceptBatchForAgentV1 } from '../../src/iskorka/PerceptionAdapterV1';
import { beginBrainActionAttemptV1 } from '../../src/iskorka/BrainLearningV1';
import type { AgentState, WorldState } from '../../src/world/types';
import type { PerceptBatchV1, ActionIntentV1 } from '../../src/iskorka/PortableHumanCoreV1';
type Fixture = {
  state: WorldState;
  rebuildSpatialProjection(): void;
  mutate(id: string, fingerprint: string, apply: () => Promise<void>): Promise<boolean>;
  executeLearnedBrainIntentAt(a: AgentState, minute: number): void;
  childExploratoryPossibilitiesV1(a: AgentState, p: PerceptBatchV1): ActionIntentV1[];
};
async function fixture(id: string) {
 const store = new InMemoryWorldStore();
 const runtime = await IskorkaRuntime.openOrCreate(store,id,id);
 const engine = (runtime as unknown as {world:Fixture}).world;
 return {store,runtime,engine};
}
function adult(w: WorldState): AgentState {
 const a=w.agents.agent_1;
 a.life.ageYears=24;a.life.stage='adult';a.life.health=1;a.energy=1;
 a.movement=undefined;
 a.locationId='workshop';
 a.position={x:w.places.workshop.mapX,y:w.places.workshop.mapY,layerId:'surface'};
 a.knownPlaceIds=[a.homeId,'commons','workshop','resource_field','meadow','forest'];
 const body=w.v21!.bodiesByAgentId[a.id];
 delete body.sleep;
 ensureBodyCoreV1(w,a,body);
 return a;
}
test('clothes require plants, material, work and dressing; state and wear survive reload',async()=>{
 const {store,runtime,engine}=await fixture('clothes-physical');
 await engine.mutate('clothes','clothes',async()=>{
  const w=engine.state,a=adult(w);
  assert.equal(makeClothingV1(w,a),false,'empty hands created a garment');
  assert.equal(wearClothingV1(w,a),false,'nonexistent garment was worn');
  a.locationId='resource_field';
  const land=w.v16!.settlementResourcesById[w.places[a.homeId].settlementId!];
  const base=land.renewableBase;
  while((a.clothingV1?.fibre??0)<4) assert.ok(gatherClothingFibreV1(w,a)>0);
  assert.ok(land.renewableBase<base,'gathering did not consume plants');
  assert.equal(makeClothingV1(w,a),false,'crafting bypassed workshop');
  a.locationId='workshop';
  const before=a.clothingV1!.fibre;
  assert.equal(makeClothingV1(w,a),true);
  assert.equal(a.clothingV1!.fibre,before-4,'materials were not reserved exactly once');
  assert.equal(a.clothingV1!.spare,undefined,'garment appeared before labor');
  for(let i=0;i<10&&!a.clothingV1!.spare;i++) assert.equal(makeClothingV1(w,a),true);
  assert.ok(a.clothingV1!.spare);
  assert.equal(clothingProtectionV1(a,0),0,'unworn garment insulated body');
  assert.equal(wearClothingV1(w,a),true);
  assert.ok(clothingProtectionV1(a,0)>0);
  assert.ok(garmentConditionV1(a.clothingV1!.worn,525600)<1);
  assert.equal(garmentConditionV1(a.clothingV1!.worn,3*525600),0);
 });
 const state=runtime.snapshot();
 const reopened=await IskorkaRuntime.openOrCreate(store,'clothes-physical','clothes-physical');
 assert.deepEqual(reopened.snapshot().agents.agent_1.clothingV1,state.agents.agent_1.clothingV1);
});
test('learned work reaches the real project, pays physical labor, and completes a habitable house',async()=>{
 const {runtime,engine}=await fixture('native-build');
 await engine.mutate('build','build',async()=>{
  const w=engine.state,a=adult(w),town=w.settlements.settlement_ainkrad;
  const homeId='native_test_build';
  w.places[homeId]={...structuredClone(w.places.workshop),id:homeId,kind:'construction_site',capacity:1,
    name:'Стройплощадка',connectedPlaceIds:['workshop']};
  w.places.workshop.connectedPlaceIds.push(homeId);town.memberPlaceIds.push(homeId);
  a.knownPlaceIds!.push(homeId);
  const eco=w.v16!.settlementEconomyById[town.id];
  eco.activeHumanHomeProject={
    id:'native-build-project',settlementId:town.id,homeId,recipe:'timber_wattle_thatch',
    initiatedByAgentId:a.id,intendedResidentIds:[a.id],builderIds:[],
    plotX:w.places[homeId].mapX,plotY:w.places[homeId].mapY,plotRotation:0,urbanLot:900,
    startedWorldMinute:0,stage:'site_selection',laborRequiredPersonDays:0.001,
    laborCompletedPersonDays:0,reservedMaterials:{wood:0.72,stone:0},
  };
  a.locationId=homeId;
  a.position={x:w.places[homeId].mapX,y:w.places[homeId].mapY,layerId:'surface'};
  const brain=w.iskorkaBrainV1!.brainsByAgentId[a.id];
  const percept=perceptBatchForAgentV1(w,a.id);
  beginBrainActionAttemptV1(brain,percept,'work',homeId);
  if(brain.learning) delete brain.learning.nextReviewWorldMinute;
  const energy=a.energy,wood=eco.stocks.wood;
  engine.executeLearnedBrainIntentAt(a,0);
  assert.equal(w.places[homeId].kind,'home','learned choice only practiced in workshop');
  assert.equal(w.places[homeId].capacity,6);
  assert.equal(a.homeId,homeId);
  assert.ok(a.energy<energy);
  assert.equal(eco.stocks.wood,wood,'reserved materials were paid twice');
  assert.equal(eco.activeHumanHomeProject,undefined);
  assert.ok(brain.learning!.methods.some(m=>m.action==='work'&&m.successes>0));
 });
 assert.equal(runtime.snapshot().places.native_test_build.kind,'home');
});
test('new work and textile affordances are limited to learned places and physical ages',async()=>{
 const {engine}=await fixture('work-affordances');
 await engine.mutate('offers','offers',async()=>{
  const w=engine.state,a=adult(w);
  let choices=engine.childExploratoryPossibilitiesV1(a,perceptBatchForAgentV1(w,a.id));
  assert.ok(choices.some(c=>c.action==='work'&&c.target?.objectId==='workshop'));
  const field=w.places.resource_field;
  field.kind='forest';field.biome='forest';
  choices=engine.childExploratoryPossibilitiesV1(a,perceptBatchForAgentV1(w,a.id));
  assert.ok(choices.some(c=>c.action==='gather'&&c.target?.objectId==='resource_field'));
  field.kind='resource_field';field.biome='plains';
  choices=engine.childExploratoryPossibilitiesV1(a,perceptBatchForAgentV1(w,a.id));
  assert.ok(choices.some(c=>c.action==='gather_fibre'));
  assert.ok(!choices.some(c=>c.action==='make_clothes'));
  ensureClothingV1(a).fibre=4;
  choices=engine.childExploratoryPossibilitiesV1(a,perceptBatchForAgentV1(w,a.id));
  assert.ok(choices.some(c=>c.action==='make_clothes'));
  a.life.ageYears=5;a.life.stage='child';
  choices=engine.childExploratoryPossibilitiesV1(a,perceptBatchForAgentV1(w,a.id));
  assert.ok(!choices.some(c=>['work','gather_fibre','make_clothes'].includes(c.action)));
  assert.equal(makeClothingV1(w,a),false);
  assert.equal(gatherClothingFibreV1(w,a),0);
  ensureBodyCoreV1(w,a,w.v21!.bodiesByAgentId[a.id]);
 });
});

test('arrival measures drinking against the body at the well, not the body before a long journey',async()=>{
 const {engine}=await fixture('drink-arrival');
 await engine.mutate('arrival','arrival',async()=>{
  const w=engine.state,a=adult(w);
  a.locationId='foundation_well_east';
  const body=w.v21!.bodiesByAgentId[a.id];
  body.bodyCore!.homeostasis.hydration=0.1;
  const brain=w.iskorkaBrainV1!.brainsByAgentId[a.id];
  beginBrainActionAttemptV1(brain,perceptBatchForAgentV1(w,a.id),'drink',a.locationId);
  brain.learning!.pending!.beforeSignals.thirst=0.001;
  brain.learning!.pending!.executionPhase='travel';
  delete brain.learning!.nextReviewWorldMinute;
  engine.executeLearnedBrainIntentAt(a,0);
  assert.ok(body.bodyCore!.homeostasis.hydration>0.1);
  assert.ok((brain.learning!.methods.find(m=>m.action==='drink')?.expectedSignalRelief.thirst??0)>0.1);
 });
});
test('a rest intention carried through travel starts real sleep before learning its delayed result',async()=>{
 const {engine}=await fixture('rest-arrival');
 await engine.mutate('rest','rest',async()=>{
  const w=engine.state,a=adult(w);
  a.locationId=a.homeId;a.energy=0.2;
  const brain=w.iskorkaBrainV1!.brainsByAgentId[a.id];
  beginBrainActionAttemptV1(brain,perceptBatchForAgentV1(w,a.id),'rest',a.homeId);
  brain.learning!.pending!.executionPhase='travel';
  delete brain.learning!.nextReviewWorldMinute;
  engine.executeLearnedBrainIntentAt(a,10);
  assert.equal(w.v21!.bodiesByAgentId[a.id].sleep?.status,'sleeping');
  assert.equal(brain.learning!.pending?.executionPhase,'sleeping');
  assert.ok(!brain.learning!.methods.some(m=>m.action==='rest'&&m.successes>0));
 });
});
