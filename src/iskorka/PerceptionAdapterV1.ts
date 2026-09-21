import type { AgentState, WorldState } from '../world/types';
import { bodySignalsV1, type BodySignalsV1 } from './BodyCoreV1';
import { brainDevelopmentProfileV1 } from './BrainLifecycleV1';
import {
  PORTABLE_HUMAN_CONTRACT_VERSION_V1,
  availableSignalV1,
  unavailableSignalV1,
  type HumanBodyPerceptV1,
  type HumanBodySignalKindV1,
  type LocalObservationV1,
  type PerceptBatchV1,
  type SubjectiveSignalV1,
} from './PortableHumanCoreV1';

const BODY_SIGNAL_KEYS: readonly HumanBodySignalKindV1[] = [
  'thirst',
  'hunger',
  'breathlessness',
  'weakness',
  'coldStress',
  'heatStress',
  'sweating',
  'tremor',
  'heartPounding',
  'bladderUrge',
  'bowelUrge',
  'physicalDiscomfort',
  'cryingDrive',
  'tears',
  'blushing',
  'goosebumps',
  'dryMouth',
  'startle',
  'physicalPleasure',
  'sexualArousal',
  'postPleasureRelaxation',
] as const;

const LOCAL_VISIBILITY_RADIUS = 45;
const MAX_LOCAL_OBSERVATIONS = 24;

function unavailableInteroception(): Record<HumanBodySignalKindV1, SubjectiveSignalV1> {
  return Object.fromEntries(
    BODY_SIGNAL_KEYS.map((key) => [key, unavailableSignalV1()]),
  ) as Record<HumanBodySignalKindV1, SubjectiveSignalV1>;
}

function interoceptionFromSignals(
  signals: Readonly<BodySignalsV1>,
): Record<HumanBodySignalKindV1, SubjectiveSignalV1> {
  return Object.fromEntries(
    BODY_SIGNAL_KEYS.map((key) => [key, availableSignalV1(signals[key])]),
  ) as Record<HumanBodySignalKindV1, SubjectiveSignalV1>;
}

/**
 * Body -> brain boundary. Missing body state means unknown/unavailable, never
 * perfect health and never a fabricated numeric zero.
 */
export function humanBodyPerceptV1(
  world: Readonly<WorldState>,
  agent: Readonly<AgentState>,
): HumanBodyPerceptV1 {
  const body = world.v21?.bodiesByAgentId[agent.id];
  const core = body?.bodyCore;
  const development = brainDevelopmentProfileV1(agent.life.ageYears);
  return {
    version: PORTABLE_HUMAN_CONTRACT_VERSION_V1,
    ownerAgentId: agent.id,
    worldMinute: world.calendar.elapsedWorldMinutes,
    ageYears: agent.life.ageYears,
    brainLifePhase: development.phase,
    interoception:
      body && core
        ? interoceptionFromSignals(bodySignalsV1(agent, body, core))
        : unavailableInteroception(),
  };
}

function localObservationsV1(
  world: Readonly<WorldState>,
  agent: Readonly<AgentState>,
): LocalObservationV1[] {
  const result: LocalObservationV1[] = [];
  const current = world.places[agent.locationId];
  if (current) {
    result.push({
      objectId: current.id,
      kind: 'place',
      relation: 'here',
      observedLabel: current.name,
    });
    for (const id of current.connectedPlaceIds) {
      if (result.length >= MAX_LOCAL_OBSERVATIONS) break;
      const place = world.places[id];
      if (!place) continue;
      if (
        Math.hypot(
          place.mapX - agent.position.x,
          place.mapY - agent.position.y,
        ) > LOCAL_VISIBILITY_RADIUS
      ) continue;
      result.push({
        objectId: place.id,
        kind: 'place',
        relation: 'connected_visible',
        observedLabel: place.name,
      });
    }
  }

  if (result.length < MAX_LOCAL_OBSERVATIONS) {
    const people = Object.values(world.agents)
      .filter(
        (other) =>
          other.id !== agent.id &&
          other.life.alive &&
          !other.movement &&
          other.locationId === agent.locationId,
      )
      .sort((a, b) => a.id.localeCompare(b.id));
    for (const other of people) {
      if (result.length >= MAX_LOCAL_OBSERVATIONS) break;
      result.push({
        objectId: other.id,
        kind: 'person',
        relation: 'co_located',
        observedLabel: other.name,
      });
    }
  }
  return result;
}

/**
 * Iskorka adapter may read the world, but it emits only the resident's bounded
 * current perception. No WorldState, hidden emotion, remote stock or foreign
 * brain object is returned.
 */
export function perceptBatchForAgentV1(
  world: Readonly<WorldState>,
  agentId: string,
): PerceptBatchV1 {
  const agent = world.agents[agentId];
  if (!agent?.life.alive) {
    throw new Error(`Living resident ${agentId} is required for perception.`);
  }
  return {
    version: PORTABLE_HUMAN_CONTRACT_VERSION_V1,
    ownerAgentId: agent.id,
    worldMinute: world.calendar.elapsedWorldMinutes,
    body: humanBodyPerceptV1(world, agent),
    localObservations: localObservationsV1(world, agent),
    receivedMessages: [],
  };
}
