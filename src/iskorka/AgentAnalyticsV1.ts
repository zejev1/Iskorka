import type { AgentState, RelationshipState, WorldState } from '../world/types';
import { bodySignalsV1 } from './BodyCoreV1';
import { brainDevelopmentProfileV1 } from './BrainLifecycleV1';
import {
  BRAIN_LOGICAL_BUDGET_BYTES_V1,
  logicalBrainBytesV1,
  type BrainStateV1,
} from './BrainStateV1';
import { humanMotorDevelopmentV1 } from './HumanMotorDevelopmentV1';
import { humanVisionDevelopmentV1 } from './HumanVisionDevelopmentV1';
import { bodySleepStateV21 } from '../v21/BodySleepV21';

export interface AgentAnalyticsSnapshotV1 {
  agentId: string;
  worldMinute: number;
  worldRevision: number;
  identity: {
    name: string;
    sex?: string;
    ageYears: number;
    generation: number;
    alive: boolean;
    locationId: string;
    locationName: string;
    position: { x: number; y: number };
    currentAction?: string;
    movement?: Readonly<AgentState['movement']>;
  };
  life: {
    health: number;
    energy: number;
    stress: number;
    resources: number;
    socialDrive: number;
    needs: Readonly<AgentState['needs']>;
    physiology: Readonly<AgentState['life']['physiology']>;
    parentIds: readonly string[];
    childIds: readonly string[];
    lifespanYears: number;
    stage: string;
  };
  brain: {
    present: boolean;
    budgetBytes: number;
    usedBytes: number;
    remainingBytes: number;
    usageFraction: number;
    phase: string;
    development: ReturnType<typeof brainDevelopmentProfileV1>;
    workingStep?: BrainStateV1['workingStep'];
    dataCount: number;
    referenceCount: number;
    recentMessageCount: number;
    lastPerceptWorldMinute?: number;
    migrationImportedLegacy?: boolean;
    dataKinds: Record<string, number>;
    referenceKinds: Record<string, number>;
  };
  body: {
    present: boolean;
    phenotype?: Readonly<NonNullable<NonNullable<WorldState['v21']>['bodiesByAgentId'][string]['bodyCore']>['phenotype']>;
    homeostasis?: Readonly<NonNullable<NonNullable<WorldState['v21']>['bodiesByAgentId'][string]['bodyCore']>['homeostasis']>;
    reproductive?: Readonly<NonNullable<NonNullable<WorldState['v21']>['bodiesByAgentId'][string]['bodyCore']>['reproductive']>;
    systems?: Readonly<NonNullable<WorldState['v21']>['bodiesByAgentId'][string]['systems']>;
    signals?: ReturnType<typeof bodySignalsV1>;
    pain?: number;
    mobilityScale?: number;
    recoveryScale?: number;
    wounds: ReadonlyArray<unknown>;
    diseases: ReadonlyArray<unknown>;
    sleep?: ReturnType<typeof bodySleepStateV21>;
    motorDevelopment: ReturnType<typeof humanMotorDevelopmentV1>;
    visionDevelopment: ReturnType<typeof humanVisionDevelopmentV1>;
  };
  mind: {
    mind: Readonly<AgentState['mind']>;
    personality: Readonly<AgentState['personality']>;
    skills: Readonly<AgentState['skills']>;
    goal: Readonly<AgentState['goal']>;
    lastDecision?: Readonly<NonNullable<AgentState['lastDecision']>>;
    plan?: Readonly<NonNullable<AgentState['plan']>>;
    learning?: Readonly<NonNullable<AgentState['learning']>>;
  };
  knowledge: {
    v15?: unknown;
    language?: unknown;
    livelihood?: unknown;
    applied?: unknown;
    knownPlaceCount: number;
    knownDungeonCount: number;
  };
  relationships: {
    count: number;
    items: ReadonlyArray<RelationshipState>;
  };
}

function countKinds(values: readonly string[]): Record<string, number> {
  const result: Record<string, number> = {};
  for (const value of values) result[value] = (result[value] ?? 0) + 1;
  return result;
}

function relationshipItemsV1(
  world: Readonly<WorldState>,
  agentId: string,
): RelationshipState[] {
  return Object.values(world.relationships)
    .filter((relationship) =>
      relationship.agentA === agentId || relationship.agentB === agentId,
    )
    .map((relationship) => ({ ...relationship }))
    .sort((left, right) => right.updatedAt - left.updatedAt);
}

/**
 * Read-only observer projection for the owner UI. It does not feed the Spark's
 * brain and does not change simulation state.
 */
export function buildAgentAnalyticsV1(
  world: Readonly<WorldState>,
  agentId: string,
): AgentAnalyticsSnapshotV1 {
  const agent = world.agents[agentId];
  if (!agent) throw new Error(`Unknown analytics agent ${agentId}.`);

  const brain = world.iskorkaBrainV1?.brainsByAgentId[agent.id];
  const usedBytes = brain ? logicalBrainBytesV1(brain) : 0;
  const body = world.v21?.bodiesByAgentId[agent.id];
  const core = body?.bodyCore;
  const relationships = relationshipItemsV1(world, agent.id);

  return {
    agentId: agent.id,
    worldMinute: world.calendar.elapsedWorldMinutes,
    worldRevision: world.revision,
    identity: {
      name: agent.name,
      ...(agent.sex ? { sex: agent.sex } : {}),
      ageYears: agent.life.ageYears,
      generation: agent.life.generation,
      alive: agent.life.alive,
      locationId: agent.locationId,
      locationName: world.places[agent.locationId]?.name ?? agent.locationId,
      position: { x: agent.position.x, y: agent.position.y },
      ...(agent.lastAction ? { currentAction: agent.lastAction } : {}),
      ...(agent.movement ? { movement: agent.movement } : {}),
    },
    life: {
      health: agent.life.health,
      energy: agent.energy,
      stress: agent.stress,
      resources: agent.resources,
      socialDrive: agent.socialDrive,
      needs: agent.needs,
      physiology: agent.life.physiology,
      parentIds: [...agent.life.parentIds],
      childIds: [...agent.life.childIds],
      lifespanYears: agent.life.lifespanYears,
      stage: agent.life.stage,
    },
    brain: {
      present: Boolean(brain),
      budgetBytes: BRAIN_LOGICAL_BUDGET_BYTES_V1,
      usedBytes,
      remainingBytes: Math.max(0, BRAIN_LOGICAL_BUDGET_BYTES_V1 - usedBytes),
      usageFraction: BRAIN_LOGICAL_BUDGET_BYTES_V1 > 0
        ? usedBytes / BRAIN_LOGICAL_BUDGET_BYTES_V1
        : 0,
      phase: brainDevelopmentProfileV1(agent.life.ageYears).phase,
      development: brainDevelopmentProfileV1(agent.life.ageYears),
      ...(brain?.workingStep ? { workingStep: brain.workingStep } : {}),
      dataCount: brain?.data.length ?? 0,
      referenceCount: brain?.perception?.references.length ?? 0,
      recentMessageCount: brain?.perception?.recentMessages.length ?? 0,
      ...(brain?.perception?.lastPerceptWorldMinute === undefined
        ? {}
        : { lastPerceptWorldMinute: brain.perception.lastPerceptWorldMinute }),
      ...(brain ? { migrationImportedLegacy: brain.migration.importedLegacy } : {}),
      dataKinds: countKinds((brain?.data ?? []).map((item) => item.kind)),
      referenceKinds: countKinds(
        (brain?.perception?.references ?? []).map((item) => item.kind),
      ),
    },
    body: {
      present: Boolean(body && core),
      ...(core ? { phenotype: core.phenotype } : {}),
      ...(core ? { homeostasis: core.homeostasis } : {}),
      ...(core ? { reproductive: core.reproductive } : {}),
      ...(body ? { systems: body.systems } : {}),
      ...(body && core ? { signals: bodySignalsV1(agent, body, core) } : {}),
      ...(body ? { pain: body.pain } : {}),
      ...(body ? { mobilityScale: body.mobilityScale } : {}),
      ...(body ? { recoveryScale: body.recoveryScale } : {}),
      wounds: body?.wounds.map((wound) => ({ ...wound })) ?? [],
      diseases: body?.diseases.map((disease) => ({ ...disease })) ?? [],
      ...(bodySleepStateV21(world, agent.id)
        ? { sleep: bodySleepStateV21(world, agent.id) }
        : {}),
      motorDevelopment: humanMotorDevelopmentV1(agent.life.ageYears),
      visionDevelopment: humanVisionDevelopmentV1(agent.life.ageYears),
    },
    mind: {
      mind: agent.mind,
      personality: agent.personality,
      skills: agent.skills,
      goal: agent.goal,
      ...(agent.lastDecision ? { lastDecision: agent.lastDecision } : {}),
      ...(agent.plan ? { plan: agent.plan } : {}),
      ...(agent.learning ? { learning: agent.learning } : {}),
    },
    knowledge: {
      ...(world.v15?.knowledgeByAgentId[agent.id]
        ? { v15: world.v15.knowledgeByAgentId[agent.id] }
        : {}),
      ...(world.v18?.languageByAgentId[agent.id]
        ? { language: world.v18.languageByAgentId[agent.id] }
        : {}),
      ...(world.v18?.livelihoodByAgentId[agent.id]
        ? { livelihood: world.v18.livelihoodByAgentId[agent.id] }
        : {}),
      ...(world.v21?.appliedKnowledgeByAgentId[agent.id]
        ? { applied: world.v21.appliedKnowledgeByAgentId[agent.id] }
        : {}),
      knownPlaceCount: agent.knownPlaceIds?.length ?? 0,
      knownDungeonCount: agent.knownDungeonIds?.length ?? 0,
    },
    relationships: {
      count: relationships.length,
      items: relationships,
    },
  };
}
