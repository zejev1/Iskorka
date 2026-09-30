import test from 'node:test';
import assert from 'node:assert/strict';
import {IskorkaRuntime} from '../../src/iskorka/WorldRuntime';
import {InMemoryWorldStore} from '../../src/world/InMemoryWorldStore';
import {recordGuidedPracticeExperienceV1, guidedPracticeExperiencesV1} from '../../src/iskorka/NativeSparkAgencyV1';

test('routine practice cannot erase or fabricate a dangerous episode; danger memory stays bounded',async()=>{
  const r=await IskorkaRuntime.openOrCreate(new InMemoryWorldStore(),'danger-memory','danger-memory');
  const world=r.snapshot(),student=world.agents.agent_1;
  student.life.ageYears=13;
  const experience={domain:'survival' as const,action:'hunt' as const,placeId:'outskirts',
    mentorId:'mentor',worldMinute:0,succeeded:true,targetSpecies:'boar',defensiveEncounter:true};
  assert.equal(recordGuidedPracticeExperienceV1(world,student,experience),true);
  assert.equal(recordGuidedPracticeExperienceV1(world,student,{...experience,worldMinute:1,
    targetSpecies:'rabbit',defensiveEncounter:false}),true);
  const brain=world.iskorkaBrainV1!.brainsByAgentId[student.id];
  const memories=guidedPracticeExperiencesV1(brain);
  assert.ok(memories.some(e=>e.targetSpecies==='boar'&&e.defensiveEncounter&&e.worldMinute===0));
  assert.ok(memories.some(e=>e.targetSpecies==='rabbit'&&!e.defensiveEncounter&&e.worldMinute===1));
  for(let month=1;month<=120;month++)recordGuidedPracticeExperienceV1(world,student,
    {...experience,worldMinute:month*30*1440});
  assert.ok(guidedPracticeExperiencesV1(brain).filter(e=>e.defensiveEncounter).length<=12);
});
