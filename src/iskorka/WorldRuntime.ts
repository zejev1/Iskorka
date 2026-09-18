import { WorldEngine } from '../world/WorldEngine';
import type { WorldStore } from '../world/persistence';
import type { WorldState } from '../world/types';
import type { WorldTimeExecution } from '../world/WorldTimeExecution';
import { ISKORKA_FOUNDER_NAMES, ISKORKA_WORLD_ID, assertIskorkaProfile } from './Profile';

/** The laboratory owns only a physical world and its persistence, never a supervisor. */
export class IskorkaRuntime {
  private constructor(private readonly world: WorldEngine) {}

  static async openOrCreate(store: WorldStore, seed: string, worldId = ISKORKA_WORLD_ID): Promise<IskorkaRuntime> {
    const existing = await store.loadWorld(worldId);
    if (existing) assertIskorkaProfile(existing);
    const world = existing
      ? await WorldEngine.open({ worldId, store })
      : await WorldEngine.create({ worldId, seed, store, agentNames: [...ISKORKA_FOUNDER_NAMES] });
    assertIskorkaProfile(world.runtimeStateView(), !existing);
    return new IskorkaRuntime(world);
  }

  get elapsedMinutes(): number { return this.world.runtimeStateView().calendar.elapsedWorldMinutes; }
  get quantumMinutes(): number { return this.world.runtimeStateView().v15!.simulationClock.quantumWorldMinutes; }
  snapshot(): WorldState { return this.world.snapshot(); }

  async advanceTo(minutes: number, execution?: WorldTimeExecution): Promise<void> {
    if (!Number.isFinite(minutes) || minutes < this.elapsedMinutes) throw new Error('Некорректная цель времени.');
    if (minutes === this.elapsedMinutes) return;
    await this.world.advanceCanonicalTimeTo(minutes, execution);
    assertIskorkaProfile(this.world.runtimeStateView());
  }

  async reset(seed: string, operationId: string): Promise<void> {
    if (!seed.trim() || seed.length > 128) throw new Error('Неверный ключ нового мира.');
    await this.world.resetEpoch(seed, ISKORKA_FOUNDER_NAMES, operationId);
    assertIskorkaProfile(this.world.runtimeStateView(), true);
  }
}
