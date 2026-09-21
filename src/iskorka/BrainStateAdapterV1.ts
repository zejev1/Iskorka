import { stableJsonStringify } from '../core/stableJson';
import type { AgentState, MemoryRecord, WorldState } from '../world/types';
import {
  assertBrainStateV1,
  createBrainStateV1,
  invalidateBrainLogicalByteCacheV1,
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
  invalidateBrainLogicalByteCacheV1(brain);
  assertBrainStateV1(brain);
}

const SYNCHRONIZED_LEGACY_DATUM_IDS_V1 = new Set([
  'legacy:mind',
  'legacy:skills',
  'legacy:learning',
  'legacy:map',
  'legacy:v15-knowledge',
  'legacy:v18-language',
  'legacy:v18-livelihood',
  'legacy:v18-secret-library',
  'legacy:v19-divine',
  'legacy:v21-applied-knowledge',
  'legacy:runtime-owned-state',
]);

function makeLegacyDatumV1(
  id: string,
  section: BrainBudgetSectionV1,
  kind: string,
  value: unknown,
): import('./BrainStateV1').BrainDatumV1 | undefined {
  if (value === undefined) return undefined;
  const encoded = stableJsonStringify(value);
  if (encoded === '{}' || encoded === '[]' || encoded === 'null') return undefined;
  return {
    id,
    section,
    kind,
    source: 'unknown_legacy',
    encoded,
  };
}

/**
 * Stage-2 compatibility bridge. The old runtime still reads its established
 * fields, but their current acquired content is mirrored into the finite
 * BrainState before every commit and therefore counted against the same cap.
 * Later brain stages replace these mirrors with native structures.
 */
export function synchronizeLegacyOwnedStateV1(
  world: Readonly<WorldState>,
  agent: Readonly<AgentState>,
  brain: BrainStateV1,
): void {
  invalidateBrainLogicalByteCacheV1(brain);
  const retained = brain.data.filter(
    (datum) => !SYNCHRONIZED_LEGACY_DATUM_IDS_V1.has(datum.id),
  );

  // One canonical envelope is materially cheaper than serializing ten small
  // mirrors separately on every world commit, while accounting for exactly
  // the same acquired legacy state under the same finite budget.
  const runtimeDatum = makeLegacyDatumV1(
    'legacy:runtime-owned-state',
    'knowledge',
    'legacy_runtime_owned_state',
    {
      mind: {
        values: agent.mind.values,
        beliefs: agent.mind.beliefs,
        needs: agent.needs,
      },
      skills: agent.skills,
      learning: agent.learning,
      privateMap: {
        knownPlaceIds: agent.knownPlaceIds,
        knownDungeonIds: agent.knownDungeonIds,
        cartography: agent.cartography,
      },
      v15Knowledge: world.v15?.knowledgeByAgentId[agent.id],
      language: world.v18?.languageByAgentId[agent.id],
      livelihood: world.v18?.livelihoodByAgentId[agent.id],
      readKnowledge: world.v18?.secretLibrary.knowledgeByAgentId[agent.id],
      divine: world.v19?.divineAgency.byAgentId[agent.id],
      appliedKnowledge: world.v21?.appliedKnowledgeByAgentId[agent.id],
    },
  );

  const next = runtimeDatum ? [runtimeDatum] : [];
  brain.data = [...retained, ...next];
  brain.rngState = world.determinism.rngState;
  brain.migration.importedLegacy = true;
  brain.migration.importedDatumIds = [
    ...new Set([
      ...brain.migration.importedDatumIds,
      ...next.map((datum) => datum.id),
    ]),
  ];
  invalidateBrainLogicalByteCacheV1(brain);
}

export function importLegacyPersistentMemoriesV1(
  brain: BrainStateV1,
  memories: readonly Readonly<MemoryRecord>[],
): void {
  const owned = memories
    .filter((memory) => memory.agentId === brain.ownerAgentId)
    .map((memory) => ({
      memoryId: memory.memoryId,
      createdAt: memory.createdAt,
      kind: memory.kind,
      summary: memory.summary,
      importance: memory.importance,
      valence: memory.valence,
      relatedAgentIds: [...memory.relatedAgentIds],
    }));
  if (owned.length === 0) return;

  const datumId = 'legacy:persistent-memory-store';
  storeLegacy(
    brain,
    datumId,
    'significant',
    'legacy_persistent_memories',
    owned,
  );
  if (!brain.migration.importedDatumIds.includes(datumId)) {
    brain.migration.importedDatumIds.push(datumId);
  }
  invalidateBrainLogicalByteCacheV1(brain);
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
  agent.progression = {
    level: 1,
    experience: 0,
    objectControlAuthority: 0,
    systemControlAuthority: 0,
    combatMastery: 0,
    sacredArts: 0,
  };
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
  const identityId = agent.mind.identityId;
  agent.mind = {
    // The stable identity key is a world record linking grave/kinship/history;
    // all recoverable personal mental content is cleared around it.
    identityId,
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
    const knowledge = world.v15.knowledgeByAgentId[agentId];
    if (knowledge) {
      // Aptitudes are innate learning tendencies, not remembered content.
      knowledge.agriculture = 0;
      knowledge.construction = 0;
      knowledge.household = 0;
      knowledge.survival = 0;
      knowledge.verifiedLearningSessions = 0;
      knowledge.verifiedPracticeSessions = 0;
      delete knowledge.lastLearningWorldMinute;
    }
    const family = world.v15.familyAgencyByAgentId[agentId];
    if (family) {
      family.physicalIntimacyInclination = 0;
      family.childDesire = 0;
      family.autonomy = 0;
    }
    const smithing = world.v15.smithingByAgentId[agentId];
    if (smithing) {
      smithing.knowledge.stoneToolmaking = 0;
      smithing.knowledge.primitiveSmithing = 0;
      smithing.knowledge.weaponcraft = 0;
      smithing.knowledge.heatWorking = 0;
      smithing.knowledge.materialKnowledge = 0;
      smithing.verifiedWorkshopSessions = 0;
      smithing.failedCraftAttempts = 0;
      smithing.successfulCraftAttempts = 0;
      smithing.observedWeaponProblems = 0;
      delete smithing.lastWorkshopWorldMinute;
    }
    // equipmentByAgentId, founderSmithAgentId and world evidence are public/
    // physical historical links. They do not reconstruct the dead person's brain.
  }
  if (world.v16) {
    // v16 resident evidence and family lifecycle are world-side historical/
    // causal records required by the current schema. They are intentionally
    // retained; none of them is a recoverable private mind.
  }
  if (world.v18) {
    const language = world.v18.languageByAgentId[agentId];
    if (language) {
      language.spokenComprehension = 0;
      language.spokenExpression = 0;
      language.vocabulary = 0;
      language.cyrillicLiteracy = 0;
      language.conversationCount = 0;
      language.teachingCount = 0;
      language.writtenRecordCount = 0;
      language.teacherIds = [];
      delete language.lastConversationWorldMinute;
      delete language.lastLiteracyPracticeWorldMinute;
    }
    const livelihood = world.v18.livelihoodByAgentId[agentId];
    if (livelihood) {
      livelihood.primary = 'undecided';
      livelihood.stage = 'observing';
      for (const key of Object.keys(livelihood.practiceByKind) as Array<keyof typeof livelihood.practiceByKind>) {
        livelihood.practiceByKind[key] = 0;
      }
      livelihood.totalPractice = 0;
      livelihood.mentorIds = [];
      livelihood.changeCount = 0;
      livelihood.mappedPlaceIds = [];
      livelihood.longJourneyCount = 0;
      livelihood.defensePracticeCount = 0;
      delete livelihood.chosenWorldMinute;
      delete livelihood.lastPracticedWorldMinute;
      delete livelihood.lastWorkplaceId;
      delete livelihood.explorationEvidence;
    }
    const rhythm = world.v18.lifeRhythmByAgentId[agentId];
    if (rhythm) {
      rhythm.satiety = 0;
      rhythm.mealsConsumed = 0;
      rhythm.missedMealQuanta = 0;
      rhythm.repeatedActionCount = 0;
      rhythm.productiveActionCount = 0;
      rhythm.outsideSettlementActionCount = 0;
      delete rhythm.lastAction;
      delete rhythm.lastMealWorldMinute;
      delete rhythm.lastProductiveWorldMinute;
      delete rhythm.lastOutsideSettlementWorldMinute;
      delete rhythm.pendingArrivalAction;
      delete rhythm.pendingArrivalPlaceId;
      delete rhythm.pendingArrivalWorldMinute;
    }
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

  for (const agent of Object.values(world.agents)) {
    if ((agent.race ?? 'human') !== 'human') continue;
    const brain = registry.brainsByAgentId[agent.id];
    const retired = registry.retiredOwnersByAgentId[agent.id];
    if (agent.life.alive) {
      if (!brain) throw new Error(`Living human ${agent.id} has no BrainState.`);
      if (retired) throw new Error(`Living human ${agent.id} is marked as retired.`);
      if (
        brain.ownerAgentId !== agent.id ||
        brain.ownerGeneration !== agent.life.generation
      ) {
        throw new Error(`Brain ${agent.id} ownership mismatch.`);
      }
    } else {
      if (brain) throw new Error(`Dead human ${agent.id} still has a BrainState.`);
      if (!retired) throw new Error(`Dead human ${agent.id} has no retirement tombstone.`);
      if (retired.ownerGeneration !== agent.life.generation) {
        throw new Error(`Retired owner generation mismatch for ${agent.id}.`);
      }
    }
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
    const agent = world.agents[agentId];
    if (!agent || (agent.race ?? 'human') !== 'human') {
      throw new Error(`Retired brain owner ${agentId} is not a human resident.`);
    }
  }
}

export function totalLogicalBrainBytesV1(world: Readonly<WorldState>): number {
  return Object.values(world.iskorkaBrainV1?.brainsByAgentId ?? {})
    .reduce((sum, brain) => sum + logicalBrainBytesV1(brain), 0);
}
