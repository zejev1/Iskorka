import type { WorldTimeExecution } from '../world/WorldTimeExecution';
import { LiveAccelerationBudget, MAX_LIVE_PENDING_MINUTES } from './LiveAccelerationBudget';
import { worldStorageDiagnostics } from '../persistence/WorldSaveSafety';
import type { WorldMetrics } from '../sensors/types';
import { IndependentWorldClockGateway, type WorldClockControl } from '../boundary/WorldClockGateway';
import { WorldSensors } from '../sensors/WorldSensors';
import { InMemoryWorldStore } from '../world/InMemoryWorldStore';
import { WorldEngine } from '../world/WorldEngine';
import { ISKORKA_PROFILE, ISKORKA_FOUNDER_NAMES, assertHumanLab } from '../world/HumanLabProfile';
import { demographyByRace } from '../world/DemographyByRace';
import type { WorldEvent } from '../world/events';
import type { WorldStore } from '../world/persistence';
import type { WorldDisturbanceKind, WorldState } from '../world/types';
import type { WorldSpeedId, WorldSpeedMultiplier } from '../world/WorldClock';
import { CANONICAL_WORLD_QUANTUM_MINUTES, WORLD_MINUTES_PER_YEAR } from '../v15/WorldTimeContract';

export const OFFLINE_CATCH_UP_DEFAULT_BATCH_QUANTA = 24;
export const OFFLINE_CATCH_UP_MAX_BATCH_QUANTA = 120;
const WORLD_TIME_EPSILON = 1e-7;
const DEFAULT_LIVE_FOUNDER_NAMES = ISKORKA_FOUNDER_NAMES;
export interface LiveWorldDisturbance {
  tick: number;
  kind: WorldDisturbanceKind;
  magnitude: number;
  duration?: number;
  operationId?: string;
}

export interface RecurringLiveWorldDisturbance {
  firstTick: number;
  interval: number;
  kind: WorldDisturbanceKind;
  magnitude: number;
  duration?: number;
}

export interface LiveWorldRuntimeOptions {
  seed: string;
  worldId?: string;
  disturbances?: readonly LiveWorldDisturbance[];
  recurringDisturbances?: readonly RecurringLiveWorldDisturbance[];
  store?: WorldStore;
  durable?: boolean;
  boundedLiveAcceleration?: boolean;
  worldSpeedId?: WorldSpeedId;
  worldSpeedMultiplier?: WorldSpeedMultiplier;
}
export interface LiveWorldContinuity {
  durable: boolean;
  resumed: boolean;
  resumedFromTick: number;
  resumedFromWorldMinutes: number;
}

export interface LiveWorldFrame {
  liveTiming?: { pendingWorldMinutes: number; actualWorldMinutesPerRealMinute?: number; capacityLimited?: boolean };
  tick: number;
  world: WorldState;
  metrics: WorldMetrics;
  disturbances: LiveWorldDisturbance[];
  clock: WorldClockControl;
  recentEvents: WorldEvent[];
  continuity: LiveWorldContinuity;
}
export interface OfflineCatchUpBatchResult {
  worldEpoch: number;
  fromWorldMinutes: number;
  currentWorldMinutes: number;
  targetWorldMinutes: number;
  processedWorldMinutes: number;
  semanticQuantaProcessed: number;
  populationChanged: boolean;
  completed: boolean;
}

/** The physical world owns its life. This runtime schedules time and reads display data only. */
export class LiveWorldRuntime {
  private currentTechnicalTick: number;
  private responsiveQuanta = 4;
  private execution?: WorldTimeExecution;
  private readonly liveBudget: LiveAccelerationBudget;
  private liveMeasuredMilliseconds = 0;
  private liveMeasuredWorldMinutes = 0;

  setCooperativeExecution(execution: WorldTimeExecution): void { this.execution = execution; }

  private constructor(
    private readonly disturbances: readonly LiveWorldDisturbance[],
    private readonly recurringDisturbances: readonly RecurringLiveWorldDisturbance[],
    private readonly store: WorldStore,
    private readonly world: WorldEngine,
    private readonly sensors: WorldSensors,
    private readonly clockGateway: IndependentWorldClockGateway,
    private readonly continuity: LiveWorldContinuity,
    boundedLiveAcceleration = false,
  ) {
    this.liveBudget = new LiveAccelerationBudget(boundedLiveAcceleration ? MAX_LIVE_PENDING_MINUTES : Infinity);
    this.currentTechnicalTick = world.runtimeStateView().now;
  }

  static async create(options: LiveWorldRuntimeOptions): Promise<LiveWorldRuntime> {
    const worldId = options.worldId ?? 'ainkrad_live_world';
    const store = options.store ?? new InMemoryWorldStore();
    const existing = await store.loadWorld(worldId);
    // Never replace a failed read or an incompatible save with a fresh world.
    if (existing !== undefined) assertHumanLab(existing);
    const world = existing !== undefined
      ? await WorldEngine.open({ worldId, store })
      : await WorldEngine.create({ worldId, seed: options.seed, store,
          profile: ISKORKA_PROFILE, agentNames: [...DEFAULT_LIVE_FOUNDER_NAMES], startTime: 0 });
    assertHumanLab(world.runtimeStateView());
    return new LiveWorldRuntime(options.disturbances ?? [], options.recurringDisturbances ?? [],
      store, world, new WorldSensors(store),
      new IndependentWorldClockGateway(options.worldSpeedId, options.worldSpeedMultiplier),
      { durable: options.durable ?? false, resumed: existing !== undefined,
        resumedFromTick: existing?.now ?? 0, resumedFromWorldMinutes: existing?.calendar.elapsedWorldMinutes ?? 0 },
      options.boundedLiveAcceleration);
  }

  async synchronize(): Promise<void> {
    await this.world.reload();
    assertHumanLab(this.world.runtimeStateView());
    this.currentTechnicalTick = Math.max(this.currentTechnicalTick, this.world.runtimeStateView().now);
  }

  setWorldSpeed(speedId: unknown, multiplier: unknown): WorldClockControl {
    const clock = this.clockGateway.set(speedId, multiplier);
    this.liveMeasuredMilliseconds = 0;
    this.liveMeasuredWorldMinutes = 0;
    return clock;
  }

  storageDiagnostics(origin: string): string {
    return worldStorageDiagnostics(this.world.runtimeStateView(), origin);
  }

  worldSnapshot(): WorldState {
    return this.world.snapshot();
  }

  worldContinuityPosition(): {
    worldEpoch: number;
    elapsedWorldMinutes: number;
  } {
    const world = this.world.runtimeStateView();
    return {
      worldEpoch: world.epoch ?? 1,
      elapsedWorldMinutes: world.calendar.elapsedWorldMinutes,
    };
  }

  worldDiagnosticSummary(): {
    elapsedWorldMinutes: number;
    living: number;
    births: number;
    deaths: number;
    sapientBirths: number;
    sapientDeaths: number;
    relationships: number;
    places: number;
    settlements: number;
    revision: number;
  } {
    const world = this.world.runtimeStateView();
    const humans = demographyByRace(world).human;
    return {
      elapsedWorldMinutes: world.calendar.elapsedWorldMinutes,
      living: Object.values(world.agents).filter((agent) => agent.life.alive).length,
      births: humans.births,
      deaths: humans.deaths,
      sapientBirths: world.population.births,
      sapientDeaths: world.population.deaths,
      relationships: Object.keys(world.relationships).length,
      places: Object.keys(world.places).length,
      settlements: Object.keys(world.settlements).length,
      revision: world.revision,
    };
  }

  async resetWorld(seed = 'ainkrad-browser-world'): Promise<WorldState> {
    const current = this.world.snapshot();
    await this.world.resetEpoch(
      seed,
      DEFAULT_LIVE_FOUNDER_NAMES,
      `epoch-${(current.epoch ?? 1) + 1}`,
    );
    await this.synchronize();
    this.continuity.resumed = false;
    this.liveBudget.cancel(0);
    this.liveMeasuredMilliseconds = 0;
    this.liveMeasuredWorldMinutes = 0;
    this.continuity.resumedFromTick = this.world.snapshot().now;
    this.continuity.resumedFromWorldMinutes = 0;
    return this.world.snapshot();
  }

  /** Bounded work; UI snapshots are requested separately at display cadence. */
  async responsiveTick(realMilliseconds: number): Promise<LiveWorldFrame> {
    return (await this.advanceResponsive(realMilliseconds, true))!;
  }

  liveTiming(): { pendingWorldMinutes: number; actualWorldMinutesPerRealMinute?: number; capacityLimited?: boolean } {
    return {
      pendingWorldMinutes: this.liveBudget.pending,
      capacityLimited: this.liveBudget.limited,
      ...(this.liveMeasuredMilliseconds > 0 ? {
        actualWorldMinutesPerRealMinute: this.liveMeasuredWorldMinutes * 60_000 / this.liveMeasuredMilliseconds,
      } : {}),
    };
  }

  enqueueLiveElapsed(realMilliseconds: number): void {
    if (!Number.isFinite(realMilliseconds) || realMilliseconds < 0) {
      throw new Error('Live elapsed milliseconds must be finite and non-negative.');
    }
    this.liveBudget.enqueue(this.clockGateway.current().worldMinutesPerTick * realMilliseconds / 1000);
    if (this.liveMeasuredMilliseconds >= 10_000) {
      this.liveMeasuredMilliseconds = 0;
      this.liveMeasuredWorldMinutes = 0;
    }
    this.liveMeasuredMilliseconds += realMilliseconds;
  }

  coverLiveTimeThrough(targetWorldMinutes: number, worldEpoch = this.world.runtimeStateView().epoch ?? 1): void {
    const world = this.world.runtimeStateView();
    if (worldEpoch !== (world.epoch ?? 1)) return;
    this.liveBudget.cover(targetWorldMinutes, world.calendar.elapsedWorldMinutes);
  }

  /** Drop only uncomputed external requests; committed life and RNG are untouched. */
  discardPendingLiveTime(): void {
    this.liveBudget.cancel(this.world.runtimeStateView().calendar.elapsedWorldMinutes);
    this.liveMeasuredMilliseconds = 0;
    this.liveMeasuredWorldMinutes = 0;
  }

  async advanceResponsive(realMilliseconds: number, emitFrame = false): Promise<LiveWorldFrame | undefined> {
    this.enqueueLiveElapsed(realMilliseconds);
    const minutes = Math.min(this.liveBudget.pending, this.responsiveQuanta * CANONICAL_WORLD_QUANTUM_MINUTES);
    const before = this.world.runtimeStateView().calendar.elapsedWorldMinutes;
    const started = performance.now();
    const budgetToken = this.liveBudget.token;
    // Deduct only committed time, including recovery after a partially completed
    // call. A cancellation never rolls back a committed world interval.
    let frame: LiveWorldFrame | undefined;
    try {
      frame = await this.runTick(minutes, emitFrame);
    } finally {
      const processed = Math.max(0, this.world.runtimeStateView().calendar.elapsedWorldMinutes - before);
      // A visibility/catch-up message may arrive during an awaited commit.
      // Its transferred interval is no longer part of the live queue.
      this.liveBudget.consume(before, before + processed, budgetToken);
      this.liveMeasuredWorldMinutes += processed;
      const elapsed = performance.now() - started;
      if (processed > 0) this.responsiveQuanta = Math.max(4, Math.min(8,
        Math.ceil(processed / CANONICAL_WORLD_QUANTUM_MINUTES * 350 / Math.max(1, elapsed))));
    }
    if (frame) frame.liveTiming = this.liveTiming();
    return frame;
  }

  async tick(overrideWorldMinutes?: number): Promise<LiveWorldFrame> {
    return (await this.runTick(overrideWorldMinutes, true))!;
  }

  private async runTick(overrideWorldMinutes: number | undefined, emitFrame: boolean): Promise<LiveWorldFrame | undefined> {
    const budgetToken = this.liveBudget.token;
    const tick = Math.max(
      this.currentTechnicalTick + 1,
      this.world.runtimeStateView().now + 1,
    );
    const scheduledDisturbances = this.disturbances.filter(
      (disturbance) => disturbance.tick === tick,
    );
    const recurringDisturbances = this.recurringDisturbances
      .filter(
        (disturbance) =>
          Number.isInteger(disturbance.firstTick) &&
          Number.isInteger(disturbance.interval) &&
          disturbance.firstTick >= 1 &&
          disturbance.interval >= 1 &&
          tick >= disturbance.firstTick &&
          (tick - disturbance.firstTick) % disturbance.interval === 0,
      )
      .map(
        (disturbance): LiveWorldDisturbance => ({
          tick,
          kind: disturbance.kind,
          magnitude: disturbance.magnitude,
          duration: disturbance.duration,
          operationId: `live:recurring:${disturbance.kind}:${tick}`,
        }),
      );
    const dueDisturbances = [
      ...scheduledDisturbances,
      ...recurringDisturbances,
    ];

    for (let index = 0; index < dueDisturbances.length; index += 1) {
      const disturbance = dueDisturbances[index];
      await this.world.applyDisturbance(
        disturbance.kind,
        disturbance.magnitude,
        this.world.runtimeStateView().now,
        disturbance.duration ?? 8,
        disturbance.operationId ?? `live:${index}:${tick}`,
      );
    }

    const clock = this.clockGateway.current();
    const frameWorldMinutes =
      overrideWorldMinutes ?? clock.worldMinutesPerTick;
    if (!Number.isFinite(frameWorldMinutes) || frameWorldMinutes < 0) {
      throw new Error(
        'Live-world frame minutes must be finite and non-negative.',
      );
    }
    const target = this.world.runtimeStateView().calendar.elapsedWorldMinutes + frameWorldMinutes;
    while (this.world.runtimeStateView().calendar.elapsedWorldMinutes + WORLD_TIME_EPSILON < target) {
      const before = this.world.runtimeStateView();
      const clockState = before.v15?.simulationClock;
      const quantum = clockState?.quantumWorldMinutes ?? CANONICAL_WORLD_QUANTUM_MINUTES;
      const quanta = before.calendar.elapsedWorldMinutes < WORLD_MINUTES_PER_YEAR * 2 ? 1 : OFFLINE_CATCH_UP_DEFAULT_BATCH_QUANTA;
      const batchTarget = Math.min(target, before.calendar.elapsedWorldMinutes + quanta * quantum - (clockState?.pendingWorldMinutes ?? 0));
      await this.world.advanceCanonicalTimeTo(batchTarget, this.execution);
      if (this.execution?.shouldStop() || budgetToken !== this.liveBudget.token) break;
    }
    this.currentTechnicalTick = tick;
    if (!emitFrame) return undefined;
    const observation = await this.sensors.observe(this.world.runtimeStateView(), this.world.runtimeStateView().now);
    const recentEvents = await this.store.recent(this.world.runtimeStateView().id, 10, this.world.runtimeStateView().now);
    return structuredClone({ tick, world: this.world.runtimeStateView(), metrics: observation.metrics,
      disturbances: dueDisturbances, clock, recentEvents, continuity: this.continuity });
  }

  /** Bounded commits; all resident semantic quanta still execute in order. */
  async catchUpBatchTo(requestedTargetWorldMinutes: number, requestedMaxBatchQuanta = OFFLINE_CATCH_UP_DEFAULT_BATCH_QUANTA): Promise<OfflineCatchUpBatchResult> {
    if (!Number.isFinite(requestedTargetWorldMinutes) || requestedTargetWorldMinutes < 0) {
      throw new Error('Offline catch-up target must be finite and non-negative.');
    }
    if (!Number.isInteger(requestedMaxBatchQuanta) || requestedMaxBatchQuanta < 1) {
      throw new Error('Offline catch-up batch limit must be a positive integer.');
    }
    const before = this.world.runtimeStateView();
    const fromWorldMinutes = before.calendar.elapsedWorldMinutes;
    const targetWorldMinutes = Math.max(fromWorldMinutes, requestedTargetWorldMinutes);
    const quantum = before.v15?.simulationClock.quantumWorldMinutes ?? CANONICAL_WORLD_QUANTUM_MINUTES;
    const quantumIndex = before.v15?.simulationClock.quantumIndex ?? before.now;
    const maxQuanta = Math.min(requestedMaxBatchQuanta, OFFLINE_CATCH_UP_MAX_BATCH_QUANTA);
    const quanta = fromWorldMinutes < quantum * 3 ? 1 : maxQuanta;
    if (targetWorldMinutes > fromWorldMinutes + WORLD_TIME_EPSILON) {
      const batchTarget = Math.min(targetWorldMinutes, fromWorldMinutes + quanta * quantum - (before.v15?.simulationClock.pendingWorldMinutes ?? 0));
      await this.world.advanceCanonicalTimeTo(batchTarget, this.execution);
    }
    const after = this.world.runtimeStateView();
    this.currentTechnicalTick = Math.max(this.currentTechnicalTick, after.now);
    return { worldEpoch: after.epoch ?? 1, fromWorldMinutes, targetWorldMinutes,
      currentWorldMinutes: after.calendar.elapsedWorldMinutes,
      processedWorldMinutes: after.calendar.elapsedWorldMinutes - fromWorldMinutes,
      semanticQuantaProcessed: Math.max(0, (after.v15?.simulationClock.quantumIndex ?? after.now) - quantumIndex),
      populationChanged: after.population.births !== before.population.births || after.population.deaths !== before.population.deaths,
      completed: after.calendar.elapsedWorldMinutes + WORLD_TIME_EPSILON >= targetWorldMinutes };
  }
}
