import test from 'node:test';
import assert from 'node:assert/strict';
import {IskorkaRuntime} from '../../src/iskorka/WorldRuntime';
import {InMemoryWorldStore} from '../../src/world/InMemoryWorldStore';
import {residentKnownPath} from '../../src/world/ResidentNavigation';
import {repairOutdoorPlaceAccess} from '../../src/world/OutdoorPlaceAccess';
import {buildingPolygon,pointInPolygon} from '../../src/world/BuildingFootprints';

test('founding garden has a real walkable timber route without moving the town or residents on reload',async()=>{
 const store=new InMemoryWorldStore();
 const runtime=await IskorkaRuntime.openOrCreate(store,'iskorka-baseline-20260918','generations-profile');
 const world=runtime.snapshot(),a=world.agents.agent_1;
 a.locationId='commons';a.knownPlaceIds=['commons','quiet_space'];
 assert.ok(residentKnownPath(world,a,'quiet_space'),'garden marker is trapped in a house');
 const garden=world.places.quiet_space;
 const entrance=garden.outdoorAccessPointV1 ?? {x:garden.mapX,y:garden.mapY};
 assert.ok(Object.values(world.places).filter(p=>p.kind==='home').every(p=>!pointInPolygon(entrance,buildingPolygon(p,0.015))));
 const original=runtime.snapshot();
 const reopened=await IskorkaRuntime.openOrCreate(store,'ignored','generations-profile');
 assert.deepEqual(reopened.snapshot(),original);
});
test('repairing an old overlapping garden preserves houses, people, IDs and terrain, and refuses occupied sites',async()=>{
 const runtime=await IskorkaRuntime.openOrCreate(new InMemoryWorldStore(),'old-garden','old-garden');
 const w=runtime.snapshot(),garden=w.places.quiet_space,home=w.places.home_agent_1;
 garden.mapX=home.mapX;garden.mapY=home.mapY;
 delete garden.outdoorAccessPointV1;
 const before={agents:structuredClone(w.agents),home:structuredClone(home),terrain:structuredClone(w.terrain),centre:structuredClone(w.places.commons)};
 const moved=new Map();
 assert.equal(repairOutdoorPlaceAccess(w,moved),true);
 assert.equal(garden.mapX,home.mapX);assert.equal(garden.mapY,home.mapY);
 assert.ok(Math.hypot(garden.outdoorAccessPointV1!.x-home.mapX,garden.outdoorAccessPointV1!.y-home.mapY)<=0.3);
 assert.deepEqual(w.agents,before.agents);assert.deepEqual(home,before.home);
 assert.deepEqual(w.terrain,before.terrain);assert.deepEqual(w.places.commons,before.centre);
 assert.equal(repairOutdoorPlaceAccess(w,new Map()),false,'repair was not idempotent');
 garden.mapX=home.mapX;garden.mapY=home.mapY;w.agents.agent_1.locationId=garden.id;
 delete garden.outdoorAccessPointV1;
 assert.equal(repairOutdoorPlaceAccess(w,new Map()),false,'moved an occupied physical site');
});
