import { build, stop } from 'esbuild';
import { mkdir, readdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
await mkdir('.test-build',{recursive:true});
await build({entryPoints:['tests/iskorka/worker-harness.ts'],bundle:true,platform:'node',format:'esm',target:'node22',packages:'external',outfile:'.test-build/worker-harness.mjs'});
const tests=(await readdir('tests/iskorka')).filter(p=>p.endsWith('.test.ts'));
for (const file of tests) await build({entryPoints:['tests/iskorka/'+file],bundle:true,platform:'node',format:'esm',target:'node22',packages:'external',outfile:'.test-build/'+file.replace('.ts','.mjs')});
// Release the compiler service before memory-intensive simulation tests.
stop();
// Test files run in isolated processes; each file keeps its own serial cases.
const result=spawnSync(process.execPath,['--test','--test-concurrency=3','tools/bootstrap-profile.test.mjs',...tests.map(p=>'.test-build/'+p.replace('.ts','.mjs'))],{stdio:'inherit'});
process.exit(result.status??1);
