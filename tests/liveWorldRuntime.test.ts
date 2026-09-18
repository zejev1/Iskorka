import { describe, expect, it } from 'vitest';
import { InMemoryAppendOnlyLog } from '../src/persistence/AppendOnlyLog';
import { LiveWorldRuntime } from '../src/runtime/LiveWorldRuntime';
import { InMemoryWorldStore } from '../src/world/InMemoryWorldStore';

describe('Live world continuity', () => {
  it('does not show stale resume metadata after a new epoch starts', async () => {
    const runtime = await LiveWorldRuntime.create({
      mode: 'observer',
      seed: 'reset-continuity',
      worldId: 'reset-continuity',
      store: new InMemoryWorldStore(),
      controlLog: new InMemoryAppendOnlyLog(),
      durable: true,
      worldSpeedId: 'hour_per_minute',
    });
    await runtime.tick();
    await runtime.resetWorld();
    const resetFrame = await runtime.tick();

    expect(resetFrame.world.calendar.elapsedWorldMinutes).toBe(1);
    expect(resetFrame.continuity.resumed).toBe(false);
    expect(resetFrame.continuity.resumedFromWorldMinutes).toBe(0);
    expect(
      Object.values(resetFrame.world.agents).every(
        (agent) => !agent.lastAction && !agent.lastDecision && !agent.movement,
      ),
    ).toBe(true);
  });

  it('reopens the committed Iskorka world instead of starting over', async () => {
    const store = new InMemoryWorldStore();
    const controlLog = new InMemoryAppendOnlyLog();
    const options = {
      mode: 'observer' as const,
      seed: 'browser-continuity-seed',
      worldId: 'browser-continuity',
      store,
      controlLog,
      durable: true,
    };

    const firstRuntime = await LiveWorldRuntime.create(options);
    const first = await firstRuntime.tick();
    const second = await firstRuntime.tick();

    expect(first.continuity).toEqual({
      durable: true,
      resumed: false,
      resumedFromTick: 0,
      resumedFromWorldMinutes: 0,
    });
    expect(second.tick).toBe(2);
    expect(second.world.calendar.elapsedWorldMinutes).toBe(
      first.world.calendar.elapsedWorldMinutes + second.clock.worldMinutesPerTick,
    );

    const reopenedRuntime = await LiveWorldRuntime.create(options);
    const resumed = await reopenedRuntime.tick();

    expect(resumed.tick).toBe(3);
    expect(resumed.world.now).toBe(3);
    expect(resumed.world.calendar.elapsedWorldMinutes).toBeGreaterThan(
      second.world.calendar.elapsedWorldMinutes,
    );
    expect(resumed.continuity).toEqual({
      durable: true,
      resumed: true,
      resumedFromTick: 2,
      resumedFromWorldMinutes: second.world.calendar.elapsedWorldMinutes,
    });
    expect(resumed).not.toHaveProperty('evaluation');
    expect(resumed.recentEvents.length).toBeGreaterThan(0);
  });
});

describe('Physical semantic speed equivalence', () => {
  it('produces the identical physical world at supported ×1 and ×10 for equal world time', async () => {
    async function runAtSpeed(
      worldSpeedMultiplier: 1 | 10 | 100,
      workerTicks: number,
    ) {
      const runtime = await LiveWorldRuntime.create({
        mode: 'observer',
        seed: 'cardinal-world-time-speed-equivalence',
        worldId: 'cardinal-world-time-speed-equivalence',
        store: new InMemoryWorldStore(),
        controlLog: new InMemoryAppendOnlyLog(),
        worldSpeedId: 'year_per_minute',
        worldSpeedMultiplier,
      });
      let frame = await runtime.tick();
      for (let workerTick = 1; workerTick < workerTicks; workerTick += 1) {
        frame = await runtime.tick();
      }
      return {
        world: frame.world,

      };
    }

    const atOne = await runAtSpeed(1, 100);
    const atTen = await runAtSpeed(10, 10);

    expect(atOne.world.calendar.elapsedWorldMinutes).toBe(876_000);
    expect(atTen.world).toEqual(atOne.world);
  }, 60_000);
});
