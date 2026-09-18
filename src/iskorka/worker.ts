import { createStandaloneWorldStore } from '../persistence/IndexedDbPersistence';
import { cooperativeWorldTimeExecution } from '../world/WorldTimeExecution';
import { ISKORKA_DATABASE } from './Profile';
import { IskorkaRuntime } from './WorldRuntime';
import { MINUTES_PER_SECOND, validateCommand, type Speed, type WorldMessage } from './protocol';

const scope = self as unknown as { postMessage(message: WorldMessage): void; onmessage: ((event: MessageEvent) => void) | null };
let runtime: IskorkaRuntime | undefined;
let paused = true;
let speed: Speed = 'normal';
let timer: ReturnType<typeof setTimeout> | undefined;
let serial: Promise<void> = Promise.resolve();
let interruption = 0;
let lastFrame = 0;
let previousWall = 0;
let previousMinutes = 0;
let requestedTarget: number | undefined;
let remainingSlice = 0;

function fail(error: unknown): void {
  paused = true;
  if (timer) clearTimeout(timer);
  scope.postMessage({ type: 'error', message: error instanceof Error ? error.message : String(error) });
}
function frame(force = false): void {
  if (!runtime || (!force && performance.now() - lastFrame < 450)) return;
  lastFrame = performance.now();
  scope.postMessage({ type: 'frame', world: runtime.snapshot(), paused, speed, saved: true,
    wallMs: previousWall, simulatedMinutes: previousMinutes });
}
function enqueue(work: () => Promise<void>): void {
  serial = serial.then(work).catch(fail);
}
function schedule(): void {
  if (timer) clearTimeout(timer);
  if (!runtime || paused) return;
  // Each paced slice is fully consumed. Slow CPUs reduce achieved speed, never life opportunities.
  timer = setTimeout(() => enqueue(tick), 100);
}
async function tick(): Promise<void> {
  if (!runtime || paused) return;
  const before = runtime.elapsedMinutes;
  const began = performance.now();
  const ticket = interruption;
  if (requestedTarget === undefined) requestedTarget = before + (remainingSlice || MINUTES_PER_SECOND[speed] * .1);
  remainingSlice = 0;
  await runtime.advanceTo(requestedTarget, cooperativeWorldTimeExecution(() => ticket !== interruption || performance.now() - began > 80, 10));
  // Persisted time is the actual completed portion, not the requested target.
  if (runtime.elapsedMinutes + 1e-8 >= requestedTarget) requestedTarget = undefined;
  previousMinutes = runtime.elapsedMinutes - before;
  previousWall = performance.now() - began + 100;
  frame();
  schedule();
}

scope.onmessage = (event: MessageEvent) => {
  let command;
  try { command = validateCommand(event.data); } catch(error) { fail(error); return; }
  // A pause/reset is observed at a safe quantum boundary, even in a long slice.
  if (command.type === 'pause' || command.type === 'reset') interruption++;
  enqueue(async () => {
    if (command.type === 'init') {
      if (runtime) throw new Error('Мир уже открыт.');
      runtime = await IskorkaRuntime.openOrCreate(createStandaloneWorldStore(ISKORKA_DATABASE), command.seed);
      paused = command.paused; speed = command.speed;
      frame(true); scope.postMessage({ type: 'ready' }); schedule(); return;
    }
    if (!runtime) throw new Error('Мир ещё не открыт.');
    if (command.type === 'pause') { paused = command.paused; frame(true); schedule(); }
    else if (command.type === 'speed') { speed = command.speed; frame(true); schedule(); }
    else if (command.type === 'snapshot') frame(true);
    else if (command.type === 'reset') {
      paused = true;
      if (timer) clearTimeout(timer);
      requestedTarget = undefined; remainingSlice = 0;
      await runtime.reset(command.seed, command.operationId);
      frame(true);
    } else if (command.type === 'advance') {
      if (!paused) throw new Error('Для шага времени сначала включите паузу.');
      await runtime.advanceTo(runtime.elapsedMinutes + command.minutes, cooperativeWorldTimeExecution(() => false));
      requestedTarget = undefined; frame(true);
    }
  });
};
