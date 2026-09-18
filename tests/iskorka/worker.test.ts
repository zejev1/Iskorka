import test from 'node:test';
import assert from 'node:assert/strict';
import { Worker } from 'node:worker_threads';

test('production worker: real simulation, serialized pause, step, speed, reset and invalid commands',async()=>{
 const worker=new Worker(new URL('./worker-harness.mjs',import.meta.url));
 const messages:any[]=[];const listeners=new Set<()=>void>();
 worker.on('message',m=>{messages.push(m);for(const f of listeners)f();});
 let fatal:unknown;worker.on('error',e=>{fatal=e;for(const f of listeners)f();});
 function wait(predicate:(message:any)=>boolean):Promise<any>{
  return new Promise((resolve,reject)=>{
   const timer=setTimeout(()=>{listeners.delete(check);reject(new Error('Worker timeout: '+JSON.stringify(messages.slice(-1))));},5000);
   function check(){if(fatal){clearTimeout(timer);listeners.delete(check);reject(fatal);return;}const i=messages.findIndex(predicate);if(i>=0){clearTimeout(timer);listeners.delete(check);resolve(messages.splice(i,1)[0]);}}
   listeners.add(check);check();
  });
 }
 const post=(m:any)=>worker.postMessage(m);
 try{
  await wait(m=>m.type==='harness-ready');
  post({type:'init',seed:'worker-test',paused:true,speed:'normal'});
  const first=await wait(m=>m.type==='frame');assert.equal(Object.keys(first.world.agents).length,10);assert.equal(first.world.calendar.elapsedWorldMinutes,0);
  await wait(m=>m.type==='ready');
  post({type:'advance',minutes:8760*2});const step=await wait(m=>m.type==='frame'&&m.world.calendar.elapsedWorldMinutes>0);assert.equal(step.world.calendar.elapsedWorldMinutes,17520);
  post({type:'speed',speed:'fast'});await wait(m=>m.type==='frame'&&m.speed==='fast');
  post({type:'pause',paused:false});await wait(m=>m.type==='frame'&&!m.paused);
  await new Promise(resolve=>setTimeout(resolve,600));
  post({type:'pause',paused:true});const paused=await wait(m=>m.type==='frame'&&m.paused&&m.world.calendar.elapsedWorldMinutes>17520);
  await new Promise(resolve=>setTimeout(resolve,250));post({type:'snapshot'});const still=await wait(m=>m.type==='frame'&&m.paused);
  assert.equal(still.world.calendar.elapsedWorldMinutes,paused.world.calendar.elapsedWorldMinutes);
  post({type:'reset',seed:'worker-reset',operationId:'worker-reset-1'});const reset=await wait(m=>m.type==='frame'&&m.world.epoch===2);
  assert.equal(Object.keys(reset.world.agents).length,10);assert.equal(reset.world.calendar.elapsedWorldMinutes,0);assert.equal(reset.world.settlements.settlement_ainkrad.name,'Основание');
  post({type:'intervene'});const error=await wait(m=>m.type==='error');assert.match(error.message,/команда/);
 }finally{await worker.terminate();}
});
