import { build } from 'esbuild';
import { mkdir, readFile, writeFile, cp, rm } from 'node:fs/promises';

await rm('dist', { recursive: true, force: true });
await mkdir('dist/assets', { recursive: true });
const result = await build({
  entryPoints: { browser: 'src/iskorka/browser.ts', worker: 'src/iskorka/worker.ts' },
  bundle: true, format: 'esm', platform: 'browser', target: ['es2022'],
  outdir: 'dist/assets', minify: true, metafile: true, legalComments: 'none',
});
const forbidden = Object.keys(result.metafile.inputs).filter(p => /(?:\/sensors\/|\/boundary\/|\/runtime\/LiveWorldRuntime)/i.test(p));
if (forbidden.length) throw new Error('Forbidden supervisor dependency: ' + forbidden.join(', '));
await cp('src/iskorka/index.html', 'dist/index.html');
await mkdir('validation', { recursive: true });
await writeFile('validation/build-inputs.json', JSON.stringify(Object.keys(result.metafile.inputs).sort(), null, 2) + '\n');
// Checked-in production files let SPCK preview the same build without Node on the phone.
await rm('assets', { recursive: true, force: true });
await cp('dist/assets', 'assets', { recursive: true });
await cp('dist/index.html', 'index.html');
console.log(`Iskorka built: ${Object.keys(result.metafile.inputs).length} source inputs; standalone runtime boundary verified.`);
