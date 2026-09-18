import test from 'node:test';
import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';
import { createStandaloneWorldStore } from '../../src/persistence/IndexedDbPersistence';
import { IskorkaRuntime } from '../../src/iskorka/WorldRuntime';
import { InMemoryWorldStore } from '../../src/world/InMemoryWorldStore';
import { ISKORKA_WORLD_ID } from '../../src/iskorka/Profile';
import type { WorldCommitBatch } from '../../src/world/persistence';

test('IndexedDB adapter: world, history, RNG survive close/reopen of the runtime',async()=>{
 const db='iskorka-test-reopen';const first=createStandaloneWorldStore(db);
 const r=await IskorkaRuntime.openOrCreate(first,'idb');await r.advanceTo(525600);
 const state=r.snapshot(),events=await first.history(ISKORKA_WORLD_ID);
 const second=createStandaloneWorldStore(db),r2=await IskorkaRuntime.openOrCreate(second,'ignored');
 assert.deepEqual(r2.snapshot(),state);assert.deepEqual(await second.history(ISKORKA_WORLD_ID),events);
 await r2.advanceTo(1051200);
 const r3=await IskorkaRuntime.openOrCreate(createStandaloneWorldStore(db),'ignored');
 assert.deepEqual(r3.snapshot(),r2.snapshot());
});
test('Ainkrad database namespace cannot be passed to the standalone store',()=>{
 assert.throws(()=>createStandaloneWorldStore('ainkrad-v0-3-browser-world-v1'));
});
test('failed persistence commit does not expose a partially advanced world',async()=>{
 class FailureStore extends InMemoryWorldStore{
  fail=false;
  async commit(batch:WorldCommitBatch){if(this.fail){this.fail=false;throw new Error('test disk failure');}return super.commit(batch);}
 }
 const store=new FailureStore(),r=await IskorkaRuntime.openOrCreate(store,'rollback');const before=r.snapshot();
 store.fail=true;await assert.rejects(()=>r.advanceTo(8760),/test disk failure/);
 assert.deepEqual(r.snapshot(),before);assert.deepEqual(await store.loadWorld(ISKORKA_WORLD_ID),before);
 await r.advanceTo(8760);assert.equal(r.elapsedMinutes,8760);
});
test('Independent IndexedDB worlds cannot overwrite each other',async()=>{
 const a=await IskorkaRuntime.openOrCreate(createStandaloneWorldStore('iskorka-test-isolation-a'),'a');
 const b=await IskorkaRuntime.openOrCreate(createStandaloneWorldStore('iskorka-test-isolation-b'),'b');
 const untouched=b.snapshot();await a.advanceTo(8760*3);assert.deepEqual(b.snapshot(),untouched);
});
