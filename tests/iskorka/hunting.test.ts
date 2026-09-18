import test from 'node:test';
import assert from 'node:assert/strict';
import { WorldEngine } from '../../src/world/WorldEngine';
import { InMemoryWorldStore } from '../../src/world/InMemoryWorldStore';
import type { WorldState } from '../../src/world/types';

test('ordinary hunting consumes actual prey, costs energy and produces food and experience',async()=>{
 const engine=await WorldEngine.create({worldId:'physical-hunt',seed:'physical-hunt',store:new InMemoryWorldStore()});
 // Disposable test fixture only: no intervention method exists in the application.
 const inner=engine as any;inner.workingState=engine.snapshot();inner.stagedEvents=[];inner.stagedMemories=[];
 const world=inner.state as WorldState,a=Object.values(world.agents)[0],prey=world.wildlife.wildlife_foundation_rabbit,p=world.places[prey.habitatId];
 a.locationId=prey.habitatId;a.position={x:p.mapX,y:p.mapY,layerId:'surface'};a.movement=undefined;
 a.skills.hunting=.9;a.life.physiology.strength=1;a.life.physiology.endurance=1;a.mind.emotions.fear=0;a.personality.riskTolerance=1;
 a.resources=.1;a.energy=1;prey.threat=0;prey.alertness=0;p.danger=0;
 const before={prey:prey.count,energy:a.energy,food:a.resources,skill:a.skills.hunting};
 const environment=await inner.effectiveEnvironment(0);
 for(let i=0;i<20&&prey.count===before.prey;i++)inner.performHunt(a,prey,environment,i);
 assert.equal(prey.count,before.prey-1);assert.ok(a.energy<before.energy);assert.ok(a.resources>before.food);assert.ok(a.skills.hunting>before.skill);
 assert.ok(inner.stagedEvents.some((e:any)=>e.kind.includes('hunt')));
 assert.equal(a.locationId,prey.habitatId);
 inner.workingState=undefined;inner.stagedEvents=undefined;inner.stagedMemories=undefined;
});
