import { WorldEngine } from '../world/WorldEngine';
import type { WorldStore } from '../world/persistence';
import type { WorldTimeExecution } from '../world/WorldTimeExecution';
import { ISKORKA_PROFILE, ISKORKA_FOUNDERS, assertIskorkaProfile, isIskorka } from '../world/WorldProfile';

export const ISKORKA_WORLD_ID = 'iskorka-human-world';
export const ISKORKA_DATABASE = 'iskorka-physical-world-v1';

/** Owns physics and persistence only. No observer, gateway, agent supervisor or OFF-mode controller. */
export class IskorkaRuntime {
  private constructor(readonly engine: WorldEngine, readonly store: WorldStore, readonly resumed: boolean) {}
  static async open(store: WorldStore, seed: string, worldId = ISKORKA_WORLD_ID): Promise<IskorkaRuntime> {
    const saved = await store.loadWorld(worldId);
    if (saved && !isIskorka(saved)) throw new Error('Это сохранение другого мира. Автоматическая конвертация запрещена.');
    if (saved) assertIskorkaProfile(saved);
    const engine = saved
      ? await WorldEngine.open({ store, worldId })
      : await WorldEngine.create({ store, worldId, seed, profile: ISKORKA_PROFILE });
    assertIskorkaProfile(engine.runtimeStateView());
    return new IskorkaRuntime(engine, store, Boolean(saved));
  }
  async advanceTo(target: number, execution?: WorldTimeExecution): Promise<void> {
    await this.engine.advanceCanonicalTimeTo(target, execution);
    assertIskorkaProfile(this.engine.runtimeStateView());
  }
  async checkpoint(): Promise<void> {
    const world = this.engine.runtimeStateView();
    await this.store.checkpointWorld?.(world.id, world.revision, 'iskorka-user-save');
  }
  async reset(seed: string, operationId: string): Promise<void> {
    await this.checkpoint();
    await this.engine.resetEpoch(seed, ISKORKA_FOUNDERS, operationId);
    assertIskorkaProfile(this.engine.runtimeStateView());
  }
  async frame() {
    const world = this.engine.snapshot();
    return { world, recentEvents: await this.store.recent(world.id, 40), resumed: this.resumed };
  }
}
