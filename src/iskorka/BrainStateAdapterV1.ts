import { stableJsonStringify } from '../core/stableJson';
import type { AgentState, WorldState } from '../world/types';
import {
  assertBrainStateV1,
  createBrainStateV1,
  logicalBrainBytesV1,
  tryStoreBrainDatumV1,
  type BrainBudgetSectionV1,
  type BrainStateV1,
} from './BrainStateV1';

export const WORLD_BRAIN_REGISTRY_VERSION_V1 = 'iskorka-brain-registry-v1' as const;

export interface RetiredBrainOwnerV1 {
  ownerGeneration: number;
  diedWorldMinute: number;
}

export interface WorldBrainRegistryV1 {
  version: typeof WORLD_BRAIN_REGISTRY_VERSION_V1;
  brainsByAgentId: Record<string, BrainStateV1>;
  retiredOwnersByAgentId: Record<string, RetiredBrainOwnerV1>;
}

function storeLegacy(
  brain: BrainStateV1,
  id: string,
  section: BrainBudgetSectionV1,
  kind: string,
  value: unknown,
): void {
  if (value === undefined) return;
  const encoded = stableJsonStringify(value);
  if (encoded === '{}' || encoded === '[]' || encoded === 'null') return;
  const stored = tryStoreBrainDatumV1(brain, {
    id,
    section,
    kind,
    source: 'unknown_legacy',
    encoded,
  });
  if (!stored) {
    throw new Error(
      `Legacy personal state for ${brain.ownerAgentId} does not fit the 256 KiB BrainState budget.`,
    );
  }
}

function importLegacyOwnedStateV1(
  world: Readonly<WorldState>,
  agent: Readonly<AgentState>,
  brain: BrainStateV1,
): void {
  if (brain.migration.importedLegacy) return;

  storeLegacy(brain, 'legacy:mind', 'identity', 'legacy_mind', {
    values: agent.mind.values,
    beliefs: agent.mind.beliefs,
    needs: agent.needs,
  });
  storeLegacy(brain, 'legacy:skills', 'identity', 'legacy_skill_levels', agent.skills);
  storeLegacy(brain, 'legacy:learning', 'significant', 'legacy_learning', agent.learning);
  storeLegacy(brain, 'legacy:map', 'knowledge', 'legacy_private_map', {
    knownPlaceIds: agent.knownPlaceIds,
    knownDungeonIds: agent.knownDungeonIds,
    cartography: agent.cartography,
  });
  storeLegacy(
    brain,
    'legacy:v15-knowledge',
    'knowledge',
    'legacy_v15_knowledge',
    world.v15?.knowledgeByAgentId[agent.id],
  );
  storeLegacy(
    brain,
    'legacy:v18-language',
    'knowledge',
    'legacy_language',
    world.v18?.languageByAgentId[agent.id],
  );
  storeLegacy(
    brain,
    'legacy:v18-livelihood',
    'identity',
    'legacy_livelihood',
    world.v18?.livelihoodByAgentId[agent.id],
  );
  storeLegacy(
    brain,
    'legacy:v18-secret-library',
    'knowledge',
    'legacy_read_knowledge',
    world.v18?.secretLibrary.knowledgeByAgentId[agent.id],
  );
  storeLegacy(
    brain,
    'legacy:v19-divine',
    'significant',
    'legacy_personal_divine_state',
    world.v19?.divineAgency.byAgentId[agent.id],
  );
  storeLegacy(
    brain,
    'legacy:v21-applied-knowledge',
    'knowledge',
    'legacy_applied_knowledge',
    world.v21?.appliedKnowledgeByAgentId[agent.id],
  );

  brain.migration.importedLegacy = true;
  brain.migration.importedAtWorldMinute = world.calendar.elapsedWorldMinutes;
  brain.migration.sourceWorldRevision = world.revision;
  brain.migration.importedDatumIds = brain.data.map((datum) => datum.id);
  assertBrainStateV1(brain);
}

export function createWorldBrainRegistryV1(): WorldBrainRegistryV1 {
  return {
    version: WORLD_BRAIN_REGISTRY_VERSION_V1,
    brainsByAgentId: {},
    retiredOwnersByAgentId: {},
  };
}

export function ensureBrainForAgentV1(
  world: WorldState,
  agent: AgentState,
  options: { importLegacy?: boolean } = {},
): BrainStateV1 | undefined {
  if (!agent.life.alive || (agent.race ?? 'human') !== 'human') return undefined;
  const registry = world.iskorkaBrainV1 ??= createWorldBrainRegistryV1();
  if (registry.retiredOwnersByAgentId[agent.id]) {
    throw new Error(`Retired brain owner ID ${agent.id} cannot be reused.`);
  }
  const existing = registry.brainsByAgentId[agent.id];
  const brain = existing ?? createBrainStateV1(
    agent.id,
    agent.life.generation,
    world.determinism.rngState,
    world.calendar.elapsedWorldMinutes,
  );
  if (
    brain.ownerAgentId !== agent.id ||
    brain.ownerGeneration !== agent.life.generation
  ) {
    throw new Error(`Brain ownership mismatch for ${agent.id}.`);
  }
  if (options.importLegacy !== false) {
    importLegacyOwnedStateV1(world, agent, brain);
  }
  assertBrainStateV1(brain);
  registry.brainsByAgentId[agent.id] = brain;
  return brain;
}

export function ensureWorldBrainRegistryV1(world: WorldState): WorldBrainRegistryV1 {
  const registry = world.iskorkaBrainV1 ??= createWorldBrainRegistryV1();
  if (registry.version !== WORLD_BRAIN_REGISTRY_VERSION_V1) {
    throw new Error('Unsupported Iskorka brain registry version.');
  }
  for (const agent of Object.values(world.agents)) {
    if ((agent.race ?? 'human') !== 'human') continue;
    if (agent.life.alive) {
      ensureBrainForAgentV1(world, agent);
    } else {
      retireBrainOwnerV1(world, agent, agent.life.diedAt ?? world.calendar.elapsedWorldMinutes);
    }
  }
  assertWorldBrainRegistryV1(world);
  return registry;
}

function neutralizeLegacyAgentMindV1(agent: AgentState): void {
  delete agent.learning;
  delete agent.cartography;
  delete agent.knownPlaceIds;
  delete agent.knownDungeonIds;
  delete agent.progression;
  delete agent.privateDivineCalling;
  delete agent.agencyCadence;
  delete agent.lastDecision;
  delete agent.plan;

  agent.energy = 0;
  agent.stress = 0;
  agent.socialDrive = 0;
  agent.personality = {
    sociability: 0,
    diligence: 0,
    curiosity: 0,
    generosity: 0,
    resilience: 0,
    riskTolerance: 0,
  };
  agent.needs = { belonging: 0, purpose: 0 };
  agent.skills = {
    gathering: 0,
    hunting: 0,
    craft: 0,
    social: 0,
    exploration: 0,
  };
  agent.goal = { kind: 'recover', strength: 0, since: agent.life.diedAt ?? 0 };
  agent.mind = {
    identityId: `retired:${agent.id}:${agent.life.generation}`,
    continuity: 0,
    autonomy: 0,
    memoryCoherence: 0,
    emotions: { joy: 0, fear: 0, grief: 0, awe: 0, hope: 0 },
    values: { care: 0, freedom: 0, knowledge: 0, tradition: 0, ambition: 0 },
    beliefs: { worldTrust: 0, divinePresence: 0, fate: 0, afterlife: 0 },
  };
}

export function purgeLegacyOwnedStateV1(world: WorldState, agentId: string): void {
  const agent = world.agents[agentId];
  if (!agent) return;
  neutralizeLegacyAgentMindV1(agent);

  if (world.v15) {
    delete world.v15.knowledgeByAgentId[agentId];
    delete world.v15.familyAgencyByAgentId[agentId];
    delete world.v15.smithingByAgentId[agentId];
    if (world.v15.founderSmithAgentId === agentId) delete world.v15.founderSmithAgentId;
  }
  if (world.v16) {
    delete world.v16.residentEvidenceByAgentId[agentId];
    for (const [pairId, lifecycle] of Object.entries(world.v16.familyLifecycleByPairId)) {
      if (lifecycle.agentAId === agentId || lifecycle.agentBId === agentId) {
        delete world.v16.familyLifecycleByPairId[pairId];
      }
    }
  }
  if (world.v18) {
    delete world.v18.languageByAgentId[agentId];
    delete world.v18.livelihoodByAgentId[agentId];
    delete world.v18.lifeRhythmByAgentId[agentId];
    const removedKnowledge = world.v18.secretLibrary.knowledgeByAgentId[agentId]?.length ?? 0;
    delete world.v18.secretLibrary.knowledgeByAgentId[agentId];
    world.v18.secretLibrary.totalKnowledgeRecords = Math.max(
      0,
      world.v18.secretLibrary.totalKnowledgeRecords - removedKnowledge,
    );
  }
  if (world.v19) {
    delete world.v19.divineAgency.byAgentId[agentId];
    delete world.v19.adventureEconomy.adventurersByAgentId[agentId];
    delete world.v19.adventureEconomy.emergentSociety.residentsByAgentId[agentId];
  }
  if (world.v21) {
    delete world.v21.appliedKnowledgeByAgentId[agentId];
  }
}

export function retireBrainOwnerV1(
  world: WorldState,
  agent: AgentState,
  diedWorldMinute: number,
): void {
  const registry = world.iskorkaBrainV1 ??= createWorldBrainRegistryV1();
  delete registry.brainsByAgentId[agent.id];
  const prior = registry.retiredOwnersByAgentId[agent.id];
  if (prior && prior.ownerGeneration !== agent.life.generation) {
    throw new Error(`Retired owner generation mismatch for ${agent.id}.`);
  }
  registry.retiredOwnersByAgentId[agent.id] = {
    ownerGeneration: agent.life.generation,
    diedWorldMinute: prior?.diedWorldMinute ?? diedWorldMinute,
  };
  purgeLegacyOwnedStateV1(world, agent.id);
}

export function brainForLiveOwnerV1(
  world: Readonly<WorldState>,
  agentId: string,
  ownerGeneration: number,
): BrainStateV1 | undefined {
  const agent = world.agents[agentId];
  const registry = world.iskorkaBrainV1;
  if (!agent?.life.alive || !registry || registry.retiredOwnersByAgentId[agentId]) return undefined;
  const brain = registry.brainsByAgentId[agentId];
  if (!brain || brain.ownerGeneration !== ownerGeneration) return undefined;
  return brain;
}

export function assertWorldBrainRegistryV1(world: Readonly<WorldState>): void {
  const registry = world.iskorkaBrainV1;
  if (!registry) return;
  if (registry.version !== WORLD_BRAIN_REGISTRY_VERSION_V1) {
    throw new Error('Invalid Iskorka brain registry version.');
  }
  for (const [agentId, brain] of Object.entries(registry.brainsByAgentId)) {
    const agent = world.agents[agentId];
    if (!agent?.life.alive || (agent.race ?? 'human') !== 'human') {
      throw new Error(`Brain ${agentId} has no living human owner.`);
    }
    if (registry.retiredOwnersByAgentId[agentId]) {
      throw new Error(`Brain ${agentId} exists after owner retirement.`);
    }
    if (brain.ownerAgentId !== agentId || brain.ownerGeneration !== agent.life.generation) {
      throw new Error(`Brain ${agentId} ownership mismatch.`);
    }
    assertBrainStateV1(brain);
  }
  for (const [agentId, retired] of Object.entries(registry.retiredOwnersByAgentId)) {
    if (registry.brainsByAgentId[agentId]) throw new Error(`Retired brain ${agentId} still exists.`);
    if (!Number.isInteger(retired.ownerGeneration) || retired.ownerGeneration < 0) {
      throw new Error(`Retired brain ${agentId} generation is invalid.`);
    }
  }
}

export function totalLogicalBrainBytesV1(world: Readonly<WorldState>): number {
  return Object.values(world.iskorkaBrainV1?.brainsByAgentId ?? {})
    .reduce((sum, brain) => sum + logicalBrainBytesV1(brain), 0);
}
