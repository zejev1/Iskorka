import test from 'node:test';
import assert from 'node:assert/strict';
import { WorldEngine } from '../../src/world/WorldEngine';
import { InMemoryWorldStore } from '../../src/world/InMemoryWorldStore';
import { hash } from '../../src/world/geography/TerrainMath';
import { bindWorldTerrain } from '../../src/world/geography/WorldTerrain';
import { startBoatTravel,startBoatFishing,startBoatExploration,advanceBoats } from '../../src/v21/BoatNavigation';
import { sailingCourse,waterSegment } from '../../src/v21/SailingRoutes';
import { assertBoatNavigation } from '../../src/v21/BoatValidation';
import { worldWeatherV21 } from '../../src/v21/WeatherV21';
import { BOAT_KNOWLEDGE_ID, workOnBoat, VESSEL_DESIGNS_V22,vesselDesignV22 } from '../../src/v21/MaritimePractice';
import { recordPhysicalGoodsV21 } from '../../src/v21/EconomySystemV21';
import { ensureBodyCoreV1 } from '../../src/iskorka/BodyCoreV1';

// A controlled physical lake fixture, not a new location injected into the shipped world.
async function setup(){
 const w=(await WorldEngine.create({worldId:'boat-water-test',seed:'boat-water-test',store:new InMemoryWorldStore()})).snapshot();
 const center={x:w.places.commons.mapX+12,y:w.places.commons.mapY+12},f=w.terrain!;
 f.anchors.push({id:'boat-test-lake',...center,kind:'lake',radius:2,water:[{x:center.x-1.5,y:center.y-2},{x:center.x+1.5,y:center.y-2},{x:center.x+1.5,y:center.y+2},{x:center.x-1.5,y:center.y+2}]});
 f.key='terrain-v1:'+hash(JSON.stringify({...f,key:''}));bindWorldTerrain(w);
 for(const [id,dx]of [['boat_west',-1.53],['boat_east',1.53]] as const)w.places[id]={id,name:'Озёрный берег',kind:'lake',biome:'lake',surface:'shore',mapX:center.x+dx,mapY:center.y,capacity:10,connectedPlaceIds:[],fertility:.4,danger:0,geographyVersion:1};
 for(const a of [w.agents.agent_1,w.agents.agent_2]){
  a.life.ageYears=25;a.life.stage='adult';a.life.alive=true;a.life.health=1;a.energy=1;a.locationId='boat_west';delete a.movement;
  a.position={x:w.places.boat_west.mapX,y:center.y,layerId:'surface'};a.knownPlaceIds=['boat_west','boat_east'];a.skills.craft=.8;
  ensureBodyCoreV1(w,a,w.v21!.bodiesByAgentId[a.id]);
  w.v18!.secretLibrary.knowledgeByAgentId[a.id]=[{id:'boat-theory',knowledgeId:BOAT_KNOWLEDGE_ID,title:'Корабль',category:'engineering',historicalSource:'ЭСБЕ',sourceTitle:'Корабль',sourceUrl:'https://ru.wikisource.org/wiki/ЭСБЕ/Корабль',acquiredWorldMinute:0,understanding:.8,summary:'Киль, шпангоуты, обшивка',concepts:['кораблестроение'],practiceCount:1,sharedCount:0}];
 }
 for(let d=0;worldWeatherV21(w).kind==='storm'&&d<20;d++)w.calendar.elapsedWorldMinutes+=2880;
 w.v15!.items.test_boat={id:'test_boat',kind:'artifact',name:'Гребная лодка',ownerAgentId:'agent_1',createdWorldMinute:0,locationId:'boat_west',quality:.8,effectiveness:.4,reliability:.8,description:'Лодка',boat:{completed:true,laborMinutes:4800,requiredLaborMinutes:4800,lastWorkedMinute:0,condition:1}};
 return w;
}
test('boat movement carries willing passengers continuously with their cargo',async()=>{
 const w=await setup(),a=w.agents.agent_1,b=w.agents.agent_2,origin={...a.position},minute=w.calendar.elapsedWorldMinutes;
 recordPhysicalGoodsV21(w,a,'wood',2);recordPhysicalGoodsV21(w,b,'meat',.4);
 const cargo=structuredClone(w.v19!.adventureEconomy.adventurersByAgentId);
 assert.equal(startBoatTravel(w,a,'boat_east','walk',0,()=>false),true);assert.equal(b.movement,undefined);
 assert.equal(startBoatTravel(w,b,'boat_east','walk',0,()=>false),true);
 assert.equal(advanceBoats(w,.05,minute).length,0);assert.ok(a.position.x>origin.x);assert.ok(a.position.x<w.places.boat_east.mapX);assert.deepEqual(a.position,b.position);
 assertBoatNavigation(w,'test_boat');assert.equal(advanceBoats(w,30,minute+.05).length,2);
 assert.equal(a.locationId,'boat_east');assert.equal(b.movement,undefined);assert.deepEqual(w.v19!.adventureEconomy.adventurersByAgentId,cargo);
});
test('saved voyage opens without teleportation and finishes at its actual bank',async()=>{
 const w=await setup(),a=w.agents.agent_1,m=w.calendar.elapsedWorldMinutes;
 assert.equal(startBoatTravel(w,a,'boat_east','walk',0,()=>false),true);advanceBoats(w,2,m);w.calendar.elapsedWorldMinutes=m+2;
 const store=new InMemoryWorldStore();await store.initializeWorld(w);const e=await WorldEngine.open({worldId:w.id,store});
 assert.deepEqual(e.snapshot().agents.agent_1.position,a.position);assertBoatNavigation(e.snapshot(),'test_boat');
 await e.advanceCanonicalTimeTo(m+32);assert.equal(e.snapshot().agents.agent_1.locationId,'boat_east');
});
test('fishing depletes real fish only after a physical voyage and return',async()=>{
 const w=await setup(),a=w.agents.agent_1,m=w.calendar.elapsedWorldMinutes;
 w.wildlife.boat_fish={...Object.values(w.wildlife)[0],id:'boat_fish',species:'fish',habitatId:'boat_west',count:20,carryingCapacity:40,threat:0,isMonster:false,alertness:0};
 assert.equal(startBoatFishing(w,a,'boat_fish',0,0),true);assert.equal(w.wildlife.boat_fish.count,20);
 const full=structuredClone(w);advanceBoats(full,100,m);
 advanceBoats(w,20,m);assert.equal(w.wildlife.boat_fish.count,20);
 const loaded=JSON.parse(JSON.stringify(w));advanceBoats(loaded,80,m+20);
 assert.ok(loaded.wildlife.boat_fish.count<20);assert.equal(loaded.wildlife.boat_fish.count,full.wildlife.boat_fish.count);assert.deepEqual(loaded.agents.agent_1.position,full.agents.agent_1.position);
 const before=loaded.wildlife.boat_fish.count;advanceBoats(loaded,100,m+100);assert.equal(loaded.wildlife.boat_fish.count,before);
});
test('boat landing discovery gives no remote resident global knowledge',async()=>{
 const w=await setup(),a=w.agents.agent_1,b=w.agents.agent_2;delete w.places.boat_east;a.knownPlaceIds=['boat_west'];
 const knowledge=[...b.knownPlaceIds!],count=Object.keys(w.places).length;
 assert.equal(startBoatExploration(w,a,0),true);assert.equal(Object.keys(w.places).length,count);
 const arrived=advanceBoats(w,60,w.calendar.elapsedWorldMinutes);assert.ok(arrived[0].discovered);assert.equal(Object.keys(w.places).length,count+1);
 assert.equal(bindWorldTerrain(w)!.sample(a.position.x,a.position.y).water,false);assert.deepEqual(b.knownPlaceIds,knowledge);
});
test('no boat launch without theory, under overload, or in a storm',async()=>{
 const w=await setup(),a=w.agents.agent_1,known=w.v18!.secretLibrary.knowledgeByAgentId[a.id];
 w.v18!.secretLibrary.knowledgeByAgentId[a.id]=[];assert.equal(startBoatTravel(w,a,'boat_east','walk',0,()=>false),false);
 w.v18!.secretLibrary.knowledgeByAgentId[a.id]=known;recordPhysicalGoodsV21(w,a,'stone',20);assert.equal(startBoatTravel(w,a,'boat_east','walk',0,()=>false),false);
 w.v19!.adventureEconomy.adventurersByAgentId[a.id].carriedGoods={};
 for(let i=0;i<100&&worldWeatherV21(w).kind!=='storm';i++)w.calendar.elapsedWorldMinutes+=2880;
 assert.equal(worldWeatherV21(w).kind,'storm');assert.equal(startBoatTravel(w,a,'boat_east','walk',0,()=>false),false);
});
test('sailing segments use actual water and cannot cut through land',async()=>{
 const w=await setup(),a=w.agents.agent_1,course=sailingCourse(w,a.position,{x:w.places.boat_east.mapX,y:w.places.boat_east.mapY});assert.ok(course);
 for(let i=2;i<course.length-1;i++)assert.equal(waterSegment(w,course[i-1],course[i]),true);
 assert.equal(sailingCourse(w,a.position,{x:a.position.x-8,y:a.position.y-8}),undefined);
});
test('shipbuilding requires labor, wood and lived experience for the next design',async()=>{
 const w=await setup(),a=w.agents.agent_1;delete w.v15!.items.test_boat;a.skills.craft=.95;
 const town=w.places[a.homeId].settlementId!,economy=w.v16!.settlementEconomyById[town];economy.stocks.wood=30;economy.stocks.stone=10;delete economy.activeHumanHomeProject;
 const before=economy.stocks.wood;assert.equal(workOnBoat(w,a),true);
 let boat=Object.values(w.v15!.items).find(i=>i.ownerAgentId===a.id&&i.boat)!;assert.equal(vesselDesignV22(boat),'coastal_skiff');assert.equal(boat.boat!.completed,false);
 assert.ok(economy.stocks.wood<before);
 for(let i=0;i<30&&!boat.boat!.completed;i++){w.calendar.elapsedWorldMinutes+=480;assert.equal(workOnBoat(w,a),true);}
 assert.ok(boat.boat!.completed);w.calendar.elapsedWorldMinutes+=480;assert.equal(workOnBoat(w,a),false);
 boat.boat!.designExperience=VESSEL_DESIGNS_V22.sailing_boat.priorExperience;assert.equal(workOnBoat(w,a),true);
 assert.ok(Object.values(w.v15!.items).some(i=>i.boat&&!i.boat.completed&&vesselDesignV22(i)==='sailing_boat'));
});
