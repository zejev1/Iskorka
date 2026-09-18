import {beforeAll,describe,expect,it} from 'vitest';
import {WorldEngine} from '../src/world/WorldEngine';
import {InMemoryWorldStore} from '../src/world/InMemoryWorldStore';
import type {WorldState} from '../src/world/types';
import type {BoatJourney} from '../src/v21/BoatNavigation';
import {recordOceanPassage,assertOceanExploration,oceanCell,MAX_CHART_CELLS} from '../src/world/geography/OceanExploration';
import {IndependentOceanFrontierGateway,applyOceanDecision,oceanDecisionAllowed} from '../src/boundary/OceanFrontierGateway';
import {bindWorldTerrain,assertTerrainFoundation} from '../src/world/geography/WorldTerrain';
import {pointInPolygon} from '../src/world/BuildingFootprints';
import {worldWaterPolygons,pathCrossesWater} from '../src/world/WaterNavigation';
import {localTerrainBiome} from '../src/world/geography/LocalExploration';

let baseline:WorldState;
beforeAll(async()=>{baseline=(await WorldEngine.create({worldId:'ocean-frontier-322',seed:'ocean-frontier-322',store:new InMemoryWorldStore(),startTime:0})).snapshot();});
function expedition(x=10000,y=40000){
  const w=structuredClone(baseline),a=w.agents.agent_1;
  a.life.ageYears=25;a.energy=1;
  const origin={x:x-2000,y},position={x,y};
  const j:BoatJourney={pilotId:a.id,occupantIds:[a.id],originPlaceId:a.locationId,destinationPlaceId:a.locationId,purpose:'explore',
    waypoints:[origin,position,{x:x+50,y},{x:x+50,y:y+50},origin],nextWaypointIndex:2,
    startedWorldMinute:0,lastAdvancedWorldMinute:0,fishingMinutes:0,returning:false,travelledDistance:2000};
  a.position={...position,layerId:'surface'};a.movement={boatId:'expedition',targetPlaceId:a.locationId,purpose:'explore',
    waypoints:j.waypoints,nextWaypointIndex:2,startedAt:0,worldStageAtStart:w.growth.stage};
  w.v15!.items.expedition={id:'expedition',kind:'artifact',name:'Испытательное судно',ownerAgentId:a.id,createdWorldMinute:0,
    locationId:a.locationId,quality:.8,effectiveness:.4,reliability:.8,description:'Физический рейс',
    boat:{completed:true,laborMinutes:4800,requiredLaborMinutes:4800,lastWorkedMinute:0,condition:1,position,journey:j}};
  recordOceanPassage(w,'expedition',j,position,0);
  return w;
}
describe('0.3.22 demand-driven ocean geography',()=>{
  it('creates no archipelago on a new world, during map inspection or on a short harbour trip',()=>{
    const w=expedition(),j=w.v15!.items.expedition.boat!.journey!;
    delete w.oceanExploration;j.waypoints[0]={x:9990,y:40000};j.travelledDistance=10000;
    recordOceanPassage(w,'expedition',j,{x:10000,y:40000},0);
    expect(w.oceanExploration?.pending).toBeUndefined();expect(w.terrain!.offshore).toBeUndefined();
    const snapshot=JSON.stringify(w);bindWorldTerrain(w)!.sample(10000,40000);expect(JSON.stringify(w)).toBe(snapshot);
  });
  it('retains real sea evidence and the same random decision across reloads and repeated requests',()=>{
    const w=expedition(),r=w.oceanExploration!.pending!;expect(r).toBeDefined();assertOceanExploration(w);
    expect(w.oceanExploration!.charted[oceanCell(r.position)]).toBe(true);
    const copy=JSON.parse(JSON.stringify(w));
    expect(copy.oceanExploration.pending).toEqual(r);
    const result={requestId:r.id};applyOceanDecision(w,result);
    recordOceanPassage(w,'expedition',w.v15!.items.expedition.boat!.journey!,r.position,0);
    expect(w.oceanExploration!.pending).toBeUndefined();expect(oceanDecisionAllowed(w,result)).toBe(false);
  });
  it('stops extension at the chart memory limit without discarding previously surveyed water',()=>{
    const w=expedition(),s=w.oceanExploration!;delete s.pending;s.charted={};
    for(let i=0;i<MAX_CHART_CELLS;i++)s.charted[`${i}:-100`]=true;
    recordOceanPassage(w,'expedition',w.v15!.items.expedition.boat!.journey!,{x:10000,y:40000},0);
    expect(s.sealed).toBe(true);expect(Object.keys(s.charted)).toHaveLength(MAX_CHART_CELLS);expect(s.charted['0:-100']).toBe(true);
  });
});
