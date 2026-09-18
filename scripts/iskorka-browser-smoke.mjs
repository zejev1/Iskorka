import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { createHash } from 'node:crypto';
import { chromium } from 'playwright';

const root = resolve('dist');
const output = resolve('artifacts/browser');
await mkdir(output, { recursive: true });
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml' };
const server = createServer(async (req, res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    const path = resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname));
    if (!path.startsWith(root + sep)) { res.writeHead(403).end(); return; }
    res.setHeader('Content-Type', mime[extname(path)] || 'application/octet-stream');
    res.end(await readFile(path));
  } catch { res.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const url = `http://127.0.0.1:${server.address().port}/`;
const browser = await chromium.launch({ headless: true });
const failures = [];
const report = { checks: [], browser: browser.version(), platforms: ['Chromium desktop 1365x1000', 'Chromium touch emulation 390x844'], actualPhoneTested: false };
let page;
function watch(p) {
  p.on('pageerror', error => failures.push(error.message));
  p.on('console', message => { if (message.type() === 'error') failures.push(message.text()); });
  p.on('requestfailed', request => failures.push(request.url() + ': ' + request.failure()?.errorText));
}
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(k => [k, canonical(value[k])]));
  return value;
}
const hash = value => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
async function saved(p) {
  return p.evaluate(() => new Promise((resolve, reject) => {
    const request = indexedDB.open('iskorka-physical-world-v1');
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const transaction = db.transaction(['worlds', 'events', 'memories', 'stream_records'], 'readonly');
      const result = {};
      const world = transaction.objectStore('worlds').get('iskorka-human-world');
      world.onsuccess = () => { result.world = world.result; };
      for (const name of ['events', 'memories', 'stream_records']) {
        const all = transaction.objectStore(name).getAll();
        all.onsuccess = () => { result[name] = all.result; };
      }
      transaction.oncomplete = () => { db.close(); resolve(result); };
      transaction.onerror = () => { db.close(); reject(transaction.error); };
    };
  }));
}
async function ready(p) {
  await p.waitForFunction(() => !document.querySelector('#play')?.disabled, undefined, { timeout: 45_000 });
  assert.equal(await p.locator('#population').textContent(), '10');
  assert.match(await p.locator('#status').textContent(), /Пауза/);
  assert.ok(await p.locator('#ground canvas').count(), 'actual terrain canvas exists');
  assert.ok(await p.locator('#residents .person').count(), 'physical residents rendered');
}
async function pause(p) {
  await p.locator('#play').click();
  await p.waitForFunction(() => document.querySelector('#status')?.textContent.startsWith('Пауза'), undefined, { timeout: 45_000 });
}
function invariant(s) {
  assert.equal(s.world.profile, 'iskorka-human-lab-v1');
  assert.equal(s.world.settlements.settlement_ainkrad.name, 'Основание');
  assert.ok(Object.values(s.world.agents).every(a => a.race === 'human'));
  assert.equal(Object.values(s.world.wildlife).filter(a => a.isMonster).length, 0);
  assert.equal(s.world.centuryHumpback, undefined);
  assert.equal(s.stream_records.length, 0, 'no controller journal instantiated');
}
try {
  const context = await browser.newContext({ viewport: { width: 1365, height: 1000 } });
  page = await context.newPage(); watch(page);
  await page.goto(url); await ready(page);
  const original = await saved(page); invariant(original);
  const initialRevision = original.world.revision;
  assert.equal(Object.keys(original.world.agents).length, 10);
  report.checks.push('fresh boot: ten humans, Основание, terrain, no controllers');
  await page.locator('#people [data-agent]').first().click();
  assert.equal(await page.locator('#detail-title').textContent(), 'Алексей');
  await page.screenshot({ path: resolve(output, 'desktop-initial.png'), fullPage: true });
  await page.locator('#play').click();
  await page.waitForFunction(r => Number(document.querySelector('#map')?.dataset.revision) >= r + 6, initialRevision, { timeout: 60_000 });
  await pause(page);
  await page.locator('#save').click();
  await page.waitForFunction(() => document.querySelector('#notice')?.textContent.startsWith('Сохранено.'), undefined, { timeout: 20_000 });
  const before = await saved(page); invariant(before);
  assert.ok(before.world.calendar.elapsedWorldMinutes > original.world.calendar.elapsedWorldMinutes);
  assert.ok(before.events.length > original.events.length);
  assert.notEqual(hash(before.world.agents), hash(original.world.agents), 'real people changed through physical time');
  report.checks.push('play, physical progress, pause, durable checkpoint');
  report.elapsedWorldMinutes = before.world.calendar.elapsedWorldMinutes;
  report.revision = before.world.revision;
  report.events = before.events.length;
  report.memories = before.memories.length;
  report.savedStateSha256 = hash(before);
  await page.reload(); await ready(page);
  const after = await saved(page);
  assert.equal(hash(after), hash(before), 'reload preserves full world, RNG, memories and events exactly');
  report.checks.push('reload exact full state/RNG/history; opens paused');
  const another = await context.newPage(); watch(another);
  await another.goto(url);
  await another.waitForFunction(() => document.querySelector('#notice')?.textContent.includes('другой вкладке'), undefined, { timeout: 20_000 });
  assert.equal(hash(await saved(page)), hash(before));
  await another.close();
  report.checks.push('second tab cannot create a competing writer');
  await page.locator('#home').click();
  const initialScale = await page.locator('#scale').textContent();
  await page.locator('#zoom-in').click();
  await page.waitForFunction(scale => document.querySelector('#scale')?.textContent !== scale, initialScale);
  const box = await page.locator('#map').boundingBox();
  await page.mouse.move(box.x + box.width * .4, box.y + box.height * .6);
  await page.mouse.down(); await page.mouse.move(box.x + box.width * .6, box.y + box.height * .65, { steps: 8 }); await page.mouse.up();
  await page.locator('#home').click();
  assert.equal(hash(await saved(page)), hash(before), 'camera never changes physical world');
  report.checks.push('zoom/pan and camera home do not move inhabitants or change time');
  await page.screenshot({ path: resolve(output, 'desktop-running-world.png'), fullPage: true });
  page.once('dialog', dialog => dialog.dismiss());
  await page.locator('#reset').click();
  assert.equal(hash(await saved(page)), hash(before));
  page.once('dialog', dialog => dialog.accept());
  await page.locator('#reset').click();
  await page.waitForFunction(epoch => document.querySelector('#diagnostic')?.textContent.includes(`Эпоха ${epoch + 1} ·`), before.world.epoch, { timeout: 30_000 });
  const reset = await saved(page); invariant(reset);
  assert.equal(Object.keys(reset.world.agents).length, 10);
  assert.equal(reset.world.epoch, before.world.epoch + 1);
  report.checks.push('reset confirmation and fresh ten-human epoch');
  await context.close();

  const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  page = await mobile.newPage(); watch(page);
  await page.goto(url); await ready(page);
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'no horizontal overflow on phone');
  await page.locator('#people [data-agent]').first().tap();
  await page.locator('#map').scrollIntoViewIfNeeded();
  assert.equal(await page.locator('#detail-title').textContent(), 'Алексей');
  const target = page.locator('#residents .person').filter({ hasText: 'М' }).first();
  const title = (await target.getAttribute('title'));
  await target.tap();
  assert.equal(await page.locator('#detail-title').textContent(), title, 'map touch selects actual person despite pointer capture');
  await page.locator('#zoom-out').tap();
  await page.locator('#home').tap();
  await page.screenshot({ path: resolve(output, 'mobile-initial.png'), fullPage: true });
  await page.locator('#play').tap();
  await page.waitForFunction(() => Number(document.querySelector('#map')?.dataset.revision) > 6, undefined, { timeout: 60_000 });
  await pause(page);
  await page.locator('#save').tap();
  await page.waitForFunction(() => document.querySelector('#notice')?.textContent.startsWith('Сохранено.'));
  const mobileSaved = await saved(page); invariant(mobileSaved);
  await page.reload(); await ready(page);
  assert.equal(hash(await saved(page)), hash(mobileSaved));
  await page.screenshot({ path: resolve(output, 'mobile-reloaded.png'), fullPage: true });
  report.checks.push('mobile layout, resident touch, time controls, exact save/reload');
  await mobile.close();
  assert.deepEqual(failures, [], 'no browser/worker/network errors');
  report.ok = true;
} catch (error) {
  report.ok = false;
  report.error = String(error.stack || error);
  if (page && !page.isClosed()) await page.screenshot({ path: resolve(output, 'failure.png'), fullPage: true }).catch(() => {});
  process.exitCode = 1;
} finally {
  report.errors = failures;
  await writeFile(resolve(output, 'smoke.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}
