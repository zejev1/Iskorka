import { appendFileSync, existsSync, readFileSync, renameSync, statSync, truncateSync, writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { deserialize, serialize } from 'node:v8';
import { IskorkaRuntime } from '../src/iskorka/WorldRuntime';
import { InMemoryWorldStore } from '../src/world/InMemoryWorldStore';
import type { WorldEvent } from '../src/world/events';
import type { WorldCommitBatch } from '../src/world/persistence';

const YEAR = 525_600;
const CHECKPOINTS = new Set([1, 5, 10, 17, 18, 20, 24, 30, 50, 100, 200]);
const OUTPUT = process.argv[2] ?? 'validation/generations-profile.jsonl';
const CHECKPOINT = OUTPUT + '.checkpoint.bin';
const maxYear = Number(process.env.ISKORKA_PROFILE_MAX_YEAR ?? 200);
if (!Number.isInteger(maxYear) || maxYear < 1 || maxYear > 200) throw new Error('Invalid profile year limit.');
const LIMIT_MS = 30 * 60_000;
const LIMIT_RSS_MIB = 1536;
const seed = 'iskorka-baseline-20260918';
const started = performance.now();
// The browser archives events in IndexedDB. Mirror that separation in the
// laboratory instead of keeping centuries of public evidence in a JS Map.
class ProfileWorldStore extends InMemoryWorldStore {
  readonly eventPath = OUTPUT + '.events.jsonl';
  readonly eventKinds = new Map<string, number>();
  readonly signals: WorldEvent[] = [];
  readonly otherEventIds = new Set<string>();
  eventCount = 0;
  lastEventSequence = 0;
  constructor(resume: boolean) {
    super();
    if (!resume) writeFileSync(this.eventPath, '');
  }

  override async commit(batch: WorldCommitBatch) {
    const staged = new Set<string>();
    let nextSequence = this.lastEventSequence;
    for (const event of batch.events) {
      const suffix = event.eventId.split(':').at(-1) ?? '';
      const sequence = /^[0-9a-z]+$/.test(suffix) ? parseInt(suffix, 36) : NaN;
      const canonical = Number.isSafeInteger(sequence) &&
        sequence <= batch.nextState.determinism.eventSequence &&
        event.eventId.includes(`:${batch.worldId}:`);
      if (event.worldId !== batch.worldId || staged.has(event.eventId) ||
          (canonical ? sequence <= nextSequence : this.otherEventIds.has(event.eventId)))
        throw new Error(`Duplicate, out-of-order or foreign profile event: ${event.eventId}.`);
      if (canonical) nextSequence = sequence;
      staged.add(event.eventId);
    }
    const result = await super.commit({...batch, events: []});
    if (result.duplicate) return result;
    if (batch.events.length) {
      appendFileSync(this.eventPath, batch.events.map(event => JSON.stringify(event)).join('\n')+'\n');
      for (const event of batch.events) {
        this.eventKinds.set(event.kind, (this.eventKinds.get(event.kind) ?? 0) + 1);
        const suffix = event.eventId.split(':').at(-1) ?? '';
        const sequence = /^[0-9a-z]+$/.test(suffix) ? parseInt(suffix, 36) : NaN;
        if (!Number.isSafeInteger(sequence) || sequence > batch.nextState.determinism.eventSequence)
          this.otherEventIds.add(event.eventId);
        if (event.activeUntil !== undefined || event.activeUntilWorldMinutes !== undefined)
          this.signals.push(structuredClone(event));
      }
      this.eventCount += batch.events.length;
      this.lastEventSequence = nextSequence;
    }
    return result;
  }
  override async activeSignals(worldId: string, now: number, worldMinutes?: number) {
    return this.signals.filter(event => event.worldId === worldId && (
      worldMinutes !== undefined && event.occurredWorldMinutes !== undefined &&
      event.activeUntilWorldMinutes !== undefined
        ? event.occurredWorldMinutes <= worldMinutes && event.activeUntilWorldMinutes > worldMinutes
        : event.occurredAt <= now && event.activeUntil !== undefined && event.activeUntil > now
    )).map(event => structuredClone(event));
  }
  override async history(worldId: string) {
    return readFileSync(this.eventPath, 'utf8').split('\n').filter(Boolean)
      .map(line => JSON.parse(line) as WorldEvent).filter(event => event.worldId === worldId);
  }
  override async get(worldId: string, eventId: string) {
    return (await this.history(worldId)).find(event => event.eventId === eventId);
  }
  override async recent(worldId: string, limit: number, atOrBefore?: number) {
    if (!Number.isInteger(limit) || limit < 0) throw new Error('Invalid event limit.');
    if (limit === 0) return [];
    return (await this.history(worldId)).filter(event =>
      atOrBefore === undefined || event.occurredAt <= atOrBefore).slice(-limit);
  }
}
const resume = process.env.ISKORKA_PROFILE_RESUME === '1' && existsSync(CHECKPOINT);
const prior = resume ? deserialize(readFileSync(CHECKPOINT)) as {
  year: number; world: import('../src/world/types').WorldState;
  eventCount: number; eventKinds: [string, number][]; signals: WorldEvent[];
  eventBytes?: number; outputBytes?: number; otherEventIds?: string[];
} : undefined;
const store = new ProfileWorldStore(resume);
if (prior) {
  const rows = readFileSync(OUTPUT, 'utf8').split('\n');
  const checkpointIndex = rows.findIndex(line => line &&
    (JSON.parse(line) as {kind: string; year?: number}).kind === 'year' &&
    (JSON.parse(line) as {year: number}).year === prior.year);
  if (checkpointIndex < 0) throw new Error('Checkpoint has no matching yearly report.');
  const checkpointRow = JSON.parse(rows[checkpointIndex]) as {archivedEventBytes: number};
  truncateSync(store.eventPath, prior.eventBytes ?? checkpointRow.archivedEventBytes);
  truncateSync(OUTPUT, prior.outputBytes ?? Buffer.byteLength(rows.slice(0, checkpointIndex+1).join('\n')+'\n'));
  (store as unknown as {worlds: Map<string, typeof prior.world>}).worlds.set(prior.world.id, prior.world);
  store.eventCount = prior.eventCount;
  store.lastEventSequence = prior.world.determinism.eventSequence;
  for (const [kind, count] of prior.eventKinds) store.eventKinds.set(kind, count);
  store.signals.push(...prior.signals);
  for (const id of prior.otherEventIds ?? []) store.otherEventIds.add(id);
}
const storeCounters = store as unknown as {
  operations: Map<string, unknown>;
  memoriesById: Map<string, unknown>;
};
let completedYear = prior?.year ?? 0;
let stoppedAtLimit = false;

if (!resume) writeFileSync(OUTPUT, '');
function record(value: Record<string, unknown>) {
  const line = JSON.stringify(value);
  appendFileSync(OUTPUT, line + '\n');
  console.log(line);
}

try {
  const runtime = await IskorkaRuntime.openOrCreate(store, seed, 'generations-profile');
  for (let year = completedYear + 1; year <= maxYear; year++) {
    const stepStart = performance.now();
    await runtime.advanceTo(year * YEAR);
    completedYear = year;
    const world = runtime.snapshot();
    const agents = Object.values(world.agents);
    const alive = agents.filter(agent => agent.life.alive);
    const aliveByGeneration: Record<string, number> = {};
    for (const agent of alive) {
      const generation = String(agent.life.generation);
      aliveByGeneration[generation] = (aliveByGeneration[generation] ?? 0) + 1;
    }
    const adultDescendants = alive.filter(agent => agent.life.generation > 0 && agent.life.ageYears >= 18);
    const descendantsOver30 = alive.filter(agent => agent.life.generation > 0 && agent.life.ageYears >= 30);
    const learnedDescendants = alive.filter(agent => agent.life.generation > 0 &&
      (world.iskorkaBrainV1?.brainsByAgentId[agent.id]?.learning?.methods.length ?? 0) > 0);
    // Report retained live memory, not V8's uncollected allocation backlog.
    (globalThis as {gc?: () => void}).gc?.();
    const elapsedMs = Math.round(performance.now() - started);
    const rssMiB = Math.round(process.memoryUsage().rss / 1048576);
    const row = {
      kind: 'year', seed, year, alive: alive.length, aliveByGeneration,
      births: world.population.births, deaths: world.population.deaths,
      homes: Object.values(world.places).filter(place => place.kind === 'home').length,
      housingCapacity: Object.values(world.places).filter(place => place.kind === 'home').reduce((sum, place) => sum + place.capacity, 0),
      regions: world.growth.discoveredRegionIds.length,
      clothed: alive.filter(agent => agent.clothingV1?.worn &&
        world.calendar.elapsedWorldMinutes - (agent.clothingV1.worn.wornSinceWorldMinute ?? world.calendar.elapsedWorldMinutes) < 3*YEAR).length,
      garmentsMade: agents.reduce((sum,agent) => sum + (agent.clothingV1?.madeCount ?? 0), 0),
      construction: Object.values(world.v16?.settlementEconomyById ?? {}).map(economy => ({
        constructionEvents: economy.constructionEvents, wood: economy.stocks.wood,
        project: economy.activeHumanHomeProject ? {
          id: economy.activeHumanHomeProject.id, labor: economy.activeHumanHomeProject.laborCompletedPersonDays,
          required: economy.activeHumanHomeProject.laborRequiredPersonDays } : null,
      })),
      adultDescendants: adultDescendants.length, descendantsOver30: descendantsOver30.length,
      learnedDescendants: learnedDescendants.length,
      maxGeneration: Math.max(0, ...agents.map(agent => agent.life.generation)),
      yearMs: Math.round(performance.now() - stepStart), elapsedMs, rssMiB,
      heapMiB: Math.round(process.memoryUsage().heapUsed / 1048576),
      operationCount: (prior?.year ?? 0) + storeCounters.operations.size,
      eventCount: store.eventCount,
      memoryCount: storeCounters.memoriesById.size,
      signalCount: store.signals.length,
      ...(CHECKPOINTS.has(year) ? {
        worldBytes: Buffer.byteLength(JSON.stringify(world)),
        archivedEventBytes: statSync(store.eventPath).size,
        topEventKinds: [...store.eventKinds].sort((a,b) => b[1] - a[1]).slice(0, 8),
        aliveFemaleAdults: alive.filter(agent => agent.sex === 'female' && agent.life.ageYears >= 18).length,
        aliveMaleAdults: alive.filter(agent => agent.sex === 'male' && agent.life.ageYears >= 18).length,
      } : {}),
    };
    appendFileSync(OUTPUT, JSON.stringify(row) + '\n');
    if (year % 5 === 0 || CHECKPOINTS.has(year)) {
      const temporary = CHECKPOINT + '.tmp';
      writeFileSync(temporary, serialize({year, world, eventCount: store.eventCount,
        eventKinds: [...store.eventKinds], signals: store.signals,
        otherEventIds: [...store.otherEventIds],
        eventBytes: statSync(store.eventPath).size, outputBytes: statSync(OUTPUT).size}));
      renameSync(temporary, CHECKPOINT);
    }
    if (CHECKPOINTS.has(year) || year % 10 === 0 || alive.length === 0) console.log(JSON.stringify(row));
    if (rssMiB > LIMIT_RSS_MIB || elapsedMs > LIMIT_MS) {
      record({ kind: 'limit', completedYear, limit: rssMiB > LIMIT_RSS_MIB ? 'rss' : 'time',
        rssMiB, elapsedMs });
      process.exitCode = 2;
      stoppedAtLimit = true;
      break;
    }
    if (alive.length === 0 && year < maxYear) {
      record({ kind: 'extinction', completedYear });
      for (const target of [50, 100, 200]) {
        if (target <= year || target > maxYear) continue;
        await runtime.advanceTo(target * YEAR);
        const later = runtime.snapshot();
        record({ kind: 'extinct-checkpoint', year: target,
          alive: Object.values(later.agents).filter(agent => agent.life.alive).length,
          births: later.population.births, deaths: later.population.deaths,
          rssMiB: Math.round(process.memoryUsage().rss / 1048576) });
      }
      break;
    }
  }
  if (!stoppedAtLimit) record({ kind: 'complete', completedYear,
    elapsedMs: Math.round(performance.now() - started),
    rssMiB: Math.round(process.memoryUsage().rss / 1048576) });
} catch (error) {
  record({ kind: 'error', completedYear, elapsedMs: Math.round(performance.now() - started),
    message: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack?.slice(0, 1800) : undefined });
  process.exitCode = 1;
}
