import test from 'node:test';
import assert from 'node:assert/strict';
import { IskorkaRuntime } from '../../src/iskorka/WorldRuntime';
import { InMemoryWorldStore } from '../../src/world/InMemoryWorldStore';
import { perceptBatchForAgentV1, rotatingPerceptionSampleV1 } from '../../src/iskorka/PerceptionAdapterV1';

test('1,000 co-located Sparks get bounded rotating perception with eventual full coverage', async () => {
  const runtime = await IskorkaRuntime.openOrCreate(
    new InMemoryWorldStore(),
    'perception-scale-seed',
    'perception-scale-world',
  );
  const world = runtime.snapshot();
  const observer = world.agents.agent_1;
  const template = Object.values(world.agents)[1];
  const localResidents = Array.from({ length: 1_000 }, (_, index) => ({
    ...structuredClone(template),
    id: `scale_spark_${index}`,
    position: { ...observer.position },
    locationId: observer.locationId,
    movement: undefined,
  }));

  const observedIds = new Set<string>();
  const first = rotatingPerceptionSampleV1(localResidents, observer.id, 0);
  assert.equal(first.length, 24);
  for (let review = 0; review < 125; review += 1) {
    const sample = rotatingPerceptionSampleV1(
      localResidents,
      observer.id,
      review * 240,
    );
    assert.ok(sample.length <= 24);
    for (const spark of sample) observedIds.add(spark.id);

    const percept = perceptBatchForAgentV1(world, observer.id, {
      localAgents: sample,
      localRemains: [],
    });
    assert.ok(
      percept.localObservations.filter((item) => item.kind === 'person').length <= 24,
    );
  }
  assert.equal(observedIds.size, 1_000);
});
