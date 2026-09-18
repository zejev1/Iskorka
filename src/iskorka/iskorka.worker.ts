import { createIndexedDbWorldStore } from '../persistence/IndexedDbPersistence';
import { LiveAccelerationBudget } from '../runtime/LiveAccelerationBudget';
import { cooperativeWorldTimeExecution } from '../world/WorldTimeExecution';
import { WORLD_SPEED_PRESETS, type WorldSpeedId } from '../world/WorldClock';
import { IskorkaRuntime, ISKORKA_DATABASE } from './IskorkaRuntime';
import type { IskorkaCommand, IskorkaMessage } from './protocol';

let runtime: IskorkaRuntime | undefined;
let running = false;
let booted = false;
let speed: WorldSpeedId = 'year_per_minute';
let workMs = 0;
let lastSample = performance.now();
let queue = Promise.resolve();
let ticking = false;
const budget = new LiveAccelerationBudget();
const send = (message: IskorkaMessage) => self.postMessage(message);
async function publish() {
  if (!runtime) return;
  send({ type: 'frame', frame: { ...await runtime.frame(), running, speed, capacityLimited: budget.limited, workMs } });
}
function fail(error: unknown) {
  running = false;
  send({ type: 'error', message: error instanceof Error ? error.message : String(error) });
}
function serialized(task: () => Promise<void>) { queue = queue.then(task).catch(fail); }
async function tick() {
  if (!runtime || !running || ticking) return;
  ticking = true;
  serialized(async () => {
    try {
      if (!runtime || !running) return;
      const now = performance.now();
      const rate = WORLD_SPEED_PRESETS.find(p => p.id === speed)!.worldMinutesPerRealMinute;
      budget.enqueue(Math.max(0, now - lastSample) / 60_000 * rate);
      lastSample = now;
      const from = runtime.engine.runtimeStateView().calendar.elapsedWorldMinutes;
      const token = budget.token;
      const started = performance.now();
      const target = from + budget.pending;
      await runtime.advanceTo(target, cooperativeWorldTimeExecution(() => !running, 12));
      workMs = performance.now() - started;
      budget.consume(from, runtime.engine.runtimeStateView().calendar.elapsedWorldMinutes, token);
      await publish();
    } finally { ticking = false; }
  });
}
async function initialize(seed: string) {
  runtime = await IskorkaRuntime.open(createIndexedDbWorldStore(ISKORKA_DATABASE), seed);
  // Always open paused: reading the saved world must not silently age its people.
  running = false;
  lastSample = performance.now();
  await publish();
}
self.addEventListener('message', (event: MessageEvent<IskorkaCommand>) => {
  const command = event.data;
  if (!command || typeof command.type !== 'string') return;
  if (command.type === 'pause') running = false; // Cooperative stop even during an in-flight quantum.
  if (command.type === 'boot') {
    if (booted || typeof command.seed !== 'string' || !command.seed.trim()) return;
    booted = true;
    // Cross-tab lock is held for this worker's life. IDB revision checks are the
    // fallback on browsers without Web Locks; conflicts pause instead of overwrite.
    if (navigator.locks) {
      void navigator.locks.request(ISKORKA_DATABASE, { ifAvailable: true }, async lock => {
        if (!lock) throw new Error('Мир уже открыт в другой вкладке. Закройте её и перезагрузите эту.');
        await initialize(command.seed);
        await new Promise<void>(() => {});
      }).catch(fail);
    } else serialized(() => initialize(command.seed));
    return;
  }
  serialized(async () => {
    if (!runtime) throw new Error('Мир ещё загружается.');
    switch (command.type) {
      case 'play': running = true; lastSample = performance.now(); break;
      case 'pause': running = false; budget.cancel(runtime.engine.runtimeStateView().calendar.elapsedWorldMinutes); break;
      case 'speed':
        if (!WORLD_SPEED_PRESETS.some(p => p.id === command.speed)) throw new Error('Недопустимая скорость.');
        speed = command.speed; lastSample = performance.now(); budget.cancel(runtime.engine.runtimeStateView().calendar.elapsedWorldMinutes); break;
      case 'save':
        await runtime.checkpoint(); send({ type: 'saved', revision: runtime.engine.runtimeStateView().revision }); break;
      case 'reset':
        running = false;
        if (typeof command.seed !== 'string' || !command.seed.trim() || typeof command.operationId !== 'string') throw new Error('Неверная команда нового мира.');
        await runtime.reset(command.seed, command.operationId);
        budget.cancel(0); lastSample = performance.now(); break;
    }
    await publish();
  });
});
setInterval(() => void tick(), 500);
