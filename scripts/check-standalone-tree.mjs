import { readdir, readFile } from 'node:fs/promises';
import { extname, join, relative } from 'node:path';

const root = process.cwd();
const excludedDirs = new Set(['.git', 'node_modules', 'dist']);
const textExt = new Set(['.ts','.js','.mjs','.cjs','.json','.md','.txt','.yml','.yaml','.html','.css','.tsv']);
const banned = [
  ['car','dinal'].join(''),
  ['gate','way'].join(''),
];
const ownPath = relative(root, new URL(import.meta.url).pathname);
const hits = [];

async function walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.isDirectory() && excludedDirs.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) { await walk(full); continue; }
    const rel = relative(root, full);
    if (rel === ownPath || !textExt.has(extname(entry.name).toLowerCase())) continue;
    const text = await readFile(full, 'utf8');
    for (const word of banned) {
      const rx = new RegExp(word, 'i');
      if (rx.test(text)) hits.push(rel);
    }
  }
}
await walk(root);
const unique = [...new Set(hits)].sort();
if (unique.length) {
  console.error('Legacy external-control terminology remains in current tree:');
  for (const file of unique) console.error(' - ' + file);
  process.exitCode = 1;
} else {
  console.log('Standalone tree terminology: PASS.');
}
