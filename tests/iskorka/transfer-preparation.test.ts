import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {IskorkaRuntime} from '../../src/iskorka/WorldRuntime';
import {InMemoryWorldStore} from '../../src/world/InMemoryWorldStore';
import {stableJsonStringify} from '../../src/core/stableJson';

test('offline transfer preparation preserves complete state and never edits target or accepts a foreign profile',async()=>{
 const root=mkdtempSync(join(tmpdir(),'iskorka-transfer-'));
 try{
  const runtime=await IskorkaRuntime.openOrCreate(new InMemoryWorldStore(),'transfer-proof','transfer-proof');
  await runtime.advanceTo(1440);
  const world=runtime.snapshot(),snapshot=join(root,'world.json'),out=join(root,'package');
  writeFileSync(snapshot,JSON.stringify(world));
  const before=execFileSync('git',['status','--porcelain'],{encoding:'utf8'});
  const argv=['tools/prepare-ainkrad-transfer.mjs','--source='+process.cwd(),'--target='+process.cwd(),'--snapshot='+snapshot,'--out='+out];
  execFileSync(process.execPath,argv,{stdio:'pipe'});
  const exported=readFileSync(join(out,'world.snapshot.json'),'utf8');
  assert.equal(stableJsonStringify(JSON.parse(exported)),stableJsonStringify(world));
  const manifest=JSON.parse(readFileSync(join(out,'manifest.json'),'utf8'));
  assert.equal(manifest.snapshot.sha256,createHash('sha256').update(exported).digest('hex'));
  assert.equal(manifest.automaticImportSupported,false);
  assert.equal(execFileSync('git',['status','--porcelain'],{encoding:'utf8'}),before);
  assert.throws(()=>execFileSync(process.execPath,argv,{stdio:'pipe'}),'overwrote prior review package');
  writeFileSync(snapshot,JSON.stringify({...world,simulationProfile:undefined}));
  assert.throws(()=>execFileSync(process.execPath,[...argv.slice(0,-1),'--out='+join(root,'foreign')],{stdio:'pipe'}),'inferred foreign world profile');
 }finally{rmSync(root,{recursive:true,force:true});}
});
